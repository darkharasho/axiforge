-- A blanket level for a folder: "everyone in this team gets this much here".
--
-- Per-person grants alone do not scale. A twenty-person squad that wants one
-- read-only reference folder had to say so twenty times, and the twenty-first
-- person to join silently got the role default instead — the setting was never a
-- fact about the FOLDER, only a pile of facts about people, so nothing could
-- keep it true as the team changed.
--
-- This is that fact, written once. It reuses folder_grants rather than adding a
-- parallel table so there is still exactly one resolution rule (@see access.js):
-- a grant with user_id '*' covers every member. At one folder a person's own
-- grant beats the blanket; between folders the nearer one wins, as before.
--
-- '*' is not a person, so the user_id foreign key has to go: the alternative is
-- a phantom row in `users`, which would then have to be excluded from every
-- query that counts or lists people, forever, and would be wrong the first time
-- somebody forgot. The key was never load-bearing — setGrant already refuses a
-- user_id that is not a member of the team, and the team cascade still removes
-- the rows when a team goes.
CREATE TABLE folder_grants_new (
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  folder_id  TEXT NOT NULL,
  -- a user id, or '*' for everyone in the team
  user_id    TEXT NOT NULL,
  access     TEXT NOT NULL CHECK (access IN ('none','read','write','delete')),
  granted_by TEXT NOT NULL REFERENCES users(id),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (team_id, folder_id, user_id)
);
INSERT INTO folder_grants_new SELECT team_id, folder_id, user_id, access, granted_by, granted_at FROM folder_grants;
DROP TABLE folder_grants;
ALTER TABLE folder_grants_new RENAME TO folder_grants;
CREATE INDEX IF NOT EXISTS folder_grants_user ON folder_grants(team_id, user_id);
