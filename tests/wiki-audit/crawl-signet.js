"use strict";

/**
 * crawl-signet.js — Extract signet passive attribute facts from wiki pages.
 *
 * Signet passives are rendered in the blockquote as a self-named buff row:
 *   [icon] Signet of Might: 180 Power
 *
 * This crawler navigates to the skill page and extracts just the passive
 * attribute fact (the row whose link text matches the skill name), ignoring
 * active-skill facts like Recharge, Might stacks, etc.
 */

const { WIKI_BASE } = require("./crawl");

const PAGE_TIMEOUT = 10_000;
const RETRY_DELAY = 2_000;

const SELECTORS = {
  factRow: "blockquote dl > dd",
  noArticle: ".mw-newarticletext",
};

/**
 * Browser-context function: extract the self-named passive buff fact row.
 * Returns an array of { name, valueText, titleAttr } (0 or 1 entries).
 */
function _extractPassiveFactBrowser(dds, skillName) {
  const results = [];
  const target = skillName.toLowerCase();

  for (const dd of dds) {
    // Skip hidden rows (gamemode toggling)
    const style = window.getComputedStyle(dd);
    if (style.display === "none") continue;

    const links = dd.querySelectorAll("a[title]");
    let name = "";
    let titleAttr = "";
    for (const a of links) {
      const text = (a.textContent || "").trim();
      if (text) { name = text; titleAttr = a.getAttribute("title") || ""; break; }
    }
    if (!name) continue;

    // The passive buff row links to the effect page, e.g. "Signet of Might"
    // or "Signet of Might (effect)". Match by checking if the name or title
    // contains the skill name.
    const nameLower = name.toLowerCase();
    const titleLower = titleAttr.toLowerCase();
    if (nameLower !== target && !titleLower.includes(target)) continue;

    const fullText = (dd.textContent || "").trim();
    const nameIdx = fullText.indexOf(name);
    let valueText = "";
    if (nameIdx >= 0) {
      valueText = fullText.slice(nameIdx + name.length).replace(/^\s*[:;]\s*/, "").trim();
    }

    // The passive fact value looks like "180 Power" — a number followed by a stat name.
    // Skip rows that don't have a numeric value (e.g. pure text descriptions).
    if (/^\d/.test(valueText)) {
      results.push({ name, valueText, titleAttr });
    }
  }
  return results;
}

async function _crawlSignetOnce(page, entity) {
  const pageName = entity.name.replace(/ /g, "_");
  const url = WIKI_BASE + encodeURI(pageName);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
  } catch (err) {
    return { facts: [], error: `Navigation failed: ${err.message}`, wiki_url: url };
  }

  const missing = await page.$(SELECTORS.noArticle);
  if (missing) {
    return { facts: [], error: "Wiki page not found", wiki_url: url };
  }

  const finalUrl = page.url();

  try {
    const facts = await page.$$eval(
      SELECTORS.factRow,
      _extractPassiveFactBrowser,
      entity.name,
    );
    return { facts, error: null, wiki_url: finalUrl };
  } catch (err) {
    return { facts: [], error: err.message, wiki_url: finalUrl };
  }
}

async function crawlEntity(page, entity, _entityType) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await _crawlSignetOnce(page, entity);
    if (!result.error || attempt === 1) return result;
    await new Promise((r) => setTimeout(r, RETRY_DELAY));
  }
}

module.exports = { crawlEntity };
