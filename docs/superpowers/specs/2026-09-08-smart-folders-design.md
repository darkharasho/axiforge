# Smart Folders: rule engine, built-ins, and a user-facing rule builder

Date: 2026-09-08
Status: approved design, not yet implemented
Origin: Discord forum thread "Additional Smart Folder Options" (ge0rge)

## Problem

The library sidebar has four smart folders — `All Builds`, `By Profession`,
`By Game Mode`, `All Comps` — and every one of them is a hardcoded pair: a
`data-navigate-*` attribute in `sidebar.js` and a matching `if` branch in
`getVisibleBuilds()` (`folder-store.js`). Adding a fifth means editing both
files. There is no way for a user to add one at all.

Two concrete requests came out of the Discord thread:

- **Main Repository** — every build the user has, in one flat list, showing
  the folder path for builds that are filed. `All Builds` does not do this: it
  filters to `!b.folderId` and renders folder rows alongside, so filed builds
  are only reachable by descending the tree.
- **Shared** — every build reachable through the team library, on either side
  of it: teams the user owns and teams they were invited to.

Beyond those, users want to slice their library by their own criteria — tag,
elite spec, game mode, and combinations of them.

Solving this by adding two more hardcoded branches would leave the underlying
problem in place. This design replaces the hardcoded branches with a small rule
engine, then expresses both the new built-ins and any user-created smart folder
as rules over that engine.

## Scope

In scope:

- A rule schema and a pure evaluator.
- Five new built-in smart folders, seeded as rules.
- A rule-builder modal so users can create, edit, and delete their own.
- Retiring the `smart-profession` and `smart-gamemode` branches in favour of
  generated rules.

Explicitly out of scope for v1:

- Nested condition groups in the editor. The schema supports them; the UI only
  ever produces one root group. See "Deliberate omissions".
- Drag-reordering smart folders.
- Auto-generated per-team smart folders.
- Rules over comps. Smart folders filter builds; comps keep their existing
  `All Comps` behaviour.

## Data model

A smart folder is a record with a name, an icon, and a rule:

```js
{
  id: "sf_a1b2c3",
  name: "WvW Firebrands",
  icon: "funnel",
  rule: {
    type: "group",
    match: "all",              // "all" | "any"
    children: [
      { type: "condition", field: "gameMode",  op: "isAnyOf",   value: ["wvw"] },
      { type: "condition", field: "eliteSpec", op: "isAnyOf",   value: ["Firebrand"] },
      { type: "condition", field: "tags",      op: "hasNoneOf", value: ["retired"] }
    ]
  }
}
```

The rule is a **tree from day one**. `evaluate(node, build, ctx)` recurses on
`group` nodes and dispatches on `condition` nodes. The editor only ever builds a
single root group in v1, so nested groups cost nothing now and, if they are ever
added, need no data migration.

An empty `children` array matches every build. That is how `Main Repository` is
expressed.

### Field and operator vocabulary

| Field | Operators | Value |
|---|---|---|
| `profession` | `isAnyOf`, `isNoneOf` | string[] |
| `eliteSpec` | `isAnyOf`, `isNoneOf` | string[] |
| `gameMode` | `isAnyOf`, `isNoneOf` | string[] |
| `tags` | `hasAnyOf`, `hasAllOf`, `hasNoneOf`, `isEmpty`, `isNotEmpty` | string[] / none |
| `title` | `contains`, `notContains` | string |
| `notes` | `contains`, `notContains` | string |
| `location` | `isUnfiled`, `inFolder`, `notInFolder` | none / folderId |
| `ownership` | `is`, `isNot` | `"personal"` \| `"sharedByMe"` \| `"sharedWithMe"` |
| `team` | `isAnyOf` | teamId[] |
| `updatedAt` | `withinDays`, `olderThanDays` | number |
| `createdAt` | `withinDays`, `olderThanDays` | number |
| `pinned` | `isTrue`, `isFalse` | none |

Semantics worth pinning down, because each is ambiguous on its face:

- `eliteSpec` matches against elite specializations only — a build matches when
  `(b.specializations || []).some(s => s.elite && values.includes(s.name))`.
  This mirrors the existing toolbar filter.
- `gameMode` treats a missing `gameMode` as `"pve"`, matching
  `getVisibleBuilds()` today.
- `inFolder` **includes subfolders**, resolved through `folderSubtreeIds()`.
  `notInFolder` is its exact negation, so an unfiled build satisfies it.
- `ownership` is keyed on the team root a build sits under (`teamRootFor()` in
  `teams.js`), never on authorship: `personal` = no team root, `sharedByMe` =
  a team root with `role === "owner"`, `sharedWithMe` = a team root with any
  other role. A teammate's build inside a team the user owns is therefore
  `sharedByMe`. Separating the user's own builds from their teammates' inside
  one team would need `createdBy`, which lives in main's sync state and is not
  exposed to the renderer; it is out of scope here.
- Both `is` and `isNot` evaluate `false` for a value outside that vocabulary,
  so a malformed ownership rule matches nothing rather than everything.
