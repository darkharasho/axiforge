import { state } from "./state.js";
import { WEAPON_STRENGTH_MIDPOINT, BOON_CONDITION_ICONS, FACT_TYPE_ICONS } from "./constants.js";
import { escapeHtml, tierLabel, normalizeText, stripGw2Markup } from "./utils.js";
import { computeUpgradeModifiers } from "./stats.js";
import { getAssumedBoons } from "./equipment.js";
import { BUFF_FACT_TYPES, computeStats } from "./engine-bridge.js";

let _readOnly = false;
export function setReadOnly(val) { _readOnly = val; }


let _onHoverPreview = null;
export function setOnHoverPreview(cb) { _onHoverPreview = cb; }

/**
 * Check if a skill is aquatic-only (weapon skill for a weapon with the Aquatic flag,
 * and the skill itself does NOT have NoUnderwater — i.e. it's the underwater variant).
 */
function _isAquaticOnlySkill(kind, entity) {
  if (kind !== "skill" || !entity) return false;
  const wt = (entity.weaponType || "").toLowerCase();
  if (!wt) return false;
  // Only relevant for weapons that have the Aquatic flag
  const profWeapons = state.activeCatalog?.professionWeapons || {};
  const weaponData = profWeapons[wt];
  if (!weaponData?.flags?.includes("Aquatic")) return false;
  // The aquatic variant is the one WITHOUT NoUnderwater
  return !(entity.flags || []).includes("NoUnderwater");
}

// DOM refs injected by the entry point via initDetailPanel() to keep this module
// importable in Node.js test environments (no document.querySelector at module scope).
let _el = { detailHost: null, hoverPreview: null, expandBtn: null };
let _openWikiModal = null;
let _openDetailModal = null;
let _anchoredMenu = null;

export function triggerDetailPanelAnimation() {
  if (!_el.detailHost) return;
  requestAnimationFrame(() => {
    // Animate the whole facts list (always fires on mode switch)
    const ul = _el.detailHost.querySelector(".facts-list");
    if (ul) {
      ul.classList.remove("facts-list--refresh");
      void ul.offsetWidth; // force reflow to restart animation
      ul.classList.add("facts-list--refresh");
    }
    // Flash each changed/added fact individually
    _el.detailHost.querySelectorAll(".fact-item--split").forEach((el) => {
      el.classList.remove("fact-item--split--flash");
      void el.offsetWidth;
      el.classList.add("fact-item--split--flash");
    });
    _el.detailHost.querySelectorAll(".fact-item--new-in-mode").forEach((el) => {
      el.classList.remove("fact-item--new-in-mode--flash");
      void el.offsetWidth;
      el.classList.add("fact-item--new-in-mode--flash");
    });
  });
}

export function initDetailPanel(domRefs, callbacks = {}) {
  _el = { ..._el, ...domRefs };
  _openWikiModal = callbacks.openWikiModal || null;
  _openDetailModal = callbacks.openDetailModal || null;
  if (!_readOnly) {
    if (_el.detailHost) {
      _el.detailHost.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-url]");
        if (btn && _openWikiModal) _openWikiModal(btn.dataset.url);
      });
    }
    if (_el.expandBtn) {
      _el.expandBtn.addEventListener("click", () => {
        if (_openDetailModal) _openDetailModal();
      });
    }
  }
}

