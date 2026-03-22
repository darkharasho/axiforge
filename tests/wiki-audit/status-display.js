/**
 * status-display.js — Terminal status dashboard for the wiki audit.
 *
 * Renders an in-place updating TUI panel using ANSI escape codes.
 * No external dependencies — just process.stdout with cursor control.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Wiki Audit                                          15m 23s   │
 * │  ████████████████░░░░░░░░░░░░░░  53.2% (3021/5695)  ~14m left │
 * │                                                                │
 * │  Workers                                                       │
 * │  ● #1  Fireball                                                │
 * │  ● #2  Signet of Restoration                                   │
 * │  ● #3  Raging Storm                                            │
 * │  ● #4  idle                                                    │
 * │                                                                │
 * │  ✓ 3001 match   ✗ 12 mismatch   ◌ 3 missing(s)   ─ 2890 skip │
 * │  ◌ 1 missing(w)   ! 4 error                                   │
 * │                                                                │
 * │  Recent                                                        │
 * │  ✗ MISMATCH   Consume Plasma (skill #1123)                     │
 * │  ! ERROR      Slash — Disambiguation                           │
 * │  ◌ MISSING(S) Eye of the Storm (skill #5765)                   │
 * └─────────────────────────────────────────────────────────────────┘
 */

const ESC = "\x1b";
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_LINE = `${ESC}[K`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;

// Colors
const GREEN = `${ESC}[32m`;
const RED = `${ESC}[31m`;
const YELLOW = `${ESC}[33m`;
const CYAN = `${ESC}[36m`;
const GRAY = `${ESC}[90m`;
const WHITE = `${ESC}[37m`;
const BG_DARK = `${ESC}[48;5;235m`;

const BAR_FILLED = "\u2588";
const BAR_EMPTY = "\u2591";
const BAR_WIDTH = 35;
const MAX_RECENT = 8;

class StatusDisplay {
  constructor(workerCount, total) {
    this.workerCount = workerCount;
    this.total = total;
    this.completed = 0;
    this.startTime = Date.now();
    this.workerStatus = new Array(workerCount).fill("starting...");
    this.summary = {
      matches: 0, mismatches: 0, missing_from_splits: 0,
      missing_from_wiki: 0, no_split: 0, errors: 0,
    };
    this.recent = []; // { icon, color, label, text }
    this._lines = 0;  // how many lines we rendered last frame
    this._interval = null;
    this._started = false;
  }

  start() {
    this._started = true;
    process.stdout.write(HIDE_CURSOR);
    this._interval = setInterval(() => this._render(), 250);
    this._render();
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
    this._interval = null;
    if (this._started) process.stdout.write(SHOW_CURSOR);
  }

  setWorker(id, text) {
    this.workerStatus[id] = text;
  }

  addCompleted(category) {
    this.completed++;
    if (category in this.summary) this.summary[category]++;
  }

  addRecent(icon, color, label, text) {
    this.recent.unshift({ icon, color, label, text });
    if (this.recent.length > MAX_RECENT) this.recent.pop();
  }

  _elapsed() {
    return Date.now() - this.startTime;
  }

