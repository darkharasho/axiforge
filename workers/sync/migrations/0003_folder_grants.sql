-- Per-folder access within a teamspace.
--
-- Until now a teamspace had exactly two settings for a person: `owner` (do
-- anything) or `member` (write anything, delete only your own). That is one
-- decision for the whole library, so a squad that wants an officers-only folder,
-- or a read-only reference section, has no way to express it — the only lever is
-- making somebody an owner of everything or nothing.
--
-- A grant says "for this folder and everything inside it, this person gets this
-- much". The NEAREST grant walking up from an item wins, so a broad grant on the
-- team root can be narrowed folder by folder, and vice versa. A grant on the
-- team's own id is the team-wide default for that person, which is how a
-- read-only member is expressed.
--
-- `none` exists because "read" is only half of admin control: hiding a folder is
-- the thing people actually ask for. It is enforced by filtering the changes
-- feed, not just by refusing writes.
--
-- Owners are deliberately NOT grantable. An owner can hand out and take back any
-- grant in the team, so a grant that appeared to restrict one would be a lie —
-- they can remove it in the same breath.
CREATE TABLE IF NOT EXISTS folder_grants (
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  folder_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id),
  access     TEXT NOT NULL CHECK (access IN ('none','read','write','delete')),
  granted_by TEXT NOT NULL REFERENCES users(id),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (team_id, folder_id, user_id)
);
CREATE INDEX IF NOT EXISTS folder_grants_user ON folder_grants(team_id, user_id);

-- Losing read access has to reach the client, and there is no per-item event for
-- "you may no longer see this" — the item did not change. So a grant edit stamps
-- the team's seq onto the affected member, and a client whose cursor predates
-- that stamp is told to resync. This is exactly the mechanism `purged_seq`
-- already uses for purged tombstones; the full re-pull's prune then removes
-- whatever the server no longer hands out.
ALTER TABLE memberships ADD COLUMN grants_seq INTEGER NOT NULL DEFAULT 0;
