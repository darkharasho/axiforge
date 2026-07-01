/**
 * status-display.js — Terminal status dashboard for the wiki audit.
 *
 * Uses the alternate screen buffer (like vim/htop) so the dashboard
 * occupies the full terminal and restores the original content on exit.
 * This works reliably across all terminals including VS Code integrated.
 */

const ESC = "\x1b";
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const ALT_SCREEN_ON = `${ESC}[?1049h`;   // Switch to alternate screen buffer
const ALT_SCREEN_OFF = `${ESC}[?1049l`;  // Restore original screen buffer
const CURSOR_HOME = `${ESC}[H`;          // Move cursor to top-left
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

const BAR_FILLED = "\u2588";
const BAR_EMPTY = "\u2591";
const BAR_WIDTH = 35;
const MAX_RECENT = 12;

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
    this._interval = null;
    this._started = false;
    // The dashboard relies on the alternate screen buffer and cursor control,
    // which only make sense on an interactive terminal. Under CI (or any piped/
    // redirected run) those escape sequences turn the log into noise, so fall
    // back to plain, append-only progress lines instead.
    this._quiet = !process.stdout.isTTY || !!process.env.CI;
  }

  start() {
    this._started = true;
    if (this._quiet) {
      console.log(`Auditing ${this.total} entities (progress printed as findings arrive)...`);
      return;
    }
    // Switch to alternate screen buffer and hide cursor
    process.stdout.write(ALT_SCREEN_ON + HIDE_CURSOR);
    this._interval = setInterval(() => this._render(), 200);
    this._render();
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
    this._interval = null;
    if (this._started && !this._quiet) {
      // Final render before leaving
      this._render();
      // Restore original screen buffer and show cursor
      process.stdout.write(ALT_SCREEN_OFF + SHOW_CURSOR);
    }
  }

  setWorker(id, text) {
    this.workerStatus[id] = text;
  }

  addCompleted(category) {
    this.completed++;
    if (category in this.summary) this.summary[category]++;
  }

  addRecent(icon, color, label, text) {
    if (this._quiet) {
      // Append-only: surface each finding immediately so CI logs show drift
      // as it's discovered, without any cursor manipulation.
      console.log(`  [${this.completed}/${this.total}] ${label.trim()}: ${text}`);
      return;
    }
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
    const w = Math.min(process.stdout.columns || 80, 78);
    const termRows = process.stdout.rows || 40;
    const hbar = GRAY + "\u2500".repeat(w) + RESET;
    const thickbar = GRAY + "\u2550".repeat(w) + RESET;

    const lines = [];

    // Header + progress (compact: 3 lines)
    const elapsed = this._formatTime(this._elapsed());
    const eta = this._eta();
    lines.push(`  ${BOLD}${CYAN}Wiki Audit${RESET}${" ".repeat(Math.max(1, w - 14 - elapsed.length))}${DIM}${elapsed}${RESET}`);
    lines.push(`  ${this._progressBar()}  ${DIM}${eta}${RESET}`);
    lines.push(hbar);

    // Workers (compact: 1 header + N workers)
    lines.push(`  ${BOLD}Workers${RESET}`);
    for (let i = 0; i < this.workerCount; i++) {
      const status = this.workerStatus[i] || "idle";
      const isIdle = status === "idle" || status === "starting..." || status === "done";
      const dot = isIdle ? `${GRAY}\u25cb${RESET}` : `${GREEN}\u25cf${RESET}`;
      const label = `${DIM}#${String(i + 1).padEnd(2)}${RESET}`;
      const name = isIdle ? `${GRAY}${status}${RESET}` : `${WHITE}${status}${RESET}`;
      lines.push(`  ${dot} ${label} ${_truncate(name, w - 10)}`);
    }
    lines.push(hbar);

    // Stats — two rows for readability
    const s = this.summary;
    lines.push(
      `  ${GREEN}\u2713 ${s.matches}${RESET} ${DIM}match${RESET}` +
      `     ${RED}\u2717 ${s.mismatches}${RESET} ${DIM}mismatch${RESET}` +
      `     ${GRAY}\u2500 ${s.no_split}${RESET} ${DIM}no split${RESET}`,
    );
    lines.push(
      `  ${YELLOW}\u25cc ${s.missing_from_splits}${RESET} ${DIM}missing(splits)${RESET}` +
      `  ${YELLOW}\u25cc ${s.missing_from_wiki}${RESET} ${DIM}missing(wiki)${RESET}` +
      `  ${GRAY}! ${s.errors}${RESET} ${DIM}errors${RESET}`,
    );
    lines.push(hbar);

    // Recent findings — fill remaining terminal space
    const recentBudget = termRows - lines.length - 2; // 2 for bottom bar + safety
    if (this.recent.length > 0 && recentBudget > 1) {
      lines.push(`  ${BOLD}Recent Findings${RESET}`);
      const showCount = Math.min(this.recent.length, recentBudget - 1);
      for (let i = 0; i < showCount; i++) {
        const r = this.recent[i];
        const icon = `${r.color}${r.icon}${RESET}`;
        const label = `${r.color}${BOLD}${r.label.padEnd(11)}${RESET}`;
        lines.push(`  ${icon} ${label} ${_truncate(r.text, w - 17)}`);
      }
    }

    lines.push(thickbar);

    // Render: move cursor home and write all lines, clear remainder
    let output = CURSOR_HOME;
    for (let i = 0; i < termRows; i++) {
      if (i < lines.length) {
        output += lines[i] + CLEAR_LINE + "\n";
      } else {
        output += CLEAR_LINE + "\n";
      }
    }
    process.stdout.write(output);
  }
}

function _truncate(str, max) {
  // Strip ANSI for length calculation
  const plain = str.replace(/\x1b\[[0-9;]*m/g, "");
  if (plain.length <= max) return str;
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
  return str.slice(0, rawIdx) + `${GRAY}\u2026${RESET}`;
}

module.exports = { StatusDisplay };
