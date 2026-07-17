# Short Links for Transient Build Shares

## Summary

Replace the high-entropy `build.axi.link/#b=<~2KB base64url>` transient-share URL
with a short, low-entropy `build.axi.link/b/<slug>` link backed by a Cloudflare
Worker + KV. This stops Google Safe Browsing's on-device phishing classifier from
reading shared links as obfuscated redirect payloads (which triggered a
"Dangerous site" full-page block), while keeping every existing `#b=` link
working forever.

## Motivation

`build.axi.link` was hit by a Google Safe Browsing **real-time heuristic**
"Dangerous site" warning — a client-side classification, not a persistent
blocklist entry (nothing appears in Search Console Security Issues on the
DNS-verified domain property). The trip factors:

- `.link` is a heavily-abused, low-reputation TLD.
- Newish domain with little traffic history.
- The share URL shape: `#b=<long high-entropy base64 blob>` reads like an
  obfuscated redirect/payload to the classifier, even though the `#` fragment
  never leaves the browser.

Short, low-entropy URLs remove the third factor (the one we control) and are
strictly better to paste into Discord. This spec is the durable half of the fix;
it is paired operationally with a Safe Browsing false-positive report for
immediate un-flagging.

## Background: two existing share paths

Only the first is implicated here.

| Path | URL shape | Backing | Affected |
|------|-----------|---------|----------|
| **Transient share** (`buildToHash`, `src/web/webApi/share.js`) | `build.axi.link/#b=<base64url>&n=<name>` | None — build encoded entirely in the URL fragment, fully serverless | Yes |
| **Published link** (`shortUrl`, `src/main/shortUrl.js`) | `{owner}.github.io/{repo}/r/{fileId}` | GitHub Pages file (`gw2eww/axibuilds`), requires GitHub auth + Discord gate | No — untouched |

## Goals

- Emit `build.axi.link/b/<slug>` as the default "Copy link" output.
- Keep the legacy `#b=` links decoding forever (permanent, serverless fallback).
- Never hard-fail sharing: fall back to `#b=` when offline or if the Worker is down.
- No changes to the build share **codec** (`@axiapps/code`) or the build wire
  format. Slugs wrap the *existing* share code.

## Non-goals

- Touching the authenticated published-link flow (`/r/{fileId}`).
- Comp transient shares (deferred — see Open Decisions).

## Design

### URL shapes

- **New (default):** `https://build.axi.link/b/Ab3xK9c` — 7-char base62 slug.
- **Legacy (permanent fallback):** `https://build.axi.link/#b=<base64url>&n=<name>`
  — still decodes via the unchanged `hashToBuild`. Old Discord links never break.

### Hosting

`build.axi.link` is fronted by **Cloudflare** (confirmed). Implement as one
Cloudflare Worker with a single KV namespace `SHARE_SLUGS`, routed on the
`build.axi.link` zone.

### Worker endpoints

**`POST /api/shorten`**

- Body: `{ code: "<raw AxiForge share code>", name?: "<title>" }`.
- Validate `code` server-side with the same `isValidShareCode` check
  (bundle `@axiapps/code` into the Worker, or a cheap structural check as a
  first gate). Reject anything that doesn't validate.
- **Content-address to dedupe:** `slug = base62(sha256(code + "\0" + name))[:7]`.
  Deterministic — re-sharing the same build yields the same slug, so the table
  does not grow on repeat shares.
- On a rare 7-char prefix collision (different `{code,name}`, same slug),
  extend to 8, then 9 chars.
- `KV.put(slug, JSON.stringify({ code, name }))` with **no expiry**
  (see Retention decision).
- Response: `{ slug, url: "https://build.axi.link/b/<slug>" }`.

**`GET /b/<slug>`**

- Serve the SPA shell (same `index.html`) so the client router picks up the
  `/b/<slug>` route.
- Emit `<meta name="robots" content="noindex">` (or an `X-Robots-Tag: noindex`
  header) on `/b/*` so Google does not crawl thousands of build permutations —
  crawl volume on an opaque-URL space itself depresses domain reputation.

**`GET /api/b/<slug>`**

- `KV.get(slug)` → `{ code, name }` or `404`.

### Abuse controls (required)

The write endpoint must not become an open text store / redirector — that is
exactly what earns a *real* Safe Browsing flag.

- `Content-Length` cap (~4 KB) on `/api/shorten`.
- Per-IP rate limit (Cloudflare WAF rule, or a KV/Durable Object counter).
- Reject bodies that fail `isValidShareCode`.

### Client integration (`src/web/webApi/share.js`)

- Add `buildToShortLink(build)` (async):
  1. `code = encodeShareCode(build)`.
  2. `POST /api/shorten` → `{ url }`; return it.
  3. On **any** network failure, fall back to the existing `#b=` hash URL so
     sharing never hard-fails offline or if the Worker is down.
- Add `slugToBuild(slug)`: `GET /api/b/<slug>` → `{ code, name }` → run the
  **existing** `decodeShareCode` + `nestSkills` path (share.js). Zero codec
  changes.
- Extend the router (wherever `#b=` is currently read) to also match the
  `/b/<slug>` route and dispatch to `slugToBuild`.
- The Share / Copy-link button uses `buildToShortLink` for the primary
  "Copy link"; optionally keep a secondary "Copy offline link" that emits the
  `#b=` form.

### Desktop

Desktop's copy-link uses the same seam. Offline, or if the user hasn't opted
into networked sharing, it falls back to `#b=` transparently. No auth required —
this is the anonymous transient path, distinct from the Discord-gated publish
flow.

## Files changed

| File | Change |
|------|--------|
| `workers/share-shortener/` (new) | CF Worker: `/api/shorten`, `/b/*`, `/api/b/*`; `wrangler.toml` with `SHARE_SLUGS` KV binding + `build.axi.link` route |
| `src/web/webApi/share.js` | Add `buildToShortLink` + `slugToBuild`; keep `buildToHash`/`hashToBuild` as permanent fallback |
| `src/web/…/router` (where `#b=` is read) | Add `/b/<slug>` route → `slugToBuild` |
| Share-button module | Primary "Copy link" → short link, fallback to hash |
| `tests/web/share.test.js` | Cover `buildToShortLink` success + offline fallback; `slugToBuild` round-trip equals `hashToBuild` output |

## Testing

- Unit: `slugToBuild(shorten(build))` decodes to the same build object as
  `hashToBuild(buildToHash(build))`.
- Unit: `buildToShortLink` returns a `#b=` URL when the fetch rejects.
- Worker: `POST /api/shorten` rejects invalid codes and oversized bodies;
  deterministic slug for identical input; collision extension path.

## Open Decisions

1. **Retention** — *Recommended: permanent + content-addressed.* KV is cheap,
   dedup keeps growth bounded, and links never rot. Alternative (TTL, e.g. 1yr)
   would let old Discord links die.
2. **Scope** — builds only for v1, or also comps (which have their own
   `#`-style transient share)? *Recommended: builds first, comps as a
   follow-up reusing the same Worker.*

## Reality check

Short links reduce recurrence but the `.link` TLD's low reputation is an
independent factor. Pair this with the Safe Browsing false-positive report for
immediate un-flagging. If the flag persists after both, the escalation is
serving the playground under a higher-reputation apex/subdomain.
