async function goToEditor(window) {
  await window.click('.leftnav__item[data-page="editor"]');
  await window.waitForSelector("#page-editor:not(.hidden)", { timeout: 5000 });
}

async function goToLibrary(window) {
  await window.click('.leftnav__item[data-page="library"]');
  await window.waitForSelector("#page-library:not(.hidden)", { timeout: 5000 });
}

async function goToComps(window) {
  await window.click('.leftnav__item[data-page="comps"]');
  await window.waitForSelector("#page-comps:not(.hidden)", { timeout: 5000 });
}

async function switchTab(window, tabName) {
  await window.click(`[data-subtab="${tabName}"]`);
  await window.waitForTimeout(300);
}

module.exports = { goToEditor, goToLibrary, goToComps, switchTab };
