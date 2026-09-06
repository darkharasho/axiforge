"use strict";
const { nowIso, json, errorResponse } = require("./db");
const { readJson } = require("./auth");
const { requireMembership } = require("./teams");
const { checkRateLimit } = require("./ratelimit");
const { loadTeamAccess, LEVELS, rank } = require("./access");

const MAX_BODY_BYTES = 1_500_000;
const MAX_PAGE = 200;
const MAX_BULK = 50;
const WRITES_PER_MIN = 120;
// Polling ceiling for the change log. Clients poll every 30s per team, so this
// is orders of magnitude above normal use; it exists so an authenticated client
// cannot hammer the change log. Generous enough that a full paginated resync of
// a very large team (MAX_PAGE items per request) still fits in one window.
const CHANGE_READS_PER_MIN = 240;
const TYPES = new Set(["folder", "build", "comp"]);

function bytes(str) { return new TextEncoder().encode(str).length; }

const LOGINS_CHUNK = 90; // stay well under D1's 100-bound-parameter-per-statement limit

async function loginsFor(env, userIds) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const map = new Map();
  for (let i = 0; i < ids.length; i += LOGINS_CHUNK) {
    const chunk = ids.slice(i, i + LOGINS_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await env.SYNC_DB.prepare(
      `SELECT user_id, login FROM identities WHERE user_id IN (${placeholders}) ORDER BY provider = 'github' DESC`
    ).bind(...chunk).all();
    for (const r of results) if (!map.has(r.user_id)) map.set(r.user_id, r.login);
  }
  return map;
}

function itemWire(row, logins) {
  return {
    id: row.id,
    type: row.type,
    parentId: row.parent_id,
    // A tombstone keeps its body on the server now (that is what backs the team
    // trash), but the changes feed must not start shipping it: clients branch on
    // `deleted` and would only pay for bytes they throw away. The trash endpoint
    // is the one place the retained body is handed out.
    body: row.deleted === 1 ? null : row.body ? JSON.parse(row.body) : null,
    version: row.version,
    seq: row.seq,
    deleted: row.deleted === 1,
    createdBy: { userId: row.created_by, login: logins.get(row.created_by) || null },
    updatedBy: { userId: row.updated_by, login: logins.get(row.updated_by) || null },
    updatedAt: row.updated_at,
  };
}

async function currentItem(env, teamId, itemId) {
  const row = await env.SYNC_DB.prepare("SELECT * FROM items WHERE team_id = ? AND id = ?").bind(teamId, itemId).first();
  if (!row) return null;
  return itemWire(row, await loginsFor(env, [row.created_by, row.updated_by]));
}

async function memberOr403(env, teamId, auth) {
  const m = await requireMembership(env, teamId, auth.user.id);
  if (!m) return { error: errorResponse("forbidden", "You are not a member of this team.") };
  const access = await loadTeamAccess(env, teamId, auth.user.id, m.role);
  return { membership: m, access };
}

async function writeLimited(env, deps, auth, cost = 1) {
  const rl = await checkRateLimit(env.SYNC_RL, `write:${auth.user.id}`, WRITES_PER_MIN, 60, deps, cost);
  if (rl.ok) return null;
  return errorResponse("rate_limited", "Too many changes too quickly. Try again shortly.", 429, { "Retry-After": String(rl.retryAfterSeconds) });
}

