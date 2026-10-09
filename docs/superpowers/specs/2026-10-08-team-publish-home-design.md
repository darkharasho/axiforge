# Team builds publish to one home

**Problem.** A team with no publish target fell back to each member's own
GitHub account. A shared build then lived wherever its last editor published it:
X shares a link, Y edits the build, Y's publish lands in Y's account, and X's
link never shows the edit.

**GitHub organizations can't be created by the app.** github.com has no API for
it (only GitHub Enterprise Server does), so the default home is the team
owner's own account.

## Design

1. **Every team has a target.** The Worker stamps the creator's login on a new
   team; migration 0008 gives older teams their creator (if still an owner) or
   the longest-standing owner. PATCH refuses to clear it. An owner's app also
   claims an unset team on its own, for a server that hasn't been migrated.
   A team item never falls back to a personal account: with no target it is
   held (`publishTarget.js`, `publishBatch.js`).
2. **Members can push there.** The owner's app keeps `<target>/axibuilds`
   collaborators in step with the team, removing only people it invited itself
   (`teamRepoAccess.js`, state in `team-repo-collaborators.json`). A member's
   app accepts the invite when it first publishes there; until it can push, its
   team items are held (`PUBLISH_DISCONNECTED`, retried on focus) and the Copy
   link button says why.
3. **Existing copies move.** A team item published to another account moves to
   the team's target without the "published by @x" prompt, keeping its file id
   and key. On startup the old host's app (or an owner's, if the host left the
   team) queues the move (`teamPublishMoves.itemsToMove`).
4. **Old links follow.** Each app looks for its own repo's copies of items now
   published elsewhere, deletes the payload and writes
   `site/moved/<fileId>.json` `{ "owner": "<new host>" }`, shipping the current
   viewer with it. The viewer (`src/site/moved.js`), comp members and desktop
   link import follow the pointer on a 404.

## Limits

- Comps published on other accounts with an older viewer show a moved member
  as unavailable until that account publishes again (which upgrades its viewer).
- A pointer is written once; an item that moves twice (A → B → C) chains only if
  B's app writes its own pointer, which it does when B is a person running the
  app, not when B is an org.
