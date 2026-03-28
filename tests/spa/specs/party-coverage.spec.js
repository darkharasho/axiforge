const { test, expect } = require("playwright/test");
const { generateCompPayload, makeTestBuild, makeTestComp } = require("../helpers/fixture-gen");
const { loadCompPage } = require("../helpers/route-mock");

// Helper to escape HTML attribute values for embedding JSON in data attributes
function escAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Pre-built boonCoverageHtml matching production structure ─────────────────
// Two party lines: P1 (Guardian+Elementalist), P2 (Warrior+Necromancer)
// P1 has: covered boons (Might×2, Fury, Protection), Light combo field, Blast finisher
// P2 has: Blast×3 finishers, Dark combo field, sparse boons

const boonCoverageHtml = `
<div class="party-cov__line" data-line-label="P1">
  <div class="party-cov__line-header" data-action="toggle-line">
    <span class="party-cov__line-chevron">&#x25b8;</span>
    <span class="party-cov__line-label">P1</span>
    <span class="party-cov__header-profs">
      <span class="party-cov__header-prof" title="Firebrand">G</span>
      <span class="party-cov__header-prof" title="Tempest">E</span>
    </span>
    <span class="party-cov__header-boons">
      <img src="" width="16" height="16" alt="Aegis" class="party-cov__header-boon" data-boon-name="Aegis" data-has-ally="true" data-covered="true" />
      <img src="" width="16" height="16" alt="Alacrity" class="party-cov__header-boon party-cov__header-boon--uncovered" data-boon-name="Alacrity" data-has-ally="false" data-covered="false" />
      <img src="" width="16" height="16" alt="Fury" class="party-cov__header-boon" data-boon-name="Fury" data-has-ally="true" data-covered="true" />
      <img src="" width="16" height="16" alt="Might" class="party-cov__header-boon" data-boon-name="Might" data-has-ally="true" data-covered="true" />
      <img src="" width="16" height="16" alt="Protection" class="party-cov__header-boon" data-boon-name="Protection" data-has-ally="true" data-covered="true" />
      <img src="" width="16" height="16" alt="Quickness" class="party-cov__header-boon" data-boon-name="Quickness" data-has-ally="true" data-covered="true" />
      <img src="" width="16" height="16" alt="Regeneration" class="party-cov__header-boon" data-boon-name="Regeneration" data-has-ally="false" data-covered="true" />
      <img src="" width="16" height="16" alt="Resistance" class="party-cov__header-boon party-cov__header-boon--uncovered" data-boon-name="Resistance" data-has-ally="false" data-covered="false" />
      <img src="" width="16" height="16" alt="Resolution" class="party-cov__header-boon party-cov__header-boon--uncovered" data-boon-name="Resolution" data-has-ally="false" data-covered="false" />
      <img src="" width="16" height="16" alt="Stability" class="party-cov__header-boon party-cov__header-boon--uncovered" data-boon-name="Stability" data-has-ally="false" data-covered="false" />
      <img src="" width="16" height="16" alt="Swiftness" class="party-cov__header-boon" data-boon-name="Swiftness" data-has-ally="true" data-covered="true" />
      <img src="" width="16" height="16" alt="Vigor" class="party-cov__header-boon party-cov__header-boon--uncovered" data-boon-name="Vigor" data-has-ally="false" data-covered="false" />
    </span>
  </div>
  <div class="party-cov__line-body party-cov__line-body--collapsed">
    <div class="party-cov__section" data-section="boons">
      <div class="party-cov__section-header">
        <div class="party-cov__section-label">BOONS</div>
        <label class="party-cov__toggle">
          <input type="checkbox" class="party-cov__toggle-input" data-action="toggle-self-boons" />
          <span class="party-cov__toggle-switch"></span>
          <span class="party-cov__toggle-text">Show self boons</span>
        </label>
      </div>
      <div class="party-cov__pills">
        <div class="party-cov__pill party-cov__pill--boon"
             data-category="boon" data-boon-name="Might" data-has-ally="true" data-count="2"
             data-providers="${escAttr(JSON.stringify([
               { buildId: "g1", buildName: "Firebrand", profession: "Guardian", eliteSpec: "Firebrand", profIcon: "G", sources: [
                 { type: "skill", name: "Save Yourselves!", skillIcon: "", skillDescription: "Grant boons", skillFacts: [], stacks: 5, effectiveDuration: 15, context: "", isAlly: true }
               ]},
               { buildId: "e1", buildName: "Tempest", profession: "Elementalist", eliteSpec: "Tempest", profIcon: "E", sources: [
                 { type: "skill", name: "Glyph of Elemental Harmony", skillIcon: "", skillDescription: "Heal and grant boons", skillFacts: [], stacks: 3, effectiveDuration: 10, context: "", isAlly: true }
               ]}
             ]))}"
             data-line-label="P1" data-clickable="true">
          <img src="" width="20" height="20" alt="Might" class="party-cov__pill-icon" />
          <span class="party-cov__pill-name">Might</span>
          <span class="party-cov__pill-badge">&times;2</span>
        </div>
        <div class="party-cov__pill party-cov__pill--boon"
             data-category="boon" data-boon-name="Fury" data-has-ally="true" data-count="1"
             data-providers="${escAttr(JSON.stringify([
               { buildId: "g1", buildName: "Firebrand", profession: "Guardian", eliteSpec: "Firebrand", profIcon: "G", sources: [
                 { type: "skill", name: "Feel My Wrath!", skillIcon: "", skillDescription: "Grant fury and quickness", skillFacts: [], stacks: 1, effectiveDuration: 10, context: "", isAlly: true }
               ]}
             ]))}"
             data-line-label="P1" data-clickable="true">
          <img src="" width="20" height="20" alt="Fury" class="party-cov__pill-icon" />
          <span class="party-cov__pill-name">Fury</span>
        </div>
        <div class="party-cov__pill party-cov__pill--boon party-cov__pill--uncovered"
             data-category="boon" data-boon-name="Alacrity" data-has-ally="false" data-count="0"
             data-providers="[]" data-line-label="P1">
          <img src="" width="20" height="20" alt="Alacrity" class="party-cov__pill-icon" />
          <span class="party-cov__pill-name">Alacrity</span>
        </div>
        <div class="party-cov__pill party-cov__pill--boon"
             data-category="boon" data-boon-name="Regeneration" data-has-ally="false" data-count="1"
             data-providers="${escAttr(JSON.stringify([
               { buildId: "g1", buildName: "Firebrand", profession: "Guardian", eliteSpec: "Firebrand", profIcon: "G", sources: [
                 { type: "skill", name: "Purification", skillIcon: "", skillDescription: "Heal", skillFacts: [], stacks: 1, effectiveDuration: 10, context: "", isAlly: false }
               ]}
             ]))}"
             data-line-label="P1" data-clickable="true">
          <img src="" width="20" height="20" alt="Regeneration" class="party-cov__pill-icon" />
          <span class="party-cov__pill-name">Regeneration</span>
        </div>
      </div>
      <div class="party-cov__expand" data-expand-for="boons"></div>
    </div>
    <div class="party-cov__section" data-section="fields">
      <div class="party-cov__section-label">COMBO FIELDS</div>
      <div class="party-cov__pills">
        <div class="party-cov__pill party-cov__pill--field"
             data-category="field" data-field-type="Light" data-count="1"
             data-sources="${escAttr(JSON.stringify([
               { sourceName: "Wall of Reflection", profession: "Guardian", eliteSpec: "Firebrand", profIcon: "G", kitName: "", duration: 10, radius: 0, skillIcon: "", skillDescription: "Reflect projectiles", skillFacts: [] }
             ]))}"
             data-line-label="P1" data-clickable="true"
             style="background:#5a5a3a;border-color:#7a7a5a;">
          <span class="party-cov__pill-emoji">✨</span>
          <span class="party-cov__pill-name">Light</span>
        </div>
      </div>
      <div class="party-cov__expand" data-expand-for="fields"></div>
    </div>
    <div class="party-cov__section" data-section="finishers">
      <div class="party-cov__section-label">FINISHERS</div>
      <div class="party-cov__pills">
        <div class="party-cov__pill party-cov__pill--finisher"
             data-category="finisher" data-finisher-type="Blast" data-count="2"
             data-sources="${escAttr(JSON.stringify([
               { sourceName: "Arcane Wave", profession: "Elementalist", eliteSpec: "Tempest", profIcon: "E", kitName: "", hitCount: 1, percent: 100, skillIcon: "", skillDescription: "Blast wave", skillFacts: [] },
               { sourceName: "Aftershock!", profession: "Elementalist", eliteSpec: "Tempest", profIcon: "E", kitName: "", hitCount: 1, percent: 100, skillIcon: "", skillDescription: "Earth finisher", skillFacts: [] }
             ]))}"
             data-line-label="P1" data-clickable="true"
             style="background:#4a3a5a;border-color:#6a5a7a;">
          <span class="party-cov__pill-emoji">💥</span>
          <span class="party-cov__pill-name">Blast</span>
          <span class="party-cov__pill-badge" style="color:#c8f;">&times;2</span>
        </div>
      </div>
      <div class="party-cov__expand" data-expand-for="finishers"></div>
    </div>
  </div>
</div>
<div class="party-cov__line" data-line-label="P2">
  <div class="party-cov__line-header" data-action="toggle-line">
    <span class="party-cov__line-chevron">&#x25b8;</span>
    <span class="party-cov__line-label">P2</span>
    <span class="party-cov__header-profs">
      <span class="party-cov__header-prof" title="Berserker">W</span>
      <span class="party-cov__header-prof" title="Reaper">N</span>
    </span>
    <span class="party-cov__header-boons">
      <img src="" width="16" height="16" alt="Might" class="party-cov__header-boon" data-boon-name="Might" data-has-ally="false" data-covered="true" />
      <img src="" width="16" height="16" alt="Fury" class="party-cov__header-boon" data-boon-name="Fury" data-has-ally="false" data-covered="true" />
      <img src="" width="16" height="16" alt="Stability" class="party-cov__header-boon" data-boon-name="Stability" data-has-ally="false" data-covered="true" />
    </span>
  </div>
  <div class="party-cov__line-body party-cov__line-body--collapsed">
    <div class="party-cov__section" data-section="boons">
      <div class="party-cov__section-header">
        <div class="party-cov__section-label">BOONS</div>
        <label class="party-cov__toggle">
          <input type="checkbox" class="party-cov__toggle-input" data-action="toggle-self-boons" />
          <span class="party-cov__toggle-switch"></span>
          <span class="party-cov__toggle-text">Show self boons</span>
        </label>
      </div>
      <div class="party-cov__pills">
        <div class="party-cov__pill party-cov__pill--boon"
             data-category="boon" data-boon-name="Stability" data-has-ally="false" data-count="1"
             data-providers="${escAttr(JSON.stringify([
               { buildId: "w1", buildName: "Berserker", profession: "Warrior", eliteSpec: "Berserker", profIcon: "W", sources: [
                 { type: "skill", name: "Stomp", skillIcon: "", skillDescription: "Stomp the ground", skillFacts: [], stacks: 2, effectiveDuration: 6, context: "", isAlly: false }
               ]}
             ]))}"
             data-line-label="P2" data-clickable="true">
          <img src="" width="20" height="20" alt="Stability" class="party-cov__pill-icon" />
          <span class="party-cov__pill-name">Stability</span>
        </div>
      </div>
      <div class="party-cov__expand" data-expand-for="boons"></div>
    </div>
    <div class="party-cov__section" data-section="fields">
      <div class="party-cov__section-label">COMBO FIELDS</div>
      <div class="party-cov__pills">
        <div class="party-cov__pill party-cov__pill--field"
             data-category="field" data-field-type="Dark" data-count="2"
             data-sources="${escAttr(JSON.stringify([
               { sourceName: "Well of Suffering", profession: "Necromancer", eliteSpec: "Reaper", profIcon: "N", kitName: "", duration: 5, radius: 240, skillIcon: "", skillDescription: "Dark well", skillFacts: [] },
               { sourceName: "Well of Corruption", profession: "Necromancer", eliteSpec: "Reaper", profIcon: "N", kitName: "", duration: 5, radius: 240, skillIcon: "", skillDescription: "Corrupt boons", skillFacts: [] }
             ]))}"
             data-line-label="P2" data-clickable="true"
             style="background:#3a2a3a;border-color:#5a3a5a;">
          <span class="party-cov__pill-emoji">🌑</span>
          <span class="party-cov__pill-name">Dark</span>
          <span class="party-cov__pill-badge" style="color:#c8a;">&times;2</span>
        </div>
      </div>
      <div class="party-cov__expand" data-expand-for="fields"></div>
    </div>
    <div class="party-cov__section" data-section="finishers">
      <div class="party-cov__section-label">FINISHERS</div>
      <div class="party-cov__pills">
        <div class="party-cov__pill party-cov__pill--finisher"
             data-category="finisher" data-finisher-type="Blast" data-count="3"
             data-sources="${escAttr(JSON.stringify([
               { sourceName: "Stomp", profession: "Warrior", eliteSpec: "Berserker", profIcon: "W", kitName: "", hitCount: 1, percent: 100, skillIcon: "", skillDescription: "Stomp the ground", skillFacts: [] },
               { sourceName: "Banner of Strength", profession: "Warrior", eliteSpec: "Berserker", profIcon: "W", kitName: "", hitCount: 1, percent: 100, skillIcon: "", skillDescription: "Place a banner", skillFacts: [] },
               { sourceName: "Banner of Discipline", profession: "Warrior", eliteSpec: "Berserker", profIcon: "W", kitName: "", hitCount: 1, percent: 100, skillIcon: "", skillDescription: "Place a banner", skillFacts: [] }
             ]))}"
             data-line-label="P2" data-clickable="true"
             style="background:#4a3a5a;border-color:#6a5a7a;">
          <span class="party-cov__pill-emoji">💥</span>
          <span class="party-cov__pill-name">Blast</span>
          <span class="party-cov__pill-badge" style="color:#c8f;">&times;3</span>
        </div>
      </div>
      <div class="party-cov__expand" data-expand-for="finishers"></div>
    </div>
  </div>
</div>`;

