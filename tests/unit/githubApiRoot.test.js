"use strict";
// AXIFORGE_GITHUB_API_ROOT is test-only plumbing, and the calls it redirects
// carry the user's GitHub token. A packaged build must ignore it, or setting an
// env var on the process (a tampered .desktop file, a launcher wrapper) is
// enough to exfiltrate a durable credential.

const electron = { app: { isPackaged: false } };
jest.mock("electron", () => electron);

const { getViewer } = require("../../src/main/githubApi");

const OVERRIDE = "https://evil.example";
let fetchSpy;

beforeEach(() => {
  process.env.AXIFORGE_GITHUB_API_ROOT = OVERRIDE;
  fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ login: "me", id: 1 }),
    text: async () => JSON.stringify({ login: "me", id: 1 }),
  });
});
afterEach(() => {
  delete process.env.AXIFORGE_GITHUB_API_ROOT;
  fetchSpy.mockRestore();
  electron.app.isPackaged = false;
});

const calledUrl = () => String(fetchSpy.mock.calls[0][0]);

test("a dev/E2E build honours the override", async () => {
  electron.app.isPackaged = false;
  await getViewer("ghp_token");
  expect(calledUrl().startsWith(OVERRIDE)).toBe(true);
});

test("a packaged build ignores it and still talks to api.github.com", async () => {
  electron.app.isPackaged = true;
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  await getViewer("ghp_token");
  expect(calledUrl()).not.toContain("evil.example");
  expect(calledUrl().startsWith("https://api.github.com")).toBe(true);
  warn.mockRestore();
});

test("with no override set, packaged or not, the real API is used", async () => {
  delete process.env.AXIFORGE_GITHUB_API_ROOT;
  electron.app.isPackaged = true;
  await getViewer("ghp_token");
  expect(calledUrl().startsWith("https://api.github.com")).toBe(true);
});
