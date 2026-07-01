import "./web.css";
import "./web-mobile.css";
import { createWebApi } from "./webApi/index.js";
import { seedDraftFromHash, initWebChrome } from "./chrome.js";
import { initWebMobile } from "./web-mobile.js";

/* global __APP_VERSION__ */
window.__AXIFORGE_WEB__ = true;
const appVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "web";
window.desktopApi = createWebApi({ appVersion });

// Seed the draft from the URL hash BEFORE the renderer boots (its init() reads listBuilds()).
const sharedBuild = await seedDraftFromHash();

// Boot the renderer (self-runs init() on import).
await import("../renderer/renderer.js");

// Wire web chrome after the renderer's DOM + modules are live.
await initWebChrome(sharedBuild);
initWebMobile();
