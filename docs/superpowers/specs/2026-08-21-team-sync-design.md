# Team Sync — Replacing the GitHub-Org Shared Library

Date: 2026-08-21
Status: Approved (design)
Supersedes: `2026-03-19-shared-library-design.md` (GitHub org repo sync)

## Problem

The shared library syncs builds/comps through a private GitHub repo in a GitHub
organization. In practice it is cumbersome and unreliable:

- Onboarding needs a GitHub org, an org-admin, and a repo the app creates; role
  semantics leak from GitHub ("org admin = owner").
- Every save is a git commit; every poll is a HEAD + tree fetch + N content
  fetches; the tree snapshot races with in-flight pushes (new builds were
  deleted locally and resurrected a poll later — fixed defensively on
  `harden/publish-sync-resiliency`, but the model invites this class of bug).
- Failed pushes are dropped (no outbox); 409s are resolved by silently
  overwriting the other person's change; the spec'd conflict UX and "unsynced"
  indicator were never built.
- `boonCoverageHtml` (a ~5 MB rendered publish artifact stored on comps) is
  committed on every comp save.

## Goals

- Team sync that is fast (a save is one small HTTP PUT), predictable (every local
  change is either synced or visibly pending — never lost), and simple to join
  (create a team, share an invite code).
- Real conflict handling: optimistic versioning with a keep-mine / take-theirs
  choice, never a silent overwrite.
- No GitHub org or repo. Identity reuses the existing GitHub login; the account
  model supports adding Discord later.
- One-click migration of existing org libraries; the GitHub sync code is removed
  in the same release.

## Non-Goals

