'use strict';
// GAP Compiler server

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { Store } = require('./lib/store');
const sec = require('./lib/security');
const migrations = require('./lib/migrations');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const IS_TEST = process.env.NODE_ENV === 'test';

const LIMITS = {
  name: { min: 2, max: 60 },
  title: { min: 1, max: 120 },
  subject: { max: 60 },
  description: { max: 1000 },
  sql: { max: 50_000 },
  note: { max: 20_000 },
  shareContent: { max: 100_000 },
  tags: { count: 8, length: 30 },
  zoneItems: 500,
  activeShares: 20,
  password: { min: 8, max: 128 }
};
const SESSION_TTL = { shared: 8 * 3600_000, remembered: 14 * 24 * 3600_000 };
const RESET_TTL = 10 * 60_000;
const SHARE_EXPIRY_HOURS = [1, 6, 24, 72, 168];

// ---------------------------------------------------------------- setup
const log = {
  info: (...a) => !IS_TEST && console.log(...a),
  warn: (...a) => !IS_TEST && console.warn(...a),
  error: (...a) => console.error(...a)
};

const store = new Store(DATA_DIR);
migrations.run(store, log);

// Signing secret: environment variable first; otherwise a generated key kept in
// the data directory so sessions survive restarts.
function loadSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) return process.env.SESSION_SECRET;
  if (process.env.SESSION_SECRET) log.warn('[security] SESSION_SECRET is shorter than 32 characters and was ignored.');
  const file = path.join(DATA_DIR, '.session-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, generated, { mode: 0o600 });
  log.warn('[security] SESSION_SECRET is not set. A random secret was generated in the data directory. ' +
    'Set SESSION_SECRET (32+ characters) in your environment for production.');
  return generated;
}
const SECRET = loadSecret();
const limiter = new sec.RateLimiter();

// Used so an unknown Student ID costs about the same time as a wrong password.
let DUMMY_HASH = null;
sec.hashPassword(crypto.randomBytes(12).toString('hex')).then((h) => { DUMMY_HASH = h; });

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---------------------------------------------------------------- helpers
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const signToken = (payload) => sec.signToken(payload, SECRET);
const now = () => new Date().toISOString();
const newId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

function cleanText(value, { min = 0, max, label }) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < min) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer.`);
  return s;
}

function cleanTags(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const tag = String(t).trim().replace(/^#+/, '').slice(0, LIMITS.tags.length);
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      out.push(tag);
    }
    if (out.length >= LIMITS.tags.count) break;
  }
  return out;
}

function checkPassword(password, confirm) {
  if (typeof password !== 'string' || password.length < LIMITS.password.min) {
    throw new HttpError(400, `Password must be at least ${LIMITS.password.min} characters.`, { field: 'password' });
  }
  if (password.length > LIMITS.password.max) {
    throw new HttpError(400, `Password must be ${LIMITS.password.max} characters or fewer.`, { field: 'password' });
  }
  if (confirm !== undefined && password !== confirm) {
    throw new HttpError(400, 'Passwords do not match.', { field: 'confirmPassword' });
  }
}

function limit(key, max, windowMs, message) {
  const r = limiter.consume(key, max, windowMs);
  if (!r.ok) throw new HttpError(429, message || 'Too many attempts. Try again later.', { retryAfter: r.retryAfter });
}

function assertNotBlocked(key, max, message) {
  const b = limiter.isBlocked(key, max);
  if (b.blocked) throw new HttpError(429, message, { retryAfter: b.retryAfter });
}

function issueSession(user, shared) {
  const ttl = shared ? SESSION_TTL.shared : SESSION_TTL.remembered;
  return signToken({ typ: 'session', sid: user.studentId, tv: user.tokenVersion, exp: Date.now() + ttl });
}

const publicUser = (user) => ({ studentId: user.studentId, fullName: user.fullName });

function authFromRequest(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const payload = sec.verifyToken(header.slice(7), SECRET, 'session');
  if (!payload) return null;
  const users = store.get('users');
  const user = Object.hasOwn(users, payload.sid) ? users[payload.sid] : null;
  if (!user || user.tokenVersion !== payload.tv) return null;
  return user;
}

function requireAuth(req, res, next) {
  const user = authFromRequest(req);
  if (!user) return next(new HttpError(401, 'Your session has expired. Sign in again.', { code: 'AUTH_REQUIRED' }));
  req.user = user;
  next();
}

function optionalAuth(req, res, next) {
  req.user = authFromRequest(req);
  next();
}

// ---------------------------------------------------------------- middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.DISABLE_CSP !== '1') {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; '));
  }
  next();
});

app.use((req, res, next) => {
  if (IS_TEST || !req.path.startsWith('/api/')) return next();
  const start = Date.now();
  res.on('finish', () => log.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`));
  next();
});

