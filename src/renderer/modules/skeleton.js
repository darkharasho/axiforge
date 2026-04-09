// ── Skeleton HTML templates ─────────────────────────────────────────────────
// Each template mirrors the real panel structure with pulsing placeholder shapes.
// The 150ms animation-delay on .skel prevents flashes on warm-cache loads.

function slot(extraClass = "", delay = "") {
  const d = delay ? ` skel-d${delay}` : "";
  return `<div class="skel skel-skills__slot${extraClass}${d}"></div>`;
}

function mechSlot(delay = "") {
  const d = delay ? ` skel-d${delay}` : "";
  return `<div class="skel skel-skills__mechslot${d}"></div>`;
}

function specCard(delayOffset) {
  const d = (n) => { const v = (delayOffset + n) % 6; return v === 0 ? "" : ` skel-d${v}`; };
  const majorCol = (base) => `
    <div class="skel-spec-card__major">
      <div class="skel skel-spec-card__major-trait${d(base)}"></div>
      <div class="skel skel-spec-card__major-trait${d(base + 1)}"></div>
      <div class="skel skel-spec-card__major-trait${d(base + 2)}"></div>
    </div>`;
  const minor = (n) => `
    <div class="skel skel-hex skel-spec-card__minor${d(n)}"></div>`;
  return `
  <div class="skel-spec-card">
    <div class="skel-spec-card__panel">
      <div class="skel-spec-card__body">
        <div class="skel skel-hex skel-spec-card__emblem${d(0)}"></div>
        ${minor(1)}
        ${majorCol(2)}
        ${minor(3)}
        ${majorCol(4)}
        ${minor(5)}
        ${majorCol(0)}
      </div>
    </div>
  </div>`;
}

function sectionHead(delay, hasFill = false) {
  const d = delay ? ` skel-d${delay}` : "";
  const fill = hasFill ? `<div class="skel skel-equip__fill-btn${d}"></div>` : "";
  return `
    <div class="skel-equip__section-head"><div class="skel${d}" style="height:13px;width:50px"></div>${fill}</div>`;
}

function equipSlot(delay) {
  const d = delay ? ` skel-d${delay}` : "";
  const d2 = delay ? ` skel-d${Math.min(delay + 1, 5)}` : " skel-d1";
  return `
    <div class="skel-equip__slot">
      <div class="skel skel-equip__slot-icon${d}"></div>
      <div class="skel-equip__slot-lines">
        <div class="skel${d}" style="height:8px;width:60%"></div>
        <div class="skel${d2}" style="height:7px;width:40%"></div>
      </div>
    </div>`;
}

function weaponSlot(delay) {
  const d = delay ? ` skel-d${delay}` : "";
  const d2 = delay ? ` skel-d${Math.min(delay + 1, 5)}` : " skel-d1";
  return `
    <div class="skel-equip__slot skel-equip__slot--weapon">
      <div class="skel-equip__weapon-type">
        <div class="skel skel-equip__slot-icon${d}"></div>
        <div class="skel${d}" style="height:8px;width:60px"></div>
      </div>
      <div class="skel-equip__weapon-stat">
        <div class="skel${d}" style="height:8px;width:55%"></div>
        <div class="skel${d2}" style="height:7px;width:35%"></div>
      </div>
    </div>`;
}

function compactSlot(delay) {
  const d = delay ? ` skel-d${delay}` : "";
  const d2 = delay ? ` skel-d${Math.min(delay + 1, 5)}` : " skel-d1";
  return `
    <div class="skel-equip__slot skel-equip__slot--compact">
      <div class="skel skel-equip__slot-icon${d}"></div>
      <div class="skel-equip__slot-lines">
        <div class="skel${d}" style="height:11px;width:70%"></div>
        <div class="skel${d2}" style="height:12px;width:50%"></div>
      </div>
    </div>`;
}

function statRow(d1, d2) {
  return `
    <div class="skel-equip__stat-row">
      <div class="skel-equip__stat-cell"><div class="skel skel-d${d1}" style="height:14px;width:55%"></div><div class="skel skel-d${d2}" style="height:14px;width:25%"></div></div>
      <div class="skel-equip__stat-cell"><div class="skel skel-d${d2}" style="height:14px;width:50%"></div><div class="skel skel-d${d1}" style="height:14px;width:20%"></div></div>
    </div>`;
}

function statRowSingle(d1) {
  return `
    <div class="skel-equip__stat-row">
      <div class="skel-equip__stat-cell"><div class="skel skel-d${d1}" style="height:14px;width:55%"></div><div class="skel skel-d${d1}" style="height:14px;width:25%"></div></div>
    </div>`;
}

