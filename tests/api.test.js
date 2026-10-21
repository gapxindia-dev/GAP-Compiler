'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A throw-away data directory seeded with LEGACY (pre-upgrade) data so the
// migration behaviour is tested too. All names/IDs here are synthetic.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-test-'));
fs.writeFileSync(path.join(dir, 'vaults.json'), JSON.stringify({
  '11': { studentId: '11', studentName: 'Legacy Student', salt: 'aa', pinHash: 'bb', queries: [{ id: 'q1', title: 'x', sql: 'select 1' }], notes: [] }
}));
fs.writeFileSync(path.join(dir, 'community.json'), JSON.stringify([
  { id: 'comm_1', title: 'University DB: Top 3 Students Per Department by GPA', author: 'Aarav (DBMS TA)', sql: 'select 1', upvotes: 42 },
  { id: 'comm_2', title: 'Employee-Manager Hierarchy (Self Join)', author: 'Priya_CS', sql: 'select 2', upvotes: 38 },
  // Not a seed: same id shape but different title, so it must survive the cleanup.
  { id: 'comm_9', title: 'A real post from a student', author: 'Real Person', sql: 'select 3', upvotes: 1 }
]));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'x'.repeat(48);

const { app } = require('../server');
let server, base;
before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function api(method, url, { token, body, ip, headers } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
      ...(headers || {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}
let ipCounter = 10;
const freshIp = () => `10.0.0.${++ipCounter}`;
let mobileCounter = 9876500000;
const freshMobile = () => String(++mobileCounter);
const PW = 'correct horse 42';

async function signUp(name, mobile, password = PW) {
  const m = mobile || freshMobile();
  const r = await api('POST', '/api/auth/register', { ip: freshIp(), body: { fullName: name, mobile: m, password, confirmPassword: password } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { token: r.data.token, id: r.data.student.studentId, mobile: m, name };
}

test('migration: demo posts removed, genuine post and legacy file kept, backup taken', () => {
  const board = JSON.parse(fs.readFileSync(path.join(dir, 'community.json'), 'utf8'));
  assert.deepEqual(board.map((p) => p.id), ['comm_9']);
  assert.ok(fs.existsSync(path.join(dir, 'vaults.json')), 'legacy vaults are not deleted');
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).some((d) => d.startsWith('pre-migration')));
});

test('legacy accounts cannot sign in', async () => {
  const r = await api('POST', '/api/auth/login', { ip: freshIp(), body: { studentId: '11', password: 'anything-at-all' } });
  assert.equal(r.status, 401);
});

test('registration validates input', async () => {
  const bad = (body) => api('POST', '/api/auth/register', { ip: freshIp(), body });
  assert.equal((await bad({ fullName: '', mobile: '9876543210', password: PW, confirmPassword: PW })).status, 400);
  assert.equal((await bad({ fullName: 'Ann', mobile: '123', password: PW, confirmPassword: PW })).status, 400);
  assert.equal((await bad({ fullName: 'Ann', mobile: 'abcdefghij', password: PW, confirmPassword: PW })).status, 400);
  assert.equal((await bad({ fullName: 'Ann', mobile: '9876543210', password: 'short', confirmPassword: 'short' })).status, 400);
  assert.equal((await bad({ fullName: 'Ann', mobile: '9876543210', password: PW, confirmPassword: PW + 'x' })).status, 400);
});

test('student IDs are unique and well-formed; passwords are hashed', async () => {
  const ids = new Set();
  for (let i = 0; i < 12; i++) ids.add((await signUp(`Student ${i}`)).id);
  assert.equal(ids.size, 12);
  for (const id of ids) assert.match(id, /^STUD\d{4,}$/);
  const raw = fs.readFileSync(path.join(dir, 'users.json'), 'utf8');
  assert.ok(!raw.includes(PW), 'plaintext password must never be stored');
  assert.match(raw, /scrypt\$/);
});

test('login works, wrong password fails with a generic message, /me needs a token', async () => {
  const s = await signUp('Login Person');
  const ok = await api('POST', '/api/auth/login', { ip: freshIp(), body: { studentId: s.id.toLowerCase(), password: PW } });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);
  assert.equal(JSON.stringify(ok.data).includes('passwordHash'), false);
  assert.equal(JSON.stringify(ok.data).includes(s.mobile), false);
  const bad = await api('POST', '/api/auth/login', { ip: freshIp(), body: { studentId: s.id, password: 'nope-nope-nope' } });
  const unknown = await api('POST', '/api/auth/login', { ip: freshIp(), body: { studentId: 'GAP-000000', password: 'nope-nope-nope' } });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error, unknown.data.error, 'unknown ID and wrong password look identical');
  assert.equal((await api('GET', '/api/auth/me')).status, 401);
  assert.equal((await api('GET', '/api/auth/me', { token: ok.data.token })).status, 200);
});

