/** @jest-environment jsdom */
"use strict";

const {
  renderFolderAccessBrowser, renderFolderTree, visibleRows, folderMarks,
  effectiveLevel, everyoneLevel, exceptionsAt, summarizeAccess,
  describeAccess, describeMyAccess, labelOf, ACCESS_CHOICES, EVERYONE,
} = require("../../../src/renderer/modules/library/folder-access.js");

const MEMBERS = [
  { userId: "u-owner", login: "darkharasho", role: "owner" },
  { userId: "u-mem", login: "iruixos", role: "member" },
];

// A team root and one folder inside it. The root's KEY is the team id, because
// the root folder is not a synced item and the server has nowhere else to hang
// a team-wide grant.
const ROWS = [
  { id: "root", key: "team-1", name: "EWW", depth: 0, chain: ["team-1"] },
  { id: "raids", key: "raids", name: "Raids", depth: 1, chain: ["raids", "team-1"] },
];

// The browser draws ONE folder at a time, so every render names which one. The
// root is the default because it is what the tab opens on.
const render = (over = {}) =>
  renderFolderAccessBrowser({
    rows: ROWS, members: MEMBERS, grants: [], selectedKey: "team-1",
    expanded: new Set(ROWS.map((r) => r.key)), ...over,
  });

const parse = (html) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

describe("effectiveLevel", () => {
  test("a grant on THIS folder is the one its own cell can change", () => {
    const grants = [{ folderId: "raids", userId: "u-mem", access: "read" }];
    expect(effectiveLevel(grants, ROWS[1].chain, "u-mem", "write"))
      .toEqual({ access: "read", source: "folder", fromKey: "raids", viaEveryone: false });
  });

  test("a grant above is inherited, and says which folder it came from", () => {
    const grants = [{ folderId: "team-1", userId: "u-mem", access: "read" }];
    expect(effectiveLevel(grants, ROWS[1].chain, "u-mem", "write"))
      .toEqual({ access: "read", source: "inherited", fromKey: "team-1", viaEveryone: false });
  });

  test("the nearest grant wins, not the outermost", () => {
    const grants = [
      { folderId: "team-1", userId: "u-mem", access: "read" },
      { folderId: "raids", userId: "u-mem", access: "delete" },
    ];
    expect(effectiveLevel(grants, ROWS[1].chain, "u-mem", "write").access).toBe("delete");
  });

  test("another person's grant on the same folder is not this person's", () => {
    const grants = [{ folderId: "raids", userId: "someone-else", access: "none" }];
    expect(effectiveLevel(grants, ROWS[1].chain, "u-mem", "write").source).toBe("default");
  });

  test("a blanket grant covers somebody with no grant of their own", () => {
    const grants = [{ folderId: "raids", userId: EVERYONE, access: "read" }];
    expect(effectiveLevel(grants, ROWS[1].chain, "u-mem", "write"))
      .toEqual({ access: "read", source: "folder", fromKey: "raids", viaEveryone: true });
  });

  test("a person's own grant beats the blanket ON THE SAME FOLDER — that is what naming them means", () => {
    const grants = [
      { folderId: "raids", userId: EVERYONE, access: "none" },
      { folderId: "raids", userId: "u-mem", access: "write" },
    ];
    expect(effectiveLevel(grants, ROWS[1].chain, "u-mem", "write").access).toBe("write");
  });

  test("between folders the nearer wins, blanket or not", () => {
    const grants = [
      { folderId: "team-1", userId: "u-mem", access: "delete" },
      { folderId: "raids", userId: EVERYONE, access: "read" },
    ];
    expect(effectiveLevel(grants, ROWS[1].chain, "u-mem", "write").access).toBe("read");
  });

  test("no grant anywhere up the chain is the team default", () => {
    expect(effectiveLevel([], ROWS[1].chain, "u-mem", "write"))
      .toEqual({ access: "write", source: "default", fromKey: null, viaEveryone: false });
  });
});