// ── Desktop Tests ────────────────────────────────────────────────────────────

test.describe("Party Coverage — Desktop", () => {
  test.skip(({ viewport }) => viewport.width < 1024, "Desktop only");

  let payload;

  test.beforeAll(() => {
    const builds = [
      makeTestBuild({ profession: "Guardian", title: "Firebrand" }),
      makeTestBuild({ profession: "Elementalist", title: "Tempest" }),
      makeTestBuild({ profession: "Warrior", title: "Berserker" }),
      makeTestBuild({ profession: "Necromancer", title: "Reaper" }),
    ];
    const comp = makeTestComp({
      name: "Party Coverage SPA Test",
      buildIds: builds.map((b) => b.id),
      partyLines: [
        { id: "pl-1", capacity: 5, slots: [builds[0].id, builds[1].id] },
        { id: "pl-2", capacity: 5, slots: [builds[2].id, builds[3].id] },
      ],
      boonCoverageHtml,
    });
    payload = generateCompPayload(comp, builds);
  });

  // SPA Test 1: Party coverage renders
  test("party coverage container renders with party lines", async ({ page }) => {
    await loadCompPage(page, payload);
    const lines = page.locator(".party-cov__line");
    await expect(lines).toHaveCount(2);
  });

  // SPA Test 2: Labels
  test("party lines have P1 and P2 labels", async ({ page }) => {
    await loadCompPage(page, payload);
    await expect(page.locator('.party-cov__line-label:text("P1")')).toBeVisible();
    await expect(page.locator('.party-cov__line-label:text("P2")')).toBeVisible();
  });

  // SPA Test 3: Header content
  test("P1 header shows profession icons and covered boon indicators", async ({ page }) => {
    await loadCompPage(page, payload);
    const p1 = page.locator('.party-cov__line[data-line-label="P1"]');
    const profIcons = p1.locator(".party-cov__header-prof");
    await expect(profIcons).toHaveCount(2);

    // Covered boon icons should not have uncovered class
    const coveredBoons = p1.locator('.party-cov__header-boon:not(.party-cov__header-boon--uncovered)');
    const count = await coveredBoons.count();
    expect(count).toBeGreaterThan(0);
  });

  // SPA Test 4: All three sections
  test("each line has boons, fields, and finishers sections", async ({ page }) => {
    await loadCompPage(page, payload);

    // Expand P1 to make sections visible
    await page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header').click();
    await page.waitForTimeout(300);

    const p1 = page.locator('.party-cov__line[data-line-label="P1"]');
    await expect(p1.locator('[data-section="boons"]')).toHaveCount(1);
    await expect(p1.locator('[data-section="fields"]')).toHaveCount(1);
    await expect(p1.locator('[data-section="finishers"]')).toHaveCount(1);
  });

  // SPA Test 5: Expand/collapse
  test("clicking line header expands and collapses", async ({ page }) => {
    await loadCompPage(page, payload);
    const header = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header');
    const body = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-body');
    const chevron = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-chevron');

    // Start collapsed
    await expect(chevron).toHaveText("\u25b8");

    // Expand
    await header.click();
    await expect(chevron).toHaveText("\u25be");
    const expanded = await body.evaluate((el) => !el.classList.contains("party-cov__line-body--collapsed"));
    expect(expanded).toBe(true);

    // Collapse
    await header.click();
    await expect(chevron).toHaveText("\u25b8");
  });

  // SPA Test 6: Boon pill expand
  test("clicking covered boon pill shows source detail rows", async ({ page }) => {
    await loadCompPage(page, payload);
    // Expand P1
    await page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header').click();
    await page.waitForTimeout(300);

    const p1 = page.locator('.party-cov__line[data-line-label="P1"]');
    const mightPill = p1.locator('.party-cov__pill--boon[data-boon-name="Might"]');
    await mightPill.click();
    await page.waitForTimeout(300);

    const srcRows = p1.locator('.party-cov__expand[data-expand-for="boons"] .party-cov__src-row');
    const count = await srcRows.count();
    expect(count).toBeGreaterThan(0);

    // Verify source row content
    await expect(srcRows.first().locator(".party-cov__src-name")).toBeVisible();
    await expect(srcRows.first().locator(".party-cov__src-dur")).toBeVisible();
  });

  // SPA Test 7: Combo field pill expand
  test("clicking field pill shows source details", async ({ page }) => {
    await loadCompPage(page, payload);
    await page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header').click();
    await page.waitForTimeout(300);

    const p1 = page.locator('.party-cov__line[data-line-label="P1"]');
    const lightPill = p1.locator('.party-cov__pill--field[data-field-type="Light"]');
    await lightPill.click();
    await page.waitForTimeout(300);

    const srcRows = p1.locator('.party-cov__expand[data-expand-for="fields"] .party-cov__src-row');
    expect(await srcRows.count()).toBeGreaterThan(0);
  });

  // SPA Test 8: Finisher pill expand
  test("clicking finisher pill shows source details", async ({ page }) => {
    await loadCompPage(page, payload);
    await page.locator('.party-cov__line[data-line-label="P2"] .party-cov__line-header').click();
    await page.waitForTimeout(300);

    const p2 = page.locator('.party-cov__line[data-line-label="P2"]');
    const blastPill = p2.locator('.party-cov__pill--finisher[data-finisher-type="Blast"]');
    await blastPill.click();
    await page.waitForTimeout(300);

    const srcRows = p2.locator('.party-cov__expand[data-expand-for="finishers"] .party-cov__src-row');
    expect(await srcRows.count()).toBe(3);
  });

  // SPA Test 9: Self-boon toggle
  test("self-boon toggle changes boon pill visibility", async ({ page }) => {
    await loadCompPage(page, payload);
    await page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header').click();
    await page.waitForTimeout(300);

    const p1 = page.locator('.party-cov__line[data-line-label="P1"]');
    const toggleLabel = p1.locator(".party-cov__toggle");

    // Regeneration has has-ally=false, so with toggle off it should get self-only class
    const regenPill = p1.locator('.party-cov__pill--boon[data-boon-name="Regeneration"]');
    const hasSelfOnly = await regenPill.evaluate((el) => el.classList.contains("party-cov__pill--self-only"));
    expect(hasSelfOnly).toBe(true);

    // Click the label (visible) to check the hidden checkbox and show self boons
    await toggleLabel.click();
    await page.waitForTimeout(300);
    const hasSelfOnlyAfter = await regenPill.evaluate((el) => el.classList.contains("party-cov__pill--self-only"));
    expect(hasSelfOnlyAfter).toBe(false);
  });
});