test('login locks an account after repeated failures', async () => {
  const s = await signUp('Lockout Person');
  let last;
  for (let i = 0; i < 9; i++) last = await api('POST', '/api/auth/login', { ip: freshIp(), body: { studentId: s.id, password: 'wrong-wrong' } });
  assert.equal(last.status, 429);
  const real = await api('POST', '/api/auth/login', { ip: freshIp(), body: { studentId: s.id, password: PW } });
  assert.equal(real.status, 429, 'even the right password is refused while locked');
});

test('forgot password: verified on the server, resets, invalidates sessions, is single-use', async () => {
  const s = await signUp('Recover Person', '+91 98765 11111');
  const ip = freshIp();
  // wrong mobile and unknown ID get the same generic answer
  const wrong = await api('POST', '/api/auth/recover/verify', { ip, body: { studentId: s.id, mobile: '9999999999' } });
  const unknown = await api('POST', '/api/auth/recover/verify', { ip, body: { studentId: 'GAP-000001', mobile: '9876511111' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, unknown.data.error);
  // Cannot skip verification: forged / missing tokens are rejected
  const forged = await api('POST', '/api/auth/recover/reset', { ip, body: { resetToken: 'abc.def', newPassword: 'brand new pw 1', confirmPassword: 'brand new pw 1' } });
  assert.equal(forged.status, 401);
  // A session token is not accepted as a reset token
  const sessionAsReset = await api('POST', '/api/auth/recover/reset', { ip, body: { resetToken: s.token, newPassword: 'brand new pw 1', confirmPassword: 'brand new pw 1' } });
  assert.equal(sessionAsReset.status, 401);

  const ok = await api('POST', '/api/auth/recover/verify', { ip, body: { studentId: s.id, mobile: '9876511111' } });
  assert.equal(ok.status, 200, 'formatting differences (+91, spaces) are normalised');
  const mismatch = await api('POST', '/api/auth/recover/reset', { ip, body: { resetToken: ok.data.resetToken, newPassword: 'brand new pw 1', confirmPassword: 'different pw 2' } });
  assert.equal(mismatch.status, 400);
  const done = await api('POST', '/api/auth/recover/reset', { ip, body: { resetToken: ok.data.resetToken, newPassword: 'brand new pw 1', confirmPassword: 'brand new pw 1' } });
  assert.equal(done.status, 200);

  assert.equal((await api('GET', '/api/auth/me', { token: s.token })).status, 401, 'old session invalidated');
  assert.equal((await api('POST', '/api/auth/login', { ip: freshIp(), body: { studentId: s.id, password: PW } })).status, 401, 'old password no longer works');
  assert.equal((await api('POST', '/api/auth/login', { ip: freshIp(), body: { studentId: s.id, password: 'brand new pw 1' } })).status, 200);
  const again = await api('POST', '/api/auth/recover/reset', { ip, body: { resetToken: ok.data.resetToken, newPassword: 'another pw 33', confirmPassword: 'another pw 33' } });
  assert.equal(again.status, 401, 'reset token cannot be reused');
});

test('forgot password is rate limited per account', async () => {
  const s = await signUp('Brute Force Target', '9000000001');
  let last;
  for (let i = 0; i < 6; i++) {
    last = await api('POST', '/api/auth/recover/verify', { ip: freshIp(), body: { studentId: s.id, mobile: `900000999${i}` } });
  }
  assert.equal(last.status, 429);
  const right = await api('POST', '/api/auth/recover/verify', { ip: freshIp(), body: { studentId: s.id, mobile: '9000000001' } });
  assert.equal(right.status, 429, 'correct number is refused while the account is locked');
});

test('My Zone is private to each student and starts empty', async () => {
  const a = await signUp('Zone A');
  const b = await signUp('Zone B');
  const fresh = await api('GET', '/api/zone', { token: a.token });
  assert.deepEqual(fresh.data, { queries: [], notes: [] });
  assert.equal((await api('GET', '/api/zone')).status, 401);

  const q = await api('POST', '/api/zone/queries', { token: a.token, body: { title: 'Mine', sql: 'SELECT 1', tags: 'x, y' } });
  assert.equal(q.status, 201);
  await api('POST', '/api/zone/notes', { token: a.token, body: { title: 'Note', content: 'hello' } });
  assert.equal((await api('GET', '/api/zone', { token: b.token })).data.queries.length, 0);
  assert.equal((await api('PUT', `/api/zone/queries/${q.data.item.id}`, { token: b.token, body: { title: 'Hack', sql: 'x' } })).status, 404);
  assert.equal((await api('DELETE', `/api/zone/queries/${q.data.item.id}`, { token: b.token })).status, 404);
  const upd = await api('PUT', `/api/zone/queries/${q.data.item.id}`, { token: a.token, body: { title: 'Renamed', sql: 'SELECT 2' } });
  assert.equal(upd.data.item.title, 'Renamed');
  assert.equal((await api('DELETE', `/api/zone/queries/${q.data.item.id}`, { token: a.token })).status, 200);
  assert.equal((await api('GET', '/api/zone', { token: a.token })).data.queries.length, 0);
  assert.equal((await api('POST', '/api/zone/queries', { token: a.token, body: { title: '', sql: '' } })).status, 400);
});

test('Class Board: only genuine posts, auth required, ownership enforced on the server', async () => {
  const a = await signUp('Board Author');
  const b = await signUp('Board Other');
  const list = await api('GET', '/api/community');
  assert.deepEqual(list.data.community.map((p) => p.title), ['A real post from a student']);

  assert.equal((await api('POST', '/api/community', { body: { title: 't', sql: 'select 1' } })).status, 401);
  const post = await api('POST', '/api/community', { token: a.token, body: { title: 'Joins help', sql: 'SELECT 1', author: 'Spoofed Name', ownerId: 'GAP-000000' } });
  assert.equal(post.status, 201);
  assert.equal(post.data.item.author, 'Board Author', 'author comes from the account, not the request');
  assert.equal(post.data.item.mine, true);
  assert.equal('ownerId' in post.data.item, false);

  const asOther = (await api('GET', '/api/community', { token: b.token })).data.community.find((p) => p.id === post.data.item.id);
  assert.equal(asOther.mine, false);
  assert.equal(JSON.stringify(asOther).includes(a.id), false, 'student IDs never leak to other students');

  assert.equal((await api('DELETE', `/api/community/${post.data.item.id}`)).status, 401);
  assert.equal((await api('DELETE', `/api/community/${post.data.item.id}`, { token: b.token })).status, 403);
  assert.equal((await api('DELETE', '/api/community/comm_9', { token: b.token })).status, 403, 'legacy posts without an owner cannot be deleted by anyone');
  assert.equal((await api('GET', '/api/community')).data.community.some((p) => p.id === post.data.item.id), true);

  const like = await api('POST', `/api/community/${post.data.item.id}/like`, { token: b.token });
  assert.deepEqual(like.data, { upvotes: 1, liked: true });
  assert.deepEqual((await api('POST', `/api/community/${post.data.item.id}/like`, { token: b.token })).data, { upvotes: 0, liked: false });

  assert.equal((await api('DELETE', `/api/community/${post.data.item.id}`, { token: a.token })).status, 200);
  assert.equal((await api('GET', '/api/community')).data.community.some((p) => p.id === post.data.item.id), false);
  assert.equal((await api('DELETE', `/api/community/${post.data.item.id}`, { token: a.token })).status, 404);

  const note = await api('POST', '/api/community', { token: a.token, body: { type: 'note', title: 'Tip', content: 'Use IS NULL' } });
  assert.equal(note.data.item.type, 'note');
  // persistence: the file on disk reflects the change
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'community.json'), 'utf8'));
  assert.equal(onDisk.some((p) => p.title === 'Joins help'), false);
});

