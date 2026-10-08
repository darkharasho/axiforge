"use strict";

// GitHub Pages pages a link needs before it opens: a new item's /r/ short-link
// page, or a brand-new site's viewer. The publish round doesn't wait for the
// Pages deploy (one new item would hold every other save for minutes); the
// caller about to hand the link out waits for exactly its own pages instead.

function createPagesLive({ pollUrlLive, timeoutMs }) {
  const live = new Set(); // urls seen live this session; a deployed page stays up

  async function waitOne(url, ms) {
    if (live.has(url)) return true;
    const ok = await pollUrlLive(url, { timeoutMs: ms });
    if (ok) live.add(url);
    return ok;
  }

  /**
   * True once every url answers; false if any is still missing at the timeout.
   * `opts.timeoutMs` shortens the wait for a caller that hands the link out anyway.
   */
  async function waitLive(urls, opts = {}) {
    const ms = opts.timeoutMs ?? timeoutMs;
    const unique = [...new Set((urls || []).filter(Boolean))];
    const results = await Promise.all(unique.map((url) => waitOne(url, ms)));
    return results.every(Boolean);
  }

  return { waitLive };
}

module.exports = { createPagesLive };
