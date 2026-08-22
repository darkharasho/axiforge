async function selectProfession(window, name) {
  // #professionSelect is a grouped custom select — professions are group headers,
  // options underneath are "Core {Profession}" + elite specs. Opening it portals the
  // menu to document.body (custom-select.js `_portalMenu`) so it escapes ancestor
  // overflow/stacking constraints, so the search input and options must be located
  // via the portal sentinel, NOT scoped under #professionSelect.
  await window.click("#professionSelect .cselect__trigger");
  const menu = window.locator('.cselect__menu[data-cselect-portal="1"]');
  await menu.waitFor({ state: "visible", timeout: 5_000 });
  const search = menu.locator(".cselect__search");
  if (await search.isVisible()) {
    await search.fill(name);
    await window.waitForTimeout(200);
  }
  // Click the option containing the profession name (e.g. "Core Necromancer" or "Necromancer")
  const option = menu.locator(`.cselect__option:has-text("${name}") >> visible=true`).first();
  await option.click();
  // Wait for catalog to load — spec cards appear when setProfession() completes
  await window.waitForFunction(
    () => !!document.querySelector("#specializationsHost article.spec-card"),
    null,
    { timeout: 15_000 }
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

async function addSpecialization(window, specName) {
  const emptySlot = window.locator(".spec-card .cselect__trigger").first();
  await emptySlot.click();
  await window.waitForSelector(".slot-picker", { timeout: 3000 });
  const search = window.locator(".slot-picker__search");
  if (await search.isVisible()) {
    await search.fill(specName);
    await window.waitForTimeout(300);
  }
  await window.click(`.slot-picker__option:has-text("${specName}")`);
  await window.waitForTimeout(500);
}

async function selectTrait(window, specIndex, tier, col) {
  const specCards = window.locator(".spec-card");
  const card = specCards.nth(specIndex);
  const traits = card.locator(`.trait-btn[data-tier="${tier}"]`);
  await traits.nth(col).click();
  await window.waitForTimeout(200);
}

async function selectSkill(window, slotType, skillName) {
  const slot = window.locator(`.skill-slot[data-slot="${slotType}"] .skill-icon-large`).first();
  await slot.click();
  await window.waitForSelector(".slot-picker", { timeout: 3000 });
  const search = window.locator(".slot-picker__search");
  if (await search.isVisible()) {
    await search.fill(skillName);
    await window.waitForTimeout(300);
  }
  await window.click(`.slot-picker__option:has-text("${skillName}")`);
  await window.waitForTimeout(300);
}

module.exports = { selectProfession, setTitle, setGameMode, saveBuild, addSpecialization, selectTrait, selectSkill };
