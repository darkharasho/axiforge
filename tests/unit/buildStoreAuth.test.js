"use strict";
// auth.json holds two long-lived credentials (the GitHub PAT and the team-sync
// session token). These tests pin the two properties that matter: the file is
// encrypted at rest when the OS keyring is usable, and NOTHING about that may
// cost an existing user their stored credentials.

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

// Mutable so each test can decide what Electron offers.
const keyring = { available: false, corrupt: false };
jest.mock("electron", () => ({
  app: { isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => keyring.available,
    encryptString: (s) => Buffer.from(`enc:${s}`, "utf8"),
    decryptString: (buf) => {
      if (keyring.corrupt) throw new Error("Decryption failed");
      const s = buf.toString("utf8");
      if (!s.startsWith("enc:")) throw new Error("Decryption failed");
      return s.slice(4);
    },
  },
}));

const { BuildStore, resetSafeStorageWarnings } = require("../../src/main/buildStore");

let dir, store;
beforeEach(async () => {
  keyring.available = false;
  keyring.corrupt = false;
  resetSafeStorageWarnings();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-auth-"));
  store = new BuildStore(dir);
  await store.init();
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

// The plaintext fallback warns by design, so most tests here trip it. Keep it out
// of the run output; the suite below spies on it again to assert it happened.
let quietWarn;
beforeEach(() => { quietWarn = jest.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { quietWarn.mockRestore(); });

const raw = () => fs.readFile(path.join(dir, "auth.json"), "utf8");

describe("auth.json at rest", () => {
  test("no keyring: plaintext, exactly as before", async () => {
    await store.saveAuth({ token: "ghp_x", sync: { sessionToken: "s" } });
    expect(JSON.parse(await raw())).toEqual({ token: "ghp_x", sync: { sessionToken: "s" } });
    expect(await store.getAuth()).toEqual({ token: "ghp_x", sync: { sessionToken: "s" } });
  });

  test("keyring available: the credentials never hit the disk in the clear", async () => {
    keyring.available = true;
    await store.saveAuth({ token: "ghp_secret", sync: { sessionToken: "sess_secret" } });
    const onDisk = await raw();
    expect(onDisk).not.toContain("ghp_secret");
    expect(onDisk).not.toContain("sess_secret");
    expect(JSON.parse(onDisk).__enc).toBe("safeStorage");
    expect(await store.getAuth()).toEqual({ token: "ghp_secret", sync: { sessionToken: "sess_secret" } });
  });

  test("an existing PLAINTEXT auth.json is read transparently and upgraded on the next write", async () => {
    await fs.writeFile(path.join(dir, "auth.json"), JSON.stringify({ token: "ghp_old", viewer: { login: "me" } }), "utf8");
    keyring.available = true;
    // read: no loss
    expect(await store.getAuth()).toEqual({ token: "ghp_old", viewer: { login: "me" } });
    // write: now encrypted, still round-trips
    await store.updateAuth((a) => ({ ...a, sync: { sessionToken: "s" } }));
    expect(JSON.parse(await raw()).__enc).toBe("safeStorage");
    expect(await store.getAuth()).toEqual({ token: "ghp_old", viewer: { login: "me" }, sync: { sessionToken: "s" } });
  });

  test("keyring disappears: getAuth degrades to signed-out and the file is NOT destroyed", async () => {
    keyring.available = true;
    await store.saveAuth({ token: "ghp_secret" });
    const before = await raw();
    keyring.corrupt = true;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(await store.getAuth()).toEqual({});
    warn.mockRestore();
    expect(await raw()).toBe(before); // recoverable if the keyring comes back
    keyring.corrupt = false;
    expect(await store.getAuth()).toEqual({ token: "ghp_secret" });
  });

  test("encryption failing at write time falls back to plaintext rather than losing the write", async () => {
    keyring.available = true;
    const spy = jest.spyOn(require("electron").safeStorage, "encryptString").mockImplementation(() => { throw new Error("nope"); });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await store.saveAuth({ token: "ghp_x" });
    expect(await store.getAuth()).toEqual({ token: "ghp_x" });
    spy.mockRestore();
    warn.mockRestore();
  });

  test("clearAuth wipes the credentials in both modes", async () => {
    for (const available of [false, true]) {
      keyring.available = available;
      await store.saveAuth({ token: "ghp_x" });
      await store.clearAuth();
      expect(await store.getAuth()).toEqual({});
      expect(await raw()).not.toContain("ghp_x");
    }
  });
});

describe("updateAuth serialization (m4)", () => {
  test("two concurrent read-modify-writes both survive", async () => {
    await store.saveAuth({ token: "gh", sync: { sessionToken: "s" } });
    await Promise.all([
      store.updateAuth((a) => { delete a.sync; return a; }),          // pullAll's 401 handler
      store.updateAuth((a) => { delete a.sharedLibrary; return a; }), // legacy cleanup
    ]);
    const auth = await store.getAuth();
    // the dead session token must not have been resurrected by the second writer
    expect(auth.sync).toBeUndefined();
    expect(auth.token).toBe("gh");
  });

  test("a get-then-save pair racing an update no longer wins with stale data", async () => {
    await store.saveAuth({ token: "gh", sync: { sessionToken: "s" } });
    const slow = store.updateAuth(async (a) => {
      await new Promise((r) => setTimeout(r, 5));
      delete a.sync;
      return a;
    });
    const fast = store.updateAuth((a) => ({ ...a, sharedLibrary: undefined }));
    await Promise.all([slow, fast]);
    expect((await store.getAuth()).sync).toBeUndefined();
  });

  test("returning nothing from the mutator skips the write", async () => {
    await store.saveAuth({ token: "gh" });
    const before = await raw();
    const out = await store.updateAuth(() => undefined);
    expect(out).toEqual({ token: "gh" });
    expect(await raw()).toBe(before);
  });
});

// Falling back to plaintext is a supported outcome, but a SILENT fallback is not:
// it puts a live GitHub PAT and team-sync session token on disk in the clear with
// nothing in the log to say so. Each distinct reason must announce itself once.
describe("the plaintext fallback is never silent", () => {
  let warn;
  beforeEach(() => { warn = jest.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  const lines = () => warn.mock.calls.map((c) => c.join(" "));

  test("no keyring: says so, once, however many writes follow", async () => {
    await store.saveAuth({ token: "ghp_x" });
    await store.saveAuth({ token: "ghp_y" });
    await store.updateAuth((a) => ({ ...a, sync: { sessionToken: "s" } }));
    expect(lines().filter((l) => /no OS keyring available/.test(l))).toHaveLength(1);
    // ...and the fallback itself still works exactly as before.
    expect(await store.getAuth()).toEqual({ token: "ghp_y", sync: { sessionToken: "s" } });
  });

  test("isEncryptionAvailable() throwing is reported, not swallowed", async () => {
    const ss = require("electron").safeStorage;
    const spy = jest.spyOn(ss, "isEncryptionAvailable").mockImplementation(() => { throw new Error("dbus is down"); });
    await store.saveAuth({ token: "ghp_x" });
    spy.mockRestore();
    expect(lines().some((l) => /isEncryptionAvailable\(\) threw/.test(l) && /dbus is down/.test(l))).toBe(true);
    expect(await store.getAuth()).toEqual({ token: "ghp_x" }); // write survived
  });

  test("an Electron with no safeStorage at all is reported", async () => {
    const electron = require("electron");
    const real = electron.safeStorage;
    delete electron.safeStorage;
    try {
      await store.saveAuth({ token: "ghp_x" });
    } finally {
      electron.safeStorage = real;
    }
    expect(lines().some((l) => /no usable safeStorage/.test(l))).toBe(true);
    expect(JSON.parse(await raw())).toEqual({ token: "ghp_x" });
  });
});
