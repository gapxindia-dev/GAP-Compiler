'use strict';
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// ---------- passwords ----------
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
      N: +N, r: +r, p: +p
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba); // keep timing roughly constant
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

// ---------- signed tokens (session + password-reset) ----------
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function signToken(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token, secret, expectedType) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.typ !== expectedType) return null;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- input normalisation ----------
function normalizeStudentId(value) {
  return String(value || '').trim().toUpperCase();
}

// Strips spaces, dashes, dots and brackets; a leading +91 on a 12-digit number is
// treated as the same number as its 10-digit form. Returns null when invalid.
function normalizeMobile(value) {
  let s = String(value || '').trim();
  if (!/^\+?[\d\s\-().]+$/.test(s)) return null;
  s = s.replace(/[^\d]/g, '');
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  if (s.length < 10 || s.length > 15) return null;
  return s;
}

function generateId(prefix, digits, exists) {
  for (let i = 0; i < 50; i++) {
    const id = `${prefix}-${String(crypto.randomInt(0, 10 ** digits)).padStart(digits, '0')}`;
    if (!exists(id)) return id;
  }
  throw new Error('Could not generate a unique ID');
}

// Unambiguous alphabet (no 0/O, 1/I/L) so codes are easy to read aloud and type.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateShareCode(exists) {
  for (let i = 0; i < 50; i++) {
    let raw = '';
    for (let j = 0; j < 8; j++) raw += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    if (!exists(code)) return code;
  }
  throw new Error('Could not generate a unique share code');
}

// ---------- rate limiting (in memory, per process) ----------
class RateLimiter {
  constructor() {
    this.hits = new Map();
    setInterval(() => this.prune(), 60_000).unref();
  }

  // Counts one attempt. Returns { ok, retryAfter } (seconds).
  consume(key, max, windowMs) {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      this.hits.set(key, { count: 1, reset: now + windowMs });
      return { ok: true, retryAfter: 0 };
    }
    entry.count++;
    return { ok: entry.count <= max, retryAfter: Math.ceil((entry.reset - now) / 1000) };
  }

  // Failure counters (login / recovery): record only bad attempts.
  isBlocked(key, max) {
    const entry = this.hits.get(key);
    if (!entry || entry.reset <= Date.now()) return { blocked: false, retryAfter: 0 };
    return { blocked: entry.count >= max, retryAfter: Math.ceil((entry.reset - Date.now()) / 1000) };
  }

  fail(key, windowMs) {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.reset <= now) this.hits.set(key, { count: 1, reset: now + windowMs });
    else entry.count++;
  }

  clear(key) {
    this.hits.delete(key);
  }

  prune() {
    const now = Date.now();
    for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
  }
}

module.exports = {
  hashPassword, verifyPassword, safeEqual, signToken, verifyToken,
  normalizeStudentId, normalizeMobile, generateId, generateShareCode, RateLimiter
};
