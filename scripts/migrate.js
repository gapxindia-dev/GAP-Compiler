#!/usr/bin/env node
'use strict';
// Operator tool for backups, status, and migration verification.
//
//   node scripts/migrate.js status
//   node scripts/migrate.js backup
//   node scripts/migrate.js reset-accounts [--confirm]
//   node scripts/migrate.js clean-demo [--confirm]
//   node scripts/migrate.js restore <backup-folder-name> --confirm
//
// Without --confirm every destructive command is a dry run.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('../lib/store');
const { isLegacyDemoPost } = require('../lib/migrations');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const [cmd, ...rest] = process.argv.slice(2);
const confirm = rest.includes('--confirm');
const arg = rest.find((a) => !a.startsWith('--'));

const readJson = (name, fallback) => {
  const f = path.join(DATA_DIR, `${name}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback;
};
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function describe() {
  const store = new Store(DATA_DIR);
  await store.init();

  console.log(`=== GAP Compiler Storage Status ===`);
  console.log(`Storage backend: ${store.driverDescription}`);
  if (store.isPg) {
    console.log(`DATABASE_URL is configured.`);
  } else {
    console.log(`Local data directory: ${DATA_DIR}`);
    console.log(`TIP: Set DATABASE_URL in Render environment to enable permanent PostgreSQL persistence.`);
  }

  const legacy = readJson('vaults', {});
  const users = store.get('users') || {};
  const community = store.get('community') || [];
  const meta = store.get('meta') || {};

  console.log(`Legacy accounts (vaults.json): ${Object.keys(legacy).length}`);
  console.log(`Active student accounts: ${Object.keys(users).length}`);
  for (const [id, u] of Object.entries(users)) {
    console.log(`  - ${id} (${u.fullName || 'no name'}): ${u.class || 'General'} [${u.status || 'active'}, ${u.role || 'student'}]`);
  }
  console.log(`Class Board posts: ${community.length} (${community.filter(isLegacyDemoPost).length} legacy demo posts)`);
  console.log(`Current Academic Year: ${meta.academicYear || '2026-2027'} (Next Student Serial: ${meta.nextStudentSerial || 1})`);

  await store.close();
}

async function backup(label) {
  const store = new Store(DATA_DIR);
  await store.init();
  const snap = store.snapshot(label);
  console.log(`Backup completed: ${snap.count} entities saved in ${snap.target}`);
  await store.close();
  return snap;
}

async function main() {
  switch (cmd) {
    case 'status':
      await describe();
      break;

    case 'backup':
      await backup('manual');
      break;

    case 'reset-accounts': {
      await describe();
      if (!confirm) {
        console.log('\nDRY RUN. This would back up the data directory, then move vaults.json and beams.json ' +
          'into legacy-<timestamp>/ and empty users.json, zone.json and shares.json. ' +
          'Class Board posts are not touched.\nRe-run with --confirm to apply.');
        break;
      }
      const snap = await backup('pre-reset');
      const stamp = path.basename(snap.target).replace(/^pre-reset-/, '');
      const legacyDir = path.join(DATA_DIR, `legacy-${stamp}`);
      fs.mkdirSync(legacyDir, { recursive: true });
      for (const f of ['vaults.json', 'beams.json']) {
        const src = path.join(DATA_DIR, f);
        if (fs.existsSync(src)) fs.renameSync(src, path.join(legacyDir, f));
      }
      const store = new Store(DATA_DIR);
      await store.init();
      store.load('users', {}); store.load('zone', {}); store.load('shares', {});
      await store.mutate('users', (u) => { for (const k of Object.keys(u)) delete u[k]; });
      await store.mutate('zone', (z) => { for (const k of Object.keys(z)) delete z[k]; });
      await store.mutate('shares', (s) => { for (const k of Object.keys(s)) delete s[k]; });
      console.log(`Done. Legacy files archived in ${legacyDir}. Roll back with:\n  node scripts/migrate.js restore ${path.basename(snap.target)} --confirm`);
      await store.close();
      break;
    }

    case 'clean-demo': {
      const store = new Store(DATA_DIR);
      await store.init();
      const community = store.get('community') || [];
      const demo = community.filter(isLegacyDemoPost);
      console.log(`${demo.length} legacy demo post(s) match the old seed exactly (id + title + author, no owner):`);
      demo.forEach((p) => console.log(`  - ${p.id}: ${p.title}`));
      if (!confirm) { console.log('DRY RUN. Re-run with --confirm to remove them.'); break; }
      await backup('pre-clean-demo');
      await store.mutate('community', (list) => {
        for (let i = list.length - 1; i >= 0; i--) if (isLegacyDemoPost(list[i])) list.splice(i, 1);
      });
      console.log('Done.');
      await store.close();
      break;
    }

    case 'restore': {
      if (!arg) throw new Error('Usage: restore <backup-folder-name> --confirm');
      const src = path.join(DATA_DIR, 'backups', arg);
      if (!fs.existsSync(src)) throw new Error(`No such backup: ${src}`);
      const files = fs.readdirSync(src).filter((f) => f.endsWith('.json'));
      console.log(`Would restore ${files.length} file(s) from ${src}: ${files.join(', ')}`);
      if (!confirm) { console.log('DRY RUN. Re-run with --confirm to restore.'); break; }
      await backup('pre-restore');
      for (const f of files) fs.copyFileSync(path.join(src, f), path.join(DATA_DIR, f));
      console.log('Restored. Start the server again.');
      break;
    }

    default:
      console.log('Commands: status | backup | reset-accounts [--confirm] | clean-demo [--confirm] | restore <backup> --confirm');
  }
}

main().catch((err) => {
  console.error('Migration error:', err.message);
  process.exit(1);
});