test('Quick Share: create needs sign-in, retrieve is open, codes expire, owner can revoke', async () => {
  const a = await signUp('Sharer');
  const b = await signUp('Other Sharer');
  assert.equal((await api('POST', '/api/share', { body: { title: 't', content: 'c', expiryHours: 24 } })).status, 401);
  assert.equal((await api('POST', '/api/share', { token: a.token, body: { title: 't', content: 'c', expiryHours: 5 } })).status, 400);

  const made = await api('POST', '/api/share', { token: a.token, body: { title: 'Lab 4', content: 'SELECT 1;', subject: 'DBMS', expiryHours: 1 } });
  assert.equal(made.status, 201);
  const code = made.data.share.code;
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const got = await api('GET', `/api/share/${code.toLowerCase()}`, { ip: freshIp() });
  assert.equal(got.status, 200);
  assert.equal(got.data.share.content, 'SELECT 1;');
  assert.equal(JSON.stringify(got.data).includes(a.id), false);
  assert.equal((await api('GET', '/api/share/ZZZZ-ZZZZ', { ip: freshIp() })).status, 404);

  assert.equal((await api('GET', '/api/share', { token: a.token })).data.shares.length, 1);
  assert.equal((await api('DELETE', `/api/share/${code}`, { token: b.token })).status, 404);

  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 3600_000;
  try {
    assert.equal((await api('GET', `/api/share/${code}`, { ip: freshIp() })).status, 410, 'expired codes are refused');
  } finally { Date.now = realNow; }
  assert.equal((await api('GET', `/api/share/${code}`, { ip: freshIp() })).status, 404, 'and then purged');

  const again = await api('POST', '/api/share', { token: a.token, body: { title: 'Two', content: 'x', expiryHours: 24 } });
  assert.equal((await api('DELETE', `/api/share/${again.data.share.code}`, { token: a.token })).status, 200);
});

