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

### Local folder metadata

Each folder in `folders.json` gains optional fields when shared:

```json
{
  "id": "uuid",
  "name": "Raid Builds",
  "shared": true,
  "orgName": "my-gw2-guild",
  "repoName": "axibuilds-shared",
  "lastSyncedAt": "2026-03-19T12:00:00Z",
  "remoteShas": {
    "builds/{buildId}": "sha-abc123",
    "comps/{compId}": "sha-def456"
  }
}
```

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

1. On save, if the build/comp is in a shared folder:
2. `PUT /repos/{org}/{repo}/contents/{path}` with file content and last-known SHA.
3. **200 OK** — success, store new SHA in `remoteShas`.
4. **409 Conflict** — someone else edited it. Trigger conflict resolution UX.
5. **404** (new file, no prior SHA) — `PUT` without SHA to create.

### Deletions

- Delete via `DELETE /repos/{org}/{repo}/contents/{path}` with SHA.
- If 409, warn the user that the file was modified by someone else before proceeding.

### Rate limit budget

- Full tree fetch: 1 API call
- Each changed file fetch: 1 call
- Push per save: 1 call
- At 5-min polling with 5 shared folders: ~60 tree fetches/hr + change fetches
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

- On next sync, app detects the file is gone from remote.
- Toast notification: "{build name} was deleted from the shared library by another member."
- Build is removed from the shared folder locally.
- If unsaved local edits exist, offer to save to a personal folder instead.

### Remote folder structure changes

- New folders appear automatically on sync.
- Renamed folders update locally.
- Deleted folders: contained builds are removed locally with a notification. If any had unsaved local edits, offer to save personally.

## Interaction with Existing Features

### Publishing

Shared builds can still be published to GitHub Pages individually. The `publishedSlug`, `publishedFileId`, and `publishedKey` fields travel with the build in the shared repo — if one person publishes, everyone in the org sees the published link.

### Discord sharing

No change. Any org member can share a comp from a shared folder to Discord.

### Chat links / Share codes

No change. Generated on the fly from local data.

### Comps referencing builds across boundaries

- A shared comp can only reference builds within the same shared folder. This keeps data self-contained in the repo.
- Adding a personal build to a shared comp prompts: "Move this build to the shared folder?"
- Adding a build from a different shared folder triggers the same prompt.

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
