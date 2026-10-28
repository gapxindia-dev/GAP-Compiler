'use strict';
// Unified Document & Database Store for GAP Compiler.
//
// Automatically uses PostgreSQL (PgStore) when DATABASE_URL is set (production on Render/Neon/Supabase).
// Seamlessly falls back to local JSON document store (FileStore) when DATABASE_URL is not set (local development & unit tests).

const fs = require('fs');
const path = require('path');
const { PgStore } = require('./pg-store');

class FileStore {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
    fs.mkdirSync(dir, { recursive: true });
    this.ready = true;
  }

  isReady() {
    return true;
  }

  async init() {
    this.load('meta', { schemaVersion: 3, createdAt: new Date().toISOString(), nextStudentSerial: 1, academicYear: '2026-2027' });
    this.load('users', {});
    this.load('zone', {});
    this.load('shares', {});
    this.load('community', []);
    this.ready = true;
    return Promise.resolve();
  }

  file(name) {
    return path.join(this.dir, `${name}.json`);
  }

  exists(name) {
    return fs.existsSync(this.file(name));
  }

  load(name, fallback) {
    const file = this.file(name);
    if (!fs.existsSync(file)) {
      this._write(name, fallback);
      this.cache.set(name, structuredClone(fallback));
      return this.cache.get(name);
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.cache.set(name, parsed);
      return parsed;
    } catch (err) {
      const aside = `${file}.corrupt-${Date.now()}`;
      fs.renameSync(file, aside);
      throw new Error(`${name}.json is not valid JSON. It was moved to ${aside}; fix or restore it, then restart. (${err.message})`);
    }
  }

  get(name) {
    return this.cache.get(name);
  }

  // fn receives a draft copy and may return a value. Throwing aborts the change.
  async mutate(name, fn) {
    const draft = structuredClone(this.cache.get(name));
    const result = await fn(draft);
    this._write(name, draft);
    this.cache.set(name, draft);
    return result;
  }

  _write(name, data) {
    const file = this.file(name);
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(data, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    let retries = 5;
    while (true) {
      try {
        fs.renameSync(tmp, file);
        break;
      } catch (err) {
        if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EEXIST') && --retries > 0) {
          try {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
          } catch {
            const start = Date.now();
            while (Date.now() - start < 25) { /* spin wait */ }
          }
          continue;
        }
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw err;
      }
    }
  }

  snapshot(label) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(this.dir, 'backups', `${label}-${stamp}`);
    fs.mkdirSync(target, { recursive: true });
    let count = 0;
    for (const f of fs.readdirSync(this.dir)) {
      if (f.endsWith('.json')) {
        fs.copyFileSync(path.join(this.dir, f), path.join(target, f));
        count++;
      }
    }
    return { target, count };
  }
}

class Store {
  constructor(dir, options = {}) {
    this.dir = dir;
    this.log = options.log || console;
    const dbUrl = options.databaseUrl || process.env.DATABASE_URL;

    if (dbUrl) {
      this.isPg = true;
      this.backend = new PgStore(dbUrl, dir, this.log);
      this.driverDescription = 'PostgreSQL';
    } else {
      this.isPg = false;
      this.backend = new FileStore(dir);
      this.driverDescription = 'Local JSON store';
    }
  }

  isReady() {
    return this.backend.isReady();
  }

  get readyPromise() {
    return this.backend.readyPromise || Promise.resolve();
  }

  async init() {
    return this.backend.init();
  }

  file(name) {
    if (this.backend.file) return this.backend.file(name);
    return path.join(this.dir, `${name}.json`);
  }

  exists(name) {
    return this.backend.exists(name);
  }

  load(name, fallback) {
    return this.backend.load(name, fallback);
  }

  get(name) {
    return this.backend.get(name);
  }

  async mutate(name, fn) {
    return this.backend.mutate(name, fn);
  }

  snapshot(label) {
    return this.backend.snapshot(label);
  }

  async close() {
    if (this.backend.close) await this.backend.close();
  }
}

module.exports = { Store, FileStore, PgStore };