- Moving *publishing* off GitHub Pages (P2 — a later spec; see "Publishing of
  team items" for the one consequence this has now).
- Real-time push (WebSockets/Durable Objects). The data model allows adding a
  "team changed, pull now" poke channel later without schema changes.
- Viewer/read-only role, Discord login, multiple orgs per team. Designed for,
  not built.
- Moving `boonCoverageHtml` out of `comps.json` (separate bounded fix; here it
  is simply excluded from sync).

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Identity | GitHub login now; `users` + `identities` tables so Discord can be added later |
| Roles | `owner` + `member` (members create/edit anything, delete what they created; owners everything) |
| Publishing | Stays on GitHub Pages (P1) |
| Existing org libraries | One-click migrate to a team, delete GitHub sync code same release (M1) |
| Sync mechanics | D1 + per-team sequence cursor, polling (A1) |

---

## 1. Backend — Cloudflare Worker + D1

### 1.1 Hosting

Same Worker as the Playground (`axiforge-playground`, `build.axi.link`,
`wrangler.jsonc`). Add a D1 binding `SYNC_DB` and route `/api/sync/*` through
the Worker (`run_worker_first`). Existing short-link and gw2skills routes are
untouched. Source lives in `workers/sync/` (`router.js`, `auth.js`, `teams.js`,
`items.js`, `db.js`), mounted from `workers/share-shortener/src/index.js`.
Migrations in `workers/sync/migrations/NNNN_*.sql`, applied with
`wrangler d1 migrations apply SYNC_DB`.

### 1.2 Schema

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,          -- uuid
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    TEXT NOT NULL
);
CREATE TABLE identities (
  provider          TEXT NOT NULL,         -- 'github' (later: 'discord')
  provider_user_id  TEXT NOT NULL,
  user_id           TEXT NOT NULL REFERENCES users(id),
  login             TEXT NOT NULL,         -- provider handle, for display/attribution
  PRIMARY KEY (provider, provider_user_id)
);
CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,          -- sha256(token)
  user_id       TEXT NOT NULL REFERENCES users(id),
  client_label  TEXT,                      -- e.g. "AxiForge 0.12.0 linux"
  created_at    TEXT NOT NULL,
  last_used_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL              -- sliding, 90 days
);
CREATE TABLE teams (
  id            TEXT PRIMARY KEY,          -- uuid; for migrated libraries = old root folder id
  name          TEXT NOT NULL,
  invite_code   TEXT NOT NULL UNIQUE,      -- 10 chars, Crockford base32, no vowels
  seq           INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE TABLE memberships (
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id),
  role      TEXT NOT NULL CHECK (role IN ('owner','member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE items (
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,               -- build/comp/folder id (client uuid)
  type        TEXT NOT NULL CHECK (type IN ('folder','build','comp')),
  parent_id   TEXT,                        -- folder item id, NULL = team root
  body        TEXT,                        -- JSON; NULL when deleted
  version     INTEGER NOT NULL,            -- 1,2,3… per item
  seq         INTEGER NOT NULL,            -- team-wide monotonic, set on every write
  deleted     INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL REFERENCES users(id),
  updated_by  TEXT NOT NULL REFERENCES users(id),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (team_id, id)
);
CREATE INDEX items_team_seq ON items(team_id, seq);
```

A **team is a library**. Locally it is one root folder; its subfolders are
`folder` items with `parent_id`. A user may belong to many teams (one root
folder each). Deletes are tombstones (`deleted=1`, `body=NULL`, new `seq`) so
a lagging client still learns about them; a daily cron trigger purges
tombstones older than 30 days.

### 1.3 Auth

- `POST /api/sync/auth/github { token }` — Worker calls GitHub `GET /user` with
  the supplied token (never stored), upserts `users` + `identities(github,…)`,
  creates a session, returns `{ sessionToken, user: { id, login, displayName,
  avatarUrl } }`. `client_label` from `User-Agent`.
- Every other route requires `Authorization: Bearer <sessionToken>`; the Worker
  looks up `sha256(token)`, rejects expired sessions with 401, and bumps
  `last_used_at`/`expires_at` at most once per hour.
- `DELETE /api/sync/auth/session` — logout (deletes the session row).
- Adding Discord later = one more `/auth/discord` route writing the same
  `identities` shape; an existing user can link a second identity.

### 1.4 Endpoints

All JSON. Errors: `{ error: { code, message } }` with codes
`unauthorized`, `forbidden`, `not_found`, `conflict`, `too_large`,
`invalid`, `rate_limited`.

```
POST   /teams                      {name}                → {team, role:'owner'}
POST   /teams/join                 {inviteCode}          → {team, role:'member'}  (idempotent if already a member)
GET    /teams                                            → [{team, role, seq}]
PATCH  /teams/:id                  {name}                owner
DELETE /teams/:id                                        owner   (hard delete, cascades)
GET    /teams/:id/members                                → [{userId, login, displayName, avatarUrl, role, joinedAt}]
DELETE /teams/:id/members/:userId                        owner, or self (leave). Last owner cannot leave.
POST   /teams/:id/invite/rotate                          owner → {inviteCode}

GET    /teams/:id/changes?since=<seq>&limit=<n≤200>      → {items:[Item], nextSeq, hasMore}
PUT    /teams/:id/items/:itemId    {type, parentId, body, baseVersion}
                                   201 created / 200 updated → {version, seq}
                                   409 → {error, current: Item}
DELETE /teams/:id/items/:itemId?baseVersion=N            → {version, seq} (tombstone)
                                   409 on version mismatch; 403 per role rules
POST   /teams/:id/items:bulk       {items:[{itemId,type,parentId,body,baseVersion}]} (≤50)
                                   → {results:[{itemId, status, version?, seq?, current?}]}
```

`Item` on the wire: `{ id, type, parentId, body, version, seq, deleted,
createdBy:{userId,login}, updatedBy:{userId,login}, updatedAt }`.

### 1.5 Write semantics

- `seq` is taken with `UPDATE teams SET seq = seq + 1 WHERE id = ? RETURNING seq`
  in the **same D1 batch** as the item write, so it is monotonic per team and a
  client that has seen `seq = N` has seen every write with `seq ≤ N`.
- `version` starts at 1 and increments on every write (including tombstones).
  Clients send `baseVersion` = the version they last saw. Mismatch → 409 with
  the current item. `baseVersion: null` means "create": 409 if a live item
  already exists; allowed (and un-tombstones) if the existing row is deleted.
- Deleting a folder item tombstones the folder and every descendant item in one
  batch (each gets its own `seq`), so clients see ordinary tombstones.
- `parentId` must be NULL or a live `folder` item in the same team, else 400.
- `items:bulk` runs each item with the same rules; per-item status so a partial
  failure (one 409) does not fail the upload.

### 1.6 Roles (enforced server-side)

| Action | member | owner |
|---|---|---|
| create / edit any item | ✓ | ✓ |
| delete item they created | ✓ | ✓ |
| delete a folder tree they created where every descendant was also created by them | ✓ | ✓ |
| delete any item / any folder tree | | ✓ |
| rename / delete team, rotate invite, remove members | | ✓ |
| leave team | ✓ | ✓ (not if last owner) |

"Moving an item out of a team" is a delete server-side, so the delete rule applies.

### 1.7 Limits and validation

- Body ≤ 1.5 MB (D1 row limit is 2 MB). 413 `too_large` names the item type and
  id in the message so the client can say which build.
- `boonCoverageHtml` is stripped from comp bodies server-side if present.
- `type` and `parentId` validated; unknown top-level body keys are kept (forward
  compatible).
- Rate limit: 120 writes / minute / user (KV counter, 60-second window) → 429
  with `Retry-After`.
- Invite codes: 10 chars from `0-9 A-Z` minus `I L O U` (unambiguous); `join`
  is rate-limited to 10/min/IP to slow brute force.

### 1.8 Worker testing

Vitest with `@cloudflare/vitest-pool-workers` (real D1 via miniflare, migrations
applied in `beforeAll`):

- auth: first login creates user+identity+session; second login reuses user;
  bad GitHub token → 401; expired session → 401.
- role matrix from 1.6 (403s).
- version conflict → 409 with `current`; create-over-live → 409;
  create-over-tombstone → 201 and `deleted = 0`.
- `seq` monotonic and unique under `Promise.all` of 20 concurrent PUTs.
- `changes` paging: `limit`, `hasMore`, `nextSeq`, tombstones included, order by `seq`.
- folder delete cascades; bulk partial failure reports per-item status.
- 413 on oversize body; `boonCoverageHtml` stripped.

---

## 2. Client — Electron main process

### 2.1 Modules

- `src/main/syncApi.js` — fetch client for `/api/sync/*`. Base URL from
  `AXIFORGE_SYNC_BASE` (default `https://build.axi.link/api/sync`). Maps HTTP
  errors to typed errors: `SYNC_UNAUTHORIZED`, `SYNC_FORBIDDEN`,
  `SYNC_CONFLICT` (with `current`), `SYNC_TOO_LARGE`, `SYNC_RATE_LIMITED`
  (with `retryAfterMs`), `SYNC_OFFLINE` (fetch threw / 5xx).
- `src/main/teamSync.js` — the engine. Constructor
  `{ buildStore, compStore, folderStore, syncStore, historyStore, emit }`
  (same shape as `SharedLibrary`, so `index.js` wiring is a rename).

Removed: `src/main/sharedLibrary.js`, the shared-repo functions in
`githubApi.js` (`ensureSharedRepo`, `getHeadSha`, `getRepoTree`,
`getFileContents`, `putSharedFile`, `deleteSharedFile`, `getOrgRole`), all
`shared-library:*` IPC handlers, their preload bindings, and the Shared
Library settings UI.

### 2.2 Local state

- `auth.json.sync = { sessionToken, userId, login }` (replaces `auth.sharedLibrary`).
- Root folder record: `{ ..., shared: true, teamId, role }`. Subfolders are
  ordinary folders with `parentId`.
- `syncState.json`:
  ```json
  {
    "<teamId>": {
      "cursor": 1234,
      "versions": { "<itemId>": 7 },
      "outbox": {
        "<itemId>": { "type": "build", "op": "put", "baseVersion": 7,
                      "queuedAt": "...", "attempts": 2, "nextAttemptAt": "...",
                      "conflict": null }
      }
    }
  }
  ```
  `SyncStore` gains `getTeam/setCursor/setVersion/removeVersion/
  enqueue/dequeue/markAttempt/markConflict/listOutbox` (all serialized,
  atomic writes — already in place).

### 2.3 Outbox (push)

Invariant: **a local change to a team item is never acknowledged to the renderer
without its outbox entry being on disk.** Every IPC handler that mutates a team
item (save build/comp, delete, move, folder create/rename/move/delete, publish
metadata stamp) calls `teamSync.enqueue(teamId, itemId, type, op)` before
returning.

Flush:
- Debounced 1 s per item, max 5 s; serialized per team (one in-flight request
  per team).
- The body is **read from the store at flush time**, not at enqueue — ten rapid
  edits become one PUT with the latest content. A `delete` op supersedes a
  pending `put`; a `put` after a `delete` of the same id (re-create) replaces it
  with `baseVersion: null`.
- Success → `versions[id] = version`, dequeue, emit `synced`.
- `SYNC_CONFLICT` → `markConflict(current)`, emit `conflict`, open the conflict
  modal (2.5).
- `SYNC_FORBIDDEN` → dequeue, re-pull the item, emit `error` with the server
  message (e.g. "Only the team owner or the build's creator can delete it").
- `SYNC_TOO_LARGE` → dequeue, emit `error` naming the item; the item stays local.
- `SYNC_OFFLINE` / `SYNC_RATE_LIMITED` → keep, `attempts++`,
  `nextAttemptAt = now + min(5s · 2^attempts, 5 min)` (or `retryAfterMs`),
  emit `pending`.
- `SYNC_UNAUTHORIZED` → stop everything, clear `auth.sync`, emit
  `{status:"error", error:"auth"}` (banner: "Sign in again to sync teams").
- Flush runs: on enqueue (debounced), on startup before the first pull, on
  window focus, on `online`, and at the start of every poll tick.

### 2.4 Pull

`pullTeam(teamId)`:
1. `GET /changes?since=cursor&limit=200`, loop while `hasMore`.
2. Apply items sequentially (stores are write-queued). For each item:
   - skip if `versions[id] === item.version` (our own write echoed back);
   - skip if `outbox[id]` exists (local wins until the flush resolves it; that
     flush's 409 drives the conflict flow);
   - tombstone → delete locally: build → `deleteBuild` + `removeBuildFromComps`;
     comp → `deleteComp`; folder → local folder delete (descendants arrive as
     their own tombstones);
   - else upsert: folder → `upsertFolder({id, name, parentId: parentId ?? teamRootId})`;
     build/comp → restore `folderId = parentId ?? teamRootId`, upsert via the
     store, record a history entry (`source: "team-sync"`, author =
     `updatedBy.login`) exactly as the GitHub engine did.
   - `versions[id] = item.version` (or removed on tombstone).
3. Persist `cursor = nextSeq` after each page.
4. Emit per-item `syncing`/`synced` events (with `item`) and a folder-level
   `synced`, preserving the event contract `renderer.js` already consumes.

Triggers: startup (after outbox flush), every **30 s**, window focus (10 s
cooldown), and `teams:pull-all` from the UI. `pullAll` iterates the user's
teams; one failing team does not stop the others. A failing poll is silent; the
third consecutive failure shows one toast; success resets the counter.

### 2.5 Conflicts

Modal (reuses `confirm-modal.js`):

> **"Berserker Heal" was changed by vette 2 minutes ago while you were editing.**
> [Keep mine] [Take theirs]

- Keep mine → re-enqueue with `baseVersion = current.version` and flush.
- Take theirs → apply `current` locally (as in 2.4), dequeue, `versions[id] =
  current.version`. If the item is open and dirty in the editor, the store is
  updated but the editor is left alone and the existing "updated remotely —
  save or discard to apply" toast fires.
- Dismiss → entry stays in the outbox with `conflict` set; the item shows a
  "conflict" badge; clicking the badge reopens the modal. Flush skips conflicted
  entries until resolved.

### 2.6 Item payloads

- Build body: the normalized build minus `folderId` (expressed as `parentId`),
  `pinned`, `sortOrder`, `compIds`. Publish fields (`publishedFileId`,
  `publishedKey`, `publishedSlug`, `publishedAt`, `publishedOwner`) travel.
- Comp body: the comp minus `folderId`, `sortOrder`, `boonCoverageHtml`.
- Folder body: `{ name, sortOrder }`.
- `parentId` = the item's `folderId` if that folder is inside the team, or
  `null` when it sits directly in the team root folder.

### 2.7 Folder and move operations

| Local action | Team effect |
|---|---|
| create/rename/reorder subfolder | `PUT folder` |
| delete subfolder | `DELETE folder` (server cascades; owner, or member if the folder and all its items were created by them — else 403 and the folder is restored by re-pull) |
| move build/comp between folders inside the team | `PUT` with new `parentId` |
| move build/comp into a team folder | `PUT` with `baseVersion: null` |
| move build/comp out of a team folder | `DELETE` (role rules apply); it becomes personal locally |
| "Share to team…" on a personal folder | `items:bulk` of folder tree + builds + comps in 50-item batches; root folder flipped to `{shared, teamId, role}` |
| "Stop sharing" (owner) | `DELETE` the folder tree's items from the team; owner's local copies become personal; teammates receive tombstones and a toast "X stopped sharing *Folder*" |

Confirmation dialogs for move-in/move-out/stop-sharing remain as today.

### 2.8 Publishing of team items (P1 consequence)

There is no org repo, so a team build/comp publishes to the **publisher's own**
GitHub Pages repo. `publishedOwner` (GitHub login) is stored on the item and
travels with it, and `shortUrl()`/Discord sharing use it, so every teammate gets
the same link. When a *different* teammate publishes an item that already has a
`publishedOwner`, the publish confirm says: "This was published by **X**.
Publishing from your account creates a new link; the old one keeps working but
won't update." This is the one behavioural regression versus the org model and
is removed by the P2 spec (publishing via the Worker).

### 2.9 History

Pulled changes record a `build-history` entry with `source: "team-sync"` and
`authorLogin: updatedBy.login`, same as the GitHub engine (`summarizeBuildChange`
for updates, "Created" for first sight).

---

## 3. Renderer

- **Settings → Teams** (replaces Shared Library):
  - Not enabled: "Enable team sync" (one click; uses the existing GitHub login —
    if not logged in, runs the device flow first).
  - Enabled: **Create team** (name → shows invite code with Copy) · **Join team**
    (paste code) · team list: name, your role, member count; expand → members
    (owner: Remove), Leave; owner: Rotate invite code, Rename, Delete team.
  - Sign out of team sync.
- **Library**: team root folders get a team badge (tooltip: team name · role).
  Context menu: "Share to team…" (picker if >1 team), "Stop sharing" (owner),
  "Pull now". Sync badges: `syncing`, `synced`, `pending` (cloud-with-clock,
  "Waiting to sync"), `conflict` (amber, click → modal), `error`.
- `sync-status` events keep their shape; new `status` values `pending` and
  `conflict`. The 60-second "stuck spinner" safety timer stays.
- Editor subnav badge mirrors the per-item status as today.
- Preload: `shared-library:*` bindings replaced by `teams:*`:
  `enableTeamSync`, `disableTeamSync`, `createTeam`, `joinTeam`, `listTeams`,
  `listTeamMembers`, `removeTeamMember`, `leaveTeam`, `rotateInvite`,
  `renameTeam`, `deleteTeam`, `shareFolderToTeam`, `stopSharingFolder`,
  `pullTeam`, `pullAllTeams`, `resolveConflict(itemId, "mine"|"theirs")`,
  `migrateOrgLibrary(teamId|null)`.
- Local API (`localApi.js`): any endpoint that proxied `shared-library:*` is
  re-pointed at the `teams:*` equivalent; none are removed.

---

## 4. Migration (M1)

Shown in Settings → Teams while `auth.sharedLibrary` exists:

> **Move your GitHub org library to a team.** Your shared folders and their
> builds will be uploaded to a team you own; teammates join with an invite code.
> [Create team "{orgName}" and migrate] [Migrate into existing team…]

Steps (main process, `teams:migrate-org-library`):
1. Ensure team sync is enabled (session exists).
2. Create the team (or use the chosen one). For a *new* team created from a
   single shared root folder, `team.id = that folder's id` (so members re-link in
   place); with multiple shared roots, the team gets a fresh id and each old root
   becomes a `folder` item keeping its id.
3. For each shared root folder: `items:bulk` the folder tree, builds, comps from
   the local store (the local store is the synced mirror, so no GitHub access is
   needed). Progress events per batch.
4. Flip each root folder to `{ shared: true, teamId, role: "owner" }`; remove
   GitHub sync state; clear `auth.sharedLibrary`.
5. The GitHub repo is not touched (it remains as an archive).

Other members: on first launch of the new version, folders still flagged with
the old GitHub fields (`orgName`, no `teamId`) are shown with a banner:
*"This library moved to Teams — join with the owner's invite code."* The folder
stays usable as personal data meanwhile. On `joinTeam`, the first pull upserts
items by id; because ids are preserved, the existing local folder/builds are
updated in place rather than duplicated. The old `orgName`/`lastSyncedAt` fields
are cleared when a folder is re-linked to a team, and by a one-time cleanup when
`auth.sharedLibrary` is cleared.

---

## 5. Failure handling summary

| Situation | Behaviour |
|---|---|
| Offline on save | Saved locally, outbox entry, `pending` badge, retried with backoff and on focus/online/poll |
| Worker 5xx / rate limited | Same as offline; `Retry-After` respected |
| Session expired (401) | Stop polling, clear `auth.sync`, banner "Sign in again to sync teams"; outbox is preserved and flushed after re-login |
| Version conflict (409) | Modal keep-mine / take-theirs; never a silent overwrite |
| Forbidden (403) | Item re-pulled to server state, toast with server message |
| Body too large (413) | Toast naming the item; item stays local-only with `error` badge |
| Pull fails | Silent; third consecutive failure → one toast; counter resets on success |
| App crash mid-flush | Outbox persisted on disk, resumed at startup |
| Team deleted by owner | `GET /teams` no longer lists it → local root folder converted to personal with a toast |

---

## 6. Testing

- **Worker**: see 1.8.
- **`teamSync` unit tests** (jest, mocked `syncApi`, real stores in a temp dir):
  outbox entry is on disk before the IPC handler resolves; outbox survives a
  new `TeamSync` instance (restart); coalescing (N edits → 1 PUT with latest
  body); delete supersedes put; put after delete re-creates with
  `baseVersion: null`; pull skips items with pending outbox ops; pull skips
  echoed own writes; tombstones (build removed from comps; folder cascade);
  cursor persisted per page and paging continues after a mid-pull failure;
  409 → keep-mine re-PUTs with current version; 409 → take-theirs applies
  remote and dequeues; dirty editor is not clobbered (event assertion); 401
  stops polling and preserves outbox; 403 re-pulls; 413 dequeues with error;
  backoff schedule; `publishedOwner` travels; `boonCoverageHtml` never sent.
- **Migration**: unit test against mocked API — ids preserved, root folder
  flipped, `auth.sharedLibrary` cleared, partial bulk failure leaves the folder
  un-flipped and reports which items failed.
- **Live** (opt-in, `AXIFORGE_SYNC_LIVE=1`): two `TeamSync` instances against
  `wrangler dev --local` exchanging a build, a conflict, and a delete.
- **Playwright e2e**: Settings → Teams create/join flow with a stubbed API;
  conflict modal keep/take; pending badge when the API is unreachable.

---

## 7. Rollout

1. Deploy the Worker with the new routes and migrations (additive; old clients
   unaffected).
2. Release the app: hardening commits already on
   `harden/publish-sync-resiliency` + team sync + migration + removal of the
   GitHub sync code. Release notes call out: "Shared libraries now use Teams —
   owners: open Settings → Teams → Migrate; members: join with the invite code."
3. Dev loop: `wrangler dev --local --persist-to .wrangler/state` and
   `AXIFORGE_SYNC_BASE=http://localhost:8787/api/sync npm run dev`.

## 8. Open follow-ups (not in this spec)

- P2: publish via the Worker (removes the `publishedOwner` regression in 2.8).
- Move `boonCoverageHtml` out of `comps.json` into a side file.
- Discord identity + optional auto-membership from a Discord server.
- Poke channel for sub-second propagation if users ask for it.
