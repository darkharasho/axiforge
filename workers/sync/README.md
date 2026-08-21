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
    npx jest tests/unit/worker-sync --maxWorkers=2
Handlers take `(request, env, deps)`; tests inject a node:sqlite D1 shim
(`tests/helpers/d1Shim.js`), a Map KV, a fake `fetchImpl`, and a fixed `now`.

## Adding a migration
Create `workers/sync/migrations/NNNN_name.sql` (idempotent SQL), then apply
locally and remotely as above. The test shim applies every file in order.
