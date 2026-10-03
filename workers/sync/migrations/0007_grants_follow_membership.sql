-- A grant is a sentence about one person's place in one team. Clean up the ones
-- that lost their subject.
--
-- `folder_grants` was never tied to `memberships`: removing somebody from a team
-- deleted the membership and left their grants standing, and promoting somebody
-- to owner left theirs standing too. Neither row can be reached from the access
-- editor afterwards — a non-member is not in the people list, and a grant
-- against an owner is deliberately never offered, because an owner can hand any
-- grant back in the same breath. So an owner could add a person's permissions
-- and then not remove them (issue #317), and a rejoin or a demotion silently put
-- the old row back into force.
--
-- teams.js now deletes these with the membership change that orphans them. This
-- is the one-off sweep for the rows earlier versions already stranded.
--
-- '*' is the folder's blanket level rather than a person, so it has no
-- membership to follow and must survive. @see migration 0004.
DELETE FROM folder_grants
 WHERE user_id <> '*'
   AND NOT EXISTS (
     SELECT 1 FROM memberships m
      WHERE m.team_id = folder_grants.team_id
        AND m.user_id = folder_grants.user_id
        AND m.role <> 'owner'
   );
