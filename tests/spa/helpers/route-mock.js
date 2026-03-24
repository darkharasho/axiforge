"use strict";

async function mockEncRoute(page, { fileId, base64Payload, type = "build" }) {
  const dir = type === "build" ? "builds" : "comps";
  await page.route(`**/${dir}/${fileId}.enc`, (route) =>
    route.fulfill({ body: base64Payload, contentType: "text/plain" })
  );
}

async function loadBuildPage(page, payload, opts = {}) {
  await mockEncRoute(page, { fileId: payload.fileId, base64Payload: payload.base64Payload, type: "build" });
  await page.goto(`/?b=${payload.fileId}.${payload.encKey}`);
  await page.waitForSelector(opts.waitFor || ".skills-host", { timeout: 15_000 });
}

async function loadCompPage(page, payload, opts = {}) {
  await mockEncRoute(page, { fileId: payload.fileId, base64Payload: payload.base64Payload, type: "comp" });
  await page.goto(`/?c=${payload.fileId}.${payload.encKey}`);
  await page.waitForSelector(opts.waitFor || ".comp-detail", { timeout: 15_000 });
}

module.exports = { mockEncRoute, loadBuildPage, loadCompPage };
