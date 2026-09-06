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

`.github/workflows/ci.yml` runs, on every push to main and every PR:

- `npm test` (jest), plus the main-process syntax check;
- the **SPA** and **playground** Playwright suites, in a second job. Both are
  browser-only and seconds each. That job bakes `src/web/public/catalogs` first
  — it is git-ignored and generated, and the playground cannot render a
  profession without it.

The **Electron e2e suite runs nightly**, not per push
(`.github/workflows/nightly-e2e.yml`, 08:00 UTC, plus `workflow_dispatch`). It
is minutes rather than seconds and its cap is memory, so a per-push job would
queue behind itself; nightly still means a break surfaces within a day instead
of mid-release. On the runner it needs `xvfb-run` (Electron wants an X display
even with `AXIFORGE_HIDE_WINDOW`) and `ELECTRON_DISABLE_SANDBOX`, because the
runner image's AppArmor policy blocks the user namespaces Chromium's sandbox
needs.

Keep ci.yml and release.yml in sync: release.yml gates a tag on the same jest
and syntax checks, and anything added to one belongs in the other.
