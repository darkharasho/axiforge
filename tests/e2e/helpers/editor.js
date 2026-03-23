async function selectProfession(window, name) {
  await window.selectOption("#professionSelect", { label: name });
  await window.waitForTimeout(2000);
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
