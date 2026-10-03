/**
 * @jest-environment jsdom
 *
 * The access editor against the real Worker, end to end.
 *
 * Every layer of the grant path is covered on its own — the modal with a mocked
 * desktopApi, the Worker with a real D1 — and every one of those suites passes
 * while issue #317 is reported from the field: a per-person permission that is
 * removed comes back when the dialog is reopened. A bug that survives green
 * unit tests on both sides lives in what they do NOT share: the folder KEY the
 * UI writes, the id the Worker stores it under, and the id it reads back.
 *
 * So this suite wires the two halves together with nothing faked in between —
 * the real team-modal, the real teams.js handlers, a real SQLite — and performs
 * the gesture a person performs, including closing and reopening the dialog,
 * which is the only way the reported symptom can be observed at all.
 */
"use strict";

// jsdom ships none of the platform pieces the Worker runtime takes for granted,
// and undici needs the text codecs in place before it will even load.
const { TextDecoder, TextEncoder } = require("node:util");
if (typeof global.TextDecoder === "undefined") global.TextDecoder = TextDecoder;
if (typeof global.TextEncoder === "undefined") global.TextEncoder = TextEncoder;
for (const [name, value] of Object.entries(require("node:stream/web"))) {
  if (typeof global[name] === "undefined") global[name] = value;
}
if (typeof global.MessageChannel === "undefined") {
  ({ MessageChannel: global.MessageChannel, MessagePort: global.MessagePort } = require("node:worker_threads"));
}

const { Request: UndiciRequest, Response: UndiciResponse } = require("undici");

// jsdom provides neither, and the Worker handlers are written against both.
if (typeof global.Request === "undefined") global.Request = UndiciRequest;
if (typeof global.Response === "undefined") global.Response = UndiciResponse;

jest.mock("../../src/renderer/modules/state.js", () => ({
  state: { folders: [], teams: [], teamSession: null },
}));
jest.mock("../../src/renderer/modules/confirm-modal.js", () => ({
  showConfirmModal: jest.fn(async () => true),
}));
jest.mock("../../src/renderer/modules/prompt-modal.js", () => ({
  showPrompt: jest.fn(async () => null),
}));
jest.mock("../../src/renderer/modules/teams.js", () => {
  const { state } = require("../../src/renderer/modules/state.js");
  return {
    loadTeamState: jest.fn(async () => {}),
    rootForTeam: (teamId) => state.folders.find((f) => f.teamId === teamId) || null,
  };
});

const teams = require("../../workers/sync/src/teams");
const items = require("../../workers/sync/src/items");
const { createTestD1, createTestKV } = require("../helpers/d1Shim");
const { state } = require("../../src/renderer/modules/state.js");
const { initTeamModal, openTeamModal, closeTeamModal } =
  require("../../src/renderer/modules/team-modal.js");

const NOW = "2026-10-03T12:00:00.000Z";
const flush = () => new Promise((r) => setTimeout(r, 0));
/** Three turns: the handler awaits the write, then the re-read, then renders. */
const settle = async () => { await flush(); await flush(); await flush(); };

let ctx;