app.use('/api', express.json({ limit: '300kb' }));
app.use('/api', (req, res, next) => {
  limit(`api:${req.ip}`, 1200, 60_000, 'Too many requests. Slow down and try again.');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------- auth
// IP limits count FAILURES only, so a school lab behind one shared address is not
// locked out by many successful sign-ins.
app.post('/api/auth/register', wrap(async (req, res) => {
  limit(`register:${req.ip}`, 60, 3600_000, 'Too many sign-ups from this network. Try again later.');
  const { fullName, mobile, password, confirmPassword } = req.body || {};
  const name = cleanText(fullName, { ...LIMITS.name, min: LIMITS.name.min, label: 'Full name' });
  const mobileNorm = sec.normalizeMobile(mobile);
  if (!mobileNorm) throw new HttpError(400, 'Enter a valid mobile number (10 to 15 digits).', { field: 'mobile' });
  checkPassword(password, confirmPassword);

  const passwordHash = await sec.hashPassword(password);
  const user = store.mutate('users', (users) => {
    // Uniqueness is checked in the same synchronous step that inserts the record.
    const studentId = sec.generateId('GAP', 6, (id) => Object.hasOwn(users, id));
    const record = {
      studentId, fullName: name, mobile: mobileNorm, passwordHash,
      tokenVersion: 1, createdAt: now(), lastLoginAt: now()
    };
    users[studentId] = record;
    return record;
  });
  log.info(`[auth] registered ${user.studentId}`);
  res.status(201).json({ token: issueSession(user, false), student: publicUser(user) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { studentId, password, shared } = req.body || {};
  const id = sec.normalizeStudentId(studentId);
  if (!id || typeof password !== 'string' || !password) {
    throw new HttpError(400, 'Enter your Student ID and password.');
  }
  const ipKey = `login-ip:${req.ip}`;
  const idKey = `login-id:${id}`;
  assertNotBlocked(ipKey, 40, 'Too many failed sign-ins from this network. Try again in a few minutes.');
  assertNotBlocked(idKey, 8, 'Too many failed attempts for this Student ID. Try again later.');

  const users = store.get('users');
  const user = Object.hasOwn(users, id) ? users[id] : null;
  const ok = await sec.verifyPassword(password, user ? user.passwordHash : (DUMMY_HASH || 'x'));
  if (!user || !ok) {
    limiter.fail(idKey, 15 * 60_000);
    limiter.fail(ipKey, 15 * 60_000);
    log.info(`[auth] failed sign-in for ${id.slice(0, 20)}`);
    throw new HttpError(401, 'Incorrect Student ID or password.');
  }
  limiter.clear(idKey);
  store.mutate('users', (all) => { all[id].lastLoginAt = now(); });
  res.json({ token: issueSession(user, !!shared), student: publicUser(user) });
}));

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ student: publicUser(req.user) }));

// Password recovery. Step 1 checks Student ID + registered mobile on the server and
// returns a short-lived, single-purpose token. Step 2 sets the new password.
const RECOVERY_ERROR = 'The Student ID and mobile number do not match our records.';

app.post('/api/auth/recover/verify', wrap(async (req, res) => {
  const { studentId, mobile } = req.body || {};
  const id = sec.normalizeStudentId(studentId);
  const mobileNorm = sec.normalizeMobile(mobile);
  const ipKey = `recover-ip:${req.ip}`;
  const idKey = `recover-id:${id}`;
  assertNotBlocked(ipKey, 15, 'Too many recovery attempts from this network. Try again later.');
  assertNotBlocked(idKey, 5, 'Too many recovery attempts for this account. Try again later.');
  if (!id || !mobileNorm) {
    limiter.fail(ipKey, 15 * 60_000);
    throw new HttpError(400, RECOVERY_ERROR);
  }

  const users = store.get('users');
  const user = Object.hasOwn(users, id) ? users[id] : null;
  // Always compare, even for unknown IDs, so timing does not reveal which IDs exist.
  const matches = sec.safeEqual(user ? user.mobile : '0000000000', mobileNorm) && !!user;
  if (!matches) {
    limiter.fail(idKey, 30 * 60_000);
    limiter.fail(ipKey, 15 * 60_000);
    log.info(`[auth] failed recovery check for ${id.slice(0, 20)}`);
    throw new HttpError(401, RECOVERY_ERROR);
  }
  limiter.clear(idKey);
  const resetToken = signToken({ typ: 'reset', sid: user.studentId, tv: user.tokenVersion, exp: Date.now() + RESET_TTL });
  res.json({ resetToken, expiresInSeconds: RESET_TTL / 1000 });
}));

app.post('/api/auth/recover/reset', wrap(async (req, res) => {
  limit(`reset-ip:${req.ip}`, 30, 15 * 60_000, 'Too many attempts. Try again later.');
  const { resetToken, newPassword, confirmPassword } = req.body || {};
  const payload = sec.verifyToken(resetToken, SECRET, 'reset');
  const users = store.get('users');
  const user = payload && Object.hasOwn(users, payload.sid) ? users[payload.sid] : null;
  if (!user || user.tokenVersion !== payload.tv) {
    throw new HttpError(401, 'This reset session has expired. Start again from Forgot password.', { code: 'RESET_EXPIRED' });
  }
  checkPassword(newPassword, confirmPassword);
  const passwordHash = await sec.hashPassword(newPassword);
  store.mutate('users', (all) => {
    const u = all[payload.sid];
    if (!u || u.tokenVersion !== payload.tv) {
      throw new HttpError(401, 'This reset session has already been used.', { code: 'RESET_EXPIRED' });
    }
    u.passwordHash = passwordHash;
    u.tokenVersion += 1; // signs out every session and makes the reset token single-use
    u.passwordChangedAt = now();
  });
  log.info(`[auth] password reset for ${payload.sid}`);
  res.json({ message: 'Password updated. Sign in with your new password.' });
}));

// ---------------------------------------------------------------- My Zone
const zoneFor = (zone, id) => (zone[id] ||= { queries: [], notes: [] });
const readZone = (id) => (Object.hasOwn(store.get('zone'), id) ? store.get('zone')[id] : { queries: [], notes: [] });

function parseQuery(body) {
  return {
    title: cleanText(body.title, { ...LIMITS.title, label: 'Title' }),
    sql: cleanText(body.sql, { max: LIMITS.sql.max, min: 1, label: 'SQL' }),
    subject: cleanText(body.subject, { max: LIMITS.subject.max, label: 'Subject' }) || 'General',
    tags: cleanTags(body.tags),
    notes: cleanText(body.notes, { max: LIMITS.description.max, label: 'Notes' })
  };
}
function parseNote(body) {
  return {
    title: cleanText(body.title, { ...LIMITS.title, label: 'Title' }),
    content: cleanText(body.content, { max: LIMITS.note.max, min: 1, label: 'Note' }),
    subject: cleanText(body.subject, { max: LIMITS.subject.max, label: 'Subject' }) || 'General',
    tags: cleanTags(body.tags)
  };
}

app.get('/api/zone', requireAuth, (req, res) => {
  const z = readZone(req.user.studentId);
  res.json({ queries: z.queries, notes: z.notes });
});

function itemRoutes(kind, prefix, parse, label) {
  const base = `/api/zone/${kind}`;

  app.post(base, requireAuth, (req, res) => {
    const data = parse(req.body || {});
    const item = store.mutate('zone', (zone) => {
      const z = zoneFor(zone, req.user.studentId);
      if (z.queries.length + z.notes.length >= LIMITS.zoneItems) {
        throw new HttpError(400, `My Zone is full (${LIMITS.zoneItems} items). Delete something first.`);
      }
      const record = { id: newId(prefix), ...data, createdAt: now(), updatedAt: now() };
      z[kind].unshift(record);
      return record;
    });
    res.status(201).json({ item });
  });

  app.put(`${base}/:id`, requireAuth, (req, res) => {
    const data = parse(req.body || {});
    const item = store.mutate('zone', (zone) => {
      const z = zoneFor(zone, req.user.studentId); // always the caller's own zone
      const idx = z[kind].findIndex((x) => x.id === req.params.id);
      if (idx < 0) throw new HttpError(404, `${label} not found.`);
      z[kind][idx] = { ...z[kind][idx], ...data, updatedAt: now() };
      return z[kind][idx];
    });
    res.json({ item });
  });

  app.delete(`${base}/:id`, requireAuth, (req, res) => {
    store.mutate('zone', (zone) => {
      const z = zoneFor(zone, req.user.studentId);
      const idx = z[kind].findIndex((x) => x.id === req.params.id);
      if (idx < 0) throw new HttpError(404, `${label} not found.`);
      z[kind].splice(idx, 1);
    });
    res.json({ ok: true });
  });
}
itemRoutes('queries', 'q', parseQuery, 'Query');
itemRoutes('notes', 'n', parseNote, 'Note');

app.get('/api/zone/export/:format', requireAuth, (req, res) => {
  const z = readZone(req.user.studentId);
  const u = req.user;
  if (req.params.format === 'sql') {
    let out = `-- GAP Compiler: My Zone export\n-- Student: ${u.fullName} (${u.studentId})\n-- Exported: ${now()}\n-- Queries: ${z.queries.length}\n\n`;
    z.queries.forEach((q, i) => {
      out += `-- ----------------------------------------\n-- [${i + 1}] ${q.title.replace(/\n/g, ' ')} (${q.subject})\n`;
      if (q.notes) out += `-- Notes: ${q.notes.replace(/\n/g, '\n-- ')}\n`;
      if (q.tags.length) out += `-- Tags: ${q.tags.join(', ')}\n`;
      out += `-- ----------------------------------------\n${q.sql}\n\n`;
    });
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${u.studentId}_queries.sql"`);
    return res.send(out);
  }
  if (req.params.format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${u.studentId}_my-zone.json"`);
    return res.json({ studentId: u.studentId, fullName: u.fullName, exportedAt: now(), queries: z.queries, notes: z.notes });
  }
  throw new HttpError(400, 'Unsupported export format. Choose "sql" or "json".');
});

// ---------------------------------------------------------------- Quick Share
function purgeExpiredShares() {
  const t = Date.now();
  if (Object.values(store.get('shares')).some((s) => s.expiresAt <= t)) {
    store.mutate('shares', (all) => {
      for (const [code, s] of Object.entries(all)) if (s.expiresAt <= t) delete all[code];
    });
  }
}
if (!IS_TEST) setInterval(() => { try { purgeExpiredShares(); } catch (e) { log.error(e); } }, 10 * 60_000).unref();
purgeExpiredShares();

const shareView = (s) => ({
  code: s.code, title: s.title, content: s.content, subject: s.subject,
  senderName: s.senderName, createdAt: s.createdAt, expiresAt: s.expiresAt
});

app.post('/api/share', requireAuth, (req, res) => {
  const body = req.body || {};
  const title = cleanText(body.title, { ...LIMITS.title, label: 'Title' });
  const content = cleanText(body.content, { max: LIMITS.shareContent.max, min: 1, label: 'Content' });
  const subject = cleanText(body.subject, { max: LIMITS.subject.max, label: 'Subject' }) || 'General';
  const hours = Number(body.expiryHours);
  if (!SHARE_EXPIRY_HOURS.includes(hours)) throw new HttpError(400, 'Choose an expiry time from the list.');

  purgeExpiredShares();
  const mine = Object.values(store.get('shares')).filter((s) => s.ownerId === req.user.studentId).length;
  if (mine >= LIMITS.activeShares) {
    throw new HttpError(400, `You already have ${LIMITS.activeShares} active codes. Delete one or wait for it to expire.`);
  }
  const share = store.mutate('shares', (all) => {
    const code = sec.generateShareCode((c) => Object.hasOwn(all, c));
    const created = Date.now();
    all[code] = {
      code, ownerId: req.user.studentId, senderName: req.user.fullName,
      title, content, subject, createdAt: created, expiresAt: created + hours * 3600_000
    };
    return all[code];
  });
  res.status(201).json({ share: shareView(share) });
});

app.get('/api/share', requireAuth, (req, res) => {
  purgeExpiredShares();
  const mine = Object.values(store.get('shares'))
    .filter((s) => s.ownerId === req.user.studentId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(shareView);
  res.json({ shares: mine });
});

app.get('/api/share/:code', (req, res) => {
  limit(`share-get:${req.ip}`, 120, 15 * 60_000, 'Too many lookups. Try again in a few minutes.');
  const code = String(req.params.code || '').trim().toUpperCase();
  const shares = store.get('shares');
  const share = Object.hasOwn(shares, code) ? shares[code] : null;
  if (!share) throw new HttpError(404, 'No active share found for that code. Check it and try again.');
  if (share.expiresAt <= Date.now()) {
    purgeExpiredShares();
    throw new HttpError(410, 'This code has expired. Ask the sender for a new one.');
  }
  res.json({ share: shareView(share) });
});

app.delete('/api/share/:code', requireAuth, (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  store.mutate('shares', (all) => {
    const s = Object.hasOwn(all, code) ? all[code] : null;
    if (!s || s.ownerId !== req.user.studentId) throw new HttpError(404, 'Code not found.');
    delete all[code];
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Class Board
// ownerId (the Student ID) is never sent to clients: it is half of the account
// recovery credentials. Clients only learn `mine: true/false` for the viewer.
function postView(post, viewer) {
  const likedBy = post.likedBy || [];
  return {
    id: post.id, type: post.type || 'query', title: post.title, sql: post.sql, content: post.content,
    description: post.description, subject: post.subject, tags: post.tags || [],
    author: post.author, createdAt: post.createdAt,
    upvotes: likedBy.length,
    liked: !!viewer && likedBy.includes(viewer.studentId),
    mine: !!viewer && !!post.ownerId && post.ownerId === viewer.studentId
  };
}

app.get('/api/community', optionalAuth, (req, res) => {
  const q = String(req.query.query || '').trim().toLowerCase();
  const tag = String(req.query.tag || '').trim().toLowerCase();
  const all = store.get('community');
  let items = all;
  if (q) {
    items = items.filter((p) => [p.title, p.sql, p.content, p.description].some((f) => f && f.toLowerCase().includes(q)));
  }
  if (tag) items = items.filter((p) => (p.tags || []).some((t) => t.toLowerCase() === tag));
  items = [...items].sort((a, b) =>
    (b.likedBy || []).length - (a.likedBy || []).length || String(b.createdAt).localeCompare(String(a.createdAt)));

  const counts = {};
  for (const p of all) for (const t of p.tags || []) counts[t.toLowerCase()] = (counts[t.toLowerCase()] || 0) + 1;
  const tags = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  res.json({ community: items.map((p) => postView(p, req.user)), tags, total: all.length });
});

app.post('/api/community', requireAuth, (req, res) => {
  limit(`post:${req.user.studentId}`, 30, 3600_000, 'You are posting too quickly. Try again later.');
  const body = req.body || {};
  const type = body.type === 'note' ? 'note' : 'query';
  const post = {
    id: newId('post'), type,
    title: cleanText(body.title, { ...LIMITS.title, label: 'Title' }),
    description: cleanText(body.description, { max: LIMITS.description.max, label: 'Description' }),
    subject: cleanText(body.subject, { max: LIMITS.subject.max, label: 'Subject' }) || 'General',
    tags: cleanTags(body.tags),
    // Identity always comes from the authenticated account, never from the request.
    ownerId: req.user.studentId, author: req.user.fullName,
    likedBy: [], createdAt: now()
  };
  if (type === 'query') post.sql = cleanText(body.sql, { max: LIMITS.sql.max, min: 1, label: 'SQL' });
  else post.content = cleanText(body.content, { max: LIMITS.note.max, min: 1, label: 'Note' });

  store.mutate('community', (list) => { list.unshift(post); });
  res.status(201).json({ item: postView(post, req.user) });
});

app.delete('/api/community/:id', requireAuth, (req, res) => {
  const post = store.get('community').find((p) => p.id === req.params.id);
  if (!post) throw new HttpError(404, 'Post not found. It may already have been deleted.');
  if (!post.ownerId || post.ownerId !== req.user.studentId) {
    throw new HttpError(403, 'You can only delete your own posts.');
  }
  store.mutate('community', (list) => {
    const idx = list.findIndex((p) => p.id === req.params.id && p.ownerId === req.user.studentId);
    if (idx < 0) throw new HttpError(404, 'Post not found.');
    list.splice(idx, 1);
  });
  res.json({ ok: true });
});

app.post('/api/community/:id/like', requireAuth, (req, res) => {
  const result = store.mutate('community', (list) => {
    const post = list.find((p) => p.id === req.params.id);
    if (!post) throw new HttpError(404, 'Post not found.');
    post.likedBy = post.likedBy || [];
    const i = post.likedBy.indexOf(req.user.studentId);
    if (i >= 0) post.likedBy.splice(i, 1);
    else post.likedBy.push(req.user.studentId);
    return { upvotes: post.likedBy.length, liked: i < 0 };
  });
  res.json(result);
});

// ---------------------------------------------------------------- static + errors
app.use('/api', (req, res, next) => next(new HttpError(404, 'Not found.')));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (/\.(html|js|css)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.get(/^\/(?!api\/)[^.]*$/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    if (err.extra.retryAfter) res.setHeader('Retry-After', String(err.extra.retryAfter));
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That is too large to send.' });
  log.error(`[error] ${req.method} ${req.path}:`, err.message);
  res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
});

if (require.main === module || process.env.GAP_START === '1') {
  app.listen(PORT, () => {
    log.info(`GAP Compiler running at http://localhost:${PORT} (data: ${DATA_DIR})`);
  });
}

module.exports = { app };
