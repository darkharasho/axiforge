const { createSettingsApi } = require("../../src/web/webApi/settings.js");

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("setSetting then getSetting round-trips a value", async () => {
  const storage = memStorage();
  const api = createSettingsApi({ storage });
  await api.setSetting("theme", "dark");
  expect(await api.getSetting("theme")).toBe("dark");
});

test("getSetting returns undefined for unknown key", async () => {
  const api = createSettingsApi({ storage: memStorage() });
  expect(await api.getSetting("nope")).toBeUndefined();
});

test("settings persist across instances on shared storage", async () => {
  const storage = memStorage();
  await createSettingsApi({ storage }).setSetting("gameMode", "wvw");
  expect(await createSettingsApi({ storage }).getSetting("gameMode")).toBe("wvw");
});
