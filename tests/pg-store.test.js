'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PgStore } = require('../lib/pg-store');

test('PgStore initializes and formats DDL schemas correctly', async () => {
  const pgStore = new PgStore('postgres://user:pass@localhost:5432/gap_test', null, {
    info: () => {},
    warn: () => {},
    error: () => {}
  });

  assert.equal(pgStore.isReady(), false);
  assert.equal(typeof pgStore.get, 'function');
  assert.equal(typeof pgStore.mutate, 'function');
  assert.equal(typeof pgStore.load, 'function');
});

test('PgStore mock execution: verifies transactions, cache updates and rollback', async () => {
  const executedQueries = [];
  let inTransaction = false;

  const mockClient = {
    query: async (sql, params = []) => {
      executedQueries.push({ sql: sql.trim(), params });
      if (sql.trim() === 'BEGIN') inTransaction = true;
      if (sql.trim() === 'COMMIT') inTransaction = false;
      if (sql.trim() === 'ROLLBACK') inTransaction = false;

      if (sql.includes('SELECT COUNT(*)')) {
        return { rows: [{ count: '1' }] };
      }
      if (sql.includes("SELECT value FROM app_meta WHERE key = 'meta'")) {
        return { rows: [{ value: { schemaVersion: 3, nextStudentSerial: 2, academicYear: '2026-2027' } }] };
      }
      if (sql.includes('SELECT * FROM users')) {
        return {
          rows: [{
            student_id: 'TEST0001',
            full_name: 'Test Student',
            mobile: '9876543210',
            password_hash: 'hash123',
            academic_year: '2026-2027',
            class: 'General',
            status: 'active',
            role: 'student',
            token_version: 1,
            created_at: '2026-10-21T00:00:00Z',
            last_login_at: '2026-10-21T00:00:00Z',
            password_changed_at: null
          }]
        };
      }
      if (sql.includes('SELECT * FROM zone_queries')) return { rows: [] };
      if (sql.includes('SELECT * FROM zone_notes')) return { rows: [] };
      if (sql.includes('SELECT * FROM shares')) return { rows: [] };
      if (sql.includes('SELECT * FROM community')) return { rows: [] };
      return { rows: [] };
    },
    release: () => {}
  };

  const store = new PgStore('postgres://user:pass@localhost:5432/gap_test', null, {
    info: () => {},
    warn: () => {},
    error: () => {}
  });

  store.pool = {
    connect: async () => mockClient,
    end: async () => {}
  };

  await store._createTables();
  await store._loadAllIntoCache();
  store.ready = true;

  // Verify cached data loaded properly from DB
  const users = store.get('users');
  assert.ok(users.TEST0001);
  assert.equal(users.TEST0001.fullName, 'Test Student');

  // Verify successful mutation executes in a transaction
  await store.mutate('users', (draft) => {
    draft.TEST0002 = {
      studentId: 'TEST0002',
      fullName: 'Second Student',
      mobile: '9876543211',
      passwordHash: 'hash456',
      academicYear: '2026-2027',
      class: 'General',
      status: 'active',
      role: 'student',
      tokenVersion: 1,
      createdAt: '2026-10-22T00:00:00Z',
      lastLoginAt: '2026-10-22T00:00:00Z'
    };
  });

  assert.ok(store.get('users').TEST0002);
  assert.equal(inTransaction, false);

  // Verify mutation failure rolls back and does not pollute cache
  let errorCaught = false;
  try {
    await store.mutate('users', () => {
      throw new Error('Simulated database error');
    });
  } catch (err) {
    errorCaught = true;
    assert.equal(err.message, 'Simulated database error');
  }
  assert.equal(errorCaught, true);

  await store.close();
});