- `contains` / `notContains` are case-insensitive substring matches.
- `withinDays: N` means the timestamp is within the last N days of `ctx.now`.
  `olderThanDays` is its negation for records that have a timestamp; a record
  with no timestamp matches neither.
- `isEmpty` on `tags` means no tags at all (missing array or length 0).

**Every operator is total.** An unknown field, an unknown operator, or a
malformed value evaluates to `false` rather than throwing. A smart folder saved
by a newer version of the app therefore reads as "matches nothing" in an older
one, instead of breaking the library.

### The evaluation context

`matchesSmartFolder(smartFolder, build, ctx)` takes everything it needs from
`ctx` — `{ folders, now }` — rather than reaching into `state` or calling
`Date.now()`. This keeps the engine pure and unit-testable against plain
objects with no DOM and no clock.

## Persistence

User smart folders live in the existing key-value settings store, alongside the
other library preferences (`library.js` `loadPrefs`/`savePrefs`):

- `library.smartFolders` — an array of user-created smart folder records.
- `library.smartFolderOverrides` — `{ hidden: string[] }`, the ids of built-ins
  the user has hidden.

They deliberately do **not** live in `folders.json`. Folders in that file
participate in team sync; smart folders are personal views over whatever the
user can see, and syncing them would mean syncing rules that reference folders
and teams the recipient may not have.

Built-ins are **code constants, not persisted rows**, so improving a built-in
rule in a later release reaches every user. The overrides map is the only
persisted state about them, which is why hiding is the affordance rather than
deleting.

`listSmartFolders()` merges built-ins with user records and applies the
overrides. If `library.smartFolders` is unreadable or malformed, it drops the
malformed entries, keeps the valid ones and the built-ins, and the library
opens normally.

## Built-in smart folders

| Name | Rule |
|---|---|
| Main Repository | no conditions — matches everything |
| Recently Modified | `updatedAt withinDays 14` |
| Shared | `ownership isNot personal` |
| Unfiled | `location isUnfiled` |
| Untagged | `tags isEmpty` |

`All Builds` and `All Comps` are **not** converted (see below).

Per-profession and per-game-mode rows stay dynamically generated — one row per
distinct value present in the library, exactly as today — but each row now
carries a generated rule (`{ field: "profession", op: "isAnyOf", value: [prof] }`)
instead of a magic `type` string.

## Integration

New module: `src/renderer/modules/library/smart-folders.js`. It owns three
things and nothing else:

1. `BUILTIN_SMART_FOLDERS` — the seeded rules as constants.
2. `matchesSmartFolder(smartFolder, build, ctx)` — the pure evaluator.
3. `listSmartFolders()` / `saveSmartFolder()` / `deleteSmartFolder()` /
   `hideBuiltin()` / `unhideBuiltin()` — the merge and persistence layer.

`folder-store.js` gains exactly one branch in `getVisibleBuilds()`:

```js
} else if (folder.type === "smart-rule") {
  builds = builds.filter((b) => matchesSmartFolder(folder.smartFolder, b, ruleContext()));
}
```

and **loses two**: `smart-profession` and `smart-gamemode`, which become
`smart-rule` folders carrying generated rules. Net branch count in that function
goes down, not up.

`getVisibleFolders()` and `getVisibleComps()` treat `smart-rule` like the other
smart folders and return `[]`.

`isCombinedView()` in `content.js` gains `smart-rule`, which turns on the
existing `folderPathHtml()` column. **No new path-rendering code is needed** —
that column already exists and already fires for smart folders and search
results.

### What is deliberately not converted

`all` and `__all-comps` keep their existing branches. Neither is a build filter:
`all` is the tree-root view that renders folder rows and root-level builds, and
`__all-comps` renders comps instead of builds. Pushing them through the rule
engine would require inventing rule concepts for "render folder rows", which is
the kind of over-generalisation that makes this code hard to read in the first
place.

## UI

### Sidebar

The Smart Folders section becomes, in order:

1. Flat built-ins: `Main Repository`, `All Builds (by folder)`, `Recently
   Modified`, `Shared`, `Unfiled`, `Untagged`
2. The `By Profession` and `By Game Mode` collapsible groups, both collapsed by
   default. `sidebarExpandedFolders` starts empty and nothing seeds their ids,
   so a fresh install already draws them closed; a one-time prune
   (`pruneGeneratedGroupsOnce`, gated on `library.generatedGroupsPruned`)
   closes them for anyone whose saved preference remembers them open, because
   the list is now long enough that two expanded groups push the rest off
   screen. It runs exactly once — after that a user's expansion sticks again.
3. `All Comps`
4. A divider, a "My Smart Folders" label, and the user's own smart folders

`All Builds` is renamed to **`All Builds (by folder)`**. With `Main Repository`
next to it, two rows showing the same count and different contents is
indistinguishable from a bug; the rename says which is which. The underlying
`type: "all"` is unchanged, so navigation, tests, and saved state are unaffected.

