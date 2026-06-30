// Web entry. Installs a browser desktopApi BEFORE importing the renderer, which
// self-runs init() on import. This file's seam is replaced by the real one in Task 8.
window.__AXIFORGE_WEB__ = true;
window.desktopApi = new Proxy(
  {},
  {
    get() {
      // Until Task 8, every call resolves to a harmless empty value so the
      // renderer can boot without throwing.
      return async () => undefined;
    },
  }
);

await import("../renderer/renderer.js");
