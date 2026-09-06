# Testing tiers

## The short version

| Tier | Command | Time | When |
|---|---|---|---|
| Unit / jsdom | `npm test` | ~12s | **Every change.** This is the loop. |
| SPA (browser) | `npm run test:spa` | ~25s | Touching `src/site` or a published payload. |
| Playground (web) | `npm run test:playground` | ~15s | Touching `src/web`. |
| E2E smoke | `npm run test:e2e:smoke` | ~2min | A real UI change you want eyes on. |
| E2E full | `npm run test:e2e` | ~10min | **Before a release. Not in the loop.** |

`npm test` is jest and covers 2500+ cases in twelve seconds. It is where the
majority of coverage belongs and where new coverage should go by default.

## Why E2E is deliberately rare

Each e2e spec file launches a real Electron app: a Chromium process, a fresh
profile, and a full catalog build. That is seconds per file no matter how fast
the assertions are, and it is memory-bound rather than CPU-bound — which is why
this suite ran pinned to a single worker for its whole life and took over half
an hour.

Reach for e2e only when the thing under test *cannot* be reached any other way:

- it crosses the IPC boundary (main writes, renderer reads);
- it depends on real Electron behaviour (window chrome, clipboard, native menus);
- it depends on real layout (a fixed titlebar overlapping the page, overflow);
- it drives the real sync server end to end.

Everything else — a predicate, a render function, a reducer, a store — belongs in
jest, where it runs in milliseconds and fails with a readable diff. When a bug
report comes in, the first question is "can this be a unit test?" and the answer
is usually yes: of the bugs fixed in September 2026, the drag-ghost strand, the
multi-select drop, the columns stale stack, the toast dwell times and the
window.prompt regression were all caught by jsdom tests that run in under a
second.

## Parallelism

The suite runs several Electron apps at once, so every worker is isolated:

- **Data dir** — `~/.config/axiforge-desktop-e2e-test-w<N>/data`, because every
  spec calls `cleanDataDir()`, which wipes the directory outright.
- **Sync server** — one process per worker on `9878 + N`. Its `db` is
  module-level singleton state and the `resetSync()` hook wipes all of it, so a
  shared instance would have workers pulling each other's teams out from under
  themselves.
- **GW2 catalog mock** — one shared instance on 9877. Every route is a read of
  fixture data, so there is nothing to isolate.

See `tests/e2e/helpers/ports.js` and `tests/e2e/global-setup.js`.

Worker count defaults to a conservative share of the machine, because the cap is
memory and the machine is usually also running the app, a browser and a game.
Override it when the box is free:

```
E2E_WORKERS=6 npm run test:e2e
```

## CI

`.github/workflows/ci.yml` runs `npm test` only. None of the Playwright suites
run there yet, which is how nine e2e specs stayed red for three releases — see
the housekeeping item in `docs/BACKLOG.md`. The SPA and playground suites are
seconds each and are the obvious first ones to add.
