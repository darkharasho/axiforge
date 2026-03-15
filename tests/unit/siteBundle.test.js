"use strict";
const { buildSpaBundle, buildEncryptedBuildFile } = require("../../src/main/siteBundle");

describe("buildSpaBundle — file keys", () => {
  test("returns exactly 5 files", () => { expect(Object.keys(buildSpaBundle())).toHaveLength(5); });
  test("contains site/index.html", () => { expect(buildSpaBundle()["site/index.html"]).toBeTruthy(); });
  test("contains site/styles.css", () => { expect(buildSpaBundle()["site/styles.css"]).toBeTruthy(); });
  test("contains site/app.js", () => { expect(buildSpaBundle()["site/app.js"]).toBeTruthy(); });
  test("contains site/404.html", () => { expect(buildSpaBundle()["site/404.html"]).toBeTruthy(); });
  test("contains site/.nojekyll", () => { expect(buildSpaBundle()["site/.nojekyll"]).toBe("\n"); });
  test("all values are strings", () => { for (const v of Object.values(buildSpaBundle())) expect(typeof v).toBe("string"); });
});

describe("buildSpaBundle — index.html", () => {
  let html;
  beforeEach(() => { html = buildSpaBundle()["site/index.html"]; });
  test("valid HTML5", () => { expect(html.trimStart()).toMatch(/^<!doctype html>/i); });
  test("links to styles.css", () => { expect(html).toContain("styles.css"); });
  test("includes app.js", () => { expect(html).toContain("app.js"); });
  test("has AxiForge Builds title", () => { expect(html).toContain("AxiForge Builds"); });
  test("has lang=en", () => { expect(html).toContain('lang="en"'); });
  test("has viewport meta", () => { expect(html).toContain("viewport"); });
  test("loads Cinzel and Exo 2 fonts", () => { expect(html).toContain("Cinzel"); expect(html).toContain("Exo+2"); });
});

describe("buildSpaBundle — 404.html", () => {
  let html;
  beforeEach(() => { html = buildSpaBundle()["site/404.html"]; });
  test("valid HTML5", () => { expect(html.trimStart()).toMatch(/^<!doctype html>/i); });
  test("stores path in sessionStorage", () => { expect(html).toContain("sessionStorage"); });
  test("redirects to site root", () => { expect(html).toContain("location.replace"); });
});

describe("buildSpaBundle — app.js", () => {
  let js;
  beforeEach(() => { js = buildSpaBundle()["site/app.js"]; });
  test("contains crypto.subtle", () => { expect(js).toContain("crypto.subtle"); });
  test("contains AES-GCM", () => { expect(js).toContain("AES-GCM"); });
  test("parses URL fragment", () => { expect(js).toContain("location.hash"); });
  test("fetches .enc files", () => { expect(js).toContain("builds/"); expect(js).toContain(".enc"); });
  test("checks sessionStorage", () => { expect(js).toContain("sessionStorage"); });
  test("defines escapeHtml", () => { expect(js).toContain("escapeHtml"); });
});

describe("buildSpaBundle — styles.css", () => {
  let css;
  beforeEach(() => { css = buildSpaBundle()["site/styles.css"]; });
  test("dark color scheme", () => { expect(css).toContain("color-scheme: dark"); });
  test("AxiForge colors", () => { expect(css).toContain("#04070f"); expect(css).toContain("#4fd897"); expect(css).toContain("#48a8ff"); });
  test("navbar styles", () => { expect(css).toContain(".navbar"); });
  test("tab styles", () => { expect(css).toContain(".tab"); });
});

describe("buildEncryptedBuildFile", () => {
  test("returns filePath and content", () => {
    const result = buildEncryptedBuildFile({ title: "Test" }, "abc12345", "someBase64urlKey_that_is_43_chars_longAAAAA");
    expect(result.filePath).toBe("site/builds/abc12345.enc");
    expect(typeof result.content).toBe("string");
    expect(result.content.length).toBeGreaterThan(0);
  });
  test("content is base64", () => {
    const result = buildEncryptedBuildFile({ title: "Test" }, "abc12345", "someBase64urlKey_that_is_43_chars_longAAAAA");
    expect(() => Buffer.from(result.content, "base64")).not.toThrow();
  });
  test("content is encrypted", () => {
    const result = buildEncryptedBuildFile({ title: "My Secret Build" }, "abc12345", "someBase64urlKey_that_is_43_chars_longAAAAA");
    expect(result.content).not.toContain("My Secret Build");
  });
});
