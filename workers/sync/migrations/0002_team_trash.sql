-- Shared team trash.
--
-- A delete used to be final for everyone the moment it synced: the row was
-- tombstoned and `body` was set to NULL, so the content was gone from the
-- server and the only copy left anywhere was whatever each client happened to
-- still hold locally. A teammate who was offline, or who joined afterwards, had
-- nothing to restore from at all.
--
-- Keeping the body for the tombstone's lifetime turns a delete into something
-- the team can undo. The retention window already exists — purgeTombstones has
-- always dropped tombstones after 30 days — so this costs nothing beyond the
-- rows already being kept.
--
-- deleted_at / deleted_by are separate from updated_at / updated_by because a
-- restore bumps the update stamps, and the trash listing needs "who deleted
-- this, and when" to survive that.
--
-- delete_batch holds the id of the item that was ACTUALLY deleted. Deleting a
-- folder cascades to its whole subtree, and the trash should show the one
-- folder the user removed rather than a row per descendant — so a batch root is
-- simply a row where delete_batch = id, and restoring one restores the batch.
ALTER TABLE items ADD COLUMN deleted_at TEXT;
ALTER TABLE items ADD COLUMN deleted_by TEXT;
ALTER TABLE items ADD COLUMN delete_batch TEXT;

CREATE INDEX IF NOT EXISTS items_team_deleted ON items(team_id, deleted, deleted_at);
