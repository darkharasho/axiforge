"use strict";

const { WIKI_BASE } = require("./crawl");

const PAGE_TIMEOUT = 10_000;
const RETRY_DELAY = 2_000;

const SELECTORS = {
  blockquote: ".mw-parser-output blockquote",
  factRow: "blockquote dl > dd",
  statistics: "blockquote .statistics",
  noArticle: ".mw-newarticletext",
};

/**
 * Extract structured fact rows from the relic wiki page blockquote.
 * Runs inside page.$$eval (browser context) — DOM APIs are available.
 */
function _extractRelicFactsBrowser(dds) {
  return dds
    .filter((dd) => {
      // Skip PvP-only gamemode facts (we want PvE/WvW)
      const pvpOnly = dd.closest(".gamemode.pvp:not(.pve):not(.wvw)");
      if (pvpOnly) return false;
      return true;
    })
    .map((dd) => {
      const links = dd.querySelectorAll("a[title]");
      let name = "";
      for (const a of links) {
        const text = (a.textContent || "").trim();
        if (text) { name = text; break; }
      }
      const fullText = (dd.textContent || "").trim();
      const nameIdx = fullText.indexOf(name);
      let valueText = "";
      if (nameIdx >= 0 && name) {
        valueText = fullText.slice(nameIdx + name.length).replace(/^\s*[:;]\s*/, "").trim();
      }
      return { name, valueText };
    })
    .filter((f) => f.name);
}

async function _crawlRelicOnce(page, entity) {
  const pageName = entity.name.replace(/ /g, "_");
  const url = WIKI_BASE + encodeURIComponent(pageName);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
  } catch (err) {
    return { facts: [], error: `Navigation failed: ${err.message}`, wiki_url: url };
  }

  // Check for missing page
  const missing = await page.$(SELECTORS.noArticle);
  if (missing) {
    return { facts: [], error: "Wiki page not found", wiki_url: url };
  }

  const finalUrl = page.url();

  try {
    const facts = await page.$$eval(SELECTORS.factRow, _extractRelicFactsBrowser);

    // Extract recharge from statistics div
    let recharge = null;
    try {
      recharge = await page.$eval(SELECTORS.statistics, (el) => {
        const text = (el.textContent || "").trim();
        const match = text.match(/^([\d.]+)/);
        return match ? parseFloat(match[1]) : null;
      });
    } catch {
      // No statistics div — relic has no ICD
    }

    if (recharge != null) {
      facts.push({ name: "Recharge", valueText: String(recharge) });
    }

    return { facts, error: null, wiki_url: finalUrl };
  } catch (err) {
    return { facts: [], error: err.message, wiki_url: finalUrl };
  }
}

async function crawlEntity(page, entity, _entityType) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await _crawlRelicOnce(page, entity);
    if (!result.error || attempt === 1) return result;
    await new Promise((r) => setTimeout(r, RETRY_DELAY));
  }
}

module.exports = { crawlEntity, SELECTORS };
