"use strict";

// Append-only JSONL log with torn-tail recovery. Pure file mechanics — no
// knowledge of what an "entry" means beyond "one JSON value per line". Task 4
// (the version store) is where domain meaning (keyframes, patches, coalescing)
// gets layered on top of this.
//
// Crash-safety posture (see src/main/jsonFile.js for the sibling durable-JSON
// pattern; this file cannot reuse it because appends must be O(1), not
// O(file)):
//   - a torn final line (partial write from a crash mid-append) is repaired —
//     truncated back to the last complete line — before the next append, so
//     damage never compounds onto a second entry;
//   - readAll/readTail never throw on a parse failure, or on any other read
//     failure (permissions, I/O errors, ...) — they log the failure and
//     degrade to an empty result, mirroring src/main/jsonFile.js's
//     read-degrade-and-log pattern. A missing file is not a failure and is
//     never logged;
//   - replaceLast uses a cached byte offset + ftruncate so it costs O(1), not
//     a rewrite of the whole file.
//
// Concurrency: this class assumes at most one in-flight call per instance at
// a time (no overlapping unawaited append()/replaceLast() calls on the same
// file). Task 4's write queue is what serializes callers; nothing in here
// guards against interleaved stat→append sequences.

const fs = require("node:fs/promises");
const path = require("node:path");
const { TAIL_BYTES } = require("./constants");

function logDegrade(action, filePath, err) {
  console.error(`[versionLog] ${action} failed for ${path.basename(filePath)}:`, err && err.message);
}