// Core write. Returns a plain result (not a Response) so bulk can reuse it.
async function writeItem(env, deps, auth, teamId, { itemId, type, parentId, body, baseVersion }, access = null) {
  if (!itemId || typeof itemId !== "string" || itemId.length > 64) return { status: 400, message: "Invalid item id." };
  if (!TYPES.has(type)) return { status: 400, message: `Invalid type "${type}".` };
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { status: 400, message: "body must be an object." };
  parentId = typeof parentId === "string" && parentId ? parentId : null;
  if (parentId === itemId) return { status: 400, message: "An item cannot be its own parent." };
  if (baseVersion !== null && baseVersion !== undefined && !(Number.isInteger(baseVersion) && baseVersion >= 1)) {
    return { status: 400, message: "baseVersion must be null or a positive integer." };
  }
  if (type === "comp" && body && "boonCoverageHtml" in body) {
    body = { ...body };
    delete body.boonCoverageHtml;
  }
  const text = JSON.stringify(body);
  if (bytes(text) > MAX_BODY_BYTES) {
    return { status: 413, message: `This ${type} (${itemId}) is too large to sync (limit ${MAX_BODY_BYTES / 1_000_000} MB).` };
  }
  if (parentId) {
    const parent = await env.SYNC_DB.prepare("SELECT type, deleted FROM items WHERE team_id = ? AND id = ?").bind(teamId, parentId).first();
    if (!parent || parent.deleted === 1 || parent.type !== "folder") return { status: 400, message: "parentId must be a live folder in this team." };
    if (type === "folder") {
      // Walk parent_id up from parentId; if we reach itemId, this move would
      // create a cycle (a folder becoming its own ancestor).
      let cursor = parentId;
      let hops = 0;
      while (cursor) {
        if (cursor === itemId) return { status: 400, message: "A folder cannot be moved inside itself." };
        hops += 1;
        if (hops > 64) return { status: 400, message: "A folder cannot be moved inside itself." };
        const row = await env.SYNC_DB.prepare(
          "SELECT parent_id FROM items WHERE team_id = ? AND id = ? AND deleted = 0"
        ).bind(teamId, cursor).first();
        cursor = row ? row.parent_id : null;
      }
    }
  }

  const db = env.SYNC_DB;
  const now = nowIso(deps);
  const existing = await db.prepare("SELECT version, deleted, type, parent_id FROM items WHERE team_id = ? AND id = ?").bind(teamId, itemId).first();
  const base = baseVersion ?? null;

  // Per-folder access. Three questions, because a folder can be governed by a
  // grant of its own AND by where it sits:
  //   * may I put things HERE (the destination)?
  //   * if this is a move, may I take things out of WHERE IT WAS?
  //   * may I touch this item at all (a folder with its own grant)?
  // For a build or a comp the first and third are the same question.
  if (access && !access.unrestricted) {
    const denied = (where) =>
      ({ status: 403, message: `You do not have permission to change ${where} in this team.` });
    if (rank(access.at(parentId)) < LEVELS.write) return denied("that folder");
    if (existing && existing.parent_id !== parentId && rank(access.at(existing.parent_id)) < LEVELS.write) {
      return denied("the folder it is in");
    }
    if (!access.canWrite({ id: itemId, type, parent_id: parentId })) return denied("this item");
  }

  const bump = db.prepare("UPDATE teams SET seq = seq + 1 WHERE id = ?").bind(teamId);
  const seqSub = "(SELECT seq FROM teams WHERE id = ?)";
  let write, created, isInsert;
  if (!existing) {
    if (base !== null) return { status: 409, current: null, message: "Item does not exist (baseVersion must be null to create)." };
    created = true;
    isInsert = true;
    write = db.prepare(
      `INSERT INTO items (team_id, id, type, parent_id, body, version, seq, deleted, created_by, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ${seqSub}, 0, ?, ?, ?)`
    ).bind(teamId, itemId, type, parentId, text, teamId, auth.user.id, auth.user.id, now);
  } else if (existing.deleted === 1) {
    if (base !== null) return { status: 409, current: await currentItem(env, teamId, itemId) };
    created = true;
    isInsert = false;
    write = db.prepare(
      `UPDATE items SET type = ?, parent_id = ?, body = ?, version = version + 1, seq = ${seqSub}, deleted = 0,
              created_by = ?, updated_by = ?, updated_at = ?
        WHERE team_id = ? AND id = ? AND deleted = 1`
    ).bind(type, parentId, text, teamId, auth.user.id, auth.user.id, now, teamId, itemId);
  } else {
    if (base === null || base !== existing.version) return { status: 409, current: await currentItem(env, teamId, itemId) };
    if (type !== existing.type) return { status: 400, message: `Cannot change item type from "${existing.type}" to "${type}".` };
    created = false;
    isInsert = false;
    write = db.prepare(
      `UPDATE items SET type = ?, parent_id = ?, body = ?, version = version + 1, seq = ${seqSub}, updated_by = ?, updated_at = ?
        WHERE team_id = ? AND id = ? AND version = ? AND deleted = 0`
    ).bind(type, parentId, text, teamId, auth.user.id, now, teamId, itemId, base);
  }
  const read = db.prepare("SELECT version, seq FROM items WHERE team_id = ? AND id = ?").bind(teamId, itemId);

  let results;
  try {
    results = await db.batch([bump, write, read]);
  } catch (err) {
    // Concurrent create on the same id → PK violation. Report as conflict.
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(err.message))) {
      return { status: 409, current: await currentItem(env, teamId, itemId) };
    }
    throw err;
  }
  if (!isInsert && results[1].meta.changes === 0) {
    // Lost the race between our SELECT and the guarded UPDATE — someone else already
    // wrote this row (either a version bump or an un-tombstone) between our read and
    // our batch. Report as a conflict rather than silently discarding our write.
    return { status: 409, current: await currentItem(env, teamId, itemId) };
  }
  const row = results[2].results[0];
  return { status: created ? 201 : 200, version: row.version, seq: row.seq };
}