test('Cheat Sheet and old Quick Beam / vault routes are gone', async () => {
  for (const [m, u] of [['POST', '/api/auth/vault'], ['GET', '/api/vault'], ['POST', '/api/beam'], ['GET', '/api/beam/SQL-1234']]) {
    assert.equal((await api(m, u)).status, 404, `${m} ${u}`);
  }
});

test('unknown API paths return JSON 404, not the app shell', async () => {
  const r = await fetch(base + '/api/nope');
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type'), /json/);
});

test('Student ID format: name prefix + 4-digit serial, handles short names and duplicate names', async () => {
  // Test specific examples from prompt table
  const u1 = await signUp('Anubhav');
  const u2 = await signUp('Rahul');
  const u3 = await signUp('Sai');
  const u4 = await signUp('Om');
  const u5 = await signUp('Aarav Sharma');

  assert.match(u1.id, /^ANUB\d{4}$/);
  assert.match(u2.id, /^RAHU\d{4}$/);
  assert.match(u3.id, /^SAI\d{4}$/, 'Sai has 3 chars, used without padding');
  assert.match(u4.id, /^OM\d{4}$/, 'Om has 2 chars, used without padding');
  assert.match(u5.id, /^AARA\d{4}$/, 'Aarav Sharma uses first 4 chars of Aarav');

  // Duplicate name receives different serial
  const u1Second = await signUp('Anubhav');
  assert.match(u1Second.id, /^ANUB\d{4}$/);
  assert.notEqual(u1.id, u1Second.id, 'Students with identical names get different serial numbers');

  // IDs must be permanent and allow login
  const loginRes = await api('POST', '/api/auth/login', { ip: freshIp(), body: { studentId: u1.id, password: PW } });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.data.student.studentId, u1.id);
});

