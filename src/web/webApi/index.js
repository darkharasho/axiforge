const { createCatalogApi } = require("./catalog.js");
const { createDraftApi } = require("./draft.js");
const { createShareApi } = require("./share.js");
const { createSettingsApi } = require("./settings.js");
const { createSystemApi } = require("./system.js");
const { createStubsApi } = require("./stubs.js");

// Assemble the full browser desktopApi. Order matters: stubs provide safe defaults
// for desktop-only methods; the real modules override where they share a name.
function createWebApi({ appVersion } = {}) {
  const catalog = createCatalogApi();
  const draft = createDraftApi();
  const share = createShareApi();
  const settings = createSettingsApi();
  const system = createSystemApi({ appVersion });
  const stubs = createStubsApi();

  return {
    ...stubs,
    ...catalog,
    ...draft,
    ...share,
    ...settings,
    ...system,
  };
}

module.exports = { createWebApi };