describe("summarizeAccess", () => {
  test("the same level everywhere says so once", () => {
    expect(summarizeAccess(ROWS, [], "u-mem", "write")).toBe("Can edit everywhere");
  });

  test("one folder carved out is named, because that is the thing worth knowing", () => {
    const grants = [{ folderId: "raids", userId: "u-mem", access: "read" }];
    expect(summarizeAccess(ROWS, grants, "u-mem", "write")).toBe("Can edit, except Raids (read only)");
  });

  test("past one exception it counts rather than listing", () => {
    const rows = [
      ...ROWS,
      { id: "wvw", key: "wvw", name: "WvW", depth: 1, chain: ["wvw", "team-1"] },
      { id: "pvp", key: "pvp", name: "PvP", depth: 1, chain: ["pvp", "team-1"] },
    ];
    const grants = [
      { folderId: "raids", userId: "u-mem", access: "read" },
      { folderId: "wvw", userId: "u-mem", access: "none" },
    ];
    expect(summarizeAccess(rows, grants, "u-mem", "write")).toBe("Can edit in 2 of 4 folders");
  });

  test("a blanket level shows up in the person's summary, though they are named nowhere", () => {
    const grants = [{ folderId: "raids", userId: EVERYONE, access: "read" }];
    expect(summarizeAccess(ROWS, grants, "u-mem", "write")).toBe("Can edit, except Raids (read only)");
  });

  test("a team with nothing shared says that, rather than an empty level", () => {
    expect(summarizeAccess([], [], "u-mem", "write")).toBe("No folders shared yet");
  });
});

