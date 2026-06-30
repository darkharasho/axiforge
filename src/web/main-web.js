import { createWebApi } from "./webApi/index.js";

/* global __APP_VERSION__ */
window.__AXIFORGE_WEB__ = true;
const appVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "web";
window.desktopApi = createWebApi({ appVersion });

await import("../renderer/renderer.js");
