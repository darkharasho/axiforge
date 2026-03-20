# Shared Build Library Design

## Overview

Enable multiple Axiforge users to share builds and comps through a collaborative library backed by a private GitHub org repo. Members of the org all have full read/write access to shared folders, which appear alongside personal content in a merged library view.

## Approach

Use the GitHub REST API (the same `fetch()`-based approach already used for publishing) to sync shared data via a private repo in a GitHub organization. GitHub's SHA-based file updates provide optimistic locking for conflict detection. No custom backend infrastructure required.

## Repo Structure & Data Model

### Remote repo: `{org}/axibuilds-shared` (private)

```
folders/
  {folderId}/
    meta.json          # { id, name, sortOrder, createdAt, updatedAt }
    builds/
      {buildId}.json   # full build object, one file per build
    comps/
      {compId}.json    # full comp object, one file per comp
```

One file per build/comp so that:
- Optimistic locking is per-file via GitHub SHA — two people can edit different builds in the same folder without conflicting
- Smaller payloads per sync operation
- Git diffs show which specific build changed

`meta.json` is created when a folder is first shared (pushed alongside the initial builds). It is updated whenever the folder is renamed or its `sortOrder` changes, using the same SHA-based optimistic locking. On pull, changes to `meta.json` update the local folder's `name` and `sortOrder`. If two people rename the same folder simultaneously, the second push gets a 409 and the standard conflict resolution applies (keep mine / discard).

Note: The GitHub tree API may return `truncated: true` for very large repos (>100,000 entries). This is not expected for build data but if encountered, the sync engine should fall back to paginated directory listing via the contents API.

### Local storage integration

Shared builds and comps are stored in the same `builds.json` and `comps.json` files as personal data. Their `folderId` points to a shared folder, which is the only distinction. On pull, the sync engine reads the local store, upserts/removes builds by ID for the affected shared folder, and rewrites the file. On push, the engine extracts the single build/comp by ID and serializes it as a standalone JSON file for the PUT. UUID collisions between personal and shared builds are astronomically unlikely with UUIDv4 and are not handled.

All sync engine reads and writes go through the existing `BuildStore` and `CompStore` methods, which are serialized by the Node.js event loop. This prevents concurrent write conflicts between user-initiated saves and background poll pulls without needing an explicit mutex.

Shared folders are always top-level — they cannot be nested under personal folders, and personal folders cannot be nested under shared folders. The UI should prevent drag-nesting into/out of shared folders.

### Local folder metadata

Each folder in `folders.json` gains optional fields when shared. `FolderStore.upsertFolder` must be extended to persist these additional fields:

```json
{
  "id": "uuid",
  "name": "Raid Builds",
  "shared": true,
  "orgName": "my-gw2-guild",
  "lastSyncedAt": "2026-03-19T12:00:00Z"
}
```

Sync metadata (SHA tracking) is stored separately in `syncState.json` to avoid bloating `folders.json`:

```json
{
  "{folderId}": {
    "remoteShas": {
      "meta": "sha-aaa111",
      "builds/{buildId}": "sha-abc123",
      "comps/{compId}": "sha-def456"
    }
  }
}
```

The org name and repo name (`axibuilds-shared`) are stored once in `auth.json` under a `sharedLibrary` key, not repeated per folder. The folder's `orgName` field is kept for display purposes and to identify which org a folder belongs to (future multi-org support).

`remoteShas` maps each remote file path to its last-known GitHub SHA. When pushing an edit, the SHA is included — if someone else changed the file since, GitHub rejects the update with a 409.

## Sync Engine

### Three sync triggers

1. **On save** — when a build/comp in a shared folder is saved, push immediately.
2. **On folder switch** — when the user navigates to a shared folder, pull latest.
3. **Background poll** — every 5 minutes, check for remote changes across all shared folders.

### Pull algorithm

1. `GET /repos/{org}/{repo}/git/trees/{branch}?recursive=true` — single API call returns the full file tree with SHAs.
2. Compare remote SHAs against local `remoteShas` map.
3. For any file where remote SHA differs from local: `GET /repos/{org}/{repo}/contents/{path}` to fetch updated content.
4. Merge into local store, update `remoteShas` and `lastSyncedAt`.
5. New remote files (builds/comps not in local) are added to the local store.
6. Files missing from remote that exist locally with a tracked SHA (i.e., deleted by someone else) are removed locally.

### Push algorithm

1. On save, if the build/comp is in a shared folder (debounce 2 seconds after last change to avoid rapid-fire pushes):
2. Check `syncState.json` for a SHA entry for this file path.
3. If **no SHA** (new file): `PUT /repos/{org}/{repo}/contents/{path}` without `sha` field → creates file (201).
4. If **SHA exists** (update): `PUT` with the SHA → updates file (200). Store new SHA from response.
5. If **409 Conflict** — someone else edited it. Trigger conflict resolution UX.

### Deletions

- Delete via `DELETE /repos/{org}/{repo}/contents/{path}` with SHA.
- If 409 (file was modified by someone else since last sync), show a dialog:
  - **"Delete anyway"** — fetch current SHA, then delete with it.
  - **"Cancel"** — abort deletion, pull the updated version.
  - **"View updated version"** — pull and display the remote version, let user decide.

### Offline and network failure handling