describe("describeAccess / describeMyAccess", () => {
  test("says what each level means in terms of what the person can do", () => {
    expect(describeAccess("none")).toMatch(/cannot see/);
    expect(describeAccess("read")).toMatch(/change nothing/);
    expect(describeAccess("write")).toMatch(/their own work/);
    expect(describeAccess("delete")).toMatch(/anyone's work/);
  });

  test("an unknown level describes nothing rather than inventing something", () => {
    expect(describeAccess("wibble")).toBe("");
    expect(describeMyAccess("wibble")).toBe("");
  });

  test("your own level reads as a sentence about you", () => {
    expect(describeMyAccess("read")).toBe("Read only — you can see it but change nothing.");
  });
});

describe("everyoneLevel / exceptionsAt", () => {
  test("the blanket is what a folder hands to anyone not named on it", () => {
    const grants = [{ folderId: "team-1", userId: EVERYONE, access: "read" }];
    expect(everyoneLevel(grants, ROWS[1].chain, "write"))
      .toEqual({ access: "read", source: "inherited", fromKey: "team-1", viaEveryone: true });
  });

  test("a person's own grant is not the blanket, however near it is", () => {
    const grants = [{ folderId: "raids", userId: "u-mem", access: "none" }];
    expect(everyoneLevel(grants, ROWS[1].chain, "write").source).toBe("default");
  });

  test("exceptions are the people named ON one folder, blanket excluded", () => {
    const grants = [
      { folderId: "raids", userId: EVERYONE, access: "read" },
      { folderId: "raids", userId: "u-mem", access: "none" },
      { folderId: "team-1", userId: "u-mem", access: "write" },
    ];
    expect(exceptionsAt(grants, "raids", MEMBERS))
      .toEqual([{ userId: "u-mem", login: "iruixos", access: "none", role: "member" }]);
  });

  test("an owner is never listed as an exception — a level against one would not hold", () => {
    const grants = [{ folderId: "raids", userId: "u-owner", access: "read" }];
    expect(exceptionsAt(grants, "raids", MEMBERS)).toEqual([]);
  });
});

describe("the folder tree", () => {
  test("a collapsed folder hides what is inside it; the filter ignores collapse", () => {
    const deep = [
      ...ROWS,
      { id: "sq", key: "sq", name: "Squads", depth: 2, chain: ["sq", "raids", "team-1"] },
    ];
    expect(visibleRows(deep, new Set(["team-1"])).map((r) => r.key)).toEqual(["team-1", "raids"]);
    expect(visibleRows(deep, new Set(["team-1", "raids"])).map((r) => r.key))
      .toEqual(["team-1", "raids", "sq"]);
    // A match has to be reachable however the tree was left, so its ancestors
    // come with it and collapse stops applying.
    expect(visibleRows(deep, new Set(), "squad").map((r) => r.key))
      .toEqual(["team-1", "raids", "sq"]);
  });

  test("only folders with children get a twisty", () => {
    const el = parse(renderFolderTree({
      rows: ROWS, grants: [], selectedKey: "team-1", expanded: new Set(["team-1"]),
    }));
    expect(el.querySelectorAll('[data-act="toggle-folder"]')).toHaveLength(1);
    expect(el.querySelector('[data-act="toggle-folder"]').dataset.key).toBe("team-1");
  });

  test("a dot marks a folder that sets something; a red one marks a lockout", () => {
    expect(folderMarks([], "raids")).toEqual({ own: false, blocks: false });
    expect(folderMarks([{ folderId: "raids", userId: "u", access: "read" }], "raids"))
      .toEqual({ own: true, blocks: false });
    expect(folderMarks([{ folderId: "raids", userId: "u", access: "none" }], "raids"))
      .toEqual({ own: true, blocks: true });

    const el = parse(renderFolderTree({
      rows: ROWS, grants: [{ folderId: "raids", userId: "u-mem", access: "none" }],
      selectedKey: "team-1", expanded: new Set(["team-1"]),
    }));
    expect(el.querySelectorAll(".tm-fa__dot")).toHaveLength(1);
    expect(el.querySelector(".tm-fa__dot").className).toContain("--blocks");
  });

  test("a filter matching nothing says so rather than drawing an empty tree", () => {
    expect(renderFolderTree({ rows: ROWS, grants: [], expanded: new Set(), filter: "zzz" }))
      .toMatch(/No folder matches/);
  });

  test("the picked folder is the selected one, and nesting is carried as depth", () => {
    const el = parse(render({ selectedKey: "raids" }));
    const nodes = [...el.querySelectorAll(".tm-fa__node")];
    expect(nodes.map((n) => n.dataset.key)).toEqual(["team-1", "raids"]);
    expect(nodes[1].className).toContain("--on");
    expect(nodes[1].getAttribute("style")).toContain("--depth:1");
    // The pane is about that folder, and carries the key its grants are written to.
    expect(el.querySelector(".tm-fa__pane").dataset.folderKey).toBe("raids");
  });
});

describe("the picked folder's pane", () => {
  test("the blanket is the folder's primary control — one for everyone, not one per member", () => {
    const el = parse(render());
    expect(el.querySelectorAll('.tm-fa__pane select[data-user-id="*"]')).toHaveLength(1);
    expect(el.querySelector(".tm-fa__blanket-title").textContent).toBe("Everyone in the team");
    // Nobody is singled out, so nobody is listed as a rule.
    expect(el.querySelectorAll(".tm-fa__exception")).toHaveLength(0);
    expect(el.querySelector(".tm-fa__none").textContent).toMatch(/Nobody is singled out/);
  });

  test("the choices run from least to most, with inherit first", () => {
    const el = parse(render());
    expect([...el.querySelector(".tm-fa__pane select").querySelectorAll("option")].map((o) => o.value))
      .toEqual(ACCESS_CHOICES.map((c) => c.value));
  });

  test("at the team root, inherit is named as the team default", () => {
    const el = parse(render({ teamDefault: "delete" }));
    expect(el.querySelector(".tm-fa__pane option").textContent).toBe("Team default · Can delete");
    expect(el.querySelector(".tm-fa__blanket-sub").textContent).toMatch(/team default/i);
  });

  // The whole reason the pane exists: an inherited level and a deliberate one
  // look identical if you only print the level.
  test("a folder that sets nothing says so, and names the folder it follows", () => {
    const el = parse(render({
      selectedKey: "raids", grants: [{ folderId: "team-1", userId: EVERYONE, access: "read" }],
    }));
    expect(el.querySelector(".tm-fa__blanket").className).toContain("--inherited");
    expect(el.querySelector(".tm-fa__blanket-sub").textContent).toMatch(/Nothing set here — follows/);
    expect(el.querySelector(".tm-fa__blanket-sub").textContent).toContain("EWW");
    expect(el.querySelector(".tm-fa__pane select").value).toBe("inherit");
    expect(el.querySelector(".tm-fa__pane option").textContent).toBe("Inherited · Read only");
  });

  test("a blanket set on THIS folder is selected, and is not dressed as inherited", () => {
    const el = parse(render({
      selectedKey: "raids", grants: [{ folderId: "raids", userId: EVERYONE, access: "none" }],
    }));
    expect(el.querySelector(".tm-fa__blanket").className).not.toContain("--inherited");
    expect(el.querySelector(".tm-fa__blanket-sub").textContent).toMatch(/Set on this folder/);
    expect(el.querySelector(".tm-fa__pane select").value).toBe("none");
  });

  test("a named person is a rule on this folder, with a way out", () => {
    const el = parse(render({
      selectedKey: "raids", grants: [{ folderId: "raids", userId: "u-mem", access: "read" }],
    }));
    const row = el.querySelector(".tm-fa__exception");
    expect(row.dataset.userId).toBe("u-mem");
    expect(row.querySelector(".tm-fa__exception-name").textContent).toBe("iruixos");
    expect(row.querySelector("select").value).toBe("read");
    expect(row.querySelector('[data-act="clear-exception"]')).not.toBeNull();
    expect(row.querySelector(".tm-fa__person-note").textContent).toMatch(/Overrides/);
    // Clearing is "back to whatever everyone gets", and says which level that is.
    expect(row.querySelector("option").textContent).toBe("Same as everyone (Can edit)");
  });

  test("the picker offers only members not already excepted, and never the owner", () => {
    const el = parse(render({
      selectedKey: "raids", adding: true,
      grants: [{ folderId: "raids", userId: "u-mem", access: "read" }],
    }));
    // The one non-owner member is already excepted here, so there is nobody left
    // to add and neither the picker nor the invitation to open it is offered.
    expect(el.querySelector('[data-act="pick-person"]')).toBeNull();
    expect(el.querySelector('[data-act="add-exception"]')).toBeNull();
    expect(parse(render({ selectedKey: "raids", adding: true }))
      .querySelectorAll('[data-act="pick-person"] option')).toHaveLength(2); // placeholder + iruixos
  });

  test("picking someone offers a level, and stores nothing until one is chosen", () => {
    const el = parse(render({ selectedKey: "raids", pending: { folderKey: "raids", userId: "u-mem" } }));
    const row = el.querySelector(".tm-fa__exception--pending");
    expect(row.querySelector("select").value).toBe("");
    expect(row.querySelector("option").textContent).toBe("Choose a level…");
    expect(row.querySelector('[data-act="cancel-exception"]')).not.toBeNull();
  });
});

describe("everyone else", () => {
  const TEAM = [
    ...MEMBERS,
    { userId: "u-b", login: "vette", role: "member" },
    { userId: "u-c", login: "nomad", role: "member" },
  ];

  // The fold is the point of a blanket grant: it covers people without naming
  // them, so naming them all back would undo the idea.
  test("folded, it is one line — and it says what they all get", () => {
    const el = parse(render({ members: TEAM }));
    expect(el.querySelectorAll(".tm-fa__others .tm-fa__person")).toHaveLength(0);
    // The faces are their own cell; the sentence is the one after it.
    const fold = el.querySelector(".tm-fa__fold").lastElementChild
      .textContent.replace(/\s+/g, " ").trim();
    expect(fold).toBe("4 others get Can edit — show them");
    expect(el.querySelectorAll(".tm-fa__stack .tm-fa__avatar")).toHaveLength(4);
  });

  test("mixed levels are not summarised into a level nobody has", () => {
    const el = parse(render({
      selectedKey: "raids", members: TEAM,
      grants: [
        { folderId: "team-1", userId: EVERYONE, access: "read" },
        { folderId: "team-1", userId: "u-c", access: "delete" },
      ],
    }));
    // Three of the four inherit Read only and one carries their own Can delete —
    // there is no single level to name, so it does not invent one.
    expect(el.querySelector(".tm-fa__fold").textContent).toMatch(/4 others have mixed levels/);
  });

  test("unfolded, every row says where its level actually came from", () => {
    const el = parse(render({
      selectedKey: "raids", members: TEAM, showOthers: true,
      grants: [
        { folderId: "team-1", userId: EVERYONE, access: "read" },
        { folderId: "team-1", userId: "u-c", access: "delete" },
      ],
    }));
    const note = (id) => el.querySelector(`[data-user-id="${id}"] .tm-fa__person-note`)
      .textContent.replace(/\s+/g, " ").trim();
    // An owner is stated, never controlled: they can hand any grant back.
    expect(note("u-owner")).toMatch(/Owner/);
    expect(el.querySelector('[data-user-id="u-owner"] .tm-fa__fixed').textContent).toBe("Full access");
    expect(el.querySelector('[data-user-id="u-owner"] select')).toBeNull();
    // A blanket on the folder ABOVE, which is why the folder must be named.
    expect(note("u-mem")).toBe("From Everyone on EWW");
    // Their own grant up there, which beats that blanket because a person's own
    // grant wins over a blanket AT THE SAME folder. Two people, one folder, two
    // levels — the case that reads as a bug when the source is not printed.
    expect(note("u-c")).toBe("Their own level on EWW");
    expect(el.querySelector('[data-user-id="u-c"] select option').textContent).toBe("Can delete");
  });

  test("with no grants anywhere, the source is the team default", () => {
    const el = parse(render({ members: TEAM, showOthers: true }));
    expect(el.querySelector('[data-user-id="u-mem"] .tm-fa__person-note').textContent)
      .toBe("Team default");
  });
});

describe("losing access", () => {
  // No access is the one level that takes something away, and it takes every
  // folder below with it.
  test("shutting someone out of a folder is spelled out where it is set", () => {
    const el = parse(render({
      selectedKey: "raids", grants: [{ folderId: "raids", userId: "u-mem", access: "none" }],
    }));
    const warn = el.querySelector(".tm-fa__warn").textContent.replace(/\s+/g, " ");
    expect(warn).toContain("iruixos loses “Raids”");
    expect(warn).toMatch(/hides every folder beneath it too/);
  });

  test("at the root it is the whole library, and a blanket names everyone", () => {
    const el = parse(render({ grants: [{ folderId: "team-1", userId: EVERYONE, access: "none" }] }));
    expect(el.querySelector(".tm-fa__warn").textContent.replace(/\s+/g, " "))
      .toContain("Everyone lose the library");
  });

  test("no lockout, no warning", () => {
    expect(parse(render()).querySelector(".tm-fa__warn")).toBeNull();
  });
});

describe("the browser as a whole", () => {
  test("logins and folder names are text, never markup", () => {
    const html = renderFolderAccessBrowser({
      rows: [{ id: "r", key: "team-1", name: "<img src=x onerror=alert(1)>", depth: 0, chain: ["team-1"] }],
      members: [{ userId: "u", login: "<script>x</script>", role: "member" }],
      grants: [{ folderId: "team-1", userId: "u", access: "read" }],
      selectedKey: "team-1",
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
  });

  test("an empty team says so rather than rendering an empty browser", () => {
    expect(renderFolderAccessBrowser({ rows: [], members: MEMBERS, grants: [] }))
      .toMatch(/Nothing is shared/);
  });

  test("a selection that no longer exists falls back to the root, not to nothing", () => {
    const el = parse(render({ selectedKey: "gone" }));
    expect(el.querySelector(".tm-fa__pane").dataset.folderKey).toBe("team-1");
  });

  test("a team of one still gets its blanket control — there is nobody to except", () => {
    const el = parse(render({ members: [MEMBERS[0]] }));
    expect(el.querySelectorAll('.tm-fa__pane select[data-user-id="*"]')).toHaveLength(1);
    expect(el.querySelector('[data-act="add-exception"]')).toBeNull();
  });
});