async function server() {
  const db = createTestD1();
  await db.applyMigrations();
  for (const [id, login] of [["u-owner", "owner"], ["u-mem", "vette"], ["u-two", "aria"]]) {
    await db.prepare("INSERT INTO users (id, display_name, avatar_url, created_at) VALUES (?, ?, NULL, ?)")
      .bind(id, login, NOW).run();
    await db.prepare("INSERT INTO identities (provider, provider_user_id, user_id, login) VALUES ('github', ?, ?, ?)")
      .bind(id, id, login).run();
  }
  const env = { SYNC_DB: db, SYNC_RL: createTestKV() };
  const deps = { now: () => Date.parse(NOW) };
  const auth = { user: { id: "u-owner", login: "owner", displayName: "owner", avatarUrl: null } };
  const req = (method, body) => new Request("https://x/api/sync/x", {
    method,
    headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const { team } = await (await teams.createTeam(req("POST", { name: "EWW" }), env, deps, auth, {})).json();
  for (const [id, login] of [["u-mem", "vette"], ["u-two", "aria"]]) {
    await teams.joinTeam(req("POST", { inviteCode: team.inviteCode }), env, deps,
      { user: { id, login, displayName: login, avatarUrl: null } }, {});
  }

  // The shared tree, created the way the app creates it: root → Raids → Squads.
  await items.putItem(req("PUT", { type: "folder", parentId: null, body: { name: "Raids" } }),
    env, deps, auth, { teamId: team.id, itemId: "raids" });
  await items.putItem(req("PUT", { type: "folder", parentId: "raids", body: { name: "Squads" } }),
    env, deps, auth, { teamId: team.id, itemId: "squads" });

  return { env, deps, auth, req, team, db };
}

/**
 * window.desktopApi, backed by the Worker instead of by jest.fn().
 *
 * Deliberately the same two-line routing the main process does — `"inherit"`
 * means clear — so the only thing this bridge can get wrong is what the real
 * client gets wrong. @see TeamSync#setGrant
 */
function bridge(s) {
  const unwrap = async (res) => {
    if (res.status === 204) return null;
    const body = await res.json();
    if (res.status >= 400) throw new Error(body?.error?.message || `status ${res.status}`);
    return body;
  };
  return {
    listTeamMembers: async (teamId) =>
      unwrap(await teams.listMembers(s.req("GET"), s.env, s.deps, s.auth, { teamId })),
    listTeamGrants: async (teamId) =>
      unwrap(await teams.listGrants(s.req("GET"), s.env, s.deps, s.auth, { teamId })),
    setTeamGrant: async (teamId, folderId, userId, access) => unwrap(
      access === "inherit"
        ? await teams.clearGrant(s.req("DELETE"), s.env, s.deps, s.auth, { teamId, folderId, userId })
        : await teams.setGrant(s.req("PUT", { access }), s.env, s.deps, s.auth, { teamId, folderId, userId })
    ),
    removeTeamMember: async (teamId, userId) =>
      unwrap(await teams.removeMember(s.req("DELETE"), s.env, s.deps, s.auth, { teamId, userId })),
    listTargets: async () => [],
    writeClipboardText: async () => {},
    pullTeam: async () => {},
    rotateInvite: async () => ({ inviteCode: "X" }),
    renameTeam: async () => {},
    deleteTeam: async () => {},
    leaveTeam: async () => {},
    setTeamPublishOwner: async () => ({ team: { id: s.team.id, name: "EWW" }, role: "owner" }),
  };
}

beforeEach(async () => {
  const s = await server();
  ctx = s;
  window.desktopApi = bridge(s);
  state.folders = [
    { id: "local-root", name: "EWW", parentId: null, shared: true, teamId: s.team.id, role: "owner" },
    { id: "raids", name: "Raids", parentId: "local-root", sortOrder: 0 },
    { id: "squads", name: "Squads", parentId: "raids", sortOrder: 0 },
  ];
  state.teams = [{ team: { id: s.team.id, name: "EWW", inviteCode: s.team.inviteCode }, role: "owner" }];
  state.teamSession = { userId: "u-owner", login: "owner" };
  initTeamModal();
});

afterEach(() => closeTeamModal());

// ─── Driving the dialog the way a person does ──────────────────────────────────

/** Open the dialog cold, exactly as reopening it does. */
async function reopen() {
  closeTeamModal();
  await openTeamModal(ctx.team.id);
  await flush();
}

const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const choose = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};

async function goTo(tabId) {
  click(document.querySelector(`[data-tab="${tabId}"]`));
  await flush();
}

/** Pick a folder in the access tree by its visible name, as a click would. */
async function selectFolder(name) {
  const node = [...document.querySelectorAll('.tm-fa__node[data-act="pick-folder"]')]
    .find((el) => el.querySelector(".tm-fa__node-name")?.textContent.trim() === name);
  if (!node) throw new Error(`no folder named ${name} in the tree`);
  click(node);
  await flush();
}

/** Add a per-person exception on the pane currently shown: pick, then level. */
async function addException(userId, access) {
  click(document.querySelector('[data-act="add-exception"]'));
  await flush();
  choose(document.querySelector('select[data-act="pick-person"]'), userId);
  await flush();
  choose(document.querySelector('.tm-fa__exception--pending select[data-act="set-access"]'), access);
  await settle();
}

/** Reopen cold, land on Folder access, and pick one folder — the reported path. */
async function reopenAt(folderName) {
  await reopen();
  await goTo("access");
  await selectFolder(folderName);
}

const exceptionRow = (userId) => document.querySelector(`.tm-fa__exception[data-user-id="${userId}"]`);
const everyoneSelect = () =>
  document.querySelector('.tm-fa__blanket select[data-act="set-access"]');
const personSelect = (userId) =>
  document.querySelector(`.tm__person[data-user-id="${userId}"] select[data-act="set-access"]`);

// What the database actually holds, which is the only authority on "did it stick".
const rowsInDb = async () =>
  (await ctx.env.SYNC_DB.prepare("SELECT folder_id, user_id, access FROM folder_grants WHERE team_id = ?")
    .bind(ctx.team.id).all()).results;

// ─── The reported gesture ──────────────────────────────────────────────────────

describe("a per-person permission, set and then removed", () => {
  test("the team-wide level on People survives a reopen, and clearing it sticks", async () => {
    await openTeamModal(ctx.team.id);
    await flush();
    await goTo("people");

    choose(personSelect("u-mem"), "read");
    await settle();
    expect(await rowsInDb()).toEqual([{ folder_id: ctx.team.id, user_id: "u-mem", access: "read" }]);

    await reopen();
    await goTo("people");
    expect(personSelect("u-mem").value).toBe("read");

    // Back to the team default — the removal under test.
    choose(personSelect("u-mem"), "inherit");
    await settle();
    expect(await rowsInDb()).toEqual([]);

    await reopen();
    await goTo("people");
    expect(personSelect("u-mem").value).toBe("inherit");
  });

  test("an exception on a folder can be removed with the ×, and stays removed", async () => {
    await openTeamModal(ctx.team.id);
    await flush();
    await goTo("access");
    await selectFolder("Raids");

    click(document.querySelector('[data-act="add-exception"]'));
    await flush();
    choose(document.querySelector('select[data-act="pick-person"]'), "u-mem");
    await flush();
    choose(document.querySelector('.tm-fa__exception--pending select[data-act="set-access"]'), "read");
    await settle();
    expect(await rowsInDb()).toEqual([{ folder_id: "raids", user_id: "u-mem", access: "read" }]);

    await reopen();
    await goTo("access");
    await selectFolder("Raids");
    expect(exceptionRow("u-mem")).not.toBeNull();

    click(exceptionRow("u-mem").querySelector('[data-act="clear-exception"]'));
    await settle();
    expect(await rowsInDb()).toEqual([]);
    expect(exceptionRow("u-mem")).toBeNull();

    // The symptom as reported: gone until you reopen the dialog.
    await reopen();
    await goTo("access");
    await selectFolder("Raids");
    expect(exceptionRow("u-mem")).toBeNull();
  });

  test("the select on an exception row can also take it back to inherited", async () => {
    await openTeamModal(ctx.team.id);
    await flush();
    await goTo("access");
    await selectFolder("Raids");

    click(document.querySelector('[data-act="add-exception"]'));
    await flush();
    choose(document.querySelector('select[data-act="pick-person"]'), "u-mem");
    await flush();
    choose(document.querySelector('.tm-fa__exception--pending select[data-act="set-access"]'), "none");
    await settle();

    await reopen();
    await goTo("access");
    await selectFolder("Raids");
    choose(exceptionRow("u-mem").querySelector('select[data-act="set-access"]'), "inherit");
    await settle();
    expect(await rowsInDb()).toEqual([]);

    await reopen();
    await goTo("access");
    await selectFolder("Raids");
    expect(exceptionRow("u-mem")).toBeNull();
  });
});

/**
 * The same removal in the shapes that are not the simple case — a folder two
 * deep, a level that matches its folder's blanket, an inherited blanket
 * overhead, and the blanket itself. Each of these changes what the pane says
 * about the row WITHOUT changing the row, which is precisely the kind of
 * difference that can send the × at the wrong folder key.
 */
describe("the same removal, in the shapes that read differently", () => {
  test("two folders down, where the key is a folder id and the parent has its own grant", async () => {
    await openTeamModal(ctx.team.id);
    await flush();
    await goTo("access");
    await selectFolder("Raids");
    await addException("u-mem", "read");
    await selectFolder("Squads");
    await addException("u-mem", "none");
    expect(await rowsInDb()).toEqual([
      { folder_id: "raids", user_id: "u-mem", access: "read" },
      { folder_id: "squads", user_id: "u-mem", access: "none" },
    ]);

    await reopenAt("Squads");
    click(exceptionRow("u-mem").querySelector('[data-act="clear-exception"]'));
    await settle();

    // Only the deeper one goes: the pane you are looking at is the folder you
    // are editing, and Raids still reads "read" afterwards.
    await reopenAt("Squads");
    expect(exceptionRow("u-mem")).toBeNull();
    expect(await rowsInDb()).toEqual([{ folder_id: "raids", user_id: "u-mem", access: "read" }]);
  });

  test("an exception at the same level as the folder's blanket still removes", async () => {
    await openTeamModal(ctx.team.id);
    await flush();
    await goTo("access");
    await selectFolder("Raids");
    choose(everyoneSelect(), "read");
    await settle();
    await addException("u-mem", "read"); // "Matches Everyone here"
    expect((await rowsInDb()).length).toBe(2);

    await reopenAt("Raids");
    expect(exceptionRow("u-mem").textContent).toContain("Matches");
    click(exceptionRow("u-mem").querySelector('[data-act="clear-exception"]'));
    await settle();

    await reopenAt("Raids");
    expect(exceptionRow("u-mem")).toBeNull();
    expect(await rowsInDb()).toEqual([{ folder_id: "raids", user_id: "*", access: "read" }]);
  });

  test("an exception under an inherited blanket removes without disturbing the blanket", async () => {
    await openTeamModal(ctx.team.id);
    await flush();
    await goTo("access");
    await selectFolder("Raids");
    choose(everyoneSelect(), "none");
    await settle();
    await selectFolder("Squads"); // blanket here is inherited from Raids
    await addException("u-mem", "write");

    await reopenAt("Squads");
    click(exceptionRow("u-mem").querySelector('[data-act="clear-exception"]'));
    await settle();

    await reopenAt("Squads");
    expect(exceptionRow("u-mem")).toBeNull();
    expect(await rowsInDb()).toEqual([{ folder_id: "raids", user_id: "*", access: "none" }]);
  });

  test("the folder's blanket level can itself be put back to inherited", async () => {
    await openTeamModal(ctx.team.id);
    await flush();
    await goTo("access");
    await selectFolder("Raids");
    choose(everyoneSelect(), "read");
    await settle();

    await reopenAt("Raids");
    choose(everyoneSelect(), "inherit");
    await settle();

    await reopenAt("Raids");
    expect(await rowsInDb()).toEqual([]);
    expect(everyoneSelect().value).toBe("inherit");
  });

  test("with two people excepted, removing one leaves the other exactly as it was", async () => {
    await openTeamModal(ctx.team.id);
    await flush();
    await goTo("access");
    await selectFolder("Raids");
    await addException("u-mem", "read");
    await addException("u-two", "none");

    await reopenAt("Raids");
    click(exceptionRow("u-mem").querySelector('[data-act="clear-exception"]'));
    await settle();

    await reopenAt("Raids");
    expect(exceptionRow("u-mem")).toBeNull();
    expect(exceptionRow("u-two")).not.toBeNull();
    expect(await rowsInDb()).toEqual([{ folder_id: "raids", user_id: "u-two", access: "none" }]);
  });
});
