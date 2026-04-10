"use strict";

/**
 * @typedef {Object} CacheAdapter
 * @property {(key: string) => any|null} get - Get value by key, null if missing/expired
 * @property {(key: string, value: any, ttlMs: number) => void} set - Set value with TTL in milliseconds
 * @property {(key: string) => void} invalidate - Remove a specific key
 * @property {() => void} clear - Remove all entries
 * @property {(key: string) => boolean} has - Check if key exists and is not expired
 */

class MemoryCache {
  constructor() {
    this._store = new Map();
  }

  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this._store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(key) {
    this._store.delete(key);
  }

  clear() {
    this._store.clear();
  }

  has(key) {
    return this.get(key) !== null;
  }
}

const fs = require("node:fs/promises");
const path = require("node:path");

class DiskCache {
  constructor(dir) {
    this._dir = dir;
  }

  _filePath(key) {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this._dir, `${safeKey}.json`);
  }

  async get(key) {
    try {
      const raw = await fs.readFile(this._filePath(key), "utf-8");
      const entry = JSON.parse(raw);
      if (Date.now() >= entry.expiresAt) {
        await this.invalidate(key);
        return null;
      }
      return entry.value;
    } catch {
      return null;
    }
  }

  async set(key, value, ttlMs) {
    const entry = { value, expiresAt: Date.now() + ttlMs };
    await fs.mkdir(this._dir, { recursive: true });
    await fs.writeFile(this._filePath(key), JSON.stringify(entry), "utf-8");
  }

  async invalidate(key) {
    try {
      await fs.unlink(this._filePath(key));
    } catch {
      // File may not exist
    }
  }

  async clear() {
    try {
      const files = await fs.readdir(this._dir);
      await Promise.all(
        files
          .filter((f) => f.endsWith(".json"))
          .map((f) => fs.unlink(path.join(this._dir, f)))
      );
    } catch {
      // Directory may not exist
    }
  }

  async has(key) {
    return (await this.get(key)) !== null;
  }
}

module.exports = { MemoryCache, DiskCache };
