-- Two missing indexes, each of which turned a point lookup into a table scan on
-- the hottest paths there are. Together they exhausted D1's daily row-read
-- allowance for the whole account, at which point every authenticated request
-- began failing at authenticate() with a 500 — an empty team list and a
-- permanent "Waiting to sync" clock on every item, for everybody.
--
-- identities(user_id): authenticate() joins sessions -> users -> identities on
-- EVERY request, and identities is keyed by (provider, provider_user_id), so
-- the join had nothing to seek on and read the whole table each time. Cost per
-- request grew with the number of people who have ever signed in, on a query
-- that runs before any handler does.
CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id);

-- items(team_id, type): loadTeamAccess() reads the team's folder tree to
-- resolve grants. The existing items_team_seq index is on (team_id, seq), which
-- cannot serve a type filter, so this scanned every item in the team. It is
-- skipped entirely for a team with no grants — which is why the cost only
-- appeared the moment somebody first set a folder permission, and why it then
-- applied to every member's poll, every 30 seconds, forever.
CREATE INDEX IF NOT EXISTS items_team_type ON items(team_id, type);
