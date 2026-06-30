// Web settings over localStorage, stored as one JSON blob.
const SETTINGS_KEY = "axiforge.web.settings";

function createSettingsApi({ storage = window.localStorage } = {}) {
  function readAll() {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {
    getSetting: async (key) => {
      const all = readAll();
      return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : undefined;
    },
    setSetting: async (key, value) => {
      const all = readAll();
      all[key] = value;
      storage.setItem(SETTINGS_KEY, JSON.stringify(all));
    },
  };
}

module.exports = { createSettingsApi, SETTINGS_KEY };
