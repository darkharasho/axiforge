"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createConfig, hashIdentity } = require("@axiapps/axi-config");
const { startAccess } = require("../../src/main/access");

const GH_ID = 4242;
const SERVER_ID = "123456789012345678";
const HOOK = "https://discord.com/api/webhooks/1/token-a";

function manifestFetch(denylist) {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ version: 1, flags: {}, minVersion: null, notice: null, denylist }),
  });
}

function fakeStore({ viewerId = null, settings = {} } = {}) {
  return {
    getAuth: async () => (viewerId == null ? null : { viewer: { id: viewerId } }),
    getSetting: async (key) => settings[key],
  };
}

function fakeElectron(userData) {
  const windows = [];
  class BrowserWindow {
    constructor(opts) {
      this.opts = opts;
      windows.push(this);
      this.webContents = { setWindowOpenHandler() {}, on() {} };
    }
    isDestroyed() { return false; }
    destroy() {}
    removeMenu() {}
    loadURL() { return Promise.resolve(); }
    on() {}
    static getAllWindows() { return windows; }
  }
  return {
    windows,
    app: {
      quit: jest.fn(),
      relaunch: jest.fn(),
      exit: jest.fn(),
      on: jest.fn(),
      getPath: () => userData,
    },
    BrowserWindow,
    shell: { openExternal: async () => {} },
  };
}

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "axiforge-access-")); });
let configs = [];
afterEach(async () => {
  // Let any in-flight cache write settle before removing the directory.
  for (const c of configs.splice(0)) {
    await c.refresh();
    c.close();
  }
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

function makeConfig(fetch) {
  const c = createConfig({ appId: "axiforge", cacheDir: dir, fetch, refreshMs: 1e9, logger: { warn() {} } });
  configs.push(c);
  return c;
}

const noHooks = async () => [];

describe("access", () => {
  test("a listed GitHub user blocks at runtime, once", async () => {
    const config = makeConfig(manifestFetch([await hashIdentity("github_user", String(GH_ID))]));
    const onBlocked = jest.fn();
    const boot = await startAccess({
      electron: fakeElectron(dir), config, onBlocked,
      store: fakeStore({ viewerId: GH_ID }), lookupWebhooks: noHooks,
    });
    expect(boot.blocked).toBe(false);
    await boot.gate.recheck();
    await boot.gate.recheck();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledWith({ persisted: true });
    config.close();
  });

  test("a listed webhook server blocks at runtime", async () => {
    const config = makeConfig(manifestFetch([await hashIdentity("discord_server", SERVER_ID)]));
    const onBlocked = jest.fn();
    const seen = [];
    const boot = await startAccess({
      electron: fakeElectron(dir), config, onBlocked,
      store: fakeStore({
        settings: {
          "discord.compWebhooks": [{ url: HOOK }],
          "discord.buildWebhooks": [{ url: "https://discord.com/api/webhooks/2/token-b" }],
          "discord.webhookUrl": "https://discord.com/api/webhooks/3/token-c",
        },
      }),
      lookupWebhooks: async (urls) => { seen.push(...urls); return [{ kind: "discord_server", value: SERVER_ID }]; },
    });
    await boot.gate.recheck();
    expect(seen).toHaveLength(3);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    config.close();
  });

  test("a legacy-only build webhook is checked and blocks when its server is listed", async () => {
    const config = makeConfig(manifestFetch([await hashIdentity("discord_server", SERVER_ID)]));
    const onBlocked = jest.fn();
    const seen = [];
    const legacyBuild = "https://discord.com/api/webhooks/4/token-d";
    const boot = await startAccess({
      electron: fakeElectron(dir), config, onBlocked,
      store: fakeStore({ settings: { "discord.buildWebhookUrl": legacyBuild } }),
      lookupWebhooks: async (urls) => { seen.push(...urls); return urls.includes(legacyBuild) ? [{ kind: "discord_server", value: SERVER_ID }] : []; },
    });
    await boot.gate.recheck();
    expect(seen).toEqual([legacyBuild]);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    config.close();
  });

  test("clean identities never block", async () => {
    const config = makeConfig(manifestFetch([await hashIdentity("github_user", "1")]));
    const onBlocked = jest.fn();
    const boot = await startAccess({
      electron: fakeElectron(dir), config, onBlocked,
      store: fakeStore({ viewerId: GH_ID }),
      lookupWebhooks: async () => [{ kind: "discord_server", value: SERVER_ID }],
    });
    await boot.gate.recheck();
    expect(onBlocked).not.toHaveBeenCalled();
    config.close();
  });

  test("boot with the sticky trip shows the block screen", async () => {
    const hash = await hashIdentity("github_user", String(GH_ID));
    const first = makeConfig(manifestFetch([hash]));
    await first.ready();
    await first.refresh();
    expect(await first.check([{ kind: "github_user", value: String(GH_ID) }])).toEqual({ blocked: true, persisted: true });
    first.close();

    const second = makeConfig(manifestFetch([hash]));
    const electron = fakeElectron(dir);
    const boot = await startAccess({ electron, config: second, store: fakeStore(), lookupWebhooks: noHooks });
    expect(boot).toEqual({ blocked: true });
    expect(electron.windows).toHaveLength(1);
    second.close();
  });

  test("headless boot with the sticky trip exits without a window", async () => {
    const hash = await hashIdentity("github_user", String(GH_ID));
    const first = makeConfig(manifestFetch([hash]));
    await first.ready();
    await first.refresh();
    await first.check([{ kind: "github_user", value: String(GH_ID) }]);
    first.close();

    const second = makeConfig(manifestFetch([hash]));
    const electron = fakeElectron(dir);
    const write = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const boot = await startAccess({ electron, config: second, store: fakeStore(), lookupWebhooks: noHooks, headless: true });
      expect(boot).toEqual({ blocked: true });
      expect(write).toHaveBeenCalledWith("Access unavailable.\n");
      expect(electron.app.exit).toHaveBeenCalledWith(1);
      expect(electron.windows).toHaveLength(0);
    } finally {
      write.mockRestore();
      second.close();
    }
  });

  test("fails open when the fetch rejects and there is no cache", async () => {
    const config = makeConfig(async () => { throw new Error("offline"); });
    const onBlocked = jest.fn();
    const boot = await startAccess({
      electron: fakeElectron(dir), config, onBlocked,
      store: fakeStore({ viewerId: GH_ID }), lookupWebhooks: noHooks,
    });
    expect(boot.blocked).toBe(false);
    await boot.gate.recheck();
    expect(onBlocked).not.toHaveBeenCalled();
    config.close();
  });
});