- **Offline save:** The build is saved locally as normal. The push is queued and retried on next successful sync. A subtle indicator shows "unsynced changes" on the folder.
- **Failed poll:** Silently skipped. Next poll retries. No retry storm.
- **Transient server errors (500/502/503):** Retry once after 5 seconds. If still failing, skip and retry on next poll cycle. No user-facing error unless the failure persists across multiple cycles, at which point a non-blocking toast is shown.

### Rate limit budget

- Full tree fetch: 1 API call per poll (covers the entire repo, not per-folder)
- Each changed file fetch: 1 call
- Push per save: 1 call
- At 5-min polling: 12 tree fetches/hr + change fetches
- Well within the 5,000/hr authenticated rate limit even with multiple users.

## Onboarding & Folder Sharing Flow

### Setting up the org (first time)

1. User opens Settings or a "Shared Libraries" section.
2. Clicks "Set up shared library."
3. If not logged into GitHub, triggers existing OAuth device flow.
4. App fetches org memberships via `GET /user/orgs`.
5. User selects an org from the list.
6. App creates `axibuilds-shared` private repo in that org via `POST /orgs/{org}/repos` (if it doesn't already exist).
7. Stores org/repo association in `auth.json` under a `sharedLibrary` key.

### Sharing a folder

1. Right-click a folder or use folder settings to select "Share to org."
2. App creates the folder directory structure in the repo.
3. Pushes all builds and comps in that folder to the repo.
4. Marks the folder as `shared: true` locally, populates `remoteShas`.
5. Folder gets a visual indicator in the UI (icon, badge, or color).

### Joining an existing shared library (second user)

1. User logs into GitHub, opens "Shared Libraries."
2. App detects they're a member of an org that has an `axibuilds-shared` repo.
3. User clicks "Connect" to perform an initial full pull.
4. Shared folders appear in their library alongside personal folders, visually distinguished.

### Leaving / unsharing

- **Unshare folder:** Removes the `shared` flag locally. Remote data stays. Other members still see it.
- **Disconnect from org:** Removes all shared folders from local view. Data preserved both locally (becomes personal) and remotely.

## Conflict Resolution UX

### Edit conflict (409 on push)

Modal dialog:
- "This build was modified by **{committer}** at {timestamp} while you were editing it."
- **"Keep my version"** — fetches current SHA, then pushes with it (force overwrite).
- **"Discard my changes"** — pulls the remote version, overwrites local copy.

No merge UI or diffing. The optimistic locking is a safety net to prevent silent overwrites, not a full collaboration tool.

### Remote deletion while build is open

- On next sync, app detects the file is gone from remote (tracked SHA exists locally but file is absent from the tree).
- Toast notification: "{build name} was deleted from the shared library by another member."
- Build is removed from the shared folder locally.
- If unsaved local edits exist, offer to save to a personal folder instead.

### Remote folder structure changes

- New folders appear automatically on sync (new directory in `folders/` with a `meta.json`).
- Renamed folders: detected by comparing the `name` field in the pulled `meta.json` against the local folder name. Updated locally.
- Deleted folders (entire directory gone from tree): contained builds are removed locally with a notification. If any had unsaved local edits, offer to save personally.

### Attribution

The conflict dialog references "modified by {committer}" — this is read from the latest git commit that touched the file, available via `GET /repos/{org}/{repo}/commits?path={path}&per_page=1`. The committer name comes from the GitHub user who made the push.

## Interaction with Existing Features

### Publishing

Shared builds can still be published to GitHub Pages individually. The `publishedSlug`, `publishedFileId`, and `publishedKey` fields travel with the build in the shared repo — if one person publishes, everyone in the org sees the published link.

### Discord sharing

No change. Any org member can share a comp from a shared folder to Discord.

### Chat links / Share codes

No change. Generated on the fly from local data.

### Comps referencing builds across boundaries

- A shared comp can only reference builds within the same shared folder. This keeps data self-contained in the repo.
- **Enforcement:** The UI enforces this at the point of adding a build to a comp. The comp editor's build picker filters to builds in the same folder. If a build is dragged in from elsewhere, the prompt fires.
- Adding a personal build to a shared comp prompts: "Move this build to the shared folder?"
- Adding a build from a different shared folder triggers the same prompt.
- **Sharing a comp that references builds in other folders:** When sharing a folder that contains comps, the app checks if any comp references builds outside the folder. If so, it prompts the user to move those builds into the folder first (or remove them from the comp) before the share can proceed.
- **Build moved out of a shared folder while a shared comp references it:** The build is removed from the comp's slot. On next sync, other users see the updated comp with the empty slot. A toast notifies: "{build name} was removed from {comp name} because it was moved out of the shared folder."

### Folder operations

- **Moving a build out of a shared folder** — deletes it from remote, becomes personal. Confirmation dialog.
- **Moving a build into a shared folder** — pushes it to remote. Confirmation dialog.
- Both trigger confirmation since they affect other users.

## Access control

Flat model: org membership = full access. Anyone in the GitHub org can read, add, edit, and delete builds in the shared library. No role-based permissions beyond GitHub's org membership.

## Security

- Repo is private — only org members can access.
- Existing GitHub OAuth token is used for all API calls.
- No additional encryption layer (the repo is access-controlled, unlike the public GitHub Pages publishing which uses AES-256-GCM).
- Build data at rest on GitHub is governed by GitHub's security model.
- Build `images` (base64 data URIs) are included in shared build JSON. Users should be aware that large numbers of image-heavy builds will increase repo size. GitHub recommends repos stay under 1 GB.
