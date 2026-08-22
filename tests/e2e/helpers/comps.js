/**
 * Helpers for driving the Compositions page.
 *
 * The comp list is its own widget (modules/comps/comp-list.js), not the library
 * list, and the two have different contracts. Keeping these here stops specs from
 * hand-rolling their own copies and drifting apart.
 */

/** Wait for the comp detail view to finish rendering. */
async function waitForCompDetail(window) {
  await window.waitForSelector(".comp-detail", { timeout: 5_000 });
  await window.waitForTimeout(300);
}

/**
 * Open the first comp in the list.
 *
 * Two things differ from the library list, and getting either wrong hangs the
 * wait until it times out:
 *  - No `data-bound` handshake. renderCompList() sets innerHTML and calls
 *    bindListEvents() synchronously, so a row in the DOM is already live; only
 *    the library's own rows get stamped with data-bound="1".
 *  - A comp opens on a single click, not a double click.
 */
async function openFirstComp(window) {
  const row = window.locator(".comp-list-row[data-comp-id]").first();
  await row.waitFor({ state: "visible", timeout: 10_000 });
  await row.click();
  await waitForCompDetail(window);
}

module.exports = { waitForCompDetail, openFirstComp };