export function renderDetailPanel() {
  const detail = state.detail;
  if (!detail) {
    if (_el.expandBtn) _el.expandBtn.disabled = true;
    if (_el.detailHost) _el.detailHost.innerHTML = `<p class="empty-line">Select a trait or skill to inspect wiki and API details.</p>`;
    return;
  }

  const facts = Array.isArray(detail.facts) ? detail.facts.slice(0, 16) : [];
  const detailDmgStats = (() => {
    if (detail.kindLabel === "Trait") return null;
    const computed = computeStats(state).total;
    const power = computed.Power || 1000;
    const precision = computed.Precision || 1000;
    const ferocity = computed.Ferocity || 0;
    const isUnderwater = Boolean(state.editor.underwaterMode);
    const activeWeaponSet = Number(state.editor.activeWeaponSet) || 1;
    let mhId;
    if (isUnderwater) {
      const aquaticKey = activeWeaponSet === 2 ? "aquatic2" : "aquatic1";
      mhId = state.editor?.equipment?.weapons?.[aquaticKey] || "";
    } else {
      const mhKey = activeWeaponSet === 2 ? "mainhand2" : "mainhand1";
      mhId = state.editor?.equipment?.weapons?.[mhKey] || "";
    }
    const weaponStrength = WEAPON_STRENGTH_MIDPOINT[mhId] || 952.5;
    const critChance = Math.min(1, (precision - 895) / 2100);
    const effectivePower = power * (1 + critChance * (0.5 + ferocity / 1500));
    return { weaponStrength, effectivePower };
  })();
  // Alacrity only affects skill cooldowns, not trait internal cooldowns.
  const isSkill = detail.kindLabel !== "Trait";
  const alacrity = isSkill && getAssumedBoons().alacrity;
  // Burst Recharge: applies to warrior burst skills (slot Profession_1)
  const burstRecharge = isSkill && detail.slot === "Profession_1" ? (computeUpgradeModifiers().get("Burst Recharge") || 0) : 0;
  // Filter Recharge facts from list when we have infobox recharge data
  const hasInfoboxRecharge = isSkill && detail.recharge?.pve != null;
  const detailDisplayFacts = hasInfoboxRecharge ? facts.filter((f) => f.type !== "Recharge") : facts;
  const detailTimingBadges = isSkill ? _buildTimingBadges(detail, alacrity, burstRecharge) : "";

  // Build trait skill list (icon + name) for traits with associated skills
  const traitSkillsHtml = (() => {
    if (detail.kind !== "trait" || !Array.isArray(detail.traitSkillIds) || !detail.traitSkillIds.length) return "";
    const catalog = state.activeCatalog;
    if (!catalog?.skillById) return "";
    const iconOverrides = detail.traitSkillIcons || {};
    const items = [];
    for (const skillId of detail.traitSkillIds) {
      const skill = catalog.skillById.get(skillId);
      if (!skill) continue;
      const icon = iconOverrides[skillId] || skill.icon || "";
      const name = escapeHtml(skill.name || "Unknown");
      items.push(`<li class="trait-skill-entry"><img src="${escapeHtml(icon)}" alt="" onerror="this.style.visibility='hidden'" /><span>${name}</span></li>`);
    }
    return items.length ? `<ul class="trait-skill-list">${items.join("")}</ul>` : "";
  })();

  const factsHtml = detailDisplayFacts.length
    ? detailDisplayFacts
        .map((fact) => {
          const cls = fact.type === "NoData" ? "fact-item--section" : fact._splitFact ? "fact-item--split" : fact._traitedFact ? "fact-item--traited" : fact._newFact ? "fact-item--new-in-mode" : "";
          return `<li${cls ? ` class="${cls}"` : ""}>${formatFactHtml(fact, detailDmgStats, { alacrity, burstRecharge })}</li>`;
        })
        .join("")
    : traitSkillsHtml ? "" : "<li>No fact entries.</li>";

  const wiki = detail.wiki || {};
  const wikiSummary = wiki.loading
    ? "<p>Loading wiki summary...</p>"
    : wiki.summary
      ? `<p>${escapeHtml(wiki.summary)}</p>`
      : "<p>No wiki summary available.</p>";
  const wikiLink = wiki.url
    ? `<button class="wiki-open-btn" data-url="${escapeHtml(wiki.url)}">Open Wiki Page</button>`
    : "";

  if (_el.detailHost) {
    _el.detailHost.innerHTML = `
      <article class="detail-card">
        <header>
          ${detail.icon
            ? `<img src="${escapeHtml(detail.icon)}" alt="${escapeHtml(detail.title)}" onerror="this.onerror=null;${detail.iconFallback ? `this.src='${escapeHtml(detail.iconFallback)}'` : "this.style.visibility='hidden'"}" />`
            : `<div class="detail-card__icon-placeholder"></div>`}
          <div>
            <h3>${escapeHtml(detail.title)}</h3>
            <p>${escapeHtml(detail.kindLabel)}${detail.hasSplit ? ' <span class="split-badge">WvW split</span>' : ''}${detail.isAquaticOnly ? ' <span class="split-badge aquatic-badge">Aquatic</span>' : ''}</p>
          </div>
          ${detailTimingBadges}
        </header>
        <section>
          <h4>In-Game Description</h4>
          <p>${escapeHtml(detail.description || "No description.").replace(/\n/g, "<br>")}</p>
        </section>
        <section>
          <h4>Wiki</h4>
          ${wikiSummary}
          ${wikiLink}
        </section>
        ${traitSkillsHtml ? `<section>
          <h4>Trait Skills</h4>
          ${traitSkillsHtml}
        </section>` : ""}
        ${factsHtml ? `<section>
          <h4>Facts</h4>
          <ul class="facts-list">${factsHtml}</ul>
        </section>` : ""}
      </article>
    `;
    if (_el.expandBtn) _el.expandBtn.disabled = false;
  }
}

export function bindHoverPreview(node, kind, entityProvider) {
  if (!node) return;
  const readEntity = () =>
    typeof entityProvider === "function" ? entityProvider() : entityProvider || null;

  node.addEventListener("mouseenter", (event) => {
    const entity = readEntity();
    if (!entity) return;
    // Inside a dropdown menu, anchor tooltip to the left of the menu
    const menu = node.closest(".skill-select-overlay .cselect__menu") || node.closest(".slot-picker__list");
    if (menu) {
      _anchoredMenu = menu;
      showHoverPreview(kind, entity, 0, 0);
      positionHoverPreviewAnchored(menu.getBoundingClientRect());
      return;
    }
    _anchoredMenu = null;
    showHoverPreview(kind, entity, event.clientX, event.clientY);
  });

  node.addEventListener("mousemove", (event) => {
    if (_el.hoverPreview?.classList.contains("hidden")) return;
    if (_anchoredMenu) return; // anchored mode — don't follow mouse
    positionHoverPreview(event.clientX, event.clientY);
  });

  node.addEventListener("mouseleave", () => {
    _anchoredMenu = null;
    hideHoverPreview();
  });

  node.addEventListener("focus", () => {
    const entity = readEntity();
    if (!entity) return;
    const rect = node.getBoundingClientRect();
    showHoverPreview(kind, entity, rect.right, rect.top + rect.height / 2);
  });

  node.addEventListener("blur", () => {
    hideHoverPreview();
  });
}