// GET /teams/:teamId/changes?since=&limit=
async function getChanges(request, env, deps, auth, params) {
  const { error, membership, access } = await memberOr403(env, params.teamId, auth);
  if (error) return error;
  const rl = await checkRateLimit(env.SYNC_RL, `changes:${auth.user.id}`, CHANGE_READS_PER_MIN, 60, deps);
  if (!rl.ok) return errorResponse("rate_limited", "Too many sync requests. Try again shortly.", 429, { "Retry-After": String(rl.retryAfterSeconds) });
  const url = new URL(request.url);
  const since = Number(url.searchParams.get("since") || 0);
  const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : MAX_PAGE;
  if (!Number.isInteger(since) || since < 0) return errorResponse("invalid", "since must be a non-negative integer.");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) return errorResponse("invalid", `limit must be 1–${MAX_PAGE}.`);
  // A purge may have removed tombstones the client hasn't seen yet — if its
  // cursor sits inside the purged range, incremental sync would silently miss
  // those deletes. Tell it to do a full resync instead. `since = 0` (a client
  // starting fresh) never needs this — it will see current state either way.
  // Two reasons to demand a full re-pull. A purge removed tombstones this client
  // never saw, so incremental sync would silently miss those deletes. Or the
  // owner changed what this member may see: losing read access produces no item
  // event at all — the items did not change, they simply stop being handed out —
  // so only a re-pull from 0, and the prune that follows it, can reconcile.
  if (since > 0 && (since < membership.team.purged_seq || since < (membership.grants_seq || 0))) {
    return json({ resync: true, items: [], nextSeq: since, hasMore: false });
  }
  const { results } = await env.SYNC_DB.prepare(
    "SELECT * FROM items WHERE team_id = ? AND seq > ? ORDER BY seq LIMIT ?"
  ).bind(params.teamId, since, limit + 1).all();
  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  // `nextSeq` is taken from the RAW page, before filtering: the cursor tracks how
  // far through the change log we have read, not how much of it we handed over.
  // A page that filters down to nothing still advances, so a member walled out of
  // a busy folder does not stall.
  const nextSeq = page.length ? page[page.length - 1].seq : since;
  const visible = access.unrestricted ? page : page.filter((r) => access.canRead(r));
  const logins = await loginsFor(env, visible.flatMap((r) => [r.created_by, r.updated_by]));
  return json({
    resync: false,
    items: visible.map((r) => itemWire(r, logins)),
    nextSeq,
    hasMore,
  });
}

