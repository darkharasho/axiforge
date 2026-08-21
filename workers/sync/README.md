# Team sync API (`/api/sync/*`)

Spec: `docs/superpowers/specs/2026-08-21-team-sync-design.md`.

## Local dev
    npx wrangler d1 migrations apply axiforge-sync --local
    npx wrangler dev --local
    # desktop app against it:
    AXIFORGE_SYNC_BASE=http://localhost:8787/api/sync npm run dev

## Deploy
    npx wrangler d1 migrations apply axiforge-sync --remote
    npm run deploy:web        # builds the Playground + deploys the Worker

## Tests
    npm test -- tests/unit/worker-sync --maxWorkers=2
    # or directly: NODE_OPTIONS=--disable-warning=ExperimentalWarning npx jest tests/unit/worker-sync --maxWorkers=2
Handlers take `(request, env, deps)`; tests inject a node:sqlite D1 shim
(`tests/helpers/d1Shim.js`), a Map KV, a fake `fetchImpl`, and a fixed `now`.

## Adding a migration
Create `workers/sync/migrations/NNNN_name.sql` (idempotent SQL), then apply
locally and remotely as above. The test shim applies every file in order.

## Rate limiting caveat
The write/join/login rate limiters use a KV fixed-window counter
(`ratelimit.js`). Cloudflare KV allows only 1 write per second per key, so
under a sustained burst against the same key (e.g. rapid writes from one
user, or many logins from one IP in the same second) the limiter's own `put`
can fail — it fails open (logs a warning and allows the request) rather than
500ing, so this degrades to "soft" rather than blocking traffic, but it means
the limit is not strictly enforced under load. Follow-up: move to the
Workers Rate Limiting binding (`ratelimits` in `wrangler.jsonc`), which is
built for this and does not consume KV ops.