/**
 * Merge base facts with applicable traited_facts for the current build's active traits.
 *
 * GW2 API trait/skill objects have two fact sources:
 *   - `facts[]`: base facts, pre-filtered to exclude entries with requires_trait
 *   - `traitedFacts[]`: conditional overrides, each with:
 *       requires_trait  – ID of the major trait that enables this entry
 *       overrides       – 0-based index into facts[] to replace (required; see below)
 *       …fact fields    – type, text, value, etc.
 *
 * Only traited_facts WITH an `overrides` index are applied — they replace the base fact at
 * that index with an updated value (e.g., a stat that improves when a trait is active).
 * Entries without `overrides` would append extra facts representing conditional gameplay
 * states (e.g., "while in berserk mode") that are too context-dependent for a tooltip and
 * would otherwise cause fact bloat when any matching trait is selected.
 */
export function resolveEntityFacts(entity) {
  const gameMode = state.editor?.gameMode || "pve";

  // Select the appropriate fact set based on game mode.
  // PvP falls back to WvW facts (GW2 frequently shares WvW/PvP balance),
  // then to PvE facts as a last resort.
  let baseFacts;
  let usingPveFacts = true;
  if (gameMode === "wvw" && Array.isArray(entity.wvwFacts)) {
    baseFacts = entity.wvwFacts;
    usingPveFacts = false;
  } else if (gameMode === "pvp") {
    if (Array.isArray(entity.pvpFacts)) {
      baseFacts = entity.pvpFacts;
      usingPveFacts = false;
    } else if (Array.isArray(entity.wvwFacts)) {
      baseFacts = entity.wvwFacts;
      usingPveFacts = false;
    } else {
      baseFacts = Array.isArray(entity.facts) ? entity.facts : [];
    }
  } else {
    baseFacts = Array.isArray(entity.facts) ? entity.facts : [];
  }
  const traitedFacts = Array.isArray(entity.traitedFacts) ? entity.traitedFacts : [];

  // Apply traited_facts overrides only when using PvE facts as the base.
  // The GW2 API's traited_facts carry PvE-balanced values and reference PvE
  // fact positions via overrides indices — applying them to WvW/PvP fact
  // arrays misplaces overrides and surfaces PvE-only conditional effects
  // (e.g. Alacrity) that do not exist in those game modes.
  let result = baseFacts;
  if (traitedFacts.length && usingPveFacts) {
    // Collect active trait IDs — both major choices and minor traits.
    const activeTraitIds = new Set();
    const catalog = state.activeCatalog;
    for (const spec of state.editor.specializations || []) {
      for (const id of Object.values(spec?.majorChoices || {})) {
        const n = Number(id);
        if (n) activeTraitIds.add(n);
      }
      const specId = Number(spec?.specializationId || spec?.id) || 0;
      const specData = specId ? catalog?.specializationById?.get(specId) : null;
      for (const minorId of specData?.minorTraits || []) {
        if (minorId) activeTraitIds.add(Number(minorId));
      }
    }
    if (activeTraitIds.size) {
      result = [...baseFacts];
      for (const tf of traitedFacts) {
        if (!activeTraitIds.has(Number(tf.requires_trait))) continue;
        const { requires_trait: _r, overrides, ...factData } = tf;
        factData._traitedFact = true;
        if (overrides !== undefined && overrides !== null && overrides >= 0 && overrides < result.length) {
          result[overrides] = factData;
        } else if (overrides === undefined || overrides === null) {
          result.push(factData);
        }
      }
    }
  }

  // Deduplicate — always runs regardless of traitedFacts.
  // The GW2 API places both the base value AND a conditional variant in facts[] without
  // requires_trait markers. After overrides are applied above, the first entry already
  // holds the correct value; later duplicates are conditional variants to be dropped.
  //
  // Two dedup strategies:
  //   Buff/condition facts (status field present): key = status only. The same boon
  //     (e.g. Quickness) can appear with different durations across Buff/PrefixedBuff
  //     types — deduplicate by status regardless of type so both variants collapse.
  //   All other facts: key = text + type + target + source. Distinct facts that happen
  //     to share text (e.g. two AttributeConversion entries for different stats) differ
  //     by target/source and are preserved.
  // Normalise NoData stun-break facts into proper StunBreak type so they
  // deduplicate against split StunBreak entries and render with an icon.
  result = result.map((f) =>
    f.type === "NoData" && /breaks?\s*stun/i.test(f.text)
      ? { ...f, type: "StunBreak", text: "Stun Break", value: true }
      : f
  );

  // NoData facts (section separators) and facts with no identifying field are always kept.
  const seen = new Set();
  return result.filter((f) => {
    if (f.type === "NoData") return true;
    const statusKey = (f.status || "").trim();
    if (statusKey) {
      // Distinguish passive (duration 0) from active (duration > 0) signet-style
      // buffs that share the same status name (e.g. "Signet of Fury").
      const durBucket = (f.duration || 0) === 0 ? "p" : "a";
      const key = `status:${statusKey}|${f.apply_count || ""}|${durBucket}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }
    const text = (f.text || "").trim();
    if (!text) return true;
    const key = `${text}|${f.type || ""}|${f.target || ""}|${f.source || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Build timing badge HTML (recharge + cast time) for the hover/detail header.
 * Reads infobox timings from entity.recharge / entity.activation (per-mode objects).
 */
function _buildTimingBadges(entity, alacrity, burstRecharge) {
  const gameMode = state.editor?.gameMode || "pve";
  const badges = [];

  // Cast time / activation
  if (entity.activation) {
    const castTime = entity.activation[gameMode] ?? entity.activation.pve;
    if (castTime != null && castTime > 0) {
      const castIcon = FACT_TYPE_ICONS["Time"] || "";
      badges.push(`<div class="hover-preview__timing"><img src="${escapeHtml(castIcon)}" alt="Cast time" />${castTime}s</div>`);
    }
  }

  // Recharge / cooldown
  if (entity.recharge) {
    const base = entity.recharge[gameMode] ?? entity.recharge.pve;
    if (base != null && base > 0) {
      const rechargeIcon = FACT_TYPE_ICONS["Recharge"] || "";
      const alacMult = (alacrity && base > 0) ? 0.75 : 1;
      const burstMult = (burstRecharge > 0 && base > 0) ? (1 - burstRecharge / 100) : 1;
      const totalMult = alacMult * burstMult;
      if (totalMult < 1) {
        const reduced = +(base * totalMult).toFixed(2);
        badges.push(`<div class="hover-preview__timing"><img src="${escapeHtml(rechargeIcon)}" alt="Recharge" /><span class="fact-alacrity">${reduced}s <span class="fact-alacrity-original">${base}s</span></span></div>`);
      } else {
        badges.push(`<div class="hover-preview__timing"><img src="${escapeHtml(rechargeIcon)}" alt="Recharge" />${base}s</div>`);
      }
    }
  }

  if (!badges.length) return "";
  return `<div class="hover-preview__timings">${badges.join("")}</div>`;
}

function _renderStatBreakdown(entries, total, statName) {
  const lines = entries.map((e) => {
    const countSuffix = e.count > 1 ? ` <span class="breakdown-count">\u00d7${e.count}</span>` : "";
    const pill = e.category ? `<span class="breakdown-pill breakdown-pill--${e.category}">${e.category}</span>` : "";
    return `<li><span class="breakdown-value">+${e.value}</span> ${pill}${escapeHtml(e.source)}${countSuffix}</li>`;
  });
  lines.push(`<li class="breakdown-total"><span class="breakdown-value">${total}</span> Total ${escapeHtml(statName)}</li>`);
  return `<ul class="hover-preview__breakdown">${lines.join("")}</ul>`;
}

export function buildSkillCard(skill, kind, isChained = false, dmgStats = null) {
  const icon = String(skill.icon || skill.iconFallback || "");
  const description = normalizeText(skill.description || "");
  const maxFacts = kind.startsWith("equip-") ? 12 : 16;
  const rawFacts = resolveEntityFacts(skill).slice(0, maxFacts);
  const isSkillCard = kind !== "trait";
  const cardAlacrity = isSkillCard && getAssumedBoons().alacrity;
  const burstRch = isSkillCard && skill.slot === "Profession_1" ? (computeUpgradeModifiers().get("Burst Recharge") || 0) : 0;

  // Build timing data: prefer wiki infobox, fall back to extracting from facts
  const isEquip = kind.startsWith("equip-");
  let timingEntity = skill;
  if (!isEquip && !skill.recharge?.pve) {
    const rchFact = rawFacts.find((f) => f.type === "Recharge" && f.value > 0);
    if (rchFact) timingEntity = { ...skill, recharge: { pve: rchFact.value } };
  }
  const hasRechargeHeader = !isEquip && timingEntity.recharge?.pve != null;
  const displayFacts = hasRechargeHeader ? rawFacts.filter((f) => f.type !== "Recharge") : rawFacts;

  const factsItems = displayFacts
    .map((fact) => {
      const html = formatFactHtml(fact, dmgStats, { alacrity: cardAlacrity, burstRecharge: burstRch });
      if (!html) return null;
      const cls = fact.type === "NoData" ? "fact-item--section" : fact._splitFact ? "fact-item--split" : fact._traitedFact ? "fact-item--traited" : "";
      return `<li${cls ? ` class="${cls}"` : ""}>${html}</li>`;
    })
    .filter(Boolean);
  const meta = getHoverMetaLine(kind, skill);

  // Build timing badges for the header top-right (recharge + cast time)
  const timingBadges = isEquip ? "" : _buildTimingBadges(timingEntity, cardAlacrity, burstRch);

  return `
    ${isChained ? `<div class="hover-preview__chain-divider">▸</div>` : ""}
    <div class="hover-preview__head${isChained ? " hover-preview__head--chained" : ""}">
      ${icon ? `<img class="hover-preview__icon" src="${escapeHtml(icon)}" alt="${escapeHtml(skill.name || "Icon")}" onerror="this.onerror=null;this.src='${escapeHtml(String(skill.iconFallback || icon))}'" />` : "<div></div>"}
      <div>
        <h4 class="hover-preview__title">${escapeHtml(skill.name || "Unknown")}</h4>
        <p class="hover-preview__meta">${escapeHtml(meta)}${skill.hasSplit ? ' <span class="split-badge">WvW split</span>' : ''}${_isAquaticOnlySkill(kind, skill) ? ' <span class="split-badge aquatic-badge">Aquatic</span>' : ''}</p>
      </div>
      ${timingBadges}
    </div>
    ${description ? `<p class="hover-preview__desc">${escapeHtml(description).replace(/\n/g, "<br>")}</p>` : (!factsItems.length && !skill.bonuses?.length && !skill.breakdown?.length && !kind.startsWith("equip-") ? `<p class="hover-preview__desc">No description available.</p>` : "")}
    ${skill.bonuses?.length ? `<ul class="hover-preview__bonuses">${skill.bonuses.map((b, i) => `<li class="${i < (skill.activeBonusCount || 0) ? "hover-preview__bonus--active" : "hover-preview__bonus--inactive"}">(${i + 1}): ${escapeHtml(b)}</li>`).join("")}</ul>` : ""}
    ${skill.breakdown?.length ? _renderStatBreakdown(skill.breakdown, skill.breakdownTotal, skill.name) : ""}
    ${factsItems.length ? `<ul class="hover-preview__facts">${factsItems.join("")}</ul>` : ""}
  `;
}

export function positionHoverPreviewAnchored(menuRect) {
  const node = _el.hoverPreview;
  if (!node || node.classList.contains("hidden")) return;
  const pad = 8;
  const gap = 6;
  const rect = node.getBoundingClientRect();
  // Place to the left of the menu
  let left = menuRect.left - rect.width - gap;
  if (left < pad) left = menuRect.right + gap; // fall back to right side
  let top = menuRect.top;
  if (top + rect.height > window.innerHeight - pad) {
    top = window.innerHeight - rect.height - pad;
  }
  top = Math.max(46, top);
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

export function showHoverPreview(kind, entity, x, y) {
  if (!entity) return;
  if (_onHoverPreview) _onHoverPreview(kind, entity);

  // Compute damage stats from the current build for Damage fact calculations.
  // Formula: Damage = WeaponStrength × EffectivePower × Coefficient × Hits / 2597
  // EffectivePower = Power × (1 + CritChance × (0.5 + Ferocity/1500))
  let dmgStats = null;
  if (kind === "skill") {
    const computed = computeStats(state).total;
    const power = computed.Power || 1000;
    const precision = computed.Precision || 1000;
    const ferocity = computed.Ferocity || 0;
    const isUnderwater = Boolean(state.editor.underwaterMode);
    const activeWeaponSet = Number(state.editor.activeWeaponSet) || 1;
    let mhId;
    if (isUnderwater) {
      const aquaticKey = activeWeaponSet === 2 ? "aquatic2" : "aquatic1";
      mhId = state.editor?.equipment?.weapons?.[aquaticKey] || "";
    } else {
      const mhKey = activeWeaponSet === 2 ? "mainhand2" : "mainhand1";
      mhId = state.editor?.equipment?.weapons?.[mhKey] || "";
    }
    const weaponStrength = WEAPON_STRENGTH_MIDPOINT[mhId] || 952.5;
    const critChance = Math.min(1, (precision - 895) / 2100);
    const effectivePower = power * (1 + critChance * (0.5 + ferocity / 1500));
    dmgStats = { weaponStrength, effectivePower };
  }

  // For skills, follow flipSkill chain to show chained/charged skills as subsequent cards.
  // Weapon skills live in weaponSkillById; profession/utility skills in skillById — check both.
  // The mechBar candidate pool may include skills from elite specs other than the active one
  // (e.g. Tempest attunement skills spec=48 appear when Catalyst/Core Ele is active because
  // Catalyst has no spec=67 attunement candidates so the pool falls back to all candidates).
  // Those mis-spec'd skills have flip chains (Overloads) that should not be shown. Suppress the
  // flip chain whenever the hovered entity belongs to an elite spec that isn't currently active.
  const _flipCat = state.activeCatalog;
  const _activeEliteSpecId = _flipCat?.specializationById
    ? ((state.editor?.specializations || [])
        .map((e) => Number(e?.specializationId) || 0)
        .find((id) => id > 0 && _flipCat.specializationById.get(id)?.elite) || 0)
    : 0;
  const _entitySpecId = Number(entity.specialization) || 0;
  const suppressMismatchedEliteFlip = _entitySpecId > 0
    && !!_flipCat?.specializationById?.get(_entitySpecId)?.elite
    && _entitySpecId !== _activeEliteSpecId;
  // Elementalist: only Tempest (spec 48) has Overload flips on attunement F1-F4 skills; suppress
  // for all other builds including Weaver where the entity spec matches the active elite spec.
  // Also covers core attunement skills (spec 0) that fall back into the Weaver/Catalyst pool
  // via the skill lookup cascade — their flipSkill still points to the Overload.
  // Restrict to F1-F4 slots so Evoker F5 familiar flip chains (e.g. Ignite → Conflagration) are
  // not suppressed.
  const suppressElemNonTempestFlip = (state.editor?.profession ?? "") === "Elementalist"
    && _activeEliteSpecId !== 48
    && /^Profession_[1-4]$/.test(entity.slot || "");
  const chainCards = [buildSkillCard(entity, kind, false, dmgStats)];
  if (kind === "skill" && entity.flipSkill && !suppressMismatchedEliteFlip && !suppressElemNonTempestFlip) {
    const catalog = state.activeCatalog;
    const lookupSkill = (id) => catalog?.skillById?.get(id) || catalog?.weaponSkillById?.get(id);
    const exitPattern = /^(Exit|Leave|Deactivate|Stow)\b/i;
    const seen = new Set([entity.id]);
    const originalSpec = Number(entity.specialization) || 0;
    let cur = lookupSkill(entity.flipSkill);
    while (cur && !seen.has(cur.id) && !exitPattern.test(cur.name || "") && chainCards.length < 5) {
      // Stop if the flip is a same-named activated-state copy (e.g. Luminary F2/F3 virtues).
      if (cur.name === entity.name) break;
      // Stop if the flip jumps to a different specialization (e.g. base Virtue of Justice spec=0
      // or Luminary F1 spec=81 both flip to Dragonhunter Spear of Justice spec=27).
      const curSpec = Number(cur.specialization) || 0;
      if (curSpec && curSpec !== originalSpec) break;
      seen.add(cur.id);
      chainCards.push(buildSkillCard(cur, kind, true, dmgStats));
      cur = cur.flipSkill ? lookupSkill(cur.flipSkill) : null;
    }
  }

  // For traits with associated skills (traitSkillIds), show a compact list (icon + name)
  // matching the detail-panel layout instead of full skill cards.
  if (kind === "trait" && Array.isArray(entity.traitSkillIds) && entity.traitSkillIds.length) {
    const catalog = state.activeCatalog;
    const iconOverrides = entity.traitSkillIcons || {};
    const items = [];
    for (const skillId of entity.traitSkillIds) {
      const skill = catalog?.skillById?.get(skillId);
      if (!skill) continue;
      const icon = iconOverrides[skillId] || skill.icon || "";
      const name = escapeHtml(skill.name || "Unknown");
      items.push(`<li class="trait-skill-entry"><img src="${escapeHtml(icon)}" alt="" onerror="this.style.visibility='hidden'" /><span>${name}</span></li>`);
    }
    if (items.length) {
      chainCards.push(
        `<div class="hover-preview__trait-skill-divider">Trait Skills</div>`
        + `<ul class="trait-skill-list">${items.join("")}</ul>`
      );
    }
  }

  if (_el.hoverPreview) {
    _el.hoverPreview.innerHTML = chainCards.join("");
    _el.hoverPreview.classList.remove("hidden");
    positionHoverPreview(x, y);
  }
}

export function getHoverMetaLine(kind, entity) {
  if (kind === "trait") {
    const tier = Number(entity?.tier) || 0;
    return tier ? `Trait • ${tierLabel(tier)}` : "Trait";
  }
  if (kind === "equip-stat") return `Equipment • ${entity?.slot || ""}`.replace(/ • $/, "");
  if (kind === "equip-weapon") {
    const hand = entity?.hand;
    const handLabel = hand === "two" ? "Two-handed" : hand === "main" ? "Main Hand" : hand === "off" ? "Off Hand" : hand === "either" ? "One-handed" : hand === "aquatic" ? "Aquatic" : "";
    return handLabel ? `Weapon • ${handLabel}` : "Weapon";
  }
  if (kind === "equip-relic") return "Relic";
  if (kind === "equip-rune") return "Rune";
  if (kind === "equip-sigil") return "Sigil";
  if (kind === "equip-infusion") return "Infusion";
  if (kind === "equip-enrichment") return "Enrichment";
  if (kind === "spec") return entity?.elite ? "Elite Specialization" : "Specialization";
  const type = String(entity?.type || "").trim();
  const slot = String(entity?.slot || "").trim();
  // When a bundle/shroud/kit is active, show "Skill — BundleName N" for its weapon bar skills
  const activeKit = Number(state.editor.activeKit) || 0;
  if (activeKit && entity?.id) {
    const kitSkill = state.activeCatalog?.skillById?.get(activeKit);
    if (kitSkill?.bundleSkills?.includes(entity.id)) {
      const slotMatch = /^(?:Downed|Weapon|Profession)_(\d)$/i.exec(slot);
      const slotNum = slotMatch ? slotMatch[1] : "";
      return `Skill • ${kitSkill.name}${slotNum ? " " + slotNum : ""}`;
    }
  }
  const showSlot = slot && !/^(Profession|Weapon|Downed)_/i.test(slot) && !/^(Heal|Utility|Elite)$/i.test(slot);
  if (type && showSlot) return `Skill • ${type} • ${slot}`;
  if (type) return `Skill • ${type}`;
  return "Skill";
}

export function positionHoverPreview(x, y) {
  const node = _el.hoverPreview;
  if (!node || node.classList.contains("hidden")) return;
  const pad = 8;
  const offset = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = node.getBoundingClientRect();
  let left = Number(x) + offset;
  let top = Number(y) + offset;
  if (left + rect.width > vw - pad) {
    left = Number(x) - rect.width - offset;
  }
  if (top + rect.height > vh - pad) {
    top = Number(y) - rect.height - offset;
  }
  left = Math.max(pad, Math.min(left, vw - rect.width - pad));
  top = Math.max(46, Math.min(top, vh - rect.height - pad));
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

export function hideHoverPreview() {
  if (_el.hoverPreview) _el.hoverPreview.classList.add("hidden");
  if (_onHoverPreview) _onHoverPreview(null, null);
}

export async function selectDetail(kind, entity) {
  if (_readOnly) return;
  if (!entity) return;
  const facts = resolveEntityFacts(entity);
  // Fall back to extracting timing from facts when wiki infobox data isn't available
  let recharge = entity.recharge || null;
  let activation = entity.activation || null;
  if (!recharge) {
    const rchFact = facts.find((f) => f.type === "Recharge" && f.value > 0);
    if (rchFact) recharge = { pve: rchFact.value };
  }
  if (!activation) {
    const actFact = facts.find((f) => f.type === "Time" && /cast|activation/i.test(f.text || "") && f.duration > 0);
    if (actFact) activation = { pve: actFact.duration };
  }
  const detail = {
    kind,
    entityId: Number(entity.id) || null,
    kindLabel: kind === "trait" ? "Trait" : "Skill",
    title: entity.name || "Unknown",
    icon: entity.icon || "",
    iconFallback: entity.iconFallback || "",
    description: stripGw2Markup(entity.description),
    facts,
    wiki: { loading: true, summary: "", url: "" },
    hasSplit: Boolean(entity.hasSplit),
    isAquaticOnly: _isAquaticOnlySkill(kind, entity),
    slot: entity.slot || "",
    recharge,
    activation,
    traitSkillIds: entity.traitSkillIds || null,
    traitSkillIcons: entity.traitSkillIcons || null,
  };
  state.detail = detail;
  renderDetailPanel();

  const key = `${kind}:${String(entity.name || "").toLowerCase()}`;
  let wiki = state.wikiCache.get(key);
  if (!wiki) {
    try {
      wiki = await window.desktopApi.getWikiSummary(entity.name);
    } catch {
      wiki = { title: entity.name, summary: "", url: "", missing: true };
    }
    state.wikiCache.set(key, wiki);
  }
  if (state.detail === detail) {
    state.detail = {
      ...detail,
      wiki: {
        loading: false,
        summary: wiki?.summary || "",
        url: wiki?.url || "",
      },
    };
    renderDetailPanel();
  }
}

// ── Fact formatting helpers ──────────────────────────────────────────────────

function formatBuffConditionText(fact) {
  const rawStatus = String(fact.status || fact.text || "Unknown").replace(/\s*\(effect\)\s*$/i, "");
  // Use text as display name when it provides an alternative label (e.g. "Active Bonus")
  const hasAltText = fact.text && fact.status && fact.text !== fact.status
    && fact.text !== "Apply Buff/Condition" && !/\(effect\)$/i.test(fact.text);
  const name = hasAltText ? fact.text : rawStatus;
  const count = Number(fact.apply_count) || 0;
  const stackPart = count > 1 ? ` ×${count}` : "";
  const duration = fact.duration ? ` (${fact.duration}s)` : "";
  // Show description if available, or text if it differs from status (wiki effect facts)
  const extra = fact.description
    ? `: ${fact.description}`
    : (fact.text && fact.status && fact.text !== fact.status && fact.text !== "Apply Buff/Condition")
      ? `: ${fact.text}`
      : "";
  return `${name}${stackPart}${duration}${extra}`;
}

export function formatFactHtml(fact, dmgStats = null, { alacrity = false, burstRecharge = 0 } = {}) {
  if (!fact || typeof fact !== "object") return "Unknown fact";
  // Normalise GW2 API markup in text/status fields before any rendering.
  fact = fact.text && /<c=/.test(fact.text) ? { ...fact, text: stripGw2Markup(fact.text) } : fact;
  // NoData facts are section headers (e.g. conditional legend-stance effects).
  // Exception: the API uses NoData for "Breaks Stun" — render those with icon like StunBreak.
  if (fact.type === "NoData") {
    if (/breaks?\s*stun/i.test(fact.text)) {
      const iconUrl = fact.icon || FACT_TYPE_ICONS["StunBreak"] || "";
      return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml("Breaks Stun")}` : escapeHtml("Breaks Stun");
    }
    return `<span class="fact-section-header">${escapeHtml(String(fact.text || ""))}</span>`;
  }
  if (fact.type === "Damage" && fact.dmg_multiplier != null) {
    const label = String(fact.text || fact.type || "Fact");
    const hits = Number(fact.hit_count) || 1;
    const coeff = (Number(fact.dmg_multiplier) * hits).toFixed(2);
    let text = hits > 1 ? `${label}: ×${coeff} (${hits} hits)` : `${label}: ×${coeff}`;
    if (dmgStats) {
      const dmg = Math.round(dmgStats.weaponStrength * dmgStats.effectivePower * Number(fact.dmg_multiplier) * hits / 2597);
      text += ` ≈ ${dmg.toLocaleString()}`;
    }
    const iconUrl = fact.icon || FACT_TYPE_ICONS[fact.type] || "";
    return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}` : escapeHtml(text);
  }
  if (BUFF_FACT_TYPES.has(fact.type)) {
    const text = formatBuffConditionText(fact);
    const iconUrl = fact.icon || (fact.status && BOON_CONDITION_ICONS[fact.status]) || FACT_TYPE_ICONS[fact.type] || "";
    return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}` : escapeHtml(text);
  }
  // AttributeConversion: converts a % of one attribute into another (e.g. Precision → Ferocity).
  // API fields: source, target, percent. text is often the raw type name.
  // Detect by structure (source + target present) as well as by type — the API sometimes
  // omits or varies the type field for these facts.
  if (fact.type === "AttributeConversion" || (fact.source && fact.target)) {
    const toWords = (s) => String(s || "").replace(/([A-Z])/g, " $1").trim();
    const source = toWords(fact.source);
    const target = toWords(fact.target);
    const pct = fact.percent ?? "";
    const label = source && target
      ? `Gain ${target} Based on a Percentage of ${source}`
      : (fact.text && fact.text !== "AttributeConversion" ? fact.text : "Attribute Conversion");
    const text = pct === "" ? label : `${label}: ${pct}%`;
    const iconUrl = fact.icon || FACT_TYPE_ICONS["AttributeConversion"] || "";
    return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}` : escapeHtml(text);
  }
  // AttributeAdjust: the API sometimes gives the raw type name as text instead of a
  // human-readable label. Build one from the target attribute (e.g. "ConditionDamage" → "Condition Damage").
  if (fact.type === "AttributeAdjust") {
    const rawTarget = String(fact.target || "");
    const targetLabel = rawTarget.replace(/([A-Z])/g, " $1").trim();
    const label = (fact.text && fact.text !== "AttributeAdjust") ? fact.text : (targetLabel || "Attribute");
    const val = fact.value ?? "";
    let text = val === "" ? label : `${label}: ${val > 0 ? "+" : ""}${val}`;
    if (fact.coefficient != null) text += ` (×${fact.coefficient})`;
    const iconUrl = fact.icon || FACT_TYPE_ICONS["AttributeAdjust"] || "";
    return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}` : escapeHtml(text);
  }
  if (fact.type === "Time" && fact.duration != null) {
    const label = String(fact.text || "Duration");
    const text = `${label}: ${fact.duration}s`;
    const iconUrl = fact.icon || FACT_TYPE_ICONS["Time"] || "";
    return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}` : escapeHtml(text);
  }
  if (fact.type === "ComboFinisher") {
    const label = String(fact.text || "Combo Finisher");
    const finisher = fact.finisher_type || "";
    const pct = fact.percent != null && fact.percent < 100 ? ` (${fact.percent}%)` : "";
    const text = finisher ? `${label}: ${finisher}${pct}` : label;
    const iconUrl = fact.icon || FACT_TYPE_ICONS["ComboFinisher"] || "";
    return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}` : escapeHtml(text);
  }
  if (fact.type === "ComboField") {
    const label = String(fact.text || "Combo Field");
    const field = fact.field_type || "";
    const text = field ? `${label}: ${field}` : label;
    const iconUrl = fact.icon || FACT_TYPE_ICONS["ComboField"] || "";
    return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}` : escapeHtml(text);
  }
  if (fact.type === "Percent" && fact.percent != null) {
    const label = String(fact.text && fact.text !== "Percent" ? fact.text : "Percent");
    const text = `${label}: ${fact.percent}%`;
    const iconUrl = fact.icon || FACT_TYPE_ICONS["Percent"] || "";
    return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}` : escapeHtml(text);
  }
  if (fact.type === "StunBreak") {
    const iconUrl = fact.icon || FACT_TYPE_ICONS["StunBreak"] || "";
    return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml("Breaks Stun")}` : escapeHtml("Breaks Stun");
  }
  // Recharge facts — apply Alacrity and/or Burst Recharge reduction when active
  if (fact.type === "Recharge" && fact.value != null) {
    const label = String(fact.text || "Recharge");
    const base = Number(fact.value);
    const iconUrl = fact.icon || FACT_TYPE_ICONS[fact.type] || "";
    // Combine reduction multipliers: Alacrity (×0.75) and Burst Recharge (percentage)
    const alacMult = (alacrity && base > 0) ? 0.75 : 1;
    const burstMult = (burstRecharge > 0 && base > 0) ? (1 - burstRecharge / 100) : 1;
    const totalMult = alacMult * burstMult;
    if (totalMult < 1) {
      const reduced = +(base * totalMult).toFixed(2);
      const text = `${label}: ${reduced}s`;
      const suffix = ` <span class="fact-alacrity-original">${base}s</span>`;
      const inner = escapeHtml(text) + suffix;
      return iconUrl
        ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true"><span class="fact-alacrity">${inner}</span>`
        : `<span class="fact-alacrity">${inner}</span>`;
    }
    const text = `${label}: ${base}s`;
    return iconUrl ? `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}` : escapeHtml(text);
  }
  const label = String(fact.text || fact.type || "Fact");
  let value;
  let suffix = "";
  if (fact.value != null) { value = fact.value; }
  else if (fact.percent != null) { value = fact.percent; suffix = "%"; }
  else if (fact.distance != null) { value = fact.distance; }
  else if (fact.duration != null) { value = fact.duration; suffix = "s"; }
  else { value = fact.hit_count ?? fact.apply_count ?? fact.status ?? fact.description ?? ""; }
  const text = value === "" ? label : `${label}: ${value}${suffix}`;
  const iconUrl = fact.icon || FACT_TYPE_ICONS[fact.type] || "";
  if (!iconUrl) return escapeHtml(text);
  return `<img class="fact-status-icon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">${escapeHtml(text)}`;
}