function libListRow(titleW, d1, d2, d3) {
  const c = (d) => d ? ` skel-d${d}` : "";
  return `
  <div class="lib-list-row">
    <div class="skel${c(d1)} skel-lib-row-icon"></div>
    <span class="lib-list-row__title"><div class="skel${c(d1)}" style="height:18px;width:${titleW}%;border-radius:3px"></div></span>
    <span class="lib-list-row__pills"><div class="skel${c(d2)}" style="height:21px;width:54px;border-radius:999px"></div><div class="skel${c(d2)}" style="height:21px;width:46px;border-radius:999px"></div></span>
    <span class="lib-list-row__date"><div class="skel${c(d3)}" style="height:18px;width:56px;border-radius:3px"></div></span>
  </div>`;
}

function libTableRow(titleW, d1, d2, d3) {
  const c = (d) => d ? ` skel-d${d}` : "";
  return `
    <li class="lib-tv__item">
      <div class="lib-tv__row">
        <span class="lib-tv__action"></span>
        <span class="lib-tv__icon"><div class="skel${c(d1)} skel-lib-row-icon"></div></span>
        <span class="lib-tv__name"><div class="skel${c(d1)}" style="height:18px;width:${titleW}%;border-radius:3px"></div></span>
        <span class="lib-tv__profession"><div class="skel${c(d2)}" style="height:18px;width:58px;border-radius:3px"></div></span>
        <span class="lib-tv__spec"><div class="skel${c(d2)}" style="height:18px;width:55px;border-radius:3px"></div></span>
        <span class="lib-tv__mode"><div class="skel${c(d3)}" style="height:18px;width:34px;border-radius:3px"></div></span>
        <span class="lib-tv__role"><div class="skel${c(d1)}" style="height:21px;width:52px;border-radius:999px"></div></span>
        <span class="lib-tv__tags"></span>
        <span class="lib-tv__created"><div class="skel${c(d3)}" style="height:18px;width:52px;border-radius:3px"></div></span>
        <span class="lib-tv__modified"><div class="skel${c(d1)}" style="height:18px;width:52px;border-radius:3px"></div></span>
      </div>
    </li>`;
}

function libGridCard(titleW, d1, d2, d3) {
  const c = (d) => d ? ` skel-d${d}` : "";
  return `
  <div class="lib-grid-card">
    <div class="lib-grid-card__header"><div class="skel${c(d1)} skel-lib-card-icon"></div></div>
    <div class="skel${c(d1)}" style="height:18px;width:${titleW}%;border-radius:3px"></div>
    <div class="lib-grid-card__pills">
      <div class="skel${c(d2)}" style="height:21px;width:50px;border-radius:999px"></div>
      <div class="skel${c(d2)}" style="height:21px;width:40px;border-radius:999px"></div>
    </div>
    <div class="lib-grid-card__date"><div class="skel${c(d3)}" style="height:18px;width:48px;border-radius:3px"></div></div>
  </div>`;
}

function libIconItem(d1, d2, w) {
  const c = (d) => d ? ` skel-d${d}` : "";
  return `
  <div class="lib-icon-item"><div class="skel${c(d1)} skel-lib-icon-img"></div><div class="skel${c(d2)}" style="height:18px;width:${w}px;border-radius:3px"></div></div>`;
}

