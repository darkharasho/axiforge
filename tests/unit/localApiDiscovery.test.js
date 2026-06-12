"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const {
  discoveryFilePath,
  writeDiscoveryFile,
  removeDiscoveryFileSync,
} = require("../../src/main/localApiDiscovery");

describe("localApiDiscovery", () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-discovery-test-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("discoveryFilePath is <dataDir>/local-api.json", () => {
    expect(discoveryFilePath(dir)).toBe(path.join(dir, "local-api.json"));
  });

  test("writeDiscoveryFile writes the full record as JSON", async () => {
    const info = {
      port: 41234,
      token: "abc123",
      exePath: "/usr/bin/AxiForge",
      version: "0.6.30",
      pid: 9999,
    };
    await writeDiscoveryFile(dir, info);
    const raw = await fs.readFile(path.join(dir, "local-api.json"), "utf8");
    expect(JSON.parse(raw)).toEqual(info);
    const st = await fs.stat(path.join(dir, "local-api.json"));
    if (process.platform !== "win32") {
      expect(st.mode & 0o777).toBe(0o600);
    }
  });

  test("writeDiscoveryFile creates the data dir and overwrites stale files", async () => {
    const nested = path.join(dir, "data");
    await writeDiscoveryFile(nested, { port: 1, token: "old", exePath: "x", version: "0", pid: 1 });
    await writeDiscoveryFile(nested, { port: 2, token: "new", exePath: "x", version: "0", pid: 2 });
    const parsed = JSON.parse(await fs.readFile(path.join(nested, "local-api.json"), "utf8"));
    expect(parsed.port).toBe(2);
    expect(parsed.token).toBe("new");
  });

  test("removeDiscoveryFileSync deletes the file and is a no-op when missing", async () => {
    await writeDiscoveryFile(dir, { port: 1, token: "t", exePath: "x", version: "0", pid: 1 });
    removeDiscoveryFileSync(dir);
    expect(fsSync.existsSync(path.join(dir, "local-api.json"))).toBe(false);
    expect(() => removeDiscoveryFileSync(dir)).not.toThrow();
  });

  test("removeDiscoveryFileSync skips removal when ownerPid does not match the file's pid", async () => {
    await writeDiscoveryFile(dir, { port: 1, token: "t", exePath: "x", version: "0", pid: 1234 });
    removeDiscoveryFileSync(dir, { ownerPid: 9999 });
    expect(fsSync.existsSync(path.join(dir, "local-api.json"))).toBe(true);
    const parsed = JSON.parse(await fs.readFile(path.join(dir, "local-api.json"), "utf8"));
    expect(parsed.pid).toBe(1234);
  });

  test("removeDiscoveryFileSync removes the file when ownerPid matches", async () => {
    await writeDiscoveryFile(dir, { port: 1, token: "t", exePath: "x", version: "0", pid: 1234 });
    removeDiscoveryFileSync(dir, { ownerPid: 1234 });
    expect(fsSync.existsSync(path.join(dir, "local-api.json"))).toBe(false);
  });
});