// Reject an oversize request before buffering/parsing its body. `content-length`
// is attacker-controlled (can be absent or wrong), so this is a cheap early-out,
// not the authoritative check — the real limit is enforced on the parsed body.
function contentLengthTooLarge(request, maxBytes) {
  const len = Number(request.headers.get("content-length") || 0);
  return Number.isFinite(len) && len > maxBytes;
}

// PUT /teams/:teamId/items/:itemId
async function putItem(request, env, deps, auth, params) {
  const { error, access } = await memberOr403(env, params.teamId, auth);
  if (error) return error;
  if (contentLengthTooLarge(request, MAX_BODY_BYTES * 1.1)) {
    return errorResponse("too_large", `Request body is too large (limit ${MAX_BODY_BYTES / 1_000_000} MB).`);
  }
  const limited = await writeLimited(env, deps, auth);
  if (limited) return limited;
  const body = await readJson(request);
  if (!body) return errorResponse("invalid", "Invalid JSON.");
  const result = await writeItem(env, deps, auth, params.teamId, { ...body, itemId: params.itemId }, access);
  return writeResultResponse(result);
}

function writeResultResponse(result) {
  if (result.status === 201 || result.status === 200) return json({ version: result.version, seq: result.seq }, result.status);
  if (result.status === 409) return json({ error: { code: "conflict", message: result.message || "Item was changed by someone else." }, current: result.current }, 409);
  if (result.status === 413) return errorResponse("too_large", result.message);
  if (result.status === 403) return errorResponse("forbidden", result.message);
  if (result.status === 404) return errorResponse("not_found", result.message);
  return errorResponse("invalid", result.message || "Invalid request.");
}

// Collect a folder's live descendants (folders + items) via parent_id.
async function collectTree(env, teamId, rootId) {
  const { results } = await env.SYNC_DB.prepare(
    "SELECT id, type, parent_id, created_by, version FROM items WHERE team_id = ? AND deleted = 0"
  ).bind(teamId).all();
  const byParent = new Map();
  for (const r of results) {
    const list = byParent.get(r.parent_id) || [];
    list.push(r);
    byParent.set(r.parent_id, list);
  }
  const out = [];
  const visited = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const pid = queue.shift();
    for (const child of byParent.get(pid) || []) {
      if (visited.has(child.id)) continue; // cycle guard: never revisit a node
      visited.add(child.id);
      out.push(child);
      if (child.type === "folder") queue.push(child.id);
    }
  }
  return out;
}