const skeletonTemplates = {
  skills: `
<div class="skel-skills">
  <div class="skel-skills__weapon-col">
    <div class="skel-skills__mechbar">
      ${mechSlot("")}${mechSlot("1")}${mechSlot("2")}${mechSlot("3")}${mechSlot("4")}
    </div>
    <div class="skel-skills__weapon-row">
      <div class="skel skel-skills__swap"></div>
      <div class="skel-skills__group">
        ${slot("", "")}${slot("", "1")}${slot("", "2")}${slot("", "3")}${slot("", "4")}
      </div>
    </div>
  </div>
  <div class="skel skel-skills__orb skel-d2"></div>
  <div class="skel-skills__group">
    ${slot("", "")}${slot("", "1")}${slot("", "2")}${slot("", "3")}${slot("", "4")}
  </div>
</div>`,

  specs: `
<div class="skel-specs">
  ${specCard(0)}
  ${specCard(1)}
  ${specCard(2)}
</div>`,

  equipment: `
<div class="skel-equip">
  <div class="skel-equip__col">
    <!-- Armor -->
    <div class="skel-equip__section">
      ${sectionHead(1, true)}
      ${equipSlot(1)}${equipSlot(2)}${equipSlot(3)}${equipSlot(4)}${equipSlot(5)}${equipSlot(1)}
    </div>
    <!-- Weapons -->
    <div class="skel-equip__section">
      ${sectionHead(2)}
      <div class="skel-equip__set-label"><div class="skel skel-d1" style="height:12px;width:30px"></div></div>
      ${weaponSlot(1)}${weaponSlot(2)}
      <div class="skel-equip__set-label"><div class="skel skel-d2" style="height:12px;width:30px"></div></div>
      ${weaponSlot(3)}${weaponSlot(4)}
    </div>
    <!-- Consumables -->
    <div class="skel-equip__section">
      ${sectionHead(3)}
      ${compactSlot(1)}${compactSlot(2)}
    </div>
  </div>
  <div class="skel-equip__col--art">
    <div class="skel skel-equip__art skel-d2"></div>
  </div>
  <div class="skel-equip__col skel-equip__col--right">
    <!-- Attributes -->
    <div class="skel-equip__section">
      ${sectionHead(1)}
      <div class="skel-equip__stats">
        ${statRowSingle(1)}
        ${statRow(1, 2)}
        ${statRow(2, 3)}
        ${statRow(3, 4)}
        ${statRow(4, 5)}
        ${statRowSingle(5)}
        ${statRow(1, 2)}
        ${statRow(2, 3)}
        ${statRowSingle(3)}
      </div>
    </div>
    <!-- Upgrades -->
    <div class="skel-equip__section">
      ${sectionHead(2)}
      <div class="skel-equip__text-label">
        <div class="skel skel-d2" style="height:7px;width:30px"></div>
        <div class="skel skel-equip__text-input skel-d3"></div>
      </div>
    </div>
    <!-- Trinkets -->
    <div class="skel-equip__section">
      ${sectionHead(3, true)}
      <div class="skel-equip__trinket-grid skel-equip__trinket-grid--4">
        ${compactSlot(1)}${compactSlot(2)}${compactSlot(3)}${compactSlot(4)}
      </div>
      <div class="skel-equip__trinket-grid">
        ${compactSlot(2)}${compactSlot(3)}${compactSlot(4)}
      </div>
    </div>
    <!-- Underwater -->
    <div class="skel-equip__section">
      ${sectionHead(4)}
      ${equipSlot(1)}${weaponSlot(2)}${weaponSlot(3)}
    </div>
  </div>
</div>`,

  detail: `
<div class="skel-detail">
  <div class="skel-detail__header">
    <div class="skel skel-detail__icon"></div>
    <div class="skel-detail__text-group">
      <div class="skel skel-d1" style="height:12px;width:70%"></div>
      <div class="skel skel-d2" style="height:10px;width:40%"></div>
    </div>
  </div>
  <div class="skel-detail__section">
    <div class="skel skel-d1" style="height:8px;width:50%"></div>
    <div class="skel skel-d2" style="height:8px;width:90%"></div>
    <div class="skel skel-d3" style="height:8px;width:75%"></div>
  </div>
  <div class="skel-detail__section">
    <div class="skel skel-d2" style="height:8px;width:35%"></div>
    <div class="skel-detail__fact-row"><div class="skel skel-detail__fact-icon skel-d3"></div><div class="skel skel-d3" style="height:8px;width:70%"></div></div>
    <div class="skel-detail__fact-row"><div class="skel skel-detail__fact-icon skel-d4"></div><div class="skel skel-d4" style="height:8px;width:55%"></div></div>
    <div class="skel-detail__fact-row"><div class="skel skel-detail__fact-icon skel-d5"></div><div class="skel skel-d5" style="height:8px;width:65%"></div></div>
    <div class="skel-detail__fact-row"><div class="skel skel-detail__fact-icon skel-d1"></div><div class="skel skel-d1" style="height:8px;width:50%"></div></div>
  </div>
</div>`,

  dropdown: `<div class="skel skel-dropdown"></div>`,

  "library-toolbar": `
<div class="lib-toolbar__breadcrumb">
  <div class="skel skel-d1" style="height:14px;width:90px;border-radius:4px"></div>
</div>
<div class="lib-toolbar__controls">
  <div class="skel skel-d2" style="height:26px;width:160px;border-radius:6px"></div>
  <div class="skel skel-d3" style="height:26px;width:90px;border-radius:6px"></div>
  <div class="skel skel-d1" style="height:26px;width:130px;border-radius:6px"></div>
  <div class="skel skel-d2" style="height:26px;width:75px;border-radius:6px"></div>
  <div class="skel skel-d3" style="height:26px;width:60px;border-radius:6px"></div>
</div>`,

  "library-filters": `
<div class="lib-filters__bar">
  <div class="skel skel-d1" style="height:26px;width:65px;border-radius:6px"></div>
  <div class="skel skel-d2" style="height:26px;width:58px;border-radius:6px"></div>
  <div class="skel skel-d3" style="height:26px;width:52px;border-radius:6px"></div>
</div>`,

  "library-sidebar": `
<div class="lib-sidebar__header">
  <div class="skel" style="width:22px;height:22px;border-radius:4px"></div>
</div>
<nav class="lib-sidebar__nav">
  <div class="lib-sidebar__section">
    <div class="lib-sidebar__section-label"><div class="skel skel-lib-sidebar-head" style="width:80px"></div></div>
    <div class="lib-nav-item"><div class="skel skel-lib-sidebar-icon"></div><div class="skel skel-d1" style="height:18px;width:70px;border-radius:3px"></div></div>
    <div class="lib-nav-item"><div class="skel skel-d2 skel-lib-sidebar-icon"></div><div class="skel skel-d2" style="height:18px;width:55px;border-radius:3px"></div></div>
    <div class="lib-nav-item"><div class="skel skel-d3 skel-lib-sidebar-icon"></div><div class="skel skel-d3" style="height:18px;width:80px;border-radius:3px"></div></div>
  </div>
  <div class="lib-sidebar__section">
    <div class="lib-sidebar__section-header">
      <div class="lib-sidebar__section-label"><div class="skel skel-d2 skel-lib-sidebar-head" style="width:65px"></div></div>
    </div>
    <div class="lib-nav-item"><div class="skel skel-d3 skel-lib-sidebar-icon"></div><div class="skel skel-d3" style="height:18px;width:65px;border-radius:3px"></div></div>
    <div class="lib-nav-item"><div class="skel skel-d2 skel-lib-sidebar-icon"></div><div class="skel skel-d2" style="height:18px;width:75px;border-radius:3px"></div></div>
  </div>
</nav>`,

  "library-list": `
<div class="lib-list">
  ${libListRow(52, "", 1, 2)}
  ${libListRow(68, 1, 2, 3)}
  ${libListRow(43, 2, 3, 1)}
  ${libListRow(60, 3, 1, 2)}
  ${libListRow(75, 1, 2, 3)}
  ${libListRow(38, 2, 3, 1)}
</div>`,

  "library-table": `
<div class="lib-tv">
  <div class="lib-tv__header">
    <span class="lib-tv__action"></span>
    <span class="lib-tv__icon"></span>
    <span class="lib-tv__name"><div style="height:18px;width:40px;background:var(--line-soft);border-radius:3px"></div></span>
    <span class="lib-tv__profession"><div style="height:18px;width:60px;background:var(--line-soft);border-radius:3px"></div></span>
    <span class="lib-tv__spec"><div style="height:18px;width:48px;background:var(--line-soft);border-radius:3px"></div></span>
    <span class="lib-tv__mode"><div style="height:18px;width:36px;background:var(--line-soft);border-radius:3px"></div></span>
    <span class="lib-tv__role"><div style="height:18px;width:30px;background:var(--line-soft);border-radius:3px"></div></span>
    <span class="lib-tv__tags"><div style="height:18px;width:30px;background:var(--line-soft);border-radius:3px"></div></span>
    <span class="lib-tv__created"><div style="height:18px;width:48px;background:var(--line-soft);border-radius:3px"></div></span>
    <span class="lib-tv__modified"><div style="height:18px;width:48px;background:var(--line-soft);border-radius:3px"></div></span>
  </div>
  <ul class="lib-tv__tree">
    ${libTableRow(62, "", 1, 2)}
    ${libTableRow(74, 1, 2, 3)}
    ${libTableRow(45, 2, 3, 1)}
    ${libTableRow(58, 3, 1, 2)}
    ${libTableRow(80, 1, 2, 3)}
    ${libTableRow(50, 2, 3, 1)}
  </ul>
</div>`,

  "library-grid": `
<div class="lib-grid">
  ${libGridCard(70, "", 1, 2)}
  ${libGridCard(60, 1, 2, 3)}
  ${libGridCard(82, 2, 3, 1)}
  ${libGridCard(68, 3, 1, 2)}
  ${libGridCard(55, 1, 2, 3)}
  ${libGridCard(75, 2, 3, 1)}
</div>`,

  "library-icon": `
<div class="lib-icon-grid">
  ${libIconItem("", 1, 48)}
  ${libIconItem(1, 2, 38)}
  ${libIconItem(2, 3, 52)}
  ${libIconItem(3, 1, 40)}
  ${libIconItem(1, 2, 44)}
  ${libIconItem(2, 3, 50)}
  ${libIconItem(3, 1, 36)}
  ${libIconItem("", 2, 48)}
  ${libIconItem(1, 3, 42)}
  ${libIconItem(2, 1, 46)}
</div>`,
};

function injectSkeleton(el, templateName) {
  if (!el) return;
  const html = skeletonTemplates[templateName];
  if (!html) return;
  el.innerHTML = html;
}

export { skeletonTemplates, injectSkeleton };