// ── Mobile Tests ─────────────────────────────────────────────────────────────

test.describe("Party Coverage — Mobile", () => {
  test.skip(({ viewport }) => viewport.width > 1024, "Mobile/tablet only");

  let payload;

  test.beforeAll(() => {
    const builds = [
      makeTestBuild({ profession: "Guardian", title: "Firebrand" }),
      makeTestBuild({ profession: "Elementalist", title: "Tempest" }),
      makeTestBuild({ profession: "Warrior", title: "Berserker" }),
      makeTestBuild({ profession: "Necromancer", title: "Reaper" }),
    ];
    const comp = makeTestComp({
      name: "Party Coverage SPA Mobile Test",
      buildIds: builds.map((b) => b.id),
      partyLines: [
        { id: "pl-1", capacity: 5, slots: [builds[0].id, builds[1].id] },
        { id: "pl-2", capacity: 5, slots: [builds[2].id, builds[3].id] },
      ],
      boonCoverageHtml,
    });
    payload = generateCompPayload(comp, builds);
  });

  // SPA Mobile Test 10: Renders at mobile width
  test("party coverage renders at mobile width without horizontal overflow", async ({ page }) => {
    await loadCompPage(page, payload);
    const container = page.locator(".comp-boon-cov");
    await expect(container).toBeVisible();

    // Check no horizontal overflow
    const overflows = await page.evaluate(() => {
      const el = document.querySelector(".comp-boon-cov");
      return el ? el.scrollWidth > el.clientWidth : false;
    });
    expect(overflows).toBe(false);
  });

  // SPA Mobile Test 11: Header boons wrap
  test("header boons wrap at narrow width", async ({ page }) => {
    await loadCompPage(page, payload);
    const headerBoons = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__header-boons');
    await expect(headerBoons).toBeVisible();

    // flex-wrap should be applied — verify computed style
    const flexWrap = await headerBoons.evaluate((el) => getComputedStyle(el).flexWrap);
    expect(flexWrap).toBe("wrap");
  });

  // SPA Mobile Test 12: Pills tappable
  test("pill elements are visible and tappable at narrow width", async ({ page }) => {
    await loadCompPage(page, payload);
    // Expand P1
    await page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header').click();
    await page.waitForTimeout(300);

    const pill = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__pill--boon[data-clickable="true"]').first();
    await expect(pill).toBeVisible();

    // Verify it's not clipped (bounding box within viewport)
    const box = await pill.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  });

  // SPA Mobile Test 13: Expand/collapse via tap
  test("expand and collapse work via tap on mobile", async ({ page }) => {
    await loadCompPage(page, payload);
    const header = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header');
    const chevron = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-chevron');

    await expect(chevron).toHaveText("\u25b8");
    await header.tap();
    await expect(chevron).toHaveText("\u25be");
    await header.tap();
    await expect(chevron).toHaveText("\u25b8");
  });

  // SPA Mobile Test 14: Expanded detail fits viewport
  test("expanded detail panel does not exceed viewport width", async ({ page }) => {
    await loadCompPage(page, payload);
    // Expand P1
    await page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header').tap();
    await page.waitForTimeout(300);

    // Tap a boon pill
    const pill = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__pill--boon[data-clickable="true"]').first();
    await pill.tap();
    await page.waitForTimeout(300);

    // Check expand container fits
    const expandEl = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__expand[data-expand-for="boons"]');
    const overflows = await expandEl.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflows).toBe(false);
  });
});
