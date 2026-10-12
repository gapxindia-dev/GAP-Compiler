#!/usr/bin/env node
'use strict';
// Operator tool for backups, the account reset and rollback.
//
//   node scripts/migrate.js status
//   node scripts/migrate.js backup
//   node scripts/migrate.js reset-accounts [--confirm]
//   node scripts/migrate.js clean-demo [--confirm]
//   node scripts/migrate.js restore <backup-folder-name> --confirm
//
// Without --confirm every command is a dry run. STOP THE SERVER before running a
// command that changes data: the server keeps its data in memory and would
// overwrite your changes on its next write.

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

function describe() {
  const legacy = readJson('vaults', {});
  const users = readJson('users', {});
  const community = readJson('community', []);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Legacy accounts (vaults.json): ${Object.keys(legacy).length}`);
  for (const [id, v] of Object.entries(legacy)) {
    console.log(`  - ${id} (${v.studentName || 'no name'}): ${(v.queries || []).length} queries, ${(v.notes || []).length} notes`);
  }
  console.log(`New-system accounts (users.json): ${Object.keys(users).length}`);
  console.log(`Class Board posts: ${community.length} (${community.filter(isLegacyDemoPost).length} legacy demo posts)`);
}

function backup(label) {
  const store = new Store(DATA_DIR);
  const snap = store.snapshot(label);
  // Verify: every file in the backup must hash identically to the live file.
  for (const f of fs.readdirSync(snap.target)) {
    if (sha(path.join(snap.target, f)) !== sha(path.join(DATA_DIR, f))) {
      throw new Error(`Backup verification failed for ${f}. Nothing has been changed.`);
    }
  }
  console.log(`Backup verified: ${snap.count} files in ${snap.target}`);
  return snap;
}

switch (cmd) {
  case 'status':
    describe();
    break;

  case 'backup':
    backup('manual');
    break;

  case 'reset-accounts': {
    describe();
    if (!confirm) {
      console.log('\nDRY RUN. This would back up the data directory, then move vaults.json and beams.json ' +
        'into legacy-<timestamp>/ and empty users.json, zone.json and shares.json. ' +
        'Class Board posts are not touched.\nRe-run with --confirm to apply.');
      break;
    }
    const snap = backup('pre-reset');
    const stamp = path.basename(snap.target).replace(/^pre-reset-/, '');
    const legacyDir = path.join(DATA_DIR, `legacy-${stamp}`);
    fs.mkdirSync(legacyDir, { recursive: true });
    for (const f of ['vaults.json', 'beams.json']) {
      const src = path.join(DATA_DIR, f);
      if (fs.existsSync(src)) fs.renameSync(src, path.join(legacyDir, f));
    }
    const store = new Store(DATA_DIR);
    store.load('users', {}); store.load('zone', {}); store.load('shares', {});
    store.mutate('users', (u) => { for (const k of Object.keys(u)) delete u[k]; });
    store.mutate('zone', (z) => { for (const k of Object.keys(z)) delete z[k]; });
    store.mutate('shares', (s) => { for (const k of Object.keys(s)) delete s[k]; });
    console.log(`Done. Legacy files archived in ${legacyDir}. Roll back with:\n  node scripts/migrate.js restore ${path.basename(snap.target)} --confirm`);
    break;
  }

  case 'clean-demo': {
    const community = readJson('community', []);
    const demo = community.filter(isLegacyDemoPost);
    console.log(`${demo.length} legacy demo post(s) match the old seed exactly (id + title + author, no owner):`);
    demo.forEach((p) => console.log(`  - ${p.id}: ${p.title}`));
    if (!confirm) { console.log('DRY RUN. Re-run with --confirm to remove them.'); break; }
    backup('pre-clean-demo');
    const store = new Store(DATA_DIR);
    store.load('community', []);
    store.mutate('community', (list) => {
      for (let i = list.length - 1; i >= 0; i--) if (isLegacyDemoPost(list[i])) list.splice(i, 1);
    });
    console.log('Done.');
    break;
  }

  case 'restore': {
    if (!arg) throw new Error('Usage: restore <backup-folder-name> --confirm');
    const src = path.join(DATA_DIR, 'backups', arg);
    if (!fs.existsSync(src)) throw new Error(`No such backup: ${src}`);
    const files = fs.readdirSync(src).filter((f) => f.endsWith('.json'));
    console.log(`Would restore ${files.length} file(s) from ${src}: ${files.join(', ')}`);
    if (!confirm) { console.log('DRY RUN. Re-run with --confirm to restore.'); break; }
    backup('pre-restore');
    for (const f of files) fs.copyFileSync(path.join(src, f), path.join(DATA_DIR, f));
    console.log('Restored. Start the server again.');
    break;
  }

  default:
    console.log('Commands: status | backup | reset-accounts [--confirm] | clean-demo [--confirm] | restore <backup> --confirm');
}
