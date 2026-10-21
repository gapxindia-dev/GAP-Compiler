'use strict';
// Startup migrations. All of them are idempotent and non-destructive:
//  * legacy EduSQL files (vaults.json, beams.json) are never read or deleted here;
//    they simply stop being used, which is what "old accounts no longer log in" means.
//    Use `npm run reset-accounts` to archive them out of the data directory.
//  * demo posts from the old Class Board seed are removed only when id, title AND
//    author match the seed exactly and the post has no owner.

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

function run(store, log = console) {
  store.load('meta', { schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), nextStudentSerial: 1, academicYear: '2026-2027' });
  store.load('users', {});
  store.load('zone', {});
  store.load('shares', {});
  store.load('community', []);

  const meta = store.get('meta');
  const community = store.get('community');
  const demo = community.filter(isLegacyDemoPost);
  const legacyVaults = store.exists('vaults');

  if (demo.length || meta.schemaVersion < SCHEMA_VERSION) {
    const snap = store.snapshot('pre-migration');
    log.info(`[migrate] backup written to ${snap.target} (${snap.count} files)`);
  }
  if (demo.length) {
    store.mutate('community', (list) => {
      for (let i = list.length - 1; i >= 0; i--) if (isLegacyDemoPost(list[i])) list.splice(i, 1);
    });
    log.info(`[migrate] removed ${demo.length} legacy demo post(s) from the Class Board`);
  }
  if (meta.schemaVersion < SCHEMA_VERSION || legacyVaults || typeof meta.nextStudentSerial !== 'number' || !meta.academicYear) {
    store.mutate('meta', (m) => {
      m.schemaVersion = SCHEMA_VERSION;
      if (legacyVaults) m.legacyVaultsIgnored = true;
      if (typeof m.nextStudentSerial !== 'number') {
        const users = store.get('users') || {};
        let maxSerial = 0;
        for (const id of Object.keys(users)) {
          const mSerial = id.match(/^[A-Z]{1,4}(\d{4,})$/);
          if (mSerial) {
            const num = parseInt(mSerial[1], 10);
            if (num > maxSerial) maxSerial = num;
          }
        }
        m.nextStudentSerial = maxSerial > 0 ? maxSerial + 1 : 1;
      }
      if (!m.academicYear) m.academicYear = '2026-2027';
    });
  }

  // Ensure all existing users have academicYear, class, status, and role fields
  store.mutate('users', (users) => {
    const curYear = (store.get('meta') || {}).academicYear || '2026-2027';
    let changed = false;
    for (const [id, u] of Object.entries(users)) {
      if (!u.academicYear) { u.academicYear = curYear; changed = true; }
      if (!u.class) { u.class = 'General'; changed = true; }
      if (!u.status) { u.status = 'active'; changed = true; }
      if (!u.role) { u.role = 'student'; changed = true; }
    }
  });

  if (legacyVaults) {
    log.warn('[migrate] legacy vaults.json found. Old accounts are ignored and cannot sign in. ' +
      'Run `npm run reset-accounts -- --confirm` to archive it.');
  }
}

module.exports = { run, isLegacyDemoPost, SCHEMA_VERSION };
