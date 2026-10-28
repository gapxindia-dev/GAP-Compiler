'use strict';
// Startup migrations. All of them are idempotent and non-destructive:
//  * legacy EduSQL files (vaults.json, beams.json) are never read or deleted here;
//    they simply stop being used, which is what "old accounts no longer log in" means.
//    Use `npm run reset-accounts` to archive them out of the data directory.
//  * demo posts from the old Class Board seed are removed only when id, title AND
//    author match the seed exactly and the post has no owner.
//  * Existing user accounts, passwords, queries, and board posts are NEVER reset or deleted.

const SCHEMA_VERSION = 3;

const LEGACY_DEMO_POSTS = {
  comm_1: { title: 'University DB: Top 3 Students Per Department by GPA', author: 'Aarav (DBMS TA)' },
  comm_2: { title: 'Employee-Manager Hierarchy (Self Join)', author: 'Priya_CS' },
  comm_3: { title: 'Complete Student-Course-Grade Schema with Sample Data', author: 'Lab Instructor' },
  comm_4: { title: 'Banking System: Customers with Overdue Balance & No Recent Deposits', author: 'Rohan_SQL' }
};

function isLegacyDemoPost(post) {
  const demo = LEGACY_DEMO_POSTS[post && post.id];
  return !!demo && !post.ownerId && post.title === demo.title && post.author === demo.author;
}

async function run(store, log = console) {
  if (store.init) await store.init();

  store.load('meta', { schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), nextStudentSerial: 1, academicYear: '2026-2027' });
  store.load('users', {});
  store.load('zone', {});
  store.load('shares', {});
  store.load('community', []);

  const meta = store.get('meta') || {};
  const community = store.get('community') || [];
  const demo = Array.isArray(community) ? community.filter(isLegacyDemoPost) : [];
  const legacyVaults = store.exists('vaults');

  if (demo.length || (meta.schemaVersion && meta.schemaVersion < SCHEMA_VERSION)) {
    const snap = store.snapshot('pre-migration');
    log.info(`[migrate] backup written to ${snap.target} (${snap.count} files)`);
  }
  if (demo.length) {
    await store.mutate('community', (list) => {
      for (let i = list.length - 1; i >= 0; i--) if (isLegacyDemoPost(list[i])) list.splice(i, 1);
    });
    log.info(`[migrate] removed ${demo.length} legacy demo post(s) from the Class Board`);
  }

  // Ensure nextStudentSerial accurately tracks the highest registered student ID
  const users = store.get('users') || {};
  let maxSerial = 0;
  for (const id of Object.keys(users)) {
    const mSerial = id.match(/^[A-Z]{1,4}(\d{4,})$/);
    if (mSerial) {
      const num = parseInt(mSerial[1], 10);
      if (num > maxSerial) maxSerial = num;
    }
  }

  await store.mutate('meta', (m) => {
    m.schemaVersion = SCHEMA_VERSION;
    if (legacyVaults) m.legacyVaultsIgnored = true;
    if (typeof m.nextStudentSerial !== 'number' || m.nextStudentSerial <= maxSerial) {
      m.nextStudentSerial = maxSerial > 0 ? maxSerial + 1 : 1;
    }
    if (!m.academicYear) m.academicYear = '2026-2027';
  });

  // Ensure all existing users have academicYear, class, status, and role fields
  await store.mutate('users', (uMap) => {
    const curYear = (store.get('meta') || {}).academicYear || '2026-2027';
    for (const [, u] of Object.entries(uMap)) {
      if (!u.academicYear) u.academicYear = curYear;
      if (!u.class) u.class = 'General';
      if (!u.status) u.status = 'active';
      if (!u.role) u.role = 'student';
    }
  });

  if (legacyVaults) {
    log.warn('[migrate] legacy vaults.json found. Old accounts are ignored and cannot sign in. ' +
      'Run `npm run reset-accounts -- --confirm` to archive it.');
  }
}

module.exports = { run, isLegacyDemoPost, SCHEMA_VERSION };
