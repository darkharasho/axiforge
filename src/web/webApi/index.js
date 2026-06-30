import { createCatalogApi } from "./catalog.js";
import { createDraftApi } from "./draft.js";
import { createShareApi } from "./share.js";
import { createSettingsApi } from "./settings.js";
import { createSystemApi } from "./system.js";
import { createStubsApi } from "./stubs.js";

// Assemble the full browser desktopApi. Order matters: stubs provide safe defaults
// for desktop-only methods; the real modules override where they share a name.
export function createWebApi({ appVersion } = {}) {
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
