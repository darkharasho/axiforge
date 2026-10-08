# Smaller Published Payloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Published builds drop from ~1.3 MB to ~90 KB and published comps from ~17 MB to a few KB, and every existing link keeps working.

**Architecture:** A new binary envelope (v2) gzips JSON before AES-GCM encryption and drops base64. A version header sits in front, so v1 and v2 files share the same paths and links. A v2 comp links to its member builds (`members: {id: {fileId, key, owner}}`) instead of embedding them. The viewer fetches those builds and computes boon coverage itself, using the same renderer code the desktop uses, fed by per-build catalogs taken from the published builds. Publishing a build no longer re-uploads comps.

**Tech Stack:** Electron main (CommonJS, Node `crypto`/`zlib`), the SPA viewer (ESM, Vite, WebCrypto, `DecompressionStream`), renderer modules shared through `@renderer`, Jest 30 with babel-jest for ESM.

**Spec:** `docs/superpowers/specs/2026-10-07-publish-payload-shrink-design.md`

## Global Constraints

- The v2 header is exactly 4 bytes: `00 41 58 02` (`\0`, `A`, `X`, version). It is followed by a 12-byte IV, the AES-256-GCM ciphertext of `gzip(JSON)`, and a 16-byte tag.
- v1 files (base64 text) must keep decoding everywhere: the viewer, desktop link import, and `decryptPayload`.
- Links, file IDs, keys and repo paths (`site/builds/<id>.enc`, `site/comps/<id>.enc`) do not change.
- The publish repo name is the constant `TARGET_REPO = "axibuilds"` (`src/main/githubApi.js:25`). Member data URLs are `https://raw.githubusercontent.com/<owner>/axibuilds/main/site/builds/<fileId>.enc`.
- Jest is the dev loop: `npm test -- <path>`. Do **not** run Playwright (`test:e2e`, `test:spa`) mid-session; that suite runs at release only.
- Twin modules: `src/shared/publishState.js` (CJS) and `src/renderer/modules/publish-status.js` (ESM) must stay in parity. This plan changes neither.
- No release, tag push or external post without explicit approval.
- Commit after each task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A comp member that 404s** (deleted or unpublished build). The comp page still renders, that slot shows as "Build unavailable", the pool omits it, and coverage is computed from the rest. Tested in Task 8.
2. **A teammate's member still in v1 format** (no `boonDurationBonus`). Coverage still renders and uses a duration bonus of 0. Tested in Task 8.
3. **An existing v1 comp link** (embedded `builds` and `boonCoverageHtml`). It renders exactly as before, with no member fetches. Tested in Task 8.
4. **A file whose header names an unknown version (3)**. The viewer shows "This link was published by a newer AxiForge — refresh the page." Desktop import says to update the app. Tested in Tasks 3 and 4.
5. **WvW comps**. Desktop coverage and viewer coverage must agree, so publish has to fetch the catalog for the build's own game mode. Tested in Task 10 (source assertion) and Task 7 (parity).

## File Structure

| File | Responsibility |
|---|---|
| `src/main/buildEncryption.js` (modify) | Add `encryptPayload`, `decryptPayload`, `payloadVersion`, `PayloadVersionError` |
| `src/main/githubApi.js` (modify) | Upload `Buffer` bundle values byte-for-byte |
| `src/site/payload.js` (create) | Viewer decode: `payloadVersion`, `decodePayload`, `fetchPayload`, `PayloadVersionError`, `NEWER_FORMAT_MESSAGE` |
| `src/site/escape.js` (create) | `escapeHtml`, moved out of `main.js` so `render-comp.js` can be imported in tests |
| `src/site/main.js` (modify) | Use `payload.js`; for v2 comps, load members and compute coverage |
| `src/main/axiLinkImport.js` (modify) | Fetch bytes, decode v1/v2, fetch v2 comp members |
| `src/renderer/modules/boon-coverage.js` (modify) | `computePartyCoverage` accepts an explicit `upgradeCatalog` |
| `src/renderer/modules/comps/comp-boon-coverage.js` (modify) | `computeCompPartyCoverage` takes `overrides: {catalogFor, upgradeCatalogFor, durationBonusFor}` |
| `src/main/statsCompute.js` (modify) | `computeDurationStats(build, upgradeCatalog)`, matching the renderer's comp concentration/expertise |
| `src/main/buildPublish.js` (modify) | Add `boonDurationBonus` to the serialized build |
| `src/site/published-catalog.js` (create) | `catalogFromPublishedBuild`, `upgradeCatalogFromPublishedBuild`, taken out of `render-build.js` |
| `src/site/render-build.js` (modify) | `populateStateFromBuild` delegates to `published-catalog.js` |
| `src/site/comp-members.js` (create) | `memberDataBase`, `memberSpaUrl`, `loadCompMembers` |
| `src/site/comp-coverage.js` (create) | `computeViewerCoverageHtml(comp, buildsById)` |
| `src/site/render-comp.js` (modify) | "Build unavailable" slot; skip unavailable members in pool and tag popover |
| `src/main/compPublish.js` (modify) | v2 `serializeCompForPublish(comp, members)`, `planCompMembers` |
| `src/main/siteBundle.js` (modify) | Encrypted files become v2 `Buffer`s |
| `src/main/index.js` (modify) | Comp publish uses members; remove build→comp fan-out; drop the `boonCoverageHtml` argument; game-mode catalogs |
| `src/main/publishFingerprint.js` (modify) | Remove `compReceiptAfterRepublish` (dead after the fan-out removal) |
| `src/preload/index.js`, `src/main/localApi.js`, `src/renderer/modules/comps/comp-detail.js` (modify) | Drop the `boonCoverageHtml` argument |
| `tests/spa/helpers/fixture-gen.js` (modify) | Keep generating the v1 comp shape the release E2E suite expects |

---

### Task 1: v2 envelope in main

**Files:**
- Modify: `src/main/buildEncryption.js`
- Test: `tests/unit/buildEncryption.test.js` (append)