// DELETE /teams/:teamId/items/:itemId?baseVersion=N
async function deleteItem(request, env, deps, auth, params) {
  const { error, membership, access } = await memberOr403(env, params.teamId, auth);
  if (error) return error;
  const limited = await writeLimited(env, deps, auth);
  if (limited) return limited;
  const baseVersion = Number(new URL(request.url).searchParams.get("baseVersion"));
  if (!Number.isInteger(baseVersion) || baseVersion < 1) return errorResponse("invalid", "baseVersion query param is required.");

  const db = env.SYNC_DB;
  const row = await db.prepare("SELECT * FROM items WHERE team_id = ? AND id = ?").bind(params.teamId, params.itemId).first();
  if (!row || row.deleted === 1) return errorResponse("not_found", "Item not found.");
  // An item you cannot see must answer the same as one that is not there —
  // otherwise the 403/404 split tells you exactly what lives in the folder you
  // were walled out of.
  if (!access.unrestricted && !access.canRead(row)) return errorResponse("not_found", "Item not found.");
  if (row.version !== baseVersion) {
    return json({ error: { code: "conflict", message: "Item was changed since you last saw it." }, current: await currentItem(env, params.teamId, params.itemId) }, 409);
  }
  const isOwner = membership.role === "owner";
  const descendants = row.type === "folder" ? await collectTree(env, params.teamId, row.id) : [];
  if (!isOwner) {
    // Every row the cascade would take has to be one this user may delete —
    // either granted outright, or created by them. A folder delete is all or
    // nothing on purpose: half-deleting somebody's subtree is worse than
    // refusing, and it is the refusal that explains itself.
    const blocked = [row, ...descendants].find((r) => !access.canDelete(r, auth.user.id));
    if (blocked) {
      return errorResponse(
        "forbidden",
        blocked === row
          ? "You do not have permission to delete this."
          : "This folder contains items you do not have permission to delete."
      );
    }
  }

  const now = nowIso(deps);
  // The id of the item actually deleted. Descendants of a folder delete carry
  // the same batch, so the trash can show the one folder the user removed and
  // restore the whole subtree as a single act. @see listTrash / restoreItem
  const batch = row.id;
  const stmts = [];
  // Only the root row is guarded by baseVersion — a client can only have seen
  // (and thus can only race on) the version it read for the item it asked to
  // delete. Descendants are collateral and carry no version guard of their own.
  // Descendants only flip if the root actually flipped in this same batch:
  // every descendant statement (and its seq bump) is conditioned on the root
  // row now being tombstoned at baseVersion + 1 by this request. If the root
  // guard misses, the whole cascade is a no-op and we report 409 with no
  // partial tombstones left behind.
  const rootFlipped = "EXISTS (SELECT 1 FROM items WHERE team_id = ? AND id = ? AND deleted = 1 AND version = ? AND updated_by = ? AND updated_at = ?)";
  const rootFlippedArgs = [params.teamId, row.id, baseVersion + 1, auth.user.id, now];
  let rootUpdateIndex = -1;
  for (const r of [row, ...descendants]) {
    const isRoot = r.id === row.id;
    if (isRoot) {
      stmts.push(db.prepare("UPDATE teams SET seq = seq + 1 WHERE id = ?").bind(params.teamId));
      rootUpdateIndex = stmts.length;
      stmts.push(db.prepare(
        `UPDATE items SET deleted = 1, version = version + 1, seq = (SELECT seq FROM teams WHERE id = ?), updated_by = ?, updated_at = ?,
                deleted_at = ?, deleted_by = ?, delete_batch = ?
          WHERE team_id = ? AND id = ? AND deleted = 0 AND version = ?`
      ).bind(params.teamId, auth.user.id, now, now, auth.user.id, batch, params.teamId, r.id, baseVersion));
    } else {
      stmts.push(db.prepare(`UPDATE teams SET seq = seq + 1 WHERE id = ? AND ${rootFlipped}`).bind(params.teamId, ...rootFlippedArgs));
      stmts.push(db.prepare(
        `UPDATE items SET deleted = 1, version = version + 1, seq = (SELECT seq FROM teams WHERE id = ?), updated_by = ?, updated_at = ?,
                deleted_at = ?, deleted_by = ?, delete_batch = ?
          WHERE team_id = ? AND id = ? AND deleted = 0 AND ${rootFlipped}`
      ).bind(params.teamId, auth.user.id, now, now, auth.user.id, batch, params.teamId, r.id, ...rootFlippedArgs));
    }
  }
  stmts.push(db.prepare("SELECT version, seq FROM items WHERE team_id = ? AND id = ?").bind(params.teamId, params.itemId));
  const results = await db.batch(stmts);
  if (results[rootUpdateIndex].meta.changes === 0) {
    // Lost the race between our pre-read and this batch — someone else wrote
    // the root item in between. The descendant statements were conditioned on
    // the root flip, so nothing was tombstoned.
    return json({ error: { code: "conflict", message: "Item was changed since you last saw it." }, current: await currentItem(env, params.teamId, params.itemId) }, 409);
  }
  const out = results[results.length - 1].results[0];
  return json({ version: out.version, seq: out.seq });
}

