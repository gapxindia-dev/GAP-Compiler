'use strict';
// PostgreSQL storage backend for GAP Compiler
// Provides persistent, production-grade ACID storage on Render, Neon, Supabase, etc.

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

class PgStore {
  constructor(connectionString, localFallbackDir, log = console) {
    this.connectionString = connectionString;
    this.localDir = localFallbackDir;
    this.log = log;
    this.cache = new Map();
    this.pool = null;
    this.ready = false;
    this.readyPromise = null;
  }

  isReady() {
    return this.ready;
  }

  async init() {
    if (this.ready) return;
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = (async () => {
      const isLocal = !this.connectionString ||
        this.connectionString.includes('localhost') ||
        this.connectionString.includes('127.0.0.1');

      this.pool = new Pool({
        connectionString: this.connectionString,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
      });

      this.pool.on('error', (err) => {
        this.log.error('[pg-store] Unexpected idle client error:', err.message);
      });

      // Verify connection with retries (useful when Render Postgres is spinning up)
      let retries = 5;
      while (retries > 0) {
        try {
          const client = await this.pool.connect();
          client.release();
          break;
        } catch (err) {
          retries--;
          this.log.warn(`[pg-store] Connecting to PostgreSQL... (${retries} retries left): ${err.message}`);
          if (retries === 0) throw err;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      await this._createTables();
      await this._seedOrMigrateFromFiles();
      await this._loadAllIntoCache();
      this.ready = true;
      this.log.info('[pg-store] Connected to PostgreSQL. Persistent storage ready.');
    })();

    return this.readyPromise;
  }

  async _createTables() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        CREATE TABLE IF NOT EXISTS app_meta (
          key VARCHAR(64) PRIMARY KEY,
          value JSONB NOT NULL
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          student_id VARCHAR(32) PRIMARY KEY,
          full_name VARCHAR(120) NOT NULL,
          mobile VARCHAR(32) NOT NULL,
          password_hash TEXT NOT NULL,
          academic_year VARCHAR(32),
          class VARCHAR(64),
          status VARCHAR(32) NOT NULL DEFAULT 'active',
          role VARCHAR(32) NOT NULL DEFAULT 'student',
          token_version INT NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          last_login_at TEXT NOT NULL,
          password_changed_at TEXT
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS zone_queries (
          id VARCHAR(64) PRIMARY KEY,
          student_id VARCHAR(32) NOT NULL,
          title VARCHAR(255) NOT NULL,
          sql TEXT NOT NULL,
          subject VARCHAR(120),
          tags JSONB NOT NULL DEFAULT '[]'::jsonb,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS zone_notes (
          id VARCHAR(64) PRIMARY KEY,
          student_id VARCHAR(32) NOT NULL,
          title VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          subject VARCHAR(120),
          tags JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS shares (
          code VARCHAR(32) PRIMARY KEY,
          owner_id VARCHAR(32) NOT NULL,
          sender_name VARCHAR(120) NOT NULL,
          title VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          subject VARCHAR(120),
          created_at BIGINT NOT NULL,
          expires_at BIGINT NOT NULL
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS community (
          id VARCHAR(64) PRIMARY KEY,
          type VARCHAR(32) NOT NULL DEFAULT 'query',
          title VARCHAR(255) NOT NULL,
          description TEXT,
          subject VARCHAR(120),
          tags JSONB NOT NULL DEFAULT '[]'::jsonb,
          owner_id VARCHAR(32),
          author VARCHAR(120) NOT NULL,
          sql TEXT,
          content TEXT,
          liked_by JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TEXT NOT NULL,
          updated_at TEXT
        );
      `);

      // Indexes for performance
      await client.query('CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_zone_queries_student ON zone_queries(student_id);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_zone_notes_student ON zone_notes(student_id);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares(expires_at);');

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async _seedOrMigrateFromFiles() {
    const client = await this.pool.connect();
    try {
      const userCountRes = await client.query('SELECT COUNT(*) AS count FROM users;');
      const userCount = parseInt(userCountRes.rows[0].count, 10);

      // Only migrate from local files if PostgreSQL has 0 users and local users file exists
      if (userCount === 0 && this.localDir) {
        const usersFile = path.join(this.localDir, 'users.json');
        if (fs.existsSync(usersFile)) {
          let fileUsers = {};
          try { fileUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch { /* ignore */ }

          const numUsers = Object.keys(fileUsers).length;
          if (numUsers > 0) {
            this.log.info(`[pg-store] Migrating ${numUsers} existing account(s) from local files to PostgreSQL...`);
            await client.query('BEGIN');

            for (const u of Object.values(fileUsers)) {
              await client.query(
                `INSERT INTO users (student_id, full_name, mobile, password_hash, academic_year, class, status, role, token_version, created_at, last_login_at, password_changed_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                 ON CONFLICT (student_id) DO NOTHING;`,
                [u.studentId, u.fullName, u.mobile, u.passwordHash, u.academicYear || '2026-2027', u.class || 'General', u.status || 'active', u.role || 'student', u.tokenVersion || 1, u.createdAt || new Date().toISOString(), u.lastLoginAt || new Date().toISOString(), u.passwordChangedAt || null]
              );
            }

            // Migrate Meta
            const metaFile = path.join(this.localDir, 'meta.json');
            if (fs.existsSync(metaFile)) {
              try {
                const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
                await client.query(
                  'INSERT INTO app_meta (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING;',
                  ['meta', JSON.stringify(meta)]
                );
              } catch { /* ignore */ }
            }

            // Migrate Zone
            const zoneFile = path.join(this.localDir, 'zone.json');
            if (fs.existsSync(zoneFile)) {
              try {
                const zone = JSON.parse(fs.readFileSync(zoneFile, 'utf8'));
                for (const [studentId, z] of Object.entries(zone)) {
                  for (const q of z.queries || []) {
                    await client.query(
                      `INSERT INTO zone_queries (id, student_id, title, sql, subject, tags, notes, created_at, updated_at)
                       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
                       ON CONFLICT (id) DO NOTHING;`,
                      [q.id, studentId, q.title, q.sql, q.subject || 'General', JSON.stringify(q.tags || []), q.notes || '', q.createdAt || new Date().toISOString(), q.updatedAt || new Date().toISOString()]
                    );
                  }
                  for (const n of z.notes || []) {
                    await client.query(
                      `INSERT INTO zone_notes (id, student_id, title, content, subject, tags, created_at, updated_at)
                       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
                       ON CONFLICT (id) DO NOTHING;`,
                      [n.id, studentId, n.title, n.content, n.subject || 'General', JSON.stringify(n.tags || []), n.createdAt || new Date().toISOString(), n.updatedAt || new Date().toISOString()]
                    );
                  }
                }
              } catch { /* ignore */ }
            }

            // Migrate Community
            const commFile = path.join(this.localDir, 'community.json');
            if (fs.existsSync(commFile)) {
              try {
                const comm = JSON.parse(fs.readFileSync(commFile, 'utf8'));
                for (const p of comm) {
                  await client.query(
                    `INSERT INTO community (id, type, title, description, subject, tags, owner_id, author, sql, content, liked_by, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12, $13)
                     ON CONFLICT (id) DO NOTHING;`,
                    [p.id, p.type || 'query', p.title, p.description || '', p.subject || 'General', JSON.stringify(p.tags || []), p.ownerId || null, p.author || 'Anonymous', p.sql || null, p.content || null, JSON.stringify(p.likedBy || []), p.createdAt || new Date().toISOString(), p.updatedAt || null]
                  );
                }
              } catch { /* ignore */ }
            }

            // Migrate Shares
            const sharesFile = path.join(this.localDir, 'shares.json');
            if (fs.existsSync(sharesFile)) {
              try {
                const shares = JSON.parse(fs.readFileSync(sharesFile, 'utf8'));
                for (const s of Object.values(shares)) {
                  await client.query(
                    `INSERT INTO shares (code, owner_id, sender_name, title, content, subject, created_at, expires_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (code) DO NOTHING;`,
                    [s.code, s.ownerId, s.senderName, s.title, s.content, s.subject || 'General', s.createdAt, s.expiresAt]
                  );
                }
              } catch { /* ignore */ }
            }

            await client.query('COMMIT');
            this.log.info('[pg-store] Local data successfully migrated into PostgreSQL.');
          }
        }
      }
    } catch (err) {
      await client.query('ROLLBACK');
      this.log.error('[pg-store] Migration check failed:', err.message);
    } finally {
      client.release();
    }
  }

  async _loadAllIntoCache() {
    const client = await this.pool.connect();
    try {
      // 1. Meta
      const metaRes = await client.query("SELECT value FROM app_meta WHERE key = 'meta';");
      const meta = metaRes.rows.length ? metaRes.rows[0].value : {
        schemaVersion: 3,
        createdAt: new Date().toISOString(),
        nextStudentSerial: 1,
        academicYear: '2026-2027'
      };
      this.cache.set('meta', meta);

      // 2. Users
      const usersRes = await client.query('SELECT * FROM users;');
      const users = {};
      for (const row of usersRes.rows) {
        users[row.student_id] = {
          studentId: row.student_id,
          fullName: row.full_name,
          mobile: row.mobile,
          passwordHash: row.password_hash,
          academicYear: row.academic_year,
          class: row.class,
          status: row.status,
          role: row.role,
          tokenVersion: row.token_version,
          createdAt: row.created_at,
          lastLoginAt: row.last_login_at,
          passwordChangedAt: row.password_changed_at
        };
      }
      this.cache.set('users', users);

      // Ensure nextStudentSerial in meta is at least higher than all existing users
      let maxSerial = 0;
      for (const id of Object.keys(users)) {
        const m = id.match(/^[A-Z]{1,4}(\d{4,})$/);
        if (m) {
          const num = parseInt(m[1], 10);
          if (num > maxSerial) maxSerial = num;
        }
      }
      if (maxSerial >= (meta.nextStudentSerial || 1)) {
        meta.nextStudentSerial = maxSerial + 1;
        await client.query(
          "INSERT INTO app_meta (key, value) VALUES ('meta', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;",
          [JSON.stringify(meta)]
        );
      }

      // 3. Zone
      const queriesRes = await client.query('SELECT * FROM zone_queries ORDER BY created_at DESC;');
      const notesRes = await client.query('SELECT * FROM zone_notes ORDER BY created_at DESC;');
      const zone = {};
      for (const q of queriesRes.rows) {
        zone[q.student_id] ||= { queries: [], notes: [] };
        zone[q.student_id].queries.push({
          id: q.id,
          title: q.title,
          sql: q.sql,
          subject: q.subject,
          tags: q.tags || [],
          notes: q.notes,
          createdAt: q.created_at,
          updatedAt: q.updated_at
        });
      }
      for (const n of notesRes.rows) {
        zone[n.student_id] ||= { queries: [], notes: [] };
        zone[n.student_id].notes.push({
          id: n.id,
          title: n.title,
          content: n.content,
          subject: n.subject,
          tags: n.tags || [],
          createdAt: n.created_at,
          updatedAt: n.updated_at
        });
      }
      this.cache.set('zone', zone);

      // 4. Shares
      const sharesRes = await client.query('SELECT * FROM shares;');
      const shares = {};
      for (const s of sharesRes.rows) {
        shares[s.code] = {
          code: s.code,
          ownerId: s.owner_id,
          senderName: s.sender_name,
          title: s.title,
          content: s.content,
          subject: s.subject,
          createdAt: Number(s.created_at),
          expiresAt: Number(s.expires_at)
        };
      }
      this.cache.set('shares', shares);

      // 5. Community
      const commRes = await client.query('SELECT * FROM community ORDER BY created_at DESC;');
      const community = commRes.rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        description: r.description,
        subject: r.subject,
        tags: r.tags || [],
        ownerId: r.owner_id,
        author: r.author,
        sql: r.sql,
        content: r.content,
        likedBy: r.liked_by || [],
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));
      this.cache.set('community', community);
    } finally {
      client.release();
    }
  }

  get(name) {
    return this.cache.get(name);
  }

  exists(name) {
    return this.cache.has(name);
  }

  load(name, fallback) {
    if (!this.cache.has(name)) {
      this.cache.set(name, structuredClone(fallback));
    }
    return this.cache.get(name);
  }

  async mutate(name, fn) {
    const draft = structuredClone(this.cache.get(name));
    const result = await fn(draft);

    // Save to PostgreSQL before updating in-memory cache
    await this._persistDraft(name, draft);
    this.cache.set(name, draft);
    return result;
  }

  async _persistDraft(name, draft) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      if (name === 'meta') {
        await client.query(
          "INSERT INTO app_meta (key, value) VALUES ('meta', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;",
          [JSON.stringify(draft)]
        );
      } else if (name === 'users') {
        const existingIds = Object.keys(draft);
        for (const u of Object.values(draft)) {
          await client.query(
            `INSERT INTO users (student_id, full_name, mobile, password_hash, academic_year, class, status, role, token_version, created_at, last_login_at, password_changed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (student_id) DO UPDATE SET
               full_name = EXCLUDED.full_name,
               mobile = EXCLUDED.mobile,
               password_hash = EXCLUDED.password_hash,
               academic_year = EXCLUDED.academic_year,
               class = EXCLUDED.class,
               status = EXCLUDED.status,
               role = EXCLUDED.role,
               token_version = EXCLUDED.token_version,
               created_at = EXCLUDED.created_at,
               last_login_at = EXCLUDED.last_login_at,
               password_changed_at = EXCLUDED.password_changed_at;`,
            [u.studentId, u.fullName, u.mobile, u.passwordHash, u.academicYear, u.class, u.status, u.role, u.tokenVersion, u.createdAt, u.lastLoginAt, u.passwordChangedAt || null]
          );
        }
        if (existingIds.length > 0) {
          await client.query('DELETE FROM users WHERE student_id NOT IN (SELECT UNNEST($1::text[]));', [existingIds]);
        } else {
          await client.query('DELETE FROM users;');
        }
      } else if (name === 'zone') {
        // Collect all queries and notes from draft
        const allQueries = [];
        const allNotes = [];
        for (const [studentId, z] of Object.entries(draft)) {
          for (const q of z.queries || []) allQueries.push({ ...q, studentId });
          for (const n of z.notes || []) allNotes.push({ ...n, studentId });
        }

        const queryIds = allQueries.map((q) => q.id);
        for (const q of allQueries) {
          await client.query(
            `INSERT INTO zone_queries (id, student_id, title, sql, subject, tags, notes, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE SET
               title = EXCLUDED.title,
               sql = EXCLUDED.sql,
               subject = EXCLUDED.subject,
               tags = EXCLUDED.tags,
               notes = EXCLUDED.notes,
               updated_at = EXCLUDED.updated_at;`,
            [q.id, q.studentId, q.title, q.sql, q.subject, JSON.stringify(q.tags || []), q.notes || '', q.createdAt, q.updatedAt]
          );
        }
        if (queryIds.length > 0) {
          await client.query('DELETE FROM zone_queries WHERE id NOT IN (SELECT UNNEST($1::text[]));', [queryIds]);
        } else {
          await client.query('DELETE FROM zone_queries;');
        }

        const noteIds = allNotes.map((n) => n.id);
        for (const n of allNotes) {
          await client.query(
            `INSERT INTO zone_notes (id, student_id, title, content, subject, tags, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
             ON CONFLICT (id) DO UPDATE SET
               title = EXCLUDED.title,
               content = EXCLUDED.content,
               subject = EXCLUDED.subject,
               tags = EXCLUDED.tags,
               updated_at = EXCLUDED.updated_at;`,
            [n.id, n.studentId, n.title, n.content, n.subject, JSON.stringify(n.tags || []), n.createdAt, n.updatedAt]
          );
        }
        if (noteIds.length > 0) {
          await client.query('DELETE FROM zone_notes WHERE id NOT IN (SELECT UNNEST($1::text[]));', [noteIds]);
        } else {
          await client.query('DELETE FROM zone_notes;');
        }
      } else if (name === 'shares') {
        const shareCodes = Object.keys(draft);
        for (const s of Object.values(draft)) {
          await client.query(
            `INSERT INTO shares (code, owner_id, sender_name, title, content, subject, created_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (code) DO UPDATE SET
               owner_id = EXCLUDED.owner_id,
               sender_name = EXCLUDED.sender_name,
               title = EXCLUDED.title,
               content = EXCLUDED.content,
               subject = EXCLUDED.subject,
               created_at = EXCLUDED.created_at,
               expires_at = EXCLUDED.expires_at;`,
            [s.code, s.ownerId, s.senderName, s.title, s.content, s.subject, s.createdAt, s.expiresAt]
          );
        }
        if (shareCodes.length > 0) {
          await client.query('DELETE FROM shares WHERE code NOT IN (SELECT UNNEST($1::text[]));', [shareCodes]);
        } else {
          await client.query('DELETE FROM shares;');
        }
      } else if (name === 'community') {
        const postIds = draft.map((p) => p.id);
        for (const p of draft) {
          await client.query(
            `INSERT INTO community (id, type, title, description, subject, tags, owner_id, author, sql, content, liked_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12, $13)
             ON CONFLICT (id) DO UPDATE SET
               type = EXCLUDED.type,
               title = EXCLUDED.title,
               description = EXCLUDED.description,
               subject = EXCLUDED.subject,
               tags = EXCLUDED.tags,
               owner_id = EXCLUDED.owner_id,
               author = EXCLUDED.author,
               sql = EXCLUDED.sql,
               content = EXCLUDED.content,
               liked_by = EXCLUDED.liked_by,
               updated_at = EXCLUDED.updated_at;`,
            [p.id, p.type || 'query', p.title, p.description, p.subject, JSON.stringify(p.tags || []), p.ownerId || null, p.author, p.sql || null, p.content || null, JSON.stringify(p.likedBy || []), p.createdAt, p.updatedAt || null]
          );
        }
        if (postIds.length > 0) {
          await client.query('DELETE FROM community WHERE id NOT IN (SELECT UNNEST($1::text[]));', [postIds]);
        } else {
          await client.query('DELETE FROM community;');
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  snapshot(label) {
    if (!this.localDir) return { target: 'none', count: 0 };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(this.localDir, 'backups', `${label}-${stamp}`);
    fs.mkdirSync(target, { recursive: true });
    let count = 0;
    for (const [name, data] of this.cache.entries()) {
      fs.writeFileSync(path.join(target, `${name}.json`), JSON.stringify(data, null, 2));
      count++;
    }
    return { target, count };
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.ready = false;
    }
  }
}

module.exports = { PgStore };