**Interfaces:**
- Produces:
  - `encryptPayload(data: any, base64urlKey: string): Buffer`
  - `decryptPayload(input: string|Buffer|Uint8Array|ArrayBuffer, base64urlKey: string): any`
  - `payloadVersion(input): number`. Returns 1 for a string or for bytes without the header; otherwise header byte 3.
  - `class PayloadVersionError extends Error { version: number }`
  - `PAYLOAD_VERSION = 2`

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/buildEncryption.test.js`)

```js
describe("v2 payload envelope", () => {
  const {
    encryptPayload, decryptPayload, payloadVersion, PayloadVersionError, encryptBuild, generateEncryptionKey,
  } = require("../../src/main/buildEncryption");
  const key = generateEncryptionKey();
  const data = { title: "Firebrand", notes: "x".repeat(5000), nested: { a: [1, 2, 3] } };

  test("round-trips through encryptPayload/decryptPayload", () => {
    expect(decryptPayload(encryptPayload(data, key), key)).toEqual(data);
  });

  test("writes the 00 'A' 'X' 02 header and no base64", () => {
    const bytes = encryptPayload(data, key);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect([...bytes.subarray(0, 4)]).toEqual([0x00, 0x41, 0x58, 0x02]);
    expect(payloadVersion(bytes)).toBe(2);
  });

  test("compresses before encrypting", () => {
    const big = { catalog: Array.from({ length: 2000 }, (_, i) => ({ id: i, name: "Skill name", facts: [] })) };
    const v1 = Buffer.byteLength(encryptBuild(big, key));
    expect(encryptPayload(big, key).length).toBeLessThan(v1 / 5);
  });

  test("still decodes a v1 base64 string, with or without trailing whitespace", () => {
    const v1 = encryptBuild(data, key);
    expect(payloadVersion(v1)).toBe(1);
    expect(decryptPayload(v1, key)).toEqual(data);
    expect(decryptPayload(`${v1}\n`, key)).toEqual(data);
    expect(decryptPayload(Buffer.from(v1, "utf8"), key)).toEqual(data);
  });

  test("an unknown header version throws PayloadVersionError", () => {
    const bytes = encryptPayload(data, key);
    bytes[3] = 0x03;
    expect(() => decryptPayload(bytes, key)).toThrow(PayloadVersionError);
    try { decryptPayload(bytes, key); } catch (err) { expect(err.version).toBe(3); }
  });

  test("a wrong key fails rather than returning garbage", () => {
    expect(() => decryptPayload(encryptPayload(data, key), generateEncryptionKey())).toThrow();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/unit/buildEncryption.test.js`
Expected: FAIL, `encryptPayload is not a function`.

- [ ] **Step 3: Implement** in `src/main/buildEncryption.js`. Add `const zlib = require("node:zlib");` under the `crypto` require. Add this after `decryptBuild`:

```js
// v2 envelope: 4-byte header, then IV | AES-256-GCM(gzip(JSON)) | tag, as raw
// bytes. The header sits outside the cipher so a reader knows the format before
// decrypting. A v1 file is base64 text, whose first byte can never be 0x00.
const PAYLOAD_MAGIC = [0x00, 0x41, 0x58]; // "\0AX"
const PAYLOAD_VERSION = 2;

class PayloadVersionError extends Error {
  constructor(version) {
    super(`Unsupported payload version ${version}`);
    this.name = "PayloadVersionError";
    this.version = version;
  }
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
}

function payloadVersion(input) {
  if (typeof input === "string") return 1;
  const b = toBuffer(input);
  if (b.length >= 4 && b[0] === PAYLOAD_MAGIC[0] && b[1] === PAYLOAD_MAGIC[1] && b[2] === PAYLOAD_MAGIC[2]) return b[3];
  return 1;
}

function encryptPayload(data, base64urlKey) {
  const key = Buffer.from(base64urlKey, "base64url");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const packed = zlib.gzipSync(Buffer.from(JSON.stringify(data), "utf8"), { level: 9 });
  const encrypted = Buffer.concat([cipher.update(packed), cipher.final()]);
  return Buffer.concat([Buffer.from([...PAYLOAD_MAGIC, PAYLOAD_VERSION]), iv, encrypted, cipher.getAuthTag()]);
}

function decryptPayload(input, base64urlKey) {
  const version = payloadVersion(input);
  if (version === 1) {
    const text = typeof input === "string" ? input : toBuffer(input).toString("utf8");
    return decryptBuild(text.trim(), base64urlKey);
  }
  if (version !== PAYLOAD_VERSION) throw new PayloadVersionError(version);
  const b = toBuffer(input);
  const key = Buffer.from(base64urlKey, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(4, 16));
  decipher.setAuthTag(b.subarray(b.length - 16));
  const packed = Buffer.concat([decipher.update(b.subarray(16, b.length - 16)), decipher.final()]);
  return JSON.parse(zlib.gunzipSync(packed).toString("utf8"));
}
```

Extend the export: `module.exports = { slugifyBuildName, generateFileId, generateEncryptionKey, encryptBuild, decryptBuild, getDefaultBuildName, encryptPayload, decryptPayload, payloadVersion, PayloadVersionError, PAYLOAD_VERSION };`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/unit/buildEncryption.test.js`
Expected: PASS (all old and new tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/buildEncryption.js tests/unit/buildEncryption.test.js
git commit -m "feat(publish): v2 payload envelope (gzip, binary, version header)"
```

---

### Task 2: Upload Buffer bundle values

Today `publishSiteBundleOnce` drops anything that is not a string (`githubApi.js:~402`). It also chooses binary vs text by file extension, so `.enc` would be UTF-8 encoded.

**Files:**
- Modify: `src/main/githubApi.js:~400-418`
- Test: `tests/unit/githubApi.test.js` (inside `describe("publishSiteBundle — SHA deduplication")`)

**Interfaces:**
- Produces: `publishSiteBundle(token, owner, bundle)` accepts `bundle[path]: string | Buffer`. A `Buffer` is committed exactly as given.

- [ ] **Step 1: Write the failing test.** Put it next to `"commits binary (image) entries as their real bytes"`:

```js
  test("commits Buffer entries byte-for-byte (v2 .enc files)", async () => {
    const bytes = Buffer.from([0x00, 0x41, 0x58, 0x02, 9, 8, 7, 6, 5]);
    let blobBody = null;
    global.fetch = jest.fn((url, options) => {
      const urlStr = String(url);
      const method = (options?.method || "GET").toUpperCase();
      if (urlStr.includes(`/repos/${FAKE_OWNER}/${FAKE_REPO}`) && method === "GET" && !urlStr.includes("/git/")) return okRes({ name: FAKE_REPO });
      if (urlStr.includes("/git/ref/heads/") && method === "GET") return okRes({ object: { sha: HEAD_SHA } });
      if (urlStr.includes(`/git/commits/${HEAD_SHA}`) && method === "GET") return okRes({ tree: { sha: TREE_SHA } });
      if (urlStr.includes(`/git/trees/${TREE_SHA}`) && method === "GET") return okRes({ tree: [] });
      if (urlStr.includes("/git/blobs") && method === "POST") { blobBody = JSON.parse(options.body); return okRes({ sha: "blobsha" }); }
      if (urlStr.includes("/git/trees") && method === "POST") return okRes({ sha: "newtreesha" });
      if (urlStr.includes("/git/commits") && method === "POST") return okRes({ sha: "newcommitsha" });
      if (urlStr.includes("/git/refs/heads/") && method === "PATCH") return okRes({ object: { sha: "newcommitsha" } });
      return okRes({});
    });

    const result = await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, { "site/builds/abcd1234.enc": bytes });

    expect(result.files).toContain("site/builds/abcd1234.enc");
    expect(blobBody.encoding).toBe("base64");
    expect(Buffer.from(blobBody.content, "base64").equals(bytes)).toBe(true);
  });

  test("skips an unchanged Buffer entry by git blob SHA", async () => {
    const bytes = Buffer.from([0x00, 0x41, 0x58, 0x02, 1, 2, 3]);
    global.fetch = buildMockFetch({ existingFiles: { "site/builds/abcd1234.enc": computeGitBlobSha(bytes) } });
    const result = await publishSiteBundle(FAKE_TOKEN, FAKE_OWNER, { "site/builds/abcd1234.enc": bytes });
    expect(result.changed).toBe(false);
  });
```

At the top of the file, check how `computeGitBlobSha` is defined. If the test helper takes a string, make it accept a `Buffer` as well (`Buffer.isBuffer(c) ? c : Buffer.from(c)`).

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/unit/githubApi.test.js -t "Buffer"`
Expected: FAIL. `result.files` lacks the path because the string filter dropped it.

- [ ] **Step 3: Implement.** In `publishSiteBundleOnce`:

```js
  const publishEntries = Object.entries(filesToPublish).filter(
    ([filePath, content]) => filePath && (typeof content === "string" || Buffer.isBuffer(content))
  );
```

and

```js
  for (const [filePath, content] of publishEntries) {
    // A Buffer is already the file's bytes (v2 .enc payloads). Strings follow
    // the old rule: binary assets arrive base64-encoded, text as utf8.
    const contentBuffer = Buffer.isBuffer(content)
      ? content
      : isBinaryPath(filePath)
        ? Buffer.from(content, "base64")
        : Buffer.from(content, "utf8");
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/unit/githubApi.test.js`
Expected: PASS. The existing `"filters out non-string bundle values"` test still passes because `12345` is neither a string nor a Buffer.

- [ ] **Step 5: Commit**

```bash
git add src/main/githubApi.js tests/unit/githubApi.test.js
git commit -m "feat(publish): upload Buffer bundle entries byte-for-byte"
```

---

### Task 3: Viewer decodes v1 and v2

**Files:**
- Create: `src/site/payload.js`, `src/site/escape.js`
- Modify: `src/site/main.js` (`loadBuild`, `loadComp`, `decrypt`, `base64urlDecode`, `escapeHtml`), `src/site/render-comp.js:3`
- Test: `tests/unit/site/payload.test.js`

**Interfaces:**
- Consumes: `encryptPayload`, `encryptBuild` (Task 1) in tests only.
- Produces (ESM, `src/site/payload.js`):
  - `payloadVersion(bytes: Uint8Array): number`
  - `decodePayload(buffer: ArrayBuffer|Uint8Array, base64urlKey: string): Promise<any>`
  - `fetchPayload(url: string, base64urlKey: string, fetchImpl = fetch): Promise<any>`. On a non-OK response it throws `Error` with `.status`.
  - `class PayloadVersionError extends Error { version }`
  - `NEWER_FORMAT_MESSAGE = "This link was published by a newer AxiForge — refresh the page."`
- Produces (`src/site/escape.js`): `escapeHtml(s): string`

- [ ] **Step 1: Write the failing test** `tests/unit/site/payload.test.js`:

```js
"use strict";

// Node's web globals, made explicit so the test doesn't depend on which ones
// Jest's node environment happens to expose.
const web = require("node:stream/web");
globalThis.DecompressionStream ??= web.DecompressionStream;
globalThis.crypto ??= require("node:crypto").webcrypto;

const { encryptPayload, encryptBuild, generateEncryptionKey } = require("../../../src/main/buildEncryption");
const { decodePayload, fetchPayload, payloadVersion, PayloadVersionError } = require("../../../src/site/payload.js");

const key = generateEncryptionKey();
const data = { title: "Firebrand", catalogSkills: [{ id: 1, name: "Mantra" }] };
const asArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

describe("viewer payload decode", () => {
  test("decodes a v2 file written by the desktop", async () => {
    await expect(decodePayload(asArrayBuffer(encryptPayload(data, key)), key)).resolves.toEqual(data);
  });

  test("decodes a v1 base64 file, including a trailing newline", async () => {
    const v1 = Buffer.from(`${encryptBuild(data, key)}\n`, "utf8");
    expect(payloadVersion(new Uint8Array(v1))).toBe(1);
    await expect(decodePayload(asArrayBuffer(v1), key)).resolves.toEqual(data);
  });

  test("an unknown version throws PayloadVersionError", async () => {
    const bytes = encryptPayload(data, key);
    bytes[3] = 0x03;
    await expect(decodePayload(asArrayBuffer(bytes), key)).rejects.toBeInstanceOf(PayloadVersionError);
  });

  test("fetchPayload reads bytes and surfaces HTTP status", async () => {
    const ok = jest.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => asArrayBuffer(encryptPayload(data, key)) }));
    await expect(fetchPayload("https://x/builds/a.enc", key, ok)).resolves.toEqual(data);
    expect(ok).toHaveBeenCalledWith("https://x/builds/a.enc", { cache: "no-store" });

    const missing = jest.fn(async () => ({ ok: false, status: 404 }));
    await expect(fetchPayload("https://x/builds/b.enc", key, missing)).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/unit/site/payload.test.js`
Expected: FAIL, cannot find module `src/site/payload.js`.

- [ ] **Step 3: Create `src/site/payload.js`**

```js
// Decode an encrypted .enc payload. v1: base64 text of IV | AES-GCM(JSON) | tag.
// v2: 00 'A' 'X' 02 | IV | AES-GCM(gzip(JSON)) | tag, as raw bytes. The header
// sits outside the cipher, so the format is known before decrypting.
export const NEWER_FORMAT_MESSAGE = "This link was published by a newer AxiForge — refresh the page.";

export class PayloadVersionError extends Error {
  constructor(version) {
    super(`Unsupported payload version ${version}`);
    this.name = "PayloadVersionError";
    this.version = version;
  }
}

export function payloadVersion(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x41 && bytes[2] === 0x58) return bytes[3];
  return 1;
}

function base64urlDecode(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function aesDecrypt(base64urlKey, iv, ciphertext) {
  const cryptoKey = await crypto.subtle.importKey("raw", base64urlDecode(base64urlKey), { name: "AES-GCM" }, false, ["decrypt"]);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);
}

export async function decodePayload(buffer, base64urlKey) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const version = payloadVersion(bytes);
  if (version === 1) {
    const text = new TextDecoder().decode(bytes).trim();
    const combined = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const plain = await aesDecrypt(base64urlKey, combined.slice(0, 12), combined.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  if (version !== 2) throw new PayloadVersionError(version);
  const plain = await aesDecrypt(base64urlKey, bytes.slice(4, 16), bytes.slice(16));
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

export async function fetchPayload(url, base64urlKey, fetchImpl = fetch) {
  const res = await fetchImpl(url, { cache: "no-store" });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return decodePayload(await res.arrayBuffer(), base64urlKey);
}
```

- [ ] **Step 4: Create `src/site/escape.js`** by moving `escapeHtml` out of `main.js` verbatim:

```js
export function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
```

In `src/site/main.js`:
- Delete the `export function escapeHtml` body.
- Add `import { escapeHtml } from "./escape.js";` and `export { escapeHtml };` to keep the old import path working.
- In `src/site/render-comp.js:3`, change `import { escapeHtml } from "./main.js";` to `import { escapeHtml } from "./escape.js";`. Importing `main.js` runs `init()`, which is why `render-comp.js` couldn't be imported in tests.
- Then run `grep -rn 'from "./main.js"' src/site` and switch any other importer the same way.

- [ ] **Step 5: Rewire `main.js` loads.** Add `import { fetchPayload, PayloadVersionError, NEWER_FORMAT_MESSAGE } from "./payload.js";`. Delete the old `decrypt` and `base64urlDecode` functions. Replace `loadBuild`/`loadComp` with:

```js
function loadErrorMessage(err, noun) {
  if (err instanceof PayloadVersionError) return NEWER_FORMAT_MESSAGE;
  if (err?.status) return `${noun} not found (HTTP ${err.status})`;
  return err?.message || String(err);
}

async function loadBuild(fileId, base64urlKey) {
  try {
    const base = resolveDataBase(location, new URLSearchParams(location.search));
    const build = await fetchPayload(`${base}builds/${encodeURIComponent(fileId)}.enc`, base64urlKey);
    renderBuild(build);
  } catch (err) {
    showError(loadErrorMessage(err, "Build"));
  }
}

async function loadComp(fileId, base64urlKey) {
  try {
    const base = resolveDataBase(location, new URLSearchParams(location.search));
    const comp = await fetchPayload(`${base}comps/${encodeURIComponent(fileId)}.enc`, base64urlKey);
    renderComp(comp);
  } catch (err) {
    showError(loadErrorMessage(err, "Comp"));
  }
}
```

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/unit/site`
Expected: PASS. `render-comp-notes.test.js` reads the source text and is unaffected by the import change.

- [ ] **Step 7: Commit**

```bash
git add src/site/payload.js src/site/escape.js src/site/main.js src/site/render-comp.js tests/unit/site/payload.test.js
git commit -m "feat(site): decode v1 and v2 payloads; newer-format message"
```

---

### Task 4: Desktop link import reads v2 and fetches comp members

**Files:**
- Modify: `src/main/axiLinkImport.js` (`httpsGetStatus` ~15-45, `COMP_NOT_MINE` ~191, `fetchPayload` ~271, `importAxiAny` ~316)
- Test: `tests/unit/axiLinkImport.test.js` (append)

**Interfaces:**
- Consumes: `decryptPayload`, `PayloadVersionError` (Task 1).
- Produces: the injected `fetchText` returns `{status, body: string, bytes?: Buffer}`. Real HTTP fills `bytes`, and test mocks may omit it.

- [ ] **Step 1: Write the failing tests** (append):

```js
describe("v2 payloads", () => {
  const { encryptPayload } = require("../../src/main/buildEncryption");
  const key = generateEncryptionKey();
  const raw = (owner, dir, id) => `https://raw.githubusercontent.com/${owner}/axibuilds/main/site/${dir}/${id}.enc`;
  const serve = (routes) => jest.fn(async (url) => routes[url] || { status: 404, body: "" });
  const bytes = (data, k = key) => { const b = encryptPayload(data, k); return { status: 200, body: b.toString("latin1"), bytes: b }; };

  test("imports a v2 build", async () => {
    const fetchText = serve({ [raw("someone", "builds", "f4c38d4f")]: bytes({ profession: "Mesmer", title: "U Chrono" }) });
    const result = await importAxiAny(`https://someone.github.io/axibuilds/?b=f4c38d4f.${key}`, {}, { fetchText });
    expect(result.build.title).toBe("U Chrono");
  });

  test("a v2 comp fetches each member from its owner's repo; an unreachable one is dropped", async () => {
    const kA = generateEncryptionKey();
    const kB = generateEncryptionKey();
    const comp = {
      v: 2, name: "Linked Comp", gameMode: "wvw",
      partyLines: [{ id: "l", capacity: 5, slots: ["b-a", "b-b"] }],
      members: {
        "b-a": { fileId: "aaaa1111", key: kA, owner: "someone" },
        "b-b": { fileId: "bbbb2222", key: kB, owner: "teammate" },
      },
    };
    const fetchText = serve({
      [raw("someone", "comps", "e4369a53")]: bytes(comp),
      [raw("someone", "builds", "aaaa1111")]: bytes({ id: "b-a", profession: "Guardian", title: "FB" }, kA),
    });
    const result = await importAxiAny(`https://someone.github.io/axibuilds/?c=e4369a53.${key}`, {}, { fetchText });
    expect(result.kind).toBe("comp");
    expect(result.builds.map((b) => b.title)).toEqual(["FB"]);
    expect(result.comp.partyLines[0].slots).toHaveLength(1);
    expect(fetchText).toHaveBeenCalledWith(raw("teammate", "builds", "bbbb2222"));
    expect(result.comp).not.toHaveProperty("members");
    expect(result.comp).not.toHaveProperty("v");
  });

  test("a payload from a newer format says to update the app", async () => {
    const b = encryptPayload({ profession: "Mesmer" }, key);
    b[3] = 0x03;
    const fetchText = serve({ [raw("someone", "builds", "f4c38d4f")]: { status: 200, body: "", bytes: b } });
    await expect(importAxiAny(`https://someone.github.io/axibuilds/?b=f4c38d4f.${key}`, {}, { fetchText }))
      .rejects.toThrow(/newer version of AxiForge/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/unit/axiLinkImport.test.js -t "v2 payloads"`
Expected: FAIL. Decryption throws "Couldn't decrypt…", and members are never fetched.

- [ ] **Step 3: Implement.**
  - **Require:** change it to `const { decryptPayload, PayloadVersionError } = require("./buildEncryption.js");`. Keep `decryptBuild` only if it's still used elsewhere in the file (grep first).
  - **`httpsGetStatus` response handler:**

```js
        const chunks = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          const bytes = Buffer.concat(chunks);
          resolve({ status: res.statusCode, body: bytes.toString("utf8"), bytes });
        });
```

  - **`fetchPayload` decrypt block:**

```js
    try {
      return decryptPayload(res.bytes ?? res.body, key);
    } catch (err) {
      if (err instanceof PayloadVersionError) {
        throw new Error(`That ${noun} was published by a newer version of AxiForge — update the app to import it.`);
      }
      // Reached the file but could not open it: the key in the link is wrong or
      // truncated. Trying the next base would only repeat that, so stop here.
      throw new Error(`Couldn't decrypt that ${noun} — the link looks incomplete or was edited.`);
    }
```

  - **`COMP_NOT_MINE`:** add `"members", "v"` to the list.
  - **New helper** above `importAxiAny`:

```js
/**
 * A v2 comp links its builds instead of embedding them. Fetch each member from
 * the repo of the user who published it and return the same {id: build} map a
 * v1 payload carries, so toImportedComp handles both. A member that can't be
 * fetched is left out, which empties its slot the same way an unmappable v1
 * slot does.
 */
async function fetchCompMembers(members, fallbackBases, fetchText) {
  const entries = await Promise.all(Object.entries(members || {}).map(async ([buildId, m]) => {
    if (!m?.fileId || !m?.key) return null;
    const bases = m.owner ? [`https://raw.githubusercontent.com/${m.owner}/axibuilds/main/site/`] : fallbackBases;
    try {
      return [buildId, await fetchPayload({ fileId: m.fileId, key: m.key, bases, dir: "builds" }, fetchText)];
    } catch {
      return null;
    }
  }));
  return Object.fromEntries(entries.filter(Boolean));
}
```

  - **`importAxiAny` comp branch:**

```js
  if (parsed.kind === "comp") {
    let payload = await fetchPayload({ ...parsed, dir: "comps" }, fetchText, "comp");
    if (payload && payload.v === 2) {
      payload = { ...payload, builds: await fetchCompMembers(payload.members, parsed.bases, fetchText) };
    }
    const { comp, builds } = toImportedComp(payload, opts, deps.newId);
    return { kind: "comp", comp, builds };
  }
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/unit/axiLinkImport.test.js`
Expected: PASS, both the new tests and every existing v1 test (those mocks return a string `body`).

- [ ] **Step 5: Commit**

```bash
git add src/main/axiLinkImport.js tests/unit/axiLinkImport.test.js
git commit -m "feat(import): read v2 payloads and fetch linked comp members"
```

---

### Task 5: Coverage takes per-build catalogs and duration bonus

**Files:**
- Modify: `src/renderer/modules/boon-coverage.js:23-36`, `src/renderer/modules/comps/comp-boon-coverage.js:21-67`
- Test: `tests/unit/renderer/comp-boon-coverage.test.js` (append)

**Interfaces:**
- Produces:
  - `computePartyCoverage(catalog, editor, weaponSkills = [], upgradeCatalog = null)`. When `upgradeCatalog` is null it falls back to the global `state.upgradeCatalog`.
  - `computeCompPartyCoverage(comp, builds, catalogCache, getCatalog, upgradeCatalog = null, overrides = {})`, where `overrides = { catalogFor?: (build) => catalog, upgradeCatalogFor?: (build) => upgradeCatalog, durationBonusFor?: (build) => {concentration:number, expertise:number} }`. When `catalogFor` is given, `getCatalog`/`catalogCache` are not used.

- [ ] **Step 1: Write the failing tests** (append; reuses the file's `makeComp`, `makeLine`, `makeBuild`, `makeCatalog`, `makeMightSkill`):

```js
describe("computeCompPartyCoverage overrides (published-viewer path)", () => {
  test("catalogFor gives each build its own catalog, even within one profession", async () => {
    const b1 = makeBuild("b1", "Guardian"); b1.skills.healId = 100;
    const b2 = makeBuild("b2", "Guardian"); b2.skills.healId = 100;
    const withMight = makeCatalog(new Map([[100, makeMightSkill()]]));
    const without = makeCatalog(new Map());
    const comp = makeComp([makeLine("l1", ["b1", "b2"])]);
    const getCatalog = jest.fn();

    const { lines } = await computeCompPartyCoverage(comp, [b1, b2], new Map(), getCatalog, null, {
      catalogFor: (b) => (b.id === "b1" ? withMight : without),
    });

    expect(getCatalog).not.toHaveBeenCalled();
    expect(lines[0].boons.get("Might").count).toBe(1);
    expect(lines[0].boons.get("Might").providers[0].buildId).toBe("b1");
  });

  test("durationBonusFor replaces the equipment-derived concentration", async () => {
    const b1 = makeBuild("b1", "Guardian"); b1.skills.healId = 100;
    const comp = makeComp([makeLine("l1", ["b1"])]);
    const { lines } = await computeCompPartyCoverage(comp, [b1], new Map(), async () => null, null, {
      catalogFor: () => makeCatalog(new Map([[100, makeMightSkill()]])),
      durationBonusFor: () => ({ concentration: 150, expertise: 0 }),
    });
    // 10s base * (1 + 150/1500)
    expect(lines[0].boons.get("Might").providers[0].sources[0].effectiveDuration).toBe(11);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/unit/renderer/comp-boon-coverage.test.js -t "overrides"`
Expected: FAIL. `getCatalog` is called, and Might is missing or counted twice.

- [ ] **Step 3: Implement.**
  - **`boon-coverage.js`:** change `computePartyCoverage`:

```js
export function computePartyCoverage(catalog, editor, weaponSkills = [], upgradeCatalog = null) {
  // Build a temporary state object for the bridge functions.
  // The bridge needs state.editor and state.activeCatalog/upgradeCatalog. The
  // published viewer passes each build's own upgrade catalog; the desktop uses
  // the global one.
  const bridgeState = {
    editor,
    activeCatalog: catalog,
    upgradeCatalog: upgradeCatalog || state.upgradeCatalog || {},
  };
```

  - **`comp-boon-coverage.js`:** change the signature to `computeCompPartyCoverage(comp, builds, catalogCache, getCatalog, upgradeCatalog = null, overrides = {})`.
    - Add `const { catalogFor, upgradeCatalogFor, durationBonusFor } = overrides;` as the first line.
    - Wrap the `await Promise.all(...)` pre-warm in `if (!catalogFor) { ... }`.
    - Inside the per-slot loop, replace the catalog lookup through the expertise line with:

```js
      const cacheKey = `${build.profession}_${build.gameMode || "pve"}`;
      const catalog = catalogFor ? catalogFor(build) : catalogCache.get(cacheKey);
      if (!catalog) continue;

      hasFilledSlots = true;
      const weaponSkills = resolveAllWeaponSkills(catalog, build);
      const coverage = computePartyCoverage(catalog, build, weaponSkills, upgradeCatalogFor ? upgradeCatalogFor(build) : null);
      const buildName = build.title || build.id;
      // A published build carries these precomputed (the viewer has no upgrade
      // catalog); the desktop derives them from equipment.
      const bonus = durationBonusFor ? durationBonusFor(build) : null;
      const concentrationBonus = (bonus ? bonus.concentration : computeBuildConcentration(build, upgradeCatalog)) / 1500;
      // Condition duration scales off Expertise, not Concentration.
      const expertiseBonus = (bonus ? bonus.expertise : computeBuildExpertise(build, upgradeCatalog)) / 1500;
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/unit/renderer/comp-boon-coverage.test.js tests/unit/renderer/boon-coverage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/boon-coverage.js src/renderer/modules/comps/comp-boon-coverage.js tests/unit/renderer/comp-boon-coverage.test.js
git commit -m "feat(coverage): per-build catalog, upgrade catalog and duration bonus overrides"
```

---

### Task 6: Published builds carry `boonDurationBonus`

The desktop's comp coverage computes concentration and expertise with `_fakeStateForBuild` (`engine-bridge.js:452`): equipment only, no resolvable traits, PvE, no skills. Main must produce the same numbers.

**Files:**
- Modify: `src/main/statsCompute.js` (add `computeDurationStats`, export it), `src/main/buildPublish.js` (return object ~line 744)
- Test: `tests/unit/durationStatsParity.test.js` (create), `tests/unit/buildPublish.test.js` (append)

**Interfaces:**
- Produces:
  - `computeDurationStats(build, upgradeCatalog): {concentration: number, expertise: number}`
  - `serializeForPublish(...).boonDurationBonus: {concentration, expertise}`

- [ ] **Step 1: Write the failing parity test** `tests/unit/durationStatsParity.test.js`:

```js
"use strict";

// The published viewer scales boon/condition durations with values main bakes
// into each build. They must equal what the desktop's comp coverage computes,
// or the same comp shows different durations in the app and on its link.
const { computeDurationStats } = require("../../src/main/statsCompute");
const { computeBuildConcentration, computeBuildExpertise } = require("../../src/renderer/modules/engine-bridge.js");

const SLOTS = ["head", "shoulders", "chest", "hands", "legs", "feet", "back", "amulet", "ring1", "ring2", "accessory1", "accessory2", "mainhand1", "offhand1"];
const gear = (prefix) => Object.fromEntries(SLOTS.map((s) => [s, prefix]));
const scholarCatalog = {
  runeById: new Map([[24836, { id: 24836, name: "Superior Rune of the Scholar",
    bonuses: ["+25 Power", "+35 Ferocity", "+50 Power", "+65 Ferocity", "+100 Power", "+10% damage"] }]]),
  infusionById: new Map(), enrichmentById: new Map(), foodById: new Map(), utilityById: new Map(),
};

const CASES = [
  ["Minstrel's", { profession: "Guardian", equipment: { slots: gear("Minstrel's"), weapons: {}, runes: {}, infusions: {} } }, null],
  ["Viper's", { profession: "Necromancer", equipment: { slots: gear("Viper's"), weapons: {}, runes: {}, infusions: {} } }, null],
  ["Ritualist's + Scholar runes", {
    profession: "Mesmer",
    equipment: { slots: gear("Ritualist's"), weapons: {}, infusions: {},
      runes: { head: "24836", shoulders: "24836", chest: "24836", hands: "24836", legs: "24836", feet: "24836" } },
  }, scholarCatalog],
  ["no equipment", { profession: "Warrior" }, null],
];

describe("computeDurationStats matches the desktop comp coverage", () => {
  test.each(CASES)("%s", (_name, build, upgradeCatalog) => {
    const main = computeDurationStats({ specializations: [], ...build }, upgradeCatalog);
    expect(main).toEqual({
      concentration: computeBuildConcentration({ specializations: [], ...build }, upgradeCatalog),
      expertise: computeBuildExpertise({ specializations: [], ...build }, upgradeCatalog),
    });
  });

  test("a concentration set actually yields concentration", () => {
    expect(computeDurationStats({ profession: "Guardian", equipment: { slots: gear("Minstrel's"), weapons: {}, runes: {}, infusions: {} } }, null).concentration)
      .toBeGreaterThan(0);
  });
});
```

Append to `tests/unit/buildPublish.test.js`:

```js
describe("boonDurationBonus", () => {
  test("serializeForPublish bakes concentration and expertise for the viewer's coverage", () => {
    const out = serializeForPublish(makeMockBuild(), makeMockCatalog(), makeMockUpgradeCatalog());
    expect(out.boonDurationBonus).toEqual({ concentration: expect.any(Number), expertise: expect.any(Number) });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/unit/durationStatsParity.test.js tests/unit/buildPublish.test.js -t "boonDurationBonus|matches the desktop"`
Expected: FAIL, `computeDurationStats is not a function`.

- [ ] **Step 3: Implement** in `src/main/statsCompute.js`, above `module.exports`:

```js
/**
 * Concentration and Expertise exactly as the desktop's comp coverage computes
 * them (engine-bridge _fakeStateForBuild): equipment only, PvE, no skills, and
 * no trait catalog, so traits contribute nothing. Baked into published builds
 * so the viewer, which has no upgrade catalog, scales durations the same way.
 */
function computeDurationStats(build, upgradeCatalog) {
  if (!build?.equipment) return { concentration: 0, expertise: 0 };
  const { stats } = computePublishStats(build.equipment, upgradeCatalog, build.profession, "pve", {
    specializations: build.specializations || [],
    activeWeaponSet: 1,
    underwaterMode: false,
    skills: {},
  });
  return { concentration: stats.Concentration || 0, expertise: stats.Expertise || 0 };
}
```

Export it: `module.exports = { computePublishStats, computeDurationStats, estimateRole };`.

In `src/main/buildPublish.js`, change the `statsCompute` require to also pull `computeDurationStats` (grep for `require("./statsCompute")`). In the returned object, after `statModifiers,`, add:

```js
    // Concentration/Expertise for party-coverage durations on the published comp
    // page, which has no upgrade catalog to derive them from.
    boonDurationBonus: computeDurationStats(build, upgradeCatalog),
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/unit/durationStatsParity.test.js tests/unit/buildPublish.test.js tests/unit/statsCompute.test.js`
Expected: PASS. If a parity case fails, the two stat paths have drifted (see the `project_stats_path_divergence` memory). Fix `computeDurationStats` until it matches the renderer, never the other way round, because the renderer is what the desktop shows.

- [ ] **Step 5: Commit**

```bash
git add src/main/statsCompute.js src/main/buildPublish.js tests/unit/durationStatsParity.test.js tests/unit/buildPublish.test.js
git commit -m "feat(publish): bake boonDurationBonus into published builds"
```

---

### Task 7: Catalogs from a published build, plus the coverage parity test

**Files:**
- Create: `src/site/published-catalog.js`
- Modify: `src/site/render-build.js` (move `collectSkillsFromSelection`, `collectAllSkills`, and the `state.activeCatalog`/`state.upgradeCatalog` builders out of `populateStateFromBuild`)
- Test: `tests/unit/site/comp-coverage-parity.test.js` (create)

**Interfaces:**
- Consumes: `computeCompPartyCoverage(…, overrides)` (Task 5); `serializeForPublish(...).boonDurationBonus` (Task 6).
- Produces (ESM):
  - `catalogFromPublishedBuild(build): activeCatalog`. Same shape `populateStateFromBuild` assigns to `state.activeCatalog` today.
  - `upgradeCatalogFromPublishedBuild(build): upgradeCatalog`. Same shape assigned to `state.upgradeCatalog`, including the merge of `catalogNotesMentions`.

- [ ] **Step 1: Write the failing parity test** `tests/unit/site/comp-coverage-parity.test.js`:

```js
"use strict";

// The same comp must show the same party coverage in the desktop app and on its
// published link. Desktop: store builds + catalog maps + upgrade catalog.
// Viewer: serialized builds + catalogs rebuilt from the payload + baked bonus.
const { serializeForPublish } = require("../../../src/main/buildPublish");
const { computeCompPartyCoverage } = require("../../../src/renderer/modules/comps/comp-boon-coverage.js");
const { catalogFromPublishedBuild, upgradeCatalogFromPublishedBuild } = require("../../../src/site/published-catalog.js");

const SKILLS = [
  { id: 100, name: "Healing Surge", description: "Heal.", slot: "Heal", type: "Heal",
    facts: [{ type: "Buff", status: "Might", duration: 10, apply_count: 5 }] },
  { id: 200, name: "Signet of Fury", description: "Fury.", slot: "Utility", type: "Utility",
    facts: [{ type: "Buff", status: "Fury", duration: 6, apply_count: 0 }] },
];
const CATALOG_ARRAYS = { skills: SKILLS, weaponSkills: [], traits: [], specializations: [], professionWeapons: {}, legends: [], pets: [] };
const EMPTY_UPGRADES = {
  runeById: new Map(), sigilById: new Map(), infusionById: new Map(), enrichmentById: new Map(),
  foodById: new Map(), utilityById: new Map(), relicByName: new Map(), relicById: new Map(),
};
const SLOTS = ["head", "shoulders", "chest", "hands", "legs", "feet", "back", "amulet", "ring1", "ring2", "accessory1", "accessory2"];

function storeBuild(id, gameMode) {
  return {
    id, title: `Support ${id}`, profession: "Guardian", gameMode, specializations: [],
    skills: { heal: { id: 100, name: "Healing Surge" }, utility: [{ id: 200, name: "Signet of Fury" }], elite: null },
    equipment: { slots: Object.fromEntries(SLOTS.map((s) => [s, "Minstrel's"])), weapons: {}, runes: {}, sigils: {}, infusions: {} },
  };
}

function desktopCatalog() {
  return {
    skills: SKILLS, skillById: new Map(SKILLS.map((s) => [s.id, s])),
    weaponSkills: [], weaponSkillById: new Map(), traits: [], traitById: new Map(),
    specializationById: new Map(), professionWeapons: {}, legendById: new Map(), petById: new Map(),
  };
}

// Maps are not comparable across the two runs by identity; flatten to plain data.
function flatten({ lines }) {
  return lines.map((l) => ({
    label: l.label,
    hasFilledSlots: l.hasFilledSlots,
    boons: [...l.boons].map(([name, e]) => [name, e.count,
      e.providers.map((p) => [p.buildId, p.sources.map((s) => [s.name, s.effectiveDuration, s.stacks])])]),
    conditions: [...l.conditions].map(([name, e]) => [name, e.count]),
  }));
}

describe.each(["pve", "wvw"])("desktop vs viewer coverage (%s)", (gameMode) => {
  test("identical lines, boons and durations", async () => {
    const builds = [storeBuild("b1", gameMode), storeBuild("b2", gameMode)];
    const comp = { id: "c", partyLines: [{ id: "l1", capacity: 5, slots: ["b1", "b2"] }] };

    const cache = new Map();
    const desktop = await computeCompPartyCoverage(comp, builds, cache, async (p, m) => {
      cache.set(`${p}_${m}`, desktopCatalog());
    }, EMPTY_UPGRADES);

    const published = builds.map((b) => serializeForPublish(b, CATALOG_ARRAYS, EMPTY_UPGRADES));
    const viewer = await computeCompPartyCoverage(comp, published, new Map(), async () => null, null, {
      catalogFor: catalogFromPublishedBuild,
      upgradeCatalogFor: upgradeCatalogFromPublishedBuild,
      durationBonusFor: (b) => b.boonDurationBonus,
    });

    expect(flatten(viewer)).toEqual(flatten(desktop));
    expect(desktop.lines[0].boons.get("Might").count).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/unit/site/comp-coverage-parity.test.js`
Expected: FAIL, cannot find module `src/site/published-catalog.js`.

- [ ] **Step 3: Create `src/site/published-catalog.js`.**
  - Move `collectSkillsFromSelection` and `collectAllSkills` from `render-build.js` verbatim. Keep `normalizeSkillSelection` in `render-build.js`, which uses it for `state.editor`.
  - Add the two builders. Their bodies are the object literals `populateStateFromBuild` currently assigns, moved verbatim:

```js
/**
 * The activeCatalog a published build carries: the shape the shared renderer
 * modules and the coverage engine read. Pure, so the comp page can build one
 * per member without touching the global state.
 */
export function catalogFromPublishedBuild(build) {
  const allSkills = collectAllSkills(build);
  // Use full catalog traits if available (includes facts/traitedFacts), fall back to spec-embedded traits
  const allTraits = Array.isArray(build.catalogTraits) && build.catalogTraits.length
    ? build.catalogTraits
    : (build.specializations || []).flatMap(s => {
        const minors = Array.isArray(s.minorTraits) ? s.minorTraits : [];
        const majors = s.majorTraitsByTier
          ? Object.values(s.majorTraitsByTier).flat()
          : [];
        return [...minors, ...majors];
      }).filter(t => t && t.id);

  return {
    profession:         { id: build.profession },
    skills:             allSkills,
    skillById:          new Map(allSkills.map(s => [s.id, s])),
    // Weapon skills are a separate catalog from profession skills
    weaponSkills:       build.catalogWeaponSkills || [],
    weaponSkillById:    new Map((build.catalogWeaponSkills || []).map(s => [s.id, s])),
    // Enrich spec objects with majorTraits (flat ID array) derived from majorTraitsByTier.
    // The renderer's getMajorTraitsByTier reads spec.majorTraits and looks up each via traitById.
    specializations:    (build.specializations || []).map(s => ({
      ...s,
      majorTraits: s.majorTraits || (s.majorTraitsByTier
        ? Object.values(s.majorTraitsByTier).flat().map(t => typeof t === "object" ? t.id : t)
        : []),
    })),
    specializationById: new Map((build.specializations || []).map(s => [s.id, {
      ...s,
      // Normalize minorTraits to IDs so the engine's collectActiveTraitIds can use them.
      // Published builds store minorTraits as enriched objects; the engine expects numbers.
      minorTraits: (s.minorTraits || []).map(t => typeof t === "object" ? t.id : t),
      majorTraits: s.majorTraits || (s.majorTraitsByTier
        ? Object.values(s.majorTraitsByTier).flat().map(t => typeof t === "object" ? t.id : t)
        : []),
    }])),
    traits:             allTraits,
    traitById:          new Map(allTraits.map(t => [t.id, t])),
    legends:            (build.legendDisplay || []).map(l => ({
      id: l.id, name: l.name, icon: l.icon, swap: l.swap?.id || null,
      heal: l.heal || 0, utilities: Array.isArray(l.utilities) ? l.utilities : [], elite: l.elite || 0,
    })),
    // heal/utilities/elite drive the Revenant skill-bar options in the shared
    // renderer (skills.js reads activeLegend.heal/utilities/elite). Without them
    // the published build renders an empty skill bar (#283).
    legendById:         new Map((build.legendDisplay || []).map(l => [l.id, {
      id: l.id, name: l.name, icon: l.icon, swap: l.swap?.id || null,
      heal: l.heal || 0, utilities: Array.isArray(l.utilities) ? l.utilities : [], elite: l.elite || 0,
    }])),
    pets:               (build.petDisplay || []).map(p => ({ id: p.id, name: p.name, icon: p.icon, skills: p.skills || [] })),
    petById:            new Map((build.petDisplay || []).map(p => [p.id, p])),
    professionWeapons:  build.professionWeapons || {},
  };
}

/** Upgrade items the published build carries, plus items its notes mention. */
export function upgradeCatalogFromPublishedBuild(build) {
  const eqd = build.equipmentDisplay || {};
  const runeEntries = Object.values(eqd.runes || {}).filter(Boolean);
  const sigilEntries = Object.values(eqd.sigils || {}).flat().filter(Boolean);
  const infusionEntries = Object.values(eqd.infusions || {}).flat().filter(Boolean);
  const uc = {
    runeById:       new Map(runeEntries.map(r => [r.id, r])),
    sigilById:      new Map(sigilEntries.map(s => [s.id, s])),
    infusionById:   new Map(infusionEntries.map(i => [i.id, i])),
    enrichmentById: new Map(eqd.enrichment ? [[eqd.enrichment.id, eqd.enrichment]] : []),
    foodById:       new Map(eqd.food ? [[eqd.food.id, eqd.food]] : []),
    utilityById:    new Map(eqd.utility ? [[eqd.utility.id, eqd.utility]] : []),
    relicByName:    new Map(eqd.relic ? [[eqd.relic.name, eqd.relic]] : []),
    relicById:      new Map(eqd.relic ? [[eqd.relic.id, eqd.relic]] : []),
  };
  // Merge in upgrade items referenced in notes but not equipped
  for (const item of (build.catalogNotesMentions || [])) {
    const map = { rune: uc.runeById, sigil: uc.sigilById, food: uc.foodById, utility: uc.utilityById,
      infusion: uc.infusionById, enrichment: uc.enrichmentById, relic: uc.relicById }[item.category];
    if (map && !map.has(item.id)) map.set(item.id, item);
  }
  return uc;
}
```

This body is the code at `render-build.js:134–188` as of `cb8f40e6`. Before deleting the original, diff the two. If `render-build.js` has changed since, the file wins.

In `render-build.js`:
- Add `import { catalogFromPublishedBuild, upgradeCatalogFromPublishedBuild } from "./published-catalog.js";`.
- Replace the `// ── state.activeCatalog ──` and `// ── state.upgradeCatalog ──` blocks, through the end of the notes-mentions merge loop, with:

```js
  state.activeCatalog = catalogFromPublishedBuild(build);
  state.upgradeCatalog = upgradeCatalogFromPublishedBuild(build);
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/unit/site tests/unit/spa-minor-traits-normalization.test.js`
Expected: PASS. If parity fails, the diff in `flatten` output shows which field the published build or `catalogFromPublishedBuild` loses. Fix it in `serializeForPublish` or the builder; do not weaken the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/site/published-catalog.js src/site/render-build.js tests/unit/site/comp-coverage-parity.test.js
git commit -m "refactor(site): pure catalog builders from a published build; coverage parity test"
```

---

### Task 8: Viewer renders v2 comps

**Files:**
- Create: `src/site/comp-members.js`, `src/site/comp-coverage.js`
- Modify: `src/site/main.js` (`loadComp`), `src/site/render-comp.js` (`renderSlot` ~104, `buildTagHoverData` ~66, `renderBuildPool` ~164), `src/site/styles.css` (one rule)
- Test: `tests/unit/site/comp-members.test.js`, `tests/unit/site/render-comp-v2.test.js` (create)

**Interfaces:**
- Consumes: `fetchPayload` (Task 3), `computeCompPartyCoverage` overrides (Task 5), `catalogFromPublishedBuild`/`upgradeCatalogFromPublishedBuild` (Task 7), `buildPartyCoverageHTML` (existing).
- Produces:
  - `memberDataBase(member, fallbackBase): string`
  - `memberSpaUrl(member, build, loc): string`
  - `loadCompMembers(comp, {fallbackBase, loc, fetchImpl}): Promise<{[buildId]: build | {id, unavailable: true}}>`
  - `computeViewerCoverageHtml(comp, buildsById): Promise<string>`

- [ ] **Step 1: Write the failing tests.** Create `tests/unit/site/comp-members.test.js`:

```js
"use strict";

const web = require("node:stream/web");
globalThis.DecompressionStream ??= web.DecompressionStream;
globalThis.crypto ??= require("node:crypto").webcrypto;

const { encryptPayload, generateEncryptionKey } = require("../../../src/main/buildEncryption");
const { memberDataBase, memberSpaUrl, loadCompMembers } = require("../../../src/site/comp-members.js");

const loc = { origin: "https://me.github.io", pathname: "/axibuilds/" };
const okBytes = (data, key) => {
  const b = encryptPayload(data, key);
  return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};

describe("comp members", () => {
  test("a member is read from its owner's repo; an ownerless one from this page's base", () => {
    expect(memberDataBase({ owner: "mate" }, "https://raw.githubusercontent.com/me/axibuilds/main/site/"))
      .toBe("https://raw.githubusercontent.com/mate/axibuilds/main/site/");
    expect(memberDataBase({ owner: "" }, "BASE/")).toBe("BASE/");
  });

  test("spaUrl points at the owner's page with the member's file and key", () => {
    expect(memberSpaUrl({ owner: "mate", fileId: "ab12cd34", key: "KEY" }, { title: "Heal Firebrand!" }, loc))
      .toBe("https://mate.github.io/axibuilds/?n=heal-firebrand&b=ab12cd34.KEY");
    expect(memberSpaUrl({ owner: "", fileId: "ab12cd34", key: "KEY" }, { title: "" }, loc))
      .toBe("https://me.github.io/axibuilds/?n=build&b=ab12cd34.KEY");
  });

  test("loads members in parallel; a 404, a bad key, or a v1 member are each handled", async () => {
    const kA = generateEncryptionKey();
    const kB = generateEncryptionKey();
    const comp = { members: {
      a: { fileId: "aaaa1111", key: kA, owner: "me" },
      b: { fileId: "bbbb2222", key: kB, owner: "mate" },
    } };
    const fetchImpl = jest.fn(async (url) =>
      url.endsWith("aaaa1111.enc") ? okBytes({ id: "a", title: "FB", profession: "Guardian" }, kA) : { ok: false, status: 404 });

    const out = await loadCompMembers(comp, { fallbackBase: "BASE/", loc, fetchImpl });

    expect(out.a).toMatchObject({ id: "a", title: "FB", spaUrl: "https://me.github.io/axibuilds/?n=fb&b=aaaa1111." + kA });
    expect(out.b).toEqual({ id: "b", unavailable: true });
    expect(fetchImpl).toHaveBeenCalledWith("https://raw.githubusercontent.com/mate/axibuilds/main/site/builds/bbbb2222.enc", { cache: "no-store" });
  });
});
```

Create `tests/unit/site/render-comp-v2.test.js`:

```js
/**
 * @jest-environment jsdom
 */
"use strict";

const { renderCompPage } = require("../../../src/site/render-comp.js");
const { computeViewerCoverageHtml } = require("../../../src/site/comp-coverage.js");

const MIGHT = { id: 100, name: "Healing Surge", slot: "Heal", type: "Heal", description: "",
  facts: [{ type: "Buff", status: "Might", duration: 10, apply_count: 5 }] };

function publishedBuild(id, extra = {}) {
  return { id, title: id, profession: "Guardian", gameMode: "pve", specializations: [],
    skills: { heal: MIGHT, utility: [], elite: null }, equipment: { slots: {}, weapons: {} },
    catalogSkills: [MIGHT], catalogWeaponSkills: [], catalogTraits: [], spaUrl: `https://x/?b=${id}.k`, ...extra };
}

const baseComp = {
  name: "Linked", gameMode: "pve", tags: [], notes: "", categories: [], buildColors: {},
  partyLines: [{ id: "l1", capacity: 5, slots: ["a", "gone"] }],
};

beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; });

describe("v2 comp in the viewer", () => {
  test("an unavailable member renders as a marked slot and is left out of the pool", () => {
    const app = document.getElementById("app");
    renderCompPage(app, { ...baseComp, builds: { a: publishedBuild("a"), gone: { id: "gone", unavailable: true } } });
    expect(app.querySelectorAll(".comp-slot--unavailable")).toHaveLength(1);
    expect(app.querySelector(".comp-slot--unavailable").getAttribute("title")).toBe("Build unavailable");
    expect(app.querySelector(".comp-pool-count").textContent).toBe("1");
  });

  test("coverage computed in the viewer skips the unavailable member and tolerates a v1 member with no bonus", async () => {
    const html = await computeViewerCoverageHtml(baseComp, {
      a: publishedBuild("a"), // no boonDurationBonus: a teammate's v1 file
      gone: { id: "gone", unavailable: true },
    });
    expect(html).toContain("party-cov__line");
    expect(html).toContain("Might");
  });

  test("a v1 comp still renders its embedded coverage snapshot", () => {
    const app = document.getElementById("app");
    renderCompPage(app, { ...baseComp, partyLines: [{ id: "l1", capacity: 5, slots: ["a"] }],
      builds: { a: publishedBuild("a") }, boonCoverageHtml: '<div class="party-cov__line">snapshot</div>' });
    expect(app.querySelector(".comp-boon-cov__body").textContent).toContain("snapshot");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/unit/site/comp-members.test.js tests/unit/site/render-comp-v2.test.js`
Expected: FAIL, the modules don't exist yet and there is no `.comp-slot--unavailable`.

- [ ] **Step 3: Create `src/site/comp-members.js`**

```js
import { fetchPayload } from "./payload.js";

const REPO = "axibuilds";

// Mirrors slugifyBuildName (src/main/buildEncryption.js) so a member link reads
// the same as the one the desktop builds.
function slugify(name) {
  const slug = String(name || "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/[\s-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "build";
}

/** Where a member's .enc lives: its publisher's repo, or this page's own base. */
export function memberDataBase(member, fallbackBase) {
  return member?.owner ? `https://raw.githubusercontent.com/${member.owner}/${REPO}/main/site/` : fallbackBase;
}

/** The member build's own page, for slot and pool-card links. */
export function memberSpaUrl(member, build, loc) {
  const page = member.owner ? `https://${member.owner}.github.io/${REPO}/` : `${loc.origin}${loc.pathname}`;
  return `${page}?n=${encodeURIComponent(slugify(build.title))}&b=${member.fileId}.${member.key}`;
}

/**
 * Fetch every member of a v2 comp in parallel. Returns the {id: build} map v1
 * comps embed, so the rest of the page renders both formats the same way. A
 * member that can't be fetched or decrypted becomes {id, unavailable: true}.
 */
export async function loadCompMembers(comp, { fallbackBase, loc, fetchImpl }) {
  const entries = await Promise.all(Object.entries(comp.members || {}).map(async ([buildId, m]) => {
    try {
      const url = `${memberDataBase(m, fallbackBase)}builds/${encodeURIComponent(m.fileId)}.enc`;
      const build = await fetchPayload(url, m.key, fetchImpl);
      return [buildId, { ...build, id: buildId, spaUrl: memberSpaUrl(m, build, loc) }];
    } catch {
      return [buildId, { id: buildId, unavailable: true }];
    }
  }));
  return Object.fromEntries(entries);
}
```

`fetchImpl` defaults inside `fetchPayload` when `undefined` is passed (the default parameter applies). Leave that behaviour in place.

- [ ] **Step 4: Create `src/site/comp-coverage.js`**

```js
import { computeCompPartyCoverage, buildPartyCoverageHTML } from "../renderer/modules/comps/comp-boon-coverage.js";
import { catalogFromPublishedBuild, upgradeCatalogFromPublishedBuild } from "./published-catalog.js";

const NO_BONUS = { concentration: 0, expertise: 0 };

/**
 * Party coverage for a v2 comp, computed in the browser from the member builds
 * with the same code the desktop uses. Each member brings its own catalogs and
 * its baked duration bonus. A member without one (a teammate's build still in
 * v1 format) gets no bonus rather than a wrong one.
 */
export async function computeViewerCoverageHtml(comp, buildsById) {
  const builds = Object.values(buildsById).filter((b) => b && !b.unavailable);
  const catalogs = new Map(builds.map((b) => [b.id, catalogFromPublishedBuild(b)]));
  const upgrades = new Map(builds.map((b) => [b.id, upgradeCatalogFromPublishedBuild(b)]));
  const data = await computeCompPartyCoverage(comp, builds, new Map(), async () => null, null, {
    catalogFor: (b) => catalogs.get(b.id),
    upgradeCatalogFor: (b) => upgrades.get(b.id),
    durationBonusFor: (b) => b.boonDurationBonus || NO_BONUS,
  });
  return buildPartyCoverageHTML(data);
}
```

- [ ] **Step 5: Update `render-comp.js`**
  - `renderSlot`: first line of the body:

```js
  if (build?.unavailable) {
    return `<div class="comp-slot comp-slot--unavailable" title="Build unavailable"><span class="comp-slot__icon">?</span></div>`;
  }
```

  - `buildTagHoverData`: change `.filter(Boolean)` to `.filter((b) => b && !b.unavailable)`.
  - `renderBuildPool`: `const builds = Object.fromEntries(Object.entries(comp.builds || {}).filter(([, b]) => b && !b.unavailable));`

  Add to `src/site/styles.css`, next to the other `.comp-slot` rules:

```css
.comp-slot--unavailable { opacity: 0.45; border-style: dashed; }
```

- [ ] **Step 6: Wire `main.js` `loadComp`**

Add the imports:

```js
import { loadCompMembers } from "./comp-members.js";
import { computeViewerCoverageHtml } from "./comp-coverage.js";
```

Then replace the body of `loadComp`'s `try`:

```js
    const base = resolveDataBase(location, new URLSearchParams(location.search));
    let comp = await fetchPayload(`${base}comps/${encodeURIComponent(fileId)}.enc`, base64urlKey);
    if (comp.v === 2) {
      // A v2 comp links its builds: fetch them, then compute coverage here.
      const builds = await loadCompMembers(comp, { fallbackBase: base, loc: location });
      let boonCoverageHtml = "";
      try {
        boonCoverageHtml = await computeViewerCoverageHtml(comp, builds);
      } catch (err) {
        console.warn("Party coverage unavailable:", err);
      }
      comp = { ...comp, builds, boonCoverageHtml };
    }
    renderComp(comp);
```

- [ ] **Step 7: Run tests**

Run: `npm test -- tests/unit/site`
Expected: PASS.

- [ ] **Step 8: Build the SPA to catch bundling errors**

Run: `npx vite build --config src/site/vite.config.js`
Expected: build succeeds. Check `package.json` `scripts` for the project's own site build command (grep `site`) and prefer it if one exists.

- [ ] **Step 9: Commit**

```bash
git add src/site/comp-members.js src/site/comp-coverage.js src/site/main.js src/site/render-comp.js src/site/styles.css tests/unit/site/comp-members.test.js tests/unit/site/render-comp-v2.test.js
git commit -m "feat(site): render v2 comps from linked members with in-browser coverage"
```

---

### Task 9: v2 comp serializer and member planning

**Files:**
- Modify: `src/main/compPublish.js`
- Test: `tests/unit/compPublish.test.js` (rewrite the buildsMap tests), `tests/unit/site/comp-notes-publish-roundtrip.test.js` (only if it asserts `builds`)

**Interfaces:**
- Consumes: `decideCompBuildPublish({build, owner, force, slug}) → {foreignOwner, needsRecord}` (`src/main/teamGuards.js:54`).
- Produces:
  - `serializeCompForPublish(comp, members): {v: 2, id, name, notes, tags, gameMode, partyLines, buildColors, images, notesClassIcons, categories, members}`
  - `planCompMembers({compBuilds, owner, force?, slugOf, newFileId, newKey}): {members, uploads: Array<{build, fileId, key, slug, needsRecord}>, foreign: Array<{id, title, owner}>}`

- [ ] **Step 1: Rewrite the tests.** In `tests/unit/compPublish.test.js`:
  - Delete the tests named `"includes all builds in buildsMap regardless of party line assignment"`, `"each build entry includes spaUrl"` and `"slot referencing a build absent from buildsMap produces undefined entry — documents bug"`. They describe embedding, which v2 removes.
  - Remove the `makeBuildEntry` helper if nothing else uses it.
  - In `"includes comp fields"`, replace `buildsMap` with `{}`.
  - Add:

```js
describe("serializeCompForPublish v2", () => {
  test("links members instead of embedding builds and drops coverage HTML", () => {
    const members = { "build-1": { fileId: "aaaa1111", key: "K1", owner: "me" } };
    const result = serializeCompForPublish(makeComp({ boonCoverageHtml: "<div>8 MB</div>" }), members);
    expect(result.v).toBe(2);
    expect(result.members).toEqual(members);
    expect(result).not.toHaveProperty("builds");
    expect(result).not.toHaveProperty("boonCoverageHtml");
  });
});

describe("planCompMembers", () => {
  const { planCompMembers } = require("../../src/main/compPublish");
  let n = 0;
  const deps = { slugOf: (b) => b.title.toLowerCase(), newFileId: () => `new${++n}`, newKey: () => "NEWKEY" };

  test("own builds are uploaded and linked under the publisher", () => {
    const plan = planCompMembers({ ...deps, owner: "me", compBuilds: [
      { id: "b1", title: "One" },
      { id: "b2", title: "Two", publishedFileId: "keep2222", publishedKey: "K2", publishedOwner: "me", publishedSlug: "two" },
    ] });
    expect(plan.uploads.map((u) => u.build.id)).toEqual(["b1", "b2"]);
    expect(plan.members.b2).toEqual({ fileId: "keep2222", key: "K2", owner: "me" });
    expect(plan.members.b1.owner).toBe("me");
    expect(plan.uploads[0].needsRecord).toBe(true);
    expect(plan.uploads[1].needsRecord).toBe(false);
  });

  test("a teammate's published build is linked from their repo, never uploaded", () => {
    const plan = planCompMembers({ ...deps, owner: "me", compBuilds: [
      { id: "b3", title: "Theirs", publishedFileId: "mate3333", publishedKey: "K3", publishedOwner: "mate" },
    ] });
    expect(plan.uploads).toHaveLength(0);
    expect(plan.members.b3).toEqual({ fileId: "mate3333", key: "K3", owner: "mate" });
    expect(plan.foreign).toEqual([{ id: "b3", title: "Theirs", owner: "mate" }]);
  });

  test("force takes over a teammate's build", () => {
    const plan = planCompMembers({ ...deps, owner: "me", force: true, compBuilds: [
      { id: "b3", title: "Theirs", publishedFileId: "mate3333", publishedKey: "K3", publishedOwner: "mate" },
    ] });
    expect(plan.uploads).toHaveLength(1);
    expect(plan.members.b3.owner).toBe("me");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/unit/compPublish.test.js`
Expected: FAIL. `result.v` is undefined and `planCompMembers` is not a function.

- [ ] **Step 3: Implement** in `src/main/compPublish.js`. Add `const { decideCompBuildPublish } = require("./teamGuards");` near the top, after confirming with grep that `teamGuards.js` does not require `compPublish.js`. Replace `serializeCompForPublish`:

```js
/**
 * The published comp (payload v2). Member builds are linked, not embedded:
 * `members[buildId] = { fileId, key, owner }` names each build's own published
 * file, which the viewer fetches. That keeps the comp a few KB, and a build
 * re-published on its own shows up in every comp that uses it without
 * re-uploading those comps.
 */
function serializeCompForPublish(comp, members) {
  const { id, name, notes, tags, gameMode, partyLines, buildColors, categories, images } = comp;
  return {
    v: 2,
    id, name, notes, tags, gameMode, partyLines, buildColors,
    // Screenshots pasted into comp notes, keyed by the ~img:<key> tokens the
    // notes markdown references.
    images: images || {},
    // Class icons for the :Firebrand: emoji used in the notes, keyed by name.
    notesClassIcons: resolveNotesClassIcons(notes),
    // Comp-scoped build categories, so published comps can render tag slots
    // (the "tag:<id>" entries in partyLines.slots) with their icon and hover.
    categories: categories || [],
    members: { ...members },
  };
}

/**
 * Decide, for each member of a comp being published under `owner`, where its
 * published file lives. A build a teammate published is linked from their repo
 * and left alone (unless `force`). Every other member is (re-)uploaded under
 * `owner` in the same commit as the comp, reusing its file id and key when it
 * has them so existing build links stay valid.
 */
function planCompMembers({ compBuilds, owner, force = false, slugOf, newFileId, newKey }) {
  const members = {};
  const uploads = [];
  const foreign = [];
  for (const build of compBuilds) {
    const slug = slugOf(build);
    const { foreignOwner, needsRecord } = decideCompBuildPublish({ build, owner, force, slug });
    if (foreignOwner) {
      members[build.id] = { fileId: build.publishedFileId, key: build.publishedKey, owner: foreignOwner };
      foreign.push({ id: build.id, title: build.title || build.profession || "Build", owner: foreignOwner });
      continue;
    }
    const fileId = build.publishedFileId || newFileId();
    const key = build.publishedKey || newKey();
    members[build.id] = { fileId, key, owner };
    uploads.push({ build, fileId, key, slug, needsRecord });
  }
  return { members, uploads, foreign };
}
```

Export: `module.exports = { serializeCompForPublish, getCompPublishBuildIds, resolveNotesClassIcons, planCompMembers };`

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/unit/compPublish.test.js tests/unit/site/comp-notes-publish-roundtrip.test.js tests/unit/teamGuards.test.js`
Expected: PASS. If the round-trip test asserts on `builds`, change that assertion to `members`.

- [ ] **Step 5: Keep the release E2E fixtures on the v1 shape.** In `tests/spa/helpers/fixture-gen.js`, change `generateCompPayload` so it builds the legacy v1 payload explicitly. The viewer still supports v1, and those specs assert embedded-build behaviour:

```js
function generateCompPayload(comp, builds) {
  const buildsMap = Object.fromEntries(
    builds.map((b) => [b.id, serializeForPublish(b, loadCatalog(b.profession || "Necromancer"), null)])
  );
  // The legacy (v1) comp shape: builds embedded, coverage pre-rendered. The SPA
  // still renders it for links published before payload v2; these fixtures pin
  // that path. Fields other than builds/coverage come from the real serializer.
  const { v: _v, members: _members, ...fields } = serializeCompForPublish(comp, {});
  const enrichedComp = { ...fields, builds: buildsMap };
  if (comp.boonCoverageHtml) enrichedComp.boonCoverageHtml = comp.boonCoverageHtml;
  const fileId = generateFileId();
  const encKey = generateEncryptionKey();
  const base64Payload = encryptBuild(enrichedComp, encKey);
  return { fileId, encKey, base64Payload };
}
```

Keep the existing doc comment above the function, and append one line: "Pinned to the v1 shape on purpose; see payload v2 in docs/superpowers/specs/2026-10-07-publish-payload-shrink-design.md." Do not run the Playwright suite. It runs at release.

- [ ] **Step 6: Commit**

```bash
git add src/main/compPublish.js tests/unit/compPublish.test.js tests/unit/site/comp-notes-publish-roundtrip.test.js tests/spa/helpers/fixture-gen.js
git commit -m "feat(publish): v2 comp payload links members; planCompMembers"
```

---

### Task 10: Desktop publish writes v2

This switches the writers. Every reader already handles v2 (Tasks 3, 4 and 8).

**Files:**
- Modify: `src/main/siteBundle.js:69-82`, `src/main/index.js` (build publish ~1660-1830, comp publish ~1869-2010, local API ops ~2738), `src/main/publishFingerprint.js`, `src/preload/index.js:107`, `src/main/localApi.js:217`, `src/renderer/modules/comps/comp-detail.js:~1416-1428`
- Test: `tests/unit/siteBundle.test.js`, `tests/unit/localApi.test.js`, `tests/unit/publishFingerprint.test.js`, `tests/unit/publishWiring.test.js` (create)

**Interfaces:**
- Consumes: `encryptPayload` (Task 1), `serializeCompForPublish(comp, members)` and `planCompMembers` (Task 9), Buffer upload (Task 2).
- Produces:
  - IPC `comps:publish-comp(compId, opts)` (no html argument)
  - preload `publishComp(compId, opts)`
  - local API `POST /comps/:id/publish` ignores the body
  - `buildEncryptedBuildFile`/`buildEncryptedCompFile` return `{filePath, content: Buffer}`

- [ ] **Step 1: Write the failing tests.**

In `tests/unit/siteBundle.test.js`, replace the two `buildEncryptedBuildFile` tests:

```js
describe("buildEncryptedBuildFile", () => {
  const { decryptPayload, generateEncryptionKey } = require("../../src/main/buildEncryption");
  const key = generateEncryptionKey();

  test("writes a v2 Buffer at the build path", () => {
    const result = buildEncryptedBuildFile({ title: "Test" }, "abc12345", key);
    expect(result.filePath).toBe("site/builds/abc12345.enc");
    expect(Buffer.isBuffer(result.content)).toBe(true);
    expect([...result.content.subarray(0, 4)]).toEqual([0x00, 0x41, 0x58, 0x02]);
    expect(decryptPayload(result.content, key)).toEqual({ title: "Test" });
  });

  test("content does not contain plaintext", () => {
    const result = buildEncryptedBuildFile({ title: "My Secret Build" }, "abc12345", key);
    expect(result.content.includes(Buffer.from("My Secret Build"))).toBe(false);
  });
});
```

In `tests/unit/localApi.test.js`:
- Replace the test `"POST /comps/:id/publish forwards optional boonCoverageHtml"` with:

```js
  test("POST /comps/:id/publish publishes by id; any body is ignored", async () => {
    const created = await compStore.upsertComp({ name: "Pub Comp" });
    const res = await req(port, token, "POST", `/comps/${created.id}/publish`, { boonCoverageHtml: "<table></table>" });
    expect(res.status).toBe(200);
    expect((await res.json()).pagesUrl).toContain(created.id);
    expect(publishedComps).toEqual([{ id: created.id }]);
  });
```

- Change the fake to `publishComp: async (id) => { publishedComps.push({ id }); return {...same...}; }`.
- In `"works without a body"`, replace the `boonCoverageHtml` assertion with `expect(publishedComps).toEqual([{ id: created.id }]);`.

In `tests/unit/publishFingerprint.test.js`, delete the `compReceiptAfterRepublish` test and remove it from the import list.

Create `tests/unit/publishWiring.test.js`. `index.js` is the Electron entry and can't be unit-loaded; the repo already pins wiring this way (`render-comp-notes.test.js`):

```js
"use strict";

// index.js is the Electron entry point and can't be loaded under Jest, so the
// publish wiring this plan depends on is pinned at the source level.
const fs = require("node:fs");
const path = require("node:path");
const src = fs.readFileSync(path.join(__dirname, "../../src/main/index.js"), "utf8");

describe("publish wiring", () => {
  test("publishing a build no longer re-uploads comps", () => {
    expect(src).not.toMatch(/affectedComps/);
    expect(src).not.toMatch(/compRestamps/);
  });

  test("comp publish takes no coverage HTML", () => {
    expect(src).toMatch(/handle\("comps:publish-comp", \(event, compId, opts\)/);
    expect(src).not.toMatch(/boonCoverageHtml\)/);
  });

  test("publish fetches each build's catalog for its own game mode", () => {
    const calls = src.match(/getProfessionCatalog\([^)]*"en"[^)]*\)/g) || [];
    const publishCalls = calls.filter((c) => /build\.profession|cb\.profession/.test(c));
    expect(publishCalls.length).toBeGreaterThan(0);
    for (const call of publishCalls) expect(call).toMatch(/gameMode/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/unit/siteBundle.test.js tests/unit/localApi.test.js tests/unit/publishFingerprint.test.js tests/unit/publishWiring.test.js`
Expected: FAIL. Content is still a string, the fake still receives html, and the wiring assertions fail.

- [ ] **Step 3: siteBundle.** In `src/main/siteBundle.js`, import `encryptPayload` alongside the existing `encryptBuild` require. Replace the `encryptBuild(...)` calls in `buildEncryptedBuildFile` and `buildEncryptedCompFile` with `encryptPayload(...)`. Then grep the file: if `encryptBuild` has no other use, drop it from the require.

- [ ] **Step 4: Build publish in `index.js`.**
  - In the build publish handler, change `getProfessionCatalog(build.profession, "en")` to `getProfessionCatalog(build.profession, "en", build.gameMode || "pve")`.
  - Delete the whole fan-out: from the comment `// Re-encrypt any published comps that contain this build` through the closing brace of `if (affectedComps.length) { ... }`, plus the `compRestamps` declaration.
  - After `markPublished`, delete the `for (const { comp, receipt } of compRestamps) { ... }` loop with its comment.
  - Remove `compReceiptAfterRepublish` from the `require("./publishFingerprint")` destructure.
  - Delete `compReceiptAfterRepublish` from `src/main/publishFingerprint.js` and its `module.exports`.
  - Check the handler still references `combinedBundle` correctly. It is built just before the deleted block.

- [ ] **Step 5: Comp publish in `index.js`.**
  - Change the handler and function signature:

```js
  handle("comps:publish-comp", (event, compId, opts) => enqueuePublish(() => publishCompImpl(event, compId, opts || {})));
  async function publishCompImpl(event, compId, opts = {}) {
```

  - Update the `require("./compPublish")` destructure to include `planCompMembers`.
  - Replace step 4 (from `// ── 4. Publish unpublished builds, enrich all builds` through the end of its `for` loop) with:

```js
    // ── 4. Plan members: link teammates' copies, upload our own ────────
    const plan = planCompMembers({
      compBuilds, owner, force: opts.force,
      slugOf: (b) => slugifyBuildName(b.title),
      newFileId: generateFileId,
      newKey: generateEncryptionKey,
    });
    const skippedForeignBuilds = plan.foreign;
    const updatedBuildRecords = [];
    const newUploads = plan.uploads.filter((u) => !u.build.publishedFileId);

    for (const { build, fileId, key, slug, needsRecord } of plan.uploads) {
      if (!build.publishedFileId) {
        progress(`builds:${newUploads.findIndex((u) => u.build === build) + 1}:${newUploads.length}:${build.title || build.profession || "Build"}`);
      }
      let enrichedBuild;
      try {
        const [catalog, upgradeCatalog] = await Promise.all([
          getProfessionCatalog(build.profession, "en", build.gameMode || "pve"),
          getUpgradeCatalog("en"),
        ]);
        const extraCatalogs = await loadCrossProfessionCatalogs(build.notes, build.profession, getProfessionCatalog);
        enrichedBuild = serializeForPublish(build, catalog, upgradeCatalog, extraCatalogs);
      } catch (err) {
        throw new Error(
          `Failed to enrich build "${build.title || build.profession}": ${err?.message || err}. ` +
          "Check your internet connection and try again."
        );
      }
      // Pre-compute GW2 chat link so the SPA can display it without API calls
      try {
        const { generateChatLink } = require("./buildChatLink.js");
        enrichedBuild.chatLink = await generateChatLink(build);
      } catch {
        // Chat link unavailable — SPA will hide the build code widget
      }

      const encFile = buildEncryptedBuildFile(enrichedBuild, fileId, key);
      spaBundle[encFile.filePath] = encFile.content;
      const redir = buildRedirectFile(fileId, key, "b");
      spaBundle[redir.filePath] = redir.content;

      // This build's own page was just re-encrypted from `build`, so its receipt
      // moves too. Only a changed record is written (and synced to the team).
      const receipt = buildReceipt(build);
      if (needsRecord || build.publishedHash !== receipt.publishedHash) {
        updatedBuildRecords.push({ id: build.id, publishedFileId: fileId, publishedKey: key, publishedSlug: slug, publishedOwner: owner, snapshotUpdatedAt: build.updatedAt, ...receipt });
      }
    }
```

  - In step 5, replace the two lines that build `compPayload` (the `serializeCompForPublish(comp, buildsMap)` call and the `boonCoverageHtml` attach) with:

```js
    const compPayload = serializeCompForPublish(comp, plan.members);
```

  - Delete now-unused locals from step 1 (`compTheme`, `themedBuildsOn`) if nothing else in the function reads them (grep within the function).
  - In step 8's `compStore.markPublished(...)` call, replace the `boonCoverageHtml: …` line and the `...compReceipt(comp, compBuilds),` line (with its comment) with:

```js
      // Clear the pre-v2 coverage snapshot; v2 pages compute coverage live.
      boonCoverageHtml: "",
      // v2 links members, so the comp page can't go stale through them: no
      // member hashes. A member's own staleness shows on the member.
      ...compReceipt(comp, []),
```

  - In the local API ops (~line 2738), change it to `publishComp: (id) => asHttpResult(invokeLocal("comps:publish-comp", id)),`.

- [ ] **Step 6: Drop the html argument everywhere else.**
  - `src/preload/index.js:107`: `publishComp: (compId, opts) => ipcRenderer.invoke("comps:publish-comp", compId, opts || {}),`
  - `src/main/localApi.js:217`: `return ops.publishComp(params.id);`
  - `src/renderer/modules/comps/comp-detail.js`, publish click handler: delete the `// Pre-compute boon coverage HTML…` block (`let boonCoverageHtml = ""; try { … } catch { … }`). Change the call to `(opts) => window.desktopApi.publishComp(comp.id, opts),`. Then grep the file for `buildPartyCoverageHTML`/`computeCompPartyCoverage`. They are still used by the live panel (~line 610), so keep those imports.
  - Run `grep -rn "publishComp(" src docs/ | grep -v "^src/web"` and fix any remaining 3-argument call. Update local-API docs that mention a `boonCoverageHtml` body, if there are any.

- [ ] **Step 7: Run the affected tests, then the whole suite**

Run: `npm test -- tests/unit/siteBundle.test.js tests/unit/localApi.test.js tests/unit/publishFingerprint.test.js tests/unit/publishWiring.test.js tests/unit/publishBaseline.test.js tests/unit/publishState.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS. Any failure that mentions `encryptBuild`, `content` typing or `boonCoverageHtml` is a missed caller; fix the caller, not the test's intent.

- [ ] **Step 8: Commit**

```bash
git add src/main/siteBundle.js src/main/index.js src/main/publishFingerprint.js src/preload/index.js src/main/localApi.js src/renderer/modules/comps/comp-detail.js tests/unit/siteBundle.test.js tests/unit/localApi.test.js tests/unit/publishFingerprint.test.js tests/unit/publishWiring.test.js
git commit -m "feat(publish): write v2 payloads; comps link members; drop build→comp fan-out"
```

---

### Task 11: Size check against real data and bookkeeping

**Files:**
- Modify: `docs/BACKLOG.md` (the "Published payloads are 50–1000× bigger" entry)

- [ ] **Step 1: Measure a real build at v2.** This uses the logged-in user's local data and network, and is read-only:

```bash
node -e '
const { encryptPayload, encryptBuild, generateEncryptionKey } = require("./src/main/buildEncryption");
const { serializeForPublish } = require("./src/main/buildPublish");
const { getProfessionCatalog, getUpgradeCatalog } = require("./src/main/gw2Data/catalog");
const b = require(process.env.HOME + "/.config/axiforge-desktop/data/builds.json").find((x) => x.profession && x.equipment);
(async () => {
  const [cat, up] = await Promise.all([getProfessionCatalog(b.profession, "en", b.gameMode || "pve"), getUpgradeCatalog("en")]);
  const s = serializeForPublish(b, cat, up);
  const k = generateEncryptionKey();
  console.log("v1", encryptBuild(s, k).length, "v2", encryptPayload(s, k).length);
})();'
```

Expected: v2 is under 150 KB, against a v1 of about 1.2 MB. If `getProfessionCatalog` can't run outside Electron (it may need `app.getPath`), say so in the report and rely on the unit size checks instead. Don't stub around it.

- [ ] **Step 2: Update the backlog entry.** Change `- [ ]` to `- [x]`. Append one line: "Fixed by payload v2 (`docs/superpowers/specs/2026-10-07-publish-payload-shrink-design.md`): gzip + binary envelope, comps link members, coverage computed in the viewer." Add the measured v1/v2 numbers from Step 1, if you have them.

- [ ] **Step 3: Full suite once more, then commit**

Run: `npm test`
Expected: PASS.

```bash
git add docs/BACKLOG.md
git commit -m "docs(backlog): payload v2 closes the size bloat entry"
```