async function statSize(filePath) {
  try {
    const st = await fs.stat(filePath);
    return st.size;
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Read the final `TAIL_BYTES` of a file (or the whole file if smaller).
 * Returns the raw buffer and the absolute offset the read started at.
 */
async function readTailWindow(filePath, size) {
  const readFrom = Math.max(0, size - TAIL_BYTES);
  const handle = await fs.open(filePath, "r");
  try {
    const buf = Buffer.alloc(size - readFrom);
    await handle.read(buf, 0, buf.length, readFrom);
    return { buf, readFrom };
  } finally {
    await handle.close();
  }
}

function parseLines(text) {
  const lines = text.split("\n");
  // Drop a single trailing empty string produced by a terminating "\n".
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const entries = [];
  let dropped = 0;
  for (const line of lines) {
    if (line === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      dropped += 1;
    }
  }
  return { entries, dropped };
}

class VersionLog {
  constructor(filePath) {
    this.filePath = filePath;
    this._lastOffset = null;
  }

  /**
   * If the file's final byte is not "\n", the previous append was torn by a
   * crash. Truncate back to the end of the last complete line so the next
   * append starts clean instead of concatenating onto a fragment.
   *
   * Returns the (possibly repaired) file size, or null if the file does not
   * exist.
   */
  async _repairTornTail(knownSize) {
    const size = knownSize === undefined ? await statSize(this.filePath) : knownSize;
    if (size === null || size === 0) return size;

    const { buf: tail, readFrom } = await readTailWindow(this.filePath, size);

    if (tail.length === 0 || tail[tail.length - 1] === 0x0a /* \n */) {
      return size;
    }

    // Torn: find the last newline within the tail and truncate to just after
    // it (absolute offset). If there is no newline in the tail at all and we
    // didn't read from byte 0, the torn line is longer than TAIL_BYTES — fall
    // back to scanning the whole file.
    let lastNlInTail = tail.lastIndexOf(0x0a);
    let truncateAt;
    if (lastNlInTail === -1) {
      if (readFrom === 0) {
        // The entire file is one unterminated line — nothing to keep.
        truncateAt = 0;
      } else {
        const whole = await fs.readFile(this.filePath);
        const lastNl = whole.lastIndexOf(0x0a);
        truncateAt = lastNl === -1 ? 0 : lastNl + 1;
      }
    } else {
      truncateAt = readFrom + lastNlInTail + 1;
    }

    await fs.truncate(this.filePath, truncateAt);
    return truncateAt;
  }

  async append(entry) {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    const size = await this._repairTornTail();
    const offset = size === null ? 0 : size;

    await fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`);
    this._lastOffset = offset;
    return entry;
  }

  /**
   * Find the byte offset of the start of the last line in the file, without
   * a cached value. Used on cold start (a fresh VersionLog instance).
   */
  async _findLastLineOffset(knownSize) {
    const size = knownSize === undefined ? await statSize(this.filePath) : knownSize;
    if (size === null || size === 0) return 0;

    const { buf: tail, readFrom } = await readTailWindow(this.filePath, size);

    // Strip a single terminating newline before searching, so we find the
    // start of the *last* line, not an empty string after it.
    let end = tail.length;
    if (end > 0 && tail[end - 1] === 0x0a) end -= 1;

    const lastNlBeforeEnd = tail.lastIndexOf(0x0a, end - 1);
    if (lastNlBeforeEnd === -1) {
      if (readFrom === 0) {
        // Single line in the file (or in the whole tail window).
        return 0;
      }
      // The last line is longer than TAIL_BYTES — scan the whole file.
      const whole = await fs.readFile(this.filePath);
      let wholeEnd = whole.length;
      if (wholeEnd > 0 && whole[wholeEnd - 1] === 0x0a) wholeEnd -= 1;
      const lastNl = whole.lastIndexOf(0x0a, wholeEnd - 1);
      return lastNl === -1 ? 0 : lastNl + 1;
    }
    return readFrom + lastNlBeforeEnd + 1;
  }

  /**
   * The start offset of the final line — cached by the last write, or found.
   *
   * Repairs a torn tail FIRST. This is Task 3's repair-before-write rule, and
   * the destructive callers need it more than `append` does, not less: on a
   * file whose final line is a crash fragment, the offset of "the last line"
   * is the FRAGMENT's start. Truncating there removes only the fragment and
   * leaves the entry the caller meant to replace or remove standing — so
   * `replaceLast` writes its replacement after the survivor and the log ends up
   * with two entries carrying the same `v`, and `removeLast` leaves behind the
   * version its caller believes it deleted. A duplicate `v` is worse than
   * anything the fragment itself could do.
   */
  async _lastLineOffset() {
    const sizeBefore = await statSize(this.filePath);
    const sizeAfter = await this._repairTornTail(sizeBefore);
    // DEFENCE IN DEPTH, not a live guard. `_lastOffset` holds the start of the
    // last line THIS instance wrote, and within the single-writer contract this
    // class documents, corruption can only append bytes after that point — so
    // truncating at the stale offset would discard the fragment anyway and the
    // line below changes nothing. It earns its keep only once a second writer
    // is in play: if another process appended a COMPLETE line and then died
    // mid-append, the cached offset points behind that line and truncating
    // there would destroy it. Cheap, and a future caller could make it
    // load-bearing. @see the "a second writer" test in versionLog.test.js.
    if (sizeAfter !== sizeBefore) this._lastOffset = null;
    const offset = this._lastOffset;
    if (offset === null || offset === undefined) return this._findLastLineOffset(sizeAfter);
    return offset;
  }

  async replaceLast(entry) {
    // Serialize BEFORE truncating. This is the only destructive write in the
    // file, and doing it the other way round means an entry that cannot be
    // stringified (a circular reference, a throwing toJSON) destroys the
    // previous version with nothing written in its place. `append` is safe
    // for free because it destroys nothing.
    const line = `${JSON.stringify(entry)}\n`;
    const offset = await this._lastLineOffset();
    await fs.truncate(this.filePath, offset);
    await fs.appendFile(this.filePath, line);
    this._lastOffset = offset;
    return entry;
  }

  /**
   * Drop the final entry, leaving nothing in its place.
   *
   * The version store needs this when coalescing an edit that returns the
   * document to exactly the state before the version being coalesced into:
   * there is no patch left to write, and rewriting the entry with an empty one
   * would leave a blank row in the history panel. Removing it is the only
   * option that keeps the stored chain matching the live document — see
   * historyStore.js.
   */
  async removeLast() {
    const offset = await this._lastLineOffset();
    await fs.truncate(this.filePath, offset);
    // The new final line starts somewhere earlier and we do not know where;
    // drop the cache so the next write finds it rather than trusting a stale
    // offset that now points at the end of the file.
    this._lastOffset = null;
  }

  async readAll() {
    let text;
    try {
      text = await fs.readFile(this.filePath, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") return { entries: [], dropped: 0 };
      logDegrade("readAll", this.filePath, err);
      return { entries: [], dropped: 0 };
    }
    return parseLines(text);
  }

  async readTail(limit) {
    let size;
    try {
      size = await statSize(this.filePath);
    } catch (err) {
      logDegrade("readTail", this.filePath, err);
      return [];
    }
    if (size === null || size === 0) return [];

    try {
      const readFrom = Math.max(0, size - TAIL_BYTES);
      const truncated = readFrom > 0;

      let text;
      if (!truncated) {
        text = await fs.readFile(this.filePath, "utf8");
      } else {
        const { buf } = await readTailWindow(this.filePath, size);
        text = buf.toString("utf8");
        // The read did not start at byte 0, so its first line is almost
        // certainly a partial fragment of a preceding line — discard it.
        const firstNl = text.indexOf("\n");
        text = firstNl === -1 ? "" : text.slice(firstNl + 1);
      }

      const { entries } = parseLines(text);
      entries.reverse();
      if (truncated && entries.length < limit) {
        // Not enough survived the truncated window (e.g. very large entries) —
        // fall back to a full read to guarantee up to `limit` results.
        const full = await this.readAll();
        full.entries.reverse();
        return full.entries.slice(0, limit);
      }
      return entries.slice(0, limit);
    } catch (err) {
      logDegrade("readTail", this.filePath, err);
      return [];
    }
  }

  async lastEntry() {
    const tail = await this.readTail(1);
    return tail.length > 0 ? tail[0] : null;
  }

  async unlink() {
    try {
      await fs.unlink(this.filePath);
    } catch (err) {
      if (err && err.code === "ENOENT") return;
      throw err;
    }
    this._lastOffset = null;
  }
}

module.exports = { VersionLog };
