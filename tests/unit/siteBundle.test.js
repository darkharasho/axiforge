"use strict";

// Build the site before running tests
const { execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const DIST_DIR = path.join(__dirname, "../../dist/site");

// Build site if dist doesn't exist
beforeAll(() => {
  if (!fs.existsSync(DIST_DIR)) {
    execSync("npx vite build --config src/site/vite.config.js", {
      cwd: path.join(__dirname, "../.."),
      stdio: "pipe",
    });
  }
});

// Mock electron app for siteBundle.js
jest.mock("electron", () => ({ app: { isPackaged: false } }), { virtual: true });

const { buildSpaBundle, buildEncryptedBuildFile } = require("../../src/main/siteBundle");

describe("buildSpaBundle", () => {
  test("returns an object with file entries", () => {
    const bundle = buildSpaBundle();
    expect(typeof bundle).toBe("object");
    expect(Object.keys(bundle).length).toBeGreaterThan(0);
  });

  test("contains site/index.html", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/index.html"]).toBeTruthy();
  });

  test("contains site/404.html", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/404.html"]).toBeTruthy();
  });

  test("contains site/.nojekyll", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/.nojekyll"]).toBe("\n");
  });

  test("index.html is valid HTML5", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/index.html"].trimStart()).toMatch(/^<!doctype html>/i);
  });

  test("index.html contains AxiForge Builds", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/index.html"]).toContain("AxiForge Builds");
  });

  test("404.html contains redirect logic", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/404.html"]).toContain("location.replace");
  });

  test("contains at least one asset file (CSS or JS)", () => {
    const bundle = buildSpaBundle();
    const assetKeys = Object.keys(bundle).filter(k => k.startsWith("site/assets/"));
    expect(assetKeys.length).toBeGreaterThan(0);
  });

  test("all values are strings", () => {
    const bundle = buildSpaBundle();
    for (const value of Object.values(bundle)) {
      expect(typeof value).toBe("string");
    }
  });
});

describe("getSiteDistDir — packaged path", () => {
  test("uses process.resourcesPath/site when app.isPackaged is true", () => {
    jest.resetModules();
    jest.doMock("electron", () => ({ app: { isPackaged: true } }), { virtual: true });
    const origResources = process.resourcesPath;
    process.resourcesPath = "/mock/resources";
    try {
      const { getSiteDistDir } = require("../../src/main/siteBundle");
      expect(getSiteDistDir()).toBe(path.join("/mock/resources", "site"));
    } finally {
      if (origResources === undefined) delete process.resourcesPath;
      else process.resourcesPath = origResources;
      // Restore original mock for remaining tests
      jest.resetModules();
      jest.mock("electron", () => ({ app: { isPackaged: false } }), { virtual: true });
    }
  });
});

describe("buildEncryptedBuildFile", () => {
  test("returns filePath and content", () => {
    const result = buildEncryptedBuildFile({ title: "Test" }, "abc12345", "someBase64urlKey_that_is_43_chars_longAAAAA");
    expect(result.filePath).toBe("site/builds/abc12345.enc");
    expect(typeof result.content).toBe("string");
    expect(result.content.length).toBeGreaterThan(0);
  });

  test("content does not contain plaintext", () => {
    const result = buildEncryptedBuildFile({ title: "My Secret Build" }, "abc12345", "someBase64urlKey_that_is_43_chars_longAAAAA");
    expect(result.content).not.toContain("My Secret Build");
  });
});

const { computeSpaVersion, SITE_VERSION_PATH } = require("../../src/main/siteBundle");
const { partitionBundleForPublish } = require("../../src/main/siteBundle");

const shell = {
  "site/index.html": "<html>a</html>",
  "site/assets/app.js": "console.log(1)",
};

describe("computeSpaVersion", () => {
  test("is deterministic for identical shell files", () => {
    expect(computeSpaVersion({ ...shell })).toBe(computeSpaVersion({ ...shell }));
  });
  test("changes when a shell file changes", () => {
    expect(computeSpaVersion(shell)).not.toBe(
      computeSpaVersion({ ...shell, "site/index.html": "<html>b</html>" })
    );
  });
  test("ignores per-build data, redirects, and the marker itself", () => {
    const withData = {
      ...shell,
      "site/builds/abc.enc": "ENCRYPTED",
      "site/comps/def.enc": "ENCRYPTED",
      "site/r/abc/index.html": "<meta>",
      [SITE_VERSION_PATH]: "deadbeef",
    };
    expect(computeSpaVersion(withData)).toBe(computeSpaVersion(shell));
  });
  test("returns a 12-char hex string", () => {
    expect(computeSpaVersion(shell)).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("partitionBundleForPublish", () => {
  const bundle = {
    [SITE_VERSION_PATH]: "abc123",
    "site/index.html": "<html>",
    "site/builds/x/build.json": "{}",
    "site/comps/y/comp.json": "{}",
    "site/r/z": "redirect",
  };

  test("shellChanged=true when remoteVersion differs", () => {
    const { shellChanged, filesToPublish } = partitionBundleForPublish(bundle, "old");
    expect(shellChanged).toBe(true);
    expect(filesToPublish).toEqual(bundle);
  });

  test("shellChanged=false when remoteVersion matches: omits shell + version marker, keeps data", () => {
    const { shellChanged, filesToPublish } = partitionBundleForPublish(bundle, "abc123");
    expect(shellChanged).toBe(false);
    expect(filesToPublish["site/builds/x/build.json"]).toBe("{}");
    expect(filesToPublish["site/comps/y/comp.json"]).toBe("{}");
    expect(filesToPublish["site/r/z"]).toBe("redirect");
    expect(filesToPublish["site/index.html"]).toBeUndefined();
    expect(filesToPublish[SITE_VERSION_PATH]).toBeUndefined();
  });
});
