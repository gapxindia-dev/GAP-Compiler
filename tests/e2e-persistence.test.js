'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Test directory simulating persistent disk storage
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-e2e-persistence-'));

process.env.DATA_DIR = testDataDir;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'e2e_super_secret_session_key_longer_than_32_characters_12345';

const { app } = require('../server');
let server, base;

before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
  try { fs.rmSync(testDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function api(method, url, { token, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data };
}

test('E2E Verification: Register -> Login -> Save Queries -> Create Posts -> Restart Persistence', async () => {
  // 1. Register a user and record their login ID
  const regRes = await api('POST', '/api/auth/register', {
    body: {
      fullName: 'Vikramaditya Roy',
      mobile: '9811223344',
      password: 'SafePassword123!',
      confirmPassword: 'SafePassword123!',
      studentClass: '3rd Year CS',
      academicYear: '2026-2027'
    }
  });

  assert.equal(regRes.status, 201, JSON.stringify(regRes.data));
  const student = regRes.data.student;
  const initialToken = regRes.data.token;
  assert.ok(student.studentId.startsWith('VIKR'));
  const studentId = student.studentId;

  // 2. Log in using the same credentials
  const loginRes = await api('POST', '/api/auth/login', {
    body: {
      studentId: studentId.toLowerCase(),
      password: 'SafePassword123!'
    }
  });
  assert.equal(loginRes.status, 200);
  assert.ok(loginRes.data.token);
  const sessionToken = loginRes.data.token;

  // 3. Save SQL queries to My Zone
  const queryRes = await api('POST', '/api/zone/queries', {
    token: sessionToken,
    body: {
      title: 'Top Students by GPA',
      sql: 'SELECT student_name, gpa FROM students WHERE gpa >= 3.8 ORDER BY gpa DESC;',
      subject: 'DBMS',
      tags: ['sql', 'gpa', 'university'],
      notes: 'Final exam revision query'
    }
  });
  assert.equal(queryRes.status, 201);
  const savedQueryId = queryRes.data.item.id;

  // 4. Create a Class Board post
  const postRes = await api('POST', '/api/community', {
    token: sessionToken,
    body: {
      type: 'query',
      title: 'Optimized Join between Students and Enrollments',
      sql: 'SELECT s.student_name, e.grade FROM students s JOIN enrollments e ON s.student_id = e.student_id;',
      description: 'Useful for Lab Assignment 4',
      subject: 'DBMS',
      tags: ['joins', 'assignment']
    }
  });
  assert.equal(postRes.status, 201);
  const savedPostId = postRes.data.item.id;
  assert.equal(postRes.data.item.mine, true);

  // 5. Verify queries and board are immediately retrievable
  const zoneBeforeRestart = await api('GET', '/api/zone', { token: sessionToken });
  assert.equal(zoneBeforeRestart.status, 200);
  assert.equal(zoneBeforeRestart.data.queries.length, 1);
  assert.equal(zoneBeforeRestart.data.queries[0].title, 'Top Students by GPA');

  const boardBeforeRestart = await api('GET', '/api/community', { token: sessionToken });
  assert.equal(boardBeforeRestart.status, 200);
  const foundPost = boardBeforeRestart.data.community.find((p) => p.id === savedPostId);
  assert.ok(foundPost);
  assert.equal(foundPost.author, 'Vikramaditya Roy');

  // 6. Simulate Server Restart / Container Redeploy
  // Close the current listener, re-instantiate Store from the persistent directory, and verify all records persist
  const { Store } = require('../lib/store');
  const restartedStore = new Store(testDataDir);
  await restartedStore.init();

  const persistedUsers = restartedStore.get('users');
  assert.ok(persistedUsers[studentId], 'User account must survive restart');
  assert.equal(persistedUsers[studentId].fullName, 'Vikramaditya Roy');

  const persistedZone = restartedStore.get('zone');
  assert.ok(persistedZone[studentId], 'My Zone records must survive restart');
  assert.equal(persistedZone[studentId].queries.length, 1);
  assert.equal(persistedZone[studentId].queries[0].id, savedQueryId);

  const persistedCommunity = restartedStore.get('community');
  assert.ok(persistedCommunity.some((p) => p.id === savedPostId), 'Class Board posts must survive restart');

  // 7. Verify login works again after restart with same credentials
  const loginAfterRestart = await api('POST', '/api/auth/login', {
    body: {
      studentId: studentId,
      password: 'SafePassword123!'
    }
  });
  assert.equal(loginAfterRestart.status, 200);

  // 8. Verify permission restriction: Other user cannot delete Vikramaditya's post
  const regResOther = await api('POST', '/api/auth/register', {
    body: {
      fullName: 'Other Student',
      mobile: '9811223399',
      password: 'OtherPassword123!',
      confirmPassword: 'OtherPassword123!'
    }
  });
  assert.equal(regResOther.status, 201);
  const otherToken = regResOther.data.token;

  const unauthorizedDelete = await api('DELETE', `/api/community/${savedPostId}`, { token: otherToken });
  assert.equal(unauthorizedDelete.status, 403, 'Students cannot delete posts belonging to others');

  // 9. Author can delete their own post
  const authorizedDelete = await api('DELETE', `/api/community/${savedPostId}`, { token: sessionToken });
  assert.equal(authorizedDelete.status, 200);

  const boardAfterDelete = await api('GET', '/api/community');
  assert.equal(boardAfterDelete.data.community.some((p) => p.id === savedPostId), false);
});

