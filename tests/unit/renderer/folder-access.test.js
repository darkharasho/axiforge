/** @jest-environment jsdom */
"use strict";

const { renderAccessSection, levelFor, describeAccess, ACCESS_CHOICES } =
  require("../../../src/renderer/modules/library/folder-access.js");

const MEMBERS = [
  { userId: "u-owner", login: "darkharasho", role: "owner" },
  { userId: "u-mem", login: "iruixos", role: "member" },
];

const asOwner = (over = {}) =>
  renderAccessSection({ members: MEMBERS, grants: [], folderId: "raids", isOwner: true, ...over });

describe("levelFor", () => {
  test("a grant on THIS folder is the one this dialog can change", () => {
    const grants = [{ folderId: "raids", userId: "u-mem", access: "read" }];
    expect(levelFor(grants, "raids", "u-mem", "write")).toEqual({ access: "read", source: "folder" });
  });

  test("a grant somewhere else reads as inherited, not as nothing", () => {
    const grants = [{ folderId: "team-1", userId: "u-mem", access: "read" }];
    expect(levelFor(grants, "raids", "u-mem", "write").source).toBe("inherited");
  });

  test("no grant at all is the team default", () => {
    expect(levelFor([], "raids", "u-mem", "write")).toEqual({ access: null, source: "default", teamDefault: "write" });
  });
});

describe("describeAccess", () => {
  test("says what each level means in terms of what the person can do", () => {
    expect(describeAccess("none")).toMatch(/cannot see/);
    expect(describeAccess("read")).toMatch(/change nothing/);
    expect(describeAccess("write")).toMatch(/their own work/);
    expect(describeAccess("delete")).toMatch(/anyone's work/);
  });

  test("an unknown level describes nothing rather than inventing something", () => {
    expect(describeAccess("wibble")).toBe("");
  });
});

describe("renderAccessSection, as the owner", () => {
  const parse = (html) => {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
  };

  test("offers a level per member", () => {
    const el = parse(asOwner());
    expect(el.querySelectorAll("select")).toHaveLength(1);
    expect(el.querySelector('[data-user-id="u-mem"] select')).toBeTruthy();
  });

  test("an owner is stated, not offered — a level against one would not hold", () => {
    const el = parse(asOwner());
    const row = el.querySelector('[data-user-id="u-owner"]');
    expect(row.querySelector("select")).toBeNull();
    expect(row.textContent).toMatch(/full access/);
  });

  test("the choices run from least to most, with inherit first", () => {
    const el = parse(asOwner());
    expect([...el.querySelectorAll("option")].map((o) => o.value))
      .toEqual(ACCESS_CHOICES.map((c) => c.value));
  });

  test("an existing grant on this folder is the selected one", () => {
    const el = parse(asOwner({ grants: [{ folderId: "raids", userId: "u-mem", access: "read" }] }));
    expect(el.querySelector("select").value).toBe("read");
  });

  test("with no grant, Inherited names the level it actually inherits", () => {
    const el = parse(asOwner({ teamDefault: "write" }));
    expect(el.querySelector("select").value).toBe("inherit");
    expect(el.querySelector("option").textContent).toBe("Inherited (Can edit)");
  });

  test("the team root says it covers the whole team, a sub-folder says it does not", () => {
    expect(asOwner({ isTeamRoot: true })).toMatch(/whole team/);
    expect(asOwner({ isTeamRoot: false })).toMatch(/this folder and everything inside/);
  });

  test("logins are text, never markup", () => {
    const html = asOwner({ members: [{ userId: "u", login: "<img src=x onerror=alert(1)>", role: "member" }] });
    expect(html).not.toContain("<img");
  });
});

describe("renderAccessSection, as a member", () => {
  test("a member is told their own level rather than shown a dead control", () => {
    const html = renderAccessSection({
      members: MEMBERS, grants: [{ folderId: "raids", userId: "u-mem", access: "read" }],
      folderId: "raids", isOwner: false,
    });
    expect(html).not.toContain("<select");
    expect(html).toMatch(/Read only/);
    expect(html).toMatch(/change nothing/);
  });

  test("with nothing set here, it says who could change that", () => {
    const html = renderAccessSection({ members: MEMBERS, grants: [], folderId: "raids", isOwner: false });
    expect(html).toMatch(/Only the team owner/);
  });
});
