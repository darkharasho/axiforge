// The open dropdown's menu is portalled to document.body (custom-select.js
// `_portalMenu`), so options, group headers and the search input are NOT reachable
// under the select's own wrapper while it is open. The wrapper keeps its
// `.cselect--open` class, which makes `.cselect--open .cselect__option` look correct
// and silently match nothing. Always locate menu contents through this sentinel.
const OPEN_MENU = '.cselect__menu[data-cselect-portal="1"]';

/**
 * Open a custom select and return a locator for its portalled menu.
 * `host` is any selector for the select or an ancestor of it (e.g. "#professionSelect",
 * or a spec card) — the trigger is found beneath it.
 */
async function openCustomSelect(window, host) {
  await scrollIntoViewAndSettle(window, window.locator(`${host} >> .cselect__trigger`));
  await window.click(`${host} >> .cselect__trigger`);
  const menu = window.locator(OPEN_MENU);
  await menu.waitFor({ state: "visible", timeout: 5_000 });
  return menu;
}

/**
 * Wait for a just-opened menu to finish its entry animation.
 *
 * custom-select.css runs `cselect-open` (150ms, opacity + translateY) every time a
 * menu is portalled. While it plays, the options are still moving, so Playwright's
 * actionability checks fail — and because the app tears the menu down the instant an
 * option is clicked, a click that lands on a late retry still reports a timeout even
 * though the selection took. Settling first makes the first attempt the only attempt.
 */
async function settleMenu(window) {
  await window.waitForTimeout(250);
}

/**
 * Bring `target` into view and let the scroll event land before anything opens.
 *
 * renderer.js closes any open cselect on a capture-phase `scroll`, and Playwright
 * scrolls an element into view as part of its click. Scroll events are delivered on
 * the next frame, so an auto-scroll that starts *before* the click arrives *after*
 * the menu has opened and closes it again. Scrolling up front keeps the click itself
 * scroll-free.
 */
async function scrollIntoViewAndSettle(window, target) {
  await target.scrollIntoViewIfNeeded();
  await window.waitForTimeout(150);
}

/** Pick an option out of an open menu by visible text. */
async function chooseOption(window, menu, text) {
  await settleMenu(window);
  await menu.locator(`.cselect__option:has-text("${text}") >> visible=true`).first().click();
}

/** Locator for the currently open dropdown's menu. */
function openMenu(window) {
  return window.locator(OPEN_MENU);
}

/**
 * Close whatever dropdown is open, the way the app does it.
 *
 * Do NOT close a dropdown by stripping `.cselect--open` in an evaluate() — that leaves
 * the menu stranded on document.body with its portal sentinel intact, and the next
 * test's `OPEN_MENU` lookup then matches the previous test's menu.
 */
async function closeOpenSelect(window) {
  await window.keyboard.press("Escape");
  await window.locator(OPEN_MENU).waitFor({ state: "detached", timeout: 5_000 });
}

/** Type into the open menu's search box, if it has one. */
async function filterOpenMenu(window, menu, text) {
  const search = menu.locator(".cselect__search");
  if (await search.isVisible()) {
    await search.fill(text);
    await window.waitForTimeout(200);
  }
}

async function selectProfession(window, name) {
  // #professionSelect is a grouped custom select — professions are group headers,
  // options underneath are "Core {Profession}" + elite specs.
  const menu = await openCustomSelect(window, "#professionSelect");
  await filterOpenMenu(window, menu, name);
  // Click the option containing the profession name (e.g. "Core Necromancer" or "Necromancer")
  await chooseOption(window, menu, name);
  // Wait for catalog to load — spec cards replace the "select a profession" empty state
  // when setProfession() completes. Note the three cards this yields are EMPTY slot
  // placeholders: the editor no longer auto-fills specializations, so a test that needs
  // traits, skill availability or detail-panel content must call fillSpecializations().
  await window.waitForFunction(
    () => !!document.querySelector("#specializationsHost article.spec-card"),
    null,
    { timeout: 15_000 }
  );
}

/**
 * Open slot `slotIndex`'s specialization picker and return its portalled menu.
 *
 * The overlay's own `.cselect__trigger` is a decoy: specializations.css gives it
 * `opacity: 0; pointer-events: none`, so clicking it does nothing. The click
 * affordance is the visible element the card renders — the emblem on a filled card,
 * the placeholder panel on an empty one — each of which forwards to the trigger.
 */