  _formatTime(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return `${m}m ${String(rem).padStart(2, "0")}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  }

  _eta() {
    if (this.completed === 0) return "estimating...";
    const elapsed = this._elapsed();
    const rate = this.completed / elapsed;
    const remaining = this.total - this.completed;
    const eta = remaining / rate;
    return `~${this._formatTime(eta)} left`;
  }

  _progressBar() {
    const pct = this.total > 0 ? this.completed / this.total : 0;
    const filled = Math.round(BAR_WIDTH * pct);
    const bar = `${GREEN}${BAR_FILLED.repeat(filled)}${GRAY}${BAR_EMPTY.repeat(BAR_WIDTH - filled)}${RESET}`;
    const pctStr = (pct * 100).toFixed(1);
    return `${bar}  ${WHITE}${pctStr}%${RESET} ${GRAY}(${this.completed}/${this.total})${RESET}`;
  }

  _render() {
    const lines = [];
    const w = Math.min(process.stdout.columns || 80, 75);
    const hbar = GRAY + "─".repeat(w) + RESET;

    // Header
    const elapsed = this._formatTime(this._elapsed());
    const title = `${BOLD}${CYAN}  Wiki Audit${RESET}`;
    const elapsedStr = `${GRAY}${elapsed}${RESET}`;
    lines.push(`${title}${" ".repeat(Math.max(1, w - 14 - elapsed.length))}${elapsedStr}`);
    lines.push(hbar);

    // Progress bar
    const eta = this._eta();
    lines.push(`  ${this._progressBar()}  ${DIM}${eta}${RESET}`);
    lines.push("");

    // Workers
    lines.push(`  ${BOLD}Workers${RESET}`);
    for (let i = 0; i < this.workerCount; i++) {
      const status = this.workerStatus[i] || "idle";
      const isIdle = status === "idle" || status === "starting..." || status === "done";
      const dot = isIdle ? `${GRAY}○${RESET}` : `${GREEN}●${RESET}`;
      const name = isIdle ? `${GRAY}${status}${RESET}` : `${WHITE}${status}${RESET}`;
      lines.push(`  ${dot} ${DIM}#${i + 1}${RESET}  ${_truncate(name, w - 10)}`);
    }
    lines.push("");

    // Stats
    const s = this.summary;
    const stats = [
      `${GREEN}✓${RESET} ${GREEN}${s.matches}${RESET} ${DIM}match${RESET}`,
      `${RED}✗${RESET} ${RED}${s.mismatches}${RESET} ${DIM}mismatch${RESET}`,
      `${YELLOW}◌${RESET} ${YELLOW}${s.missing_from_splits}${RESET} ${DIM}miss(s)${RESET}`,
      `${YELLOW}◌${RESET} ${YELLOW}${s.missing_from_wiki}${RESET} ${DIM}miss(w)${RESET}`,
      `${GRAY}─${RESET} ${GRAY}${s.no_split}${RESET} ${DIM}skip${RESET}`,
      `${GRAY}!${RESET} ${GRAY}${s.errors}${RESET} ${DIM}err${RESET}`,
    ];
    lines.push(`  ${stats.join("   ")}`);
    lines.push("");

    // Recent findings
    if (this.recent.length > 0) {
      lines.push(`  ${BOLD}Recent${RESET}`);
      for (const r of this.recent) {
        const icon = `${r.color}${r.icon}${RESET}`;
        const label = `${r.color}${r.label.padEnd(10)}${RESET}`;
        lines.push(`  ${icon} ${label} ${_truncate(r.text, w - 16)}`);
      }
    }

    lines.push(hbar);

    // Move cursor up to overwrite previous frame
    if (this._lines > 0) {
      process.stdout.write(`${ESC}[${this._lines}A`);
    }

    // Write all lines, clearing each to end
    const output = lines.map((l) => l + CLEAR_LINE).join("\n") + "\n";
    process.stdout.write(output);

    // Pad with blank lines if this frame is shorter than previous
    if (lines.length < this._lines) {
      for (let i = 0; i < this._lines - lines.length; i++) {
        process.stdout.write(CLEAR_LINE + "\n");
      }
      // Move back up for the extra lines
      process.stdout.write(`${ESC}[${this._lines - lines.length}A`);
    }

    this._lines = lines.length;
  }
}

function _truncate(str, max) {
  // Strip ANSI for length calculation
  const plain = str.replace(/\x1b\[[0-9;]*m/g, "");
  if (plain.length <= max) return str;
  // Rough truncation — find where to cut in the raw string
  let plainIdx = 0;
  let rawIdx = 0;
  while (rawIdx < str.length && plainIdx < max - 1) {
    if (str[rawIdx] === "\x1b") {
      const end = str.indexOf("m", rawIdx);
      if (end >= 0) { rawIdx = end + 1; continue; }
    }
    plainIdx++;
    rawIdx++;
  }
  return str.slice(0, rawIdx) + `${GRAY}…${RESET}`;
}

module.exports = { StatusDisplay };
