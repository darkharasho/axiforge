"use strict";
const { nowIso, json, errorResponse } = require("./db");
const { readJson } = require("./auth");
const { requireMembership } = require("./teams");
const { checkRateLimit } = require("./ratelimit");

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
    body: row.body ? JSON.parse(row.body) : null,
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
  return { membership: m };
}

async function writeLimited(env, deps, auth, cost = 1) {
  const rl = await checkRateLimit(env.SYNC_RL, `write:${auth.user.id}`, WRITES_PER_MIN, 60, deps, cost);
  if (rl.ok) return null;
  return errorResponse("rate_limited", "Too many changes too quickly. Try again shortly.", 429, { "Retry-After": String(rl.retryAfterSeconds) });
}

// Core write. Returns a plain result (not a Response) so bulk can reuse it.
async function writeItem(env, deps, auth, teamId, { itemId, type, parentId, body, baseVersion }) {
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
  const existing = await db.prepare("SELECT version, deleted, type FROM items WHERE team_id = ? AND id = ?").bind(teamId, itemId).first();
  const base = baseVersion ?? null;

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
  const { error, membership } = await memberOr403(env, params.teamId, auth);
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
  if (since > 0 && since < membership.team.purged_seq) {
    return json({ resync: true, items: [], nextSeq: since, hasMore: false });
  }
  const { results } = await env.SYNC_DB.prepare(
    "SELECT * FROM items WHERE team_id = ? AND seq > ? ORDER BY seq LIMIT ?"
  ).bind(params.teamId, since, limit + 1).all();
  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  const logins = await loginsFor(env, page.flatMap((r) => [r.created_by, r.updated_by]));
  return json({
    resync: false,
    items: page.map((r) => itemWire(r, logins)),
    nextSeq: page.length ? page[page.length - 1].seq : since,
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
  const { error } = await memberOr403(env, params.teamId, auth);
  if (error) return error;
  if (contentLengthTooLarge(request, MAX_BODY_BYTES * 1.1)) {
    return errorResponse("too_large", `Request body is too large (limit ${MAX_BODY_BYTES / 1_000_000} MB).`);
  }
  const limited = await writeLimited(env, deps, auth);
  if (limited) return limited;
  const body = await readJson(request);
  if (!body) return errorResponse("invalid", "Invalid JSON.");
  const result = await writeItem(env, deps, auth, params.teamId, { ...body, itemId: params.itemId });
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
  const { error, membership } = await memberOr403(env, params.teamId, auth);
  if (error) return error;
  const limited = await writeLimited(env, deps, auth);
  if (limited) return limited;
  const baseVersion = Number(new URL(request.url).searchParams.get("baseVersion"));
  if (!Number.isInteger(baseVersion) || baseVersion < 1) return errorResponse("invalid", "baseVersion query param is required.");

  const db = env.SYNC_DB;
  const row = await db.prepare("SELECT * FROM items WHERE team_id = ? AND id = ?").bind(params.teamId, params.itemId).first();
  if (!row || row.deleted === 1) return errorResponse("not_found", "Item not found.");
  if (row.version !== baseVersion) {
    return json({ error: { code: "conflict", message: "Item was changed since you last saw it." }, current: await currentItem(env, params.teamId, params.itemId) }, 409);
  }
  const isOwner = membership.role === "owner";
  const descendants = row.type === "folder" ? await collectTree(env, params.teamId, row.id) : [];
  if (!isOwner) {
    const notMine = [row, ...descendants].some((r) => r.created_by !== auth.user.id);
    if (notMine) return errorResponse("forbidden", "Only the team owner or the item's creator can delete it.");
  }

  const now = nowIso(deps);
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
        `UPDATE items SET deleted = 1, body = NULL, version = version + 1, seq = (SELECT seq FROM teams WHERE id = ?), updated_by = ?, updated_at = ?
          WHERE team_id = ? AND id = ? AND deleted = 0 AND version = ?`
      ).bind(params.teamId, auth.user.id, now, params.teamId, r.id, baseVersion));
    } else {
      stmts.push(db.prepare(`UPDATE teams SET seq = seq + 1 WHERE id = ? AND ${rootFlipped}`).bind(params.teamId, ...rootFlippedArgs));
      stmts.push(db.prepare(
        `UPDATE items SET deleted = 1, body = NULL, version = version + 1, seq = (SELECT seq FROM teams WHERE id = ?), updated_by = ?, updated_at = ?
          WHERE team_id = ? AND id = ? AND deleted = 0 AND ${rootFlipped}`
      ).bind(params.teamId, auth.user.id, now, params.teamId, r.id, ...rootFlippedArgs));
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
  const { error } = await memberOr403(env, params.teamId, auth);
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
    const r = await writeItem(env, deps, auth, params.teamId, entry || {});
    results.push({ itemId: entry && entry.itemId, status: r.status, version: r.version, seq: r.seq, current: r.current, message: r.message });
  }
  return json({ results });
}

module.exports = { getChanges, putItem, deleteItem, bulkItems, writeItem, itemWire, MAX_BODY_BYTES, MAX_PAGE, MAX_BULK, MAX_BULK_BODY_BYTES };