test('Duplicate mobile registration is rejected', async () => {
  const mobile = freshMobile();
  const reg1 = await api('POST', '/api/auth/register', { ip: freshIp(), body: { fullName: 'First Student', mobile, password: PW, confirmPassword: PW } });
  assert.equal(reg1.status, 201);

  const reg2 = await api('POST', '/api/auth/register', { ip: freshIp(), body: { fullName: 'Second Student', mobile, password: PW, confirmPassword: PW } });
  assert.equal(reg2.status, 409, 'Duplicate mobile number registration must be rejected');
});

test('Class Board: original uploader can edit post; others cannot', async () => {
  const author = await signUp('Author User');
  const other = await signUp('Other User');

  const post = await api('POST', '/api/community', { token: author.token, body: { title: 'Initial Title', sql: 'SELECT 1;', subject: 'SQL' } });
  assert.equal(post.status, 201);
  const postId = post.data.item.id;

  // Unauthenticated cannot edit
  const noAuth = await api('PUT', `/api/community/${postId}`, { body: { title: 'Hacked', sql: 'SELECT 2;' } });
  assert.equal(noAuth.status, 401);

  // Other user cannot edit
  const hack = await api('PUT', `/api/community/${postId}`, { token: other.token, body: { title: 'Hacked', sql: 'SELECT 2;' } });
  assert.equal(hack.status, 403);

  // Author CAN edit
  const edited = await api('PUT', `/api/community/${postId}`, { token: author.token, body: { title: 'Updated Title', sql: 'SELECT 100;', subject: 'Advanced SQL' } });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.item.title, 'Updated Title');
  assert.equal(edited.data.item.sql, 'SELECT 100;');
});

test('Academic Year Management: advance year, preserve accounts and queries, account status deactivation', async () => {
  const admin = await signUp('Administrator');
  const adminKey = process.env.ADMIN_KEY || process.env.SESSION_SECRET;
  const adminHeaders = { 'X-Admin-Key': adminKey };

  const current = await api('GET', '/api/academic-year/current');
  assert.equal(current.status, 200);
  assert.ok(current.data.academicYear);

  const overview = await api('GET', '/api/admin/overview', { token: admin.token, headers: adminHeaders });
  assert.equal(overview.status, 200);
  assert.ok(overview.data.totalStudents >= 1);

  // Advance academic year
  const adv = await api('POST', '/api/admin/academic-year/advance', {
    token: admin.token,
    headers: adminHeaders,
    body: { newAcademicYear: '2027-2028' }
  });
  assert.equal(adv.status, 200);
  assert.equal(adv.data.academicYear, '2027-2028');

  // Verify accounts are preserved and can still sign in
  const checkLogin = await api('POST', '/api/auth/login', { ip: freshIp(), body: { studentId: admin.id, password: PW } });
  assert.equal(checkLogin.status, 200);

  // Deactivate account
  const deact = await api('PUT', `/api/admin/students/${admin.id}`, {
    token: admin.token,
    headers: adminHeaders,
    body: { status: 'deactivated' }
  });
  assert.equal(deact.status, 200);
  assert.equal(deact.data.student.status, 'deactivated');

  // Deactivated user cannot log in
  const blockedLogin = await api('POST', '/api/auth/login', { ip: freshIp(), body: { studentId: admin.id, password: PW } });
  assert.equal(blockedLogin.status, 403);
});