async function openSpecPicker(window, slotIndex) {
  const card = window.locator("#specializationsHost article.spec-card").nth(slotIndex);
  const emblem = card.locator(".spec-emblem");
  const affordance = (await emblem.count()) ? emblem : card.locator(".spec-card__panel--empty");
  await scrollIntoViewAndSettle(window, affordance);
  await affordance.click();
  const menu = openMenu(window);
  await menu.waitFor({ state: "visible", timeout: 5_000 });
  return menu;
}

/**
 * Fill specialization slots by name, in order from slot 0.
 *
 * The build editor opens blank — every slot renders as `.spec-card--empty` with a
 * picker and no emblem or trait columns — so anything downstream of a chosen
 * specialization (traits, minor anchors, elite skill availability, the detail panel)
 * is absent until a test picks one. Only the third slot accepts elite specs.
 */
async function fillSpecializations(window, names) {
  for (let slotIndex = 0; slotIndex < names.length; slotIndex += 1) {
    const card = window.locator("#specializationsHost article.spec-card").nth(slotIndex);
    const menu = await openSpecPicker(window, slotIndex);
    await filterOpenMenu(window, menu, names[slotIndex]);
    await chooseOption(window, menu, names[slotIndex]);
    // The slot re-renders as a filled card once the selection lands.
    await card.locator(".spec-emblem").waitFor({ state: "visible", timeout: 5_000 });
  }
}

/** Change the specialization already in a slot. */
async function changeSpecialization(window, slotIndex, specName) {
  const menu = await openSpecPicker(window, slotIndex);
  await filterOpenMenu(window, menu, specName);
  await chooseOption(window, menu, specName);
  await window.waitForFunction(
    ({ i, name }) => {
      const el = document.querySelectorAll("#specializationsHost article.spec-card")[i];
      return el?.querySelector(".spec-emblem")?.getAttribute("title") === name;
    },
    { i: slotIndex, name: specName },
    { timeout: 5_000 }
  );
}

async function setTitle(window, title) {
  await window.fill("#editorTitle", title);
}

async function setGameMode(window, mode) {
  await window.click(`.game-mode-toggle__btn[data-mode="${mode}"]`);
  await window.waitForTimeout(500);
}

async function saveBuild(window) {
  await window.click("#saveBuildBtn");
  await window.waitForTimeout(500);
}

async function selectTrait(window, specIndex, tier, col) {
  const specCards = window.locator(".spec-card");
  const card = specCards.nth(specIndex);
  const traits = card.locator(`.trait-btn[data-tier="${tier}"]`);
  await traits.nth(col).click();
  await window.waitForTimeout(200);
}

/**
 * Pick a skill by name. `slot` is any selector for the skill slot; its
 * `.skill-icon-large` button proxies the click to the slot's cselect trigger.
 * Skill slots start empty — the editor does not pick skills for you.
 */
async function selectSkill(window, slot, skillName) {
  await window.locator(slot).locator(".skill-icon-large").first().click();
  const menu = openMenu(window);
  await menu.waitFor({ state: "visible", timeout: 5_000 });
  await filterOpenMenu(window, menu, skillName);
  await chooseOption(window, menu, skillName);
  await menu.waitFor({ state: "detached", timeout: 5_000 });
}

/**
 * Equip a weapon in the first weapon slot, via the Equipment sub-tab, and return to the
 * Build tab. Some profession mechanics are weapon-derived — Warrior's F1 burst is blank
 * with an empty mainhand by design (skills.js) — so a test about those must equip first.
 * Weapons use the `.slot-picker` widget, not a cselect.
 */
async function equipMainhandWeapon(window, weaponName) {
  await window.click('[data-subtab="equipment"]');
  const slot = window.locator("#equipmentPanel .equip-slot--weapon").first();
  await slot.locator(".equip-weapon-type-btn").click();
  await window.waitForSelector(".slot-picker", { timeout: 5_000 });
  await window.click(`.slot-picker__option:has-text("${weaponName}")`);
  await window.waitForTimeout(300);
  await window.click('[data-subtab="build"]');
  await window.waitForTimeout(300);
}

module.exports = {
  OPEN_MENU,
  openCustomSelect,
  openMenu,
  filterOpenMenu,
  chooseOption,
  closeOpenSelect,
  selectProfession,
  openSpecPicker,
  fillSpecializations,
  changeSpecialization,
  setTitle,
  setGameMode,
  saveBuild,
  selectTrait,
  selectSkill,
  equipMainhandWeapon,
};