The section label gets a `+` button on hover — the single creation entry point.

Context menus:

- On a built-in: **Duplicate as new…** (the on-ramp — start from `Shared with
  me`, add a tag condition, save it as your own) and **Hide from sidebar**.
- On a user smart folder: **Edit rules… / Rename / Duplicate / Delete**.

### Rule editor modal

`src/renderer/modules/library/smart-folder-modal.js`, following the
`share-modal.js` pattern already in the codebase: an overlay with
`role="dialog"`, `init`/`open`/`close`, a `_render()` that writes `innerHTML`,
and one delegated `_onBodyClick`.

Layout: name and icon on one row; a `Match [All|Any] of the following
conditions:` line; a stack of condition rows; an "Add condition" button; a
footer with a live match count and Cancel/Save (plus Delete when editing a user
smart folder).

Each condition row is `[field ▾] [operator ▾] [value control] [×]`. The value
control is chosen by field:

- multi-select chips for `profession`, `eliteSpec`, `gameMode`, `tags` — options
  harvested from the library exactly as the existing toolbar dropdowns do
- a text input for `title`, `notes`
- a folder picker for `location: inFolder` / `notInFolder`
- a number input with an inline `days` suffix for the date operators, so the
  delete button stays in the same column as every other row
- nothing for `isEmpty`, `isNotEmpty`, `isTrue`, `isFalse`, `isUnfiled`

Changing a row's field resets its operator and value rather than trying to
coerce them across incompatible types.

Negative conditions (`isNoneOf`, `hasNoneOf`, `notContains`, `notInFolder`)
render their chips in the danger colour, so which rows *exclude* is legible at a
glance.

**The footer shows a live match count** (`23 builds match · of 64`) that updates
as the rule is edited. The evaluator is pure and synchronous, so this is a
filter over an in-memory array per keystroke. This is the feature that makes a
rule builder learnable rather than a guessing game; it is not optional polish.

### Toolbar entry point

The toolbar's filter area gains **"Save as smart folder"**, which converts the
current `state.libraryPrefs.activeFilters` into a rule and opens the modal
pre-filled. The mapping is direct — `professions`/`eliteSpecs`/`gameModes` become
`isAnyOf` conditions and `tags` becomes `hasAnyOf` — because the rule vocabulary
was designed as a superset of those filters. This is the discovery path: people
filter first, then wish it had stuck.

## Error handling

| Situation | Behaviour |
|---|---|
| Unknown field or operator | condition evaluates `false` |
| Malformed value for an operator | condition evaluates `false` |
| `library.smartFolders` unreadable or not an array | treated as empty; built-ins still load |
| Individual malformed smart folder record | dropped; the rest load |
| Settings write failure on save | toast an error, keep the modal open |
| Rule references a deleted folder or team | that condition simply matches nothing |
| Navigating to a smart folder that no longer exists | fall back to `All Builds (by folder)` |

## Testing

The evaluator is a pure function, so the bulk of the coverage is cheap jest
unit tests over plain objects:

- one case per field/operator pair, including the ambiguous semantics called out
  above (elite-only spec matching, `gameMode` defaulting to `"pve"`, `inFolder`
  including subfolders, all three `ownership` values including a teammate's
  build in an owned team resolving to `sharedByMe`)
- `match: "all"` vs `"any"`
- empty conditions match everything (the `Main Repository` case)
- unknown field and unknown operator both evaluate `false`
- nested group recursion — the editor cannot produce this yet, but the schema
  allows it and the evaluator must handle it

Then a smaller suite over the persistence layer:

- built-in / user / overrides merge
- hidden built-ins are excluded from `listSmartFolders()` but still resolvable
  by id
- corrupt `library.smartFolders` degrades to built-ins-only

And integration coverage in `folder-store`:

- a `smart-rule` folder filters `getVisibleBuilds()` correctly
- `smart-profession` and `smart-gamemode` produce identical results before and
  after conversion to generated rules — this is the regression that matters,
  since existing behaviour is being re-expressed
- `getVisibleFolders()` / `getVisibleComps()` return `[]` for `smart-rule`

Per the project's testing convention, Playwright E2E is release-only; jest is
the development loop here.

## Deliberate omissions

- **Nested condition groups.** The schema is a tree and the evaluator recurses,
  but the editor produces one flat root group. Multi-value conditions
  (`is any of [a, b]`) recover most of what OR-groups buy, and the case they do
  not cover — ORing across *different* fields — is served by making two smart
  folders. Adding the UI later requires no data migration.
- **Drag-reordering.** Built-ins have a fixed order, user smart folders appear
  in creation order. The overrides map stores only `hidden`; persisting a sort
  order that nothing can change would be dead weight.
- **Per-team smart folders.** Teams already have real folders in the tree; a
  smart mirror of them is duplicate navigation. `team isAnyOf` is in the
  vocabulary, so anyone who wants one can build it.
- **Smart folders over comps.** No demand, and it would mean a second field
  vocabulary for a different record shape.