const MAX_BULK_BODY_BYTES = 16_000_000;

// POST /teams/:teamId/items:bulk { items: [...] }
async function bulkItems(request, env, deps, auth, params) {
  const { error, access } = await memberOr403(env, params.teamId, auth);
  if (error) return error;
  if (contentLengthTooLarge(request, MAX_BULK_BODY_BYTES)) {
    return errorResponse("too_large", `Request body is too large (limit ${MAX_BULK_BODY_BYTES / 1_000_000} MB).`);
  }
  const body = await readJson(request);
  const list = body && Array.isArray(body.items) ? body.items : null;
  if (!list) return errorResponse("invalid", "items must be an array.");
  if (list.length > MAX_BULK) return errorResponse("invalid", `At most ${MAX_BULK} items per bulk request.`);
  // Charge the rate limiter once per item (after validating the list) so a bulk
  // request cannot be used to write far more than WRITES_PER_MIN items per minute.
  const limited = await writeLimited(env, deps, auth, list.length);
  if (limited) return limited;
  const results = [];
  for (const entry of list) {
    const r = await writeItem(env, deps, auth, params.teamId, entry || {}, access);
    results.push({ itemId: entry && entry.itemId, status: r.status, version: r.version, seq: r.seq, current: r.current, message: r.message });
  }
  return json({ results });
}

// ── Team trash ────────────────────────────────────────────────────────────────
//
// A delete used to be final for everyone the moment it synced. Now the tombstone
// keeps its body for the retention window purgeTombstones already enforced, so
// the team can undo one — including the teammate who was offline when it
// happened, or who joined afterwards, neither of whom has a local copy to
// restore from.

const MAX_TRASH = 500;

/**
 * One row per thing somebody actually deleted.
 *
 * Deleting a folder cascades to its subtree, so the descendants are tombstoned
 * under the same `delete_batch` as the folder. Listing them all would show a
 * teammate twenty rows for one act; a batch root is the row whose batch is its
 * own id, and that is the only kind listed.
 *
 * GET /teams/:teamId/trash
 */
async function listTrash(request, env, deps, auth, params) {
  const { membership, access, error } = await memberOr403(env, params.teamId, auth);
  if (error) return error;

  const { results } = await env.SYNC_DB.prepare(
    `SELECT id, type, parent_id, body, version, deleted_at, deleted_by, delete_batch,
            (SELECT COUNT(*) FROM items d
              WHERE d.team_id = i.team_id AND d.deleted = 1 AND d.delete_batch = i.delete_batch AND d.id <> i.id) AS carried,
            (SELECT COUNT(*) FROM items d
              WHERE d.team_id = i.team_id AND d.deleted = 1 AND d.delete_batch = i.delete_batch AND d.created_by <> ?) AS not_mine
       FROM items i
      WHERE i.team_id = ? AND i.deleted = 1 AND i.delete_batch = i.id
      ORDER BY i.deleted_at DESC
      LIMIT ?`
  ).bind(auth.user.id, params.teamId, MAX_TRASH).all();

  const isOwner = membership.role === "owner";
  // A deleted item is still governed by where it was. Somebody walled out of a
  // folder should not learn its contents from the trash listing.
  const rows = access.unrestricted ? results : results.filter((r) => access.canRead(r));
  const logins = await loginsFor(env, rows.map((r) => r.deleted_by).filter(Boolean));
  return json({
    items: rows.map((row) => {
      const body = row.body ? JSON.parse(row.body) : null;
      return {
        id: row.id,
        type: row.type,
        parentId: row.parent_id,
        // Just enough to render a row. The full body comes back on restore.
        name: (body && (body.title || body.name)) || null,
        version: row.version,
        carried: row.carried,
        deletedAt: row.deleted_at,
        deletedBy: { userId: row.deleted_by, login: logins.get(row.deleted_by) || null },
        // The client cannot work the rule out for itself — it does not know who
        // created each descendant of a folder delete — and a Put Back button
        // that answers 403 is worse than one that explains itself. Same rule as
        // restoreItem below; keep the two in step.
        canRestore: isOwner
          || (access.canWrite(row) && (row.deleted_by === auth.user.id || row.not_mine === 0)),
      };
    }),
  });
}

