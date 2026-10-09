-- Every team publishes somewhere.
--
-- A team with no target used to fall back to each member's own account, so a
-- shared build lived wherever its last editor published it: X shares a link, Y
-- edits the build, Y's publish lands in Y's account, and X's link never shows
-- the edit. New teams now start out publishing to their creator (teams.js
-- createTeam). This gives the teams that predate that the same answer: the
-- creator if they are still an owner, otherwise the longest-standing owner.
-- Members are added to that repo as collaborators by the owner's app.
-- Two passes because SQLite can't order a correlated subquery by the outer row.
UPDATE teams
   SET publish_owner = (
         SELECT i.login
           FROM memberships m
           JOIN identities i ON i.user_id = m.user_id AND i.provider = 'github'
          WHERE m.team_id = teams.id AND m.user_id = teams.created_by AND m.role = 'owner'),
       publish_owner_type = 'user'
 WHERE publish_owner IS NULL
   AND EXISTS (
         SELECT 1
           FROM memberships m
           JOIN identities i ON i.user_id = m.user_id AND i.provider = 'github'
          WHERE m.team_id = teams.id AND m.user_id = teams.created_by AND m.role = 'owner');

UPDATE teams
   SET publish_owner = (
         SELECT i.login
           FROM memberships m
           JOIN identities i ON i.user_id = m.user_id AND i.provider = 'github'
          WHERE m.team_id = teams.id AND m.role = 'owner'
          ORDER BY m.joined_at
          LIMIT 1),
       publish_owner_type = 'user'
 WHERE publish_owner IS NULL
   AND EXISTS (
         SELECT 1
           FROM memberships m
           JOIN identities i ON i.user_id = m.user_id AND i.provider = 'github'
          WHERE m.team_id = teams.id AND m.role = 'owner');
