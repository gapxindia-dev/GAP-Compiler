'use strict';
// Minimal JSON document store with atomic, all-or-nothing writes.
//
// Every mutation is applied to a deep copy, written to a temp file, fsynced and
// renamed over the real file. The in-memory copy is only replaced once the write
// succeeded, so a failed write leaves both disk and memory unchanged (rollback).
// A file that exists but cannot be parsed is NEVER silently replaced: it is
// moved aside as *.corrupt-<timestamp> and startup fails loudly.

const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
    fs.mkdirSync(dir, { recursive: true });
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
  mutate(name, fn) {
    const draft = structuredClone(this.cache.get(name));
    const result = fn(draft);
    this._write(name, draft);
    this.cache.set(name, draft);
    return result;
  }

  _write(name, data) {
    const file = this.file(name);
    const tmp = `${file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(data, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  }

  // Copies every top-level *.json file into <dir>/backups/<label>-<timestamp>/
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

module.exports = { Store };
