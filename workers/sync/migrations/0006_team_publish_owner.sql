-- Where this team publishes to.
--
-- Publishing has only ever had ONE target: the owner picked in Settings, stored
-- against the local auth record. That is a fact about the MACHINE, not about the
-- team, so a member of a team whose builds belong in the team's GitHub org
-- published them to their own account instead — silently, because the personal
-- account is also the fallback, and a successful publish to the wrong place
-- looks exactly like a successful publish.
--
-- The target belongs to the team, set once by an owner and read by everyone:
-- a member who joins tomorrow inherits it without being told, which is the only
-- version of this that stays true as the team changes.
--
-- NULL means "not configured" — publish falls back to the personal target, which
-- is the behaviour every existing team already has.
ALTER TABLE teams ADD COLUMN publish_owner TEXT;
-- 'user' or 'org'. It decides which endpoint creates the axibuilds repo
-- (POST /user/repos vs POST /orgs/<owner>/repos), so guessing it wrong creates
-- the repo on the wrong account — @see src/main/publishTarget.js.
ALTER TABLE teams ADD COLUMN publish_owner_type TEXT;
