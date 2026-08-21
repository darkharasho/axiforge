"use strict";
// Minimal D1 + KV test doubles built on node:sqlite so Worker handlers can be
// tested under Jest without miniflare. Only the API surface the Worker uses.
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "../../workers/sync/migrations");

function plain(row) {
  if (row === undefined || row === null) return null;
  return Object.assign({}, row); // node:sqlite returns null-prototype objects
}

function createTestD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");

  function makeStatement(sql) {
    let params = [];
    const stmt = {
      bind(...p) { params = p; return stmt; },
      async first(col) {
        const row = plain(db.prepare(sql).get(...params));
        if (row === null) return null;
        return col === undefined ? row : (row[col] ?? null);
      },
      async all() {
        const rows = db.prepare(sql).all(...params).map(plain);
        return { success: true, results: rows, meta: {} };
      },
      async run() {
        const r = db.prepare(sql).run(...params);
        return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
      _sync() {
        const isRead = /^\s*(SELECT|WITH|PRAGMA)/i.test(sql) || /\bRETURNING\b/i.test(sql);
        if (isRead) {
          const rows = db.prepare(sql).all(...params).map(plain);
          return { success: true, results: rows, meta: { changes: 0 } };
        }
        const r = db.prepare(sql).run(...params);
        return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
    };
    return stmt;
  }

  return {
    prepare: (sql) => makeStatement(sql),
    async exec(sql) { db.exec(sql); return { count: 1, duration: 0 }; },
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => s._sync());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    async applyMigrations() {
      const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
      for (const f of files) db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
    },
    _raw: db,
  };
}

function createTestKV({ now = Date.now } = {}) {
  const map = new Map();
  let offset = 0;
  const clock = () => now() + offset;
  return {
    async get(key) {
      const e = map.get(key);
      if (!e) return null;
      if (e.expiresAt && clock() >= e.expiresAt) { map.delete(key); return null; }
      return e.value;
    },
    async put(key, value, opts = {}) {
      map.set(key, { value: String(value), expiresAt: opts.expirationTtl ? clock() + opts.expirationTtl * 1000 : 0 });
    },
    async delete(key) { map.delete(key); },
    _advance(ms) { offset += ms; },
  };
}

module.exports = { createTestD1, createTestKV };
