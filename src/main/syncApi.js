"use strict";
// Thin client for the team-sync Worker (workers/sync). Every failure is a
// SyncApiError with a stable `code` so the engine can branch without parsing
// messages. Network errors and 5xx are both SYNC_OFFLINE: "retry later".

const DEFAULT_BASE_URL = "https://build.axi.link/api/sync";

const CODE_BY_STATUS = {
  400: "SYNC_INVALID",
  401: "SYNC_UNAUTHORIZED",
  403: "SYNC_FORBIDDEN",
  404: "SYNC_NOT_FOUND",
  409: "SYNC_CONFLICT",
  413: "SYNC_TOO_LARGE",
  429: "SYNC_RATE_LIMITED",
};

class SyncApiError extends Error {
  constructor(code, message, { status = 0, current = null, retryAfterMs = null } = {}) {
    super(message);
    this.name = "SyncApiError";
    this.code = code;
    this.status = status;
    this.current = current;
    this.retryAfterMs = retryAfterMs;
  }
}

class SyncApi {
  constructor({ baseUrl, getToken, fetchImpl, userAgent } = {}) {
    this.baseUrl = (baseUrl || process.env.AXIFORGE_SYNC_BASE || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.getToken = getToken || (async () => null);
    this.fetchImpl = fetchImpl || ((...a) => fetch(...a));
    this.userAgent = userAgent || "AxiForge";
  }

  async #request(method, path, { body, auth = true, query } = {}) {
    const url = new URL(this.baseUrl + path);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = { Accept: "application/json", "User-Agent": this.userAgent };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      const token = await this.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    let res;
    try {
      res = await this.fetchImpl(url.toString(), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (err) {
      throw new SyncApiError("SYNC_OFFLINE", `Network error: ${err.message}`, { status: 0 });
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = null; } }
    if (res.ok) return data;
    const code = CODE_BY_STATUS[res.status] || "SYNC_OFFLINE";
    const message = (data && data.error && data.error.message) || `Sync server error ${res.status}`;
    const retryAfter = res.headers && res.headers.get ? res.headers.get("retry-after") : null;
    throw new SyncApiError(code, message, {
      status: res.status,
      current: data && data.current ? data.current : null,
      retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : null,
    });
  }

  loginGithub(githubToken) { return this.#request("POST", "/auth/github", { body: { token: githubToken }, auth: false }); }
  logout() { return this.#request("DELETE", "/auth/session"); }

  // `opts.id` asks the server to use a client-chosen team id (migration reuses
  // the legacy shared folder's id so teammates re-link in place). The server
  // may ignore it or answer 409 if it is taken.
  createTeam(name, opts = {}) { return this.#request("POST", "/teams", { body: { name, ...(opts && opts.id ? { id: opts.id } : {}) } }); }
  joinTeam(inviteCode) { return this.#request("POST", "/teams/join", { body: { inviteCode } }); }
  listTeams() { return this.#request("GET", "/teams"); }
  listMembers(teamId) { return this.#request("GET", `/teams/${encodeURIComponent(teamId)}/members`); }
  removeMember(teamId, userId) { return this.#request("DELETE", `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`); }
  rotateInvite(teamId) { return this.#request("POST", `/teams/${encodeURIComponent(teamId)}/invite/rotate`); }
  renameTeam(teamId, name) { return this.#request("PATCH", `/teams/${encodeURIComponent(teamId)}`, { body: { name } }); }
  deleteTeam(teamId) { return this.#request("DELETE", `/teams/${encodeURIComponent(teamId)}`); }

  // Per-folder access. A member is served only their own rows; an owner gets the
  // whole team's, which is what the access editor lists.
  listGrants(teamId) { return this.#request("GET", `/teams/${encodeURIComponent(teamId)}/grants`); }
  setGrant(teamId, folderId, userId, access) {
    return this.#request("PUT", `/teams/${encodeURIComponent(teamId)}/grants/${encodeURIComponent(folderId)}/${encodeURIComponent(userId)}`, { body: { access } });
  }
  clearGrant(teamId, folderId, userId) {
    return this.#request("DELETE", `/teams/${encodeURIComponent(teamId)}/grants/${encodeURIComponent(folderId)}/${encodeURIComponent(userId)}`);
  }

  changes(teamId, since, limit = 200) { return this.#request("GET", `/teams/${encodeURIComponent(teamId)}/changes`, { query: { since, limit } }); }
  putItem(teamId, itemId, payload) { return this.#request("PUT", `/teams/${encodeURIComponent(teamId)}/items/${encodeURIComponent(itemId)}`, { body: payload }); }
  deleteItem(teamId, itemId, baseVersion) { return this.#request("DELETE", `/teams/${encodeURIComponent(teamId)}/items/${encodeURIComponent(itemId)}`, { query: { baseVersion } }); }
  bulk(teamId, items) { return this.#request("POST", `/teams/${encodeURIComponent(teamId)}/items:bulk`, { body: { items } }); }

  // The shared team trash. Unlike every other read here this one is not part of
  // the sync loop — it is only fetched when somebody opens the trash — so it has
  // no cursor and no incremental form.
  listTrash(teamId) { return this.#request("GET", `/teams/${encodeURIComponent(teamId)}/trash`); }
  restoreItem(teamId, itemId) { return this.#request("POST", `/teams/${encodeURIComponent(teamId)}/trash/${encodeURIComponent(itemId)}/restore`); }
}

module.exports = { SyncApi, SyncApiError, DEFAULT_BASE_URL };