/**
 * Put a deleted item — and everything its delete took with it — back.
 *
 * Every restored row gets its own version and seq bump, so it reaches other
 * clients through the ordinary changes feed as a normal write. There is no
 * baseVersion guard: a tombstone cannot be concurrently edited, and the only
 * race worth caring about (someone re-creating the id with a PUT) already
 * un-deletes the row, after which this is a no-op.
 *
 * POST /teams/:teamId/trash/:itemId/restore
 */
async function restoreItem(request, env, deps, auth, params) {
  const { membership, access, error } = await memberOr403(env, params.teamId, auth);
  if (error) return error;
  const limited = await writeLimited(env, deps, auth);
  if (limited) return limited;

  const db = env.SYNC_DB;
  const row = await db.prepare(
    "SELECT * FROM items WHERE team_id = ? AND id = ? AND deleted = 1"
  ).bind(params.teamId, params.itemId).first();
  if (!row) return errorResponse("not_found", "Nothing deleted with that id.");
  if (!access.unrestricted && !access.canRead(row)) return errorResponse("not_found", "Nothing deleted with that id.");
  if (!row.body) {
    // Tombstoned before this feature existed, so the content is genuinely gone.
    return errorResponse("not_found", "That item was deleted before the team trash existed, so there is nothing left to restore.");
  }

  const batch = row.delete_batch || row.id;
  const { results: members } = await db.prepare(
    "SELECT id, created_by FROM items WHERE team_id = ? AND deleted = 1 AND delete_batch = ?"
  ).bind(params.teamId, batch).all();

  // Same rule as deleting, plus the person who deleted it — undoing your own
  // action should never need the owner.
  const isOwner = membership.role === "owner";
  const deletedIt = row.deleted_by === auth.user.id;
  if (!isOwner) {
    // Putting something back is a write, so it needs write access where it will
    // land — having deleted it yourself does not survive losing access since.
    if (!access.canWrite(row)) {
      return errorResponse("forbidden", "You do not have permission to put things back in that folder.");
    }
    if (!deletedIt && members.some((r) => r.created_by !== auth.user.id)) {
      return errorResponse("forbidden", "Only the team owner, the item's creator, or whoever deleted it can restore it.");
    }
  }

  const now = nowIso(deps);
  const stmts = [];
  for (const member of members) {
    stmts.push(db.prepare("UPDATE teams SET seq = seq + 1 WHERE id = ?").bind(params.teamId));
    stmts.push(db.prepare(
      `UPDATE items SET deleted = 0, version = version + 1, seq = (SELECT seq FROM teams WHERE id = ?),
              updated_by = ?, updated_at = ?, deleted_at = NULL, deleted_by = NULL, delete_batch = NULL
        WHERE team_id = ? AND id = ? AND deleted = 1`
    ).bind(params.teamId, auth.user.id, now, params.teamId, member.id));
  }
  stmts.push(db.prepare("SELECT version, seq FROM items WHERE team_id = ? AND id = ?").bind(params.teamId, params.itemId));
  const out = (await db.batch(stmts)).at(-1).results[0];
  return json({ version: out.version, seq: out.seq, restored: members.map((m) => m.id) });
}

module.exports = { getChanges, putItem, deleteItem, bulkItems, listTrash, restoreItem, writeItem, itemWire, MAX_BODY_BYTES, MAX_PAGE, MAX_BULK, MAX_BULK_BODY_BYTES, MAX_TRASH };
