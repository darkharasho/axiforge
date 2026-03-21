# Port Comp Codec to @mks.haro/axicode Package

## Goal

Move `encodeCompCode`, `decodeCompCode`, and `isValidCompCode` from the axiforge app (`src/main/compCodec.js`) into the `@mks.haro/axicode` npm package so the codec is reusable and browser-compatible.

## Context

The comp codec was implemented in axiforge first for fast iteration (see `docs/superpowers/specs/2026-03-20-comp-share-codes-design.md`). It currently uses Node.js `zlib` for deflate/inflate. The axicode package needs to remain browser-compatible, so we replace `zlib` with `pako`.

## Design

### New dependency

`pako` — pure JS deflate/inflate, works in Node.js and browsers.

### New file: `src/compCodec.js` (in axicode package)

Three exported functions:

- **`encodeCompCode(comp, builds)`** — Takes a comp object and builds map. Encodes each build via `encodeShareCode`, deduplicates by payload, assembles JSON schema `{v, n, g, b, p}`, compresses with `pako.deflate`, encodes as base64url, wraps in `<AxiForge:Comp:...>`.
- **`decodeCompCode(code)`** — Validates format, extracts base64url payload, inflates with `pako.inflate`, parses JSON, decodes each build payload via `decodeShareCode`, expands party lines. Returns `{name, gameMode, builds, partyLines, failedBuildCount}`.
- **`isValidCompCode(text)`** — Pure string check for `<AxiForge:Comp:...>` format with non-empty payload.

Internally uses `encodeShareCode`/`decodeShareCode` from the same package (relative require).

### Updated file: `src/index.js`

Re-exports all three new functions alongside existing `encodeShareCode`, `decodeShareCode`, `isValidShareCode`.

### Tests: `tests/compCodec.test.js`

Port the 19 existing tests from axiforge's `tests/unit/compCodec.test.js`. Same structure: `isValidCompCode`, `encodeCompCode`, `decodeCompCode`, and round-trip integration tests.

### Package version

Bump from 1.0.1 to 1.1.0 (new feature, backwards compatible).

### Axiforge integration

- Update `@mks.haro/axicode` dependency to `^1.1.0`
- Replace `src/main/compCodec.js` with a thin re-export wrapper from the package
- Existing IPC handlers and tests continue working unchanged

## Base64url note

The axicode package currently uses Z85 for build codes. The comp codec uses base64url instead because the payload is JSON+deflate (arbitrary bytes, not 4-byte aligned). Node.js `Buffer.from(str, "base64url")` and `buf.toString("base64url")` are not available in browsers. The comp codec will include a small base64url encode/decode helper using `btoa`/`atob` (browser) or `Buffer` (Node.js), or use pako's built-in byte array output with a manual base64url implementation that works everywhere.
