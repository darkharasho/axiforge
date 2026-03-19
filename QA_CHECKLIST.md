# AxiForge Alpha QA Checklist

Manual QA items for alpha testers. Check off items as you test them. Report issues with profession, specializations, steps to reproduce, and game mode (PvE/WvW).

---

## Critical Path (Test First)

1. Create new build → Select profession → Add specializations/traits → Save
2. Select skills → Equipment → Publish to GitHub Pages
3. Load published build from link
4. Import build via chat link
5. Library folder management and drag-drop

---

## 1. Authentication & Onboarding

- [ ] GitHub OAuth login via device flow works (device code displayed, authorization completes)
- [ ] Logged-in user's name displays after authorization
- [ ] Logout works
- [ ] Failed authentication shows appropriate error
- [ ] Session persists across app restarts
- [ ] User can skip GitHub setup and use editor without login
- [ ] GitHub repo setup creates `axiforge` repository and enables Pages
- [ ] Pages workflow deploys and triggers correctly
- [ ] Setup status shows clear progress and error messages

---

## 2. Build Editor - Profession & Metadata

- [ ] All 9 professions selectable: Guardian, Warrior, Engineer, Ranger, Thief, Elementalist, Mesmer, Necromancer, Revenant
- [ ] Profession catalogs load correctly for each class
- [ ] Profession icons display with correct styling
- [ ] Switching professions clears previous selections
- [ ] Loading skeletons appear during catalog fetches
- [ ] Build title input accepts up to 140 characters
- [ ] Build title appears in window title bar
- [ ] Tags input accepts comma-separated values
- [ ] Unsaved changes indicator (dirty dot) shows/hides correctly

---

## 3. Game Mode Toggle (PvE/WvW)

- [ ] PvE and WvW tabs toggle between game modes
- [ ] Switching modes reloads specializations/traits with mode-appropriate data
- [ ] Game mode preference remembered across restarts
- [ ] Skill/trait balance splits reflect correctly per mode
- [ ] Detail panel facts update and flash when mode changes

---

## 4. Specializations & Traits

- [ ] Can select 0–3 specializations
- [ ] Specialization cards display with background images
- [ ] 3 tier rows (Adept/Master/Grandmaster) display per specialization
- [ ] Each tier has 3 major trait options; can select 1 per tier
- [ ] Selected traits show visual indicator
- [ ] Minor traits display as read-only
- [ ] Hovering over traits shows wiki preview panel
- [ ] SVG connector lines draw between specializations
- [ ] Lines update when page becomes visible
- [ ] Lines clear when specializations are removed
- [ ] Removing a specialization clears its traits

---

## 5. Skills (Heal, Utility, Elite)

- [ ] Heal skill slot displays with correct icon
- [ ] 3 Utility skill slots display in order
- [ ] Elite skill slot displays correctly
- [ ] Skill icons load from GW2 API renders
- [ ] Clicking skill slot opens picker with search
- [ ] Picker filters skills by profession/mode
- [ ] Selected skill updates immediately
- [ ] Aquatic/underwater skill slots show when applicable

### Profession Mechanic Slots (F1–F5)

- [ ] **Elementalist**: Attunement buttons (Fire/Water/Air/Earth) + Overload F5
- [ ] **Guardian**: Virtue buttons (Justice/Resolve/Courage) + spec variations
- [ ] **Warrior**: Burst skill updates based on equipped weapon
- [ ] **Engineer**: Tool-belt skills derived from heal/utility/elite
- [ ] **Ranger**: Pet swap commands + species skill
- [ ] **Revenant**: Legend swap buttons (2 slots) + legend-specific skills
- [ ] **Thief**: Steal/shadow mechanics
- [ ] **Necromancer**: Shroud or spec-specific mechanics
- [ ] **Mesmer**: Shatter buttons or spec-specific mechanics
- [ ] Mechanics update when specialization or weapon changes

---

## 6. Equipment

### Armor
- [ ] 6 armor slots display: Head, Shoulders, Chest, Hands, Legs, Feet
- [ ] Armor weight (light/medium/heavy) correct per profession

### Weapons
- [ ] 2 weapon sets available (mainhand/offhand per set)
- [ ] Aquatic weapons show separately
- [ ] Weapon dropdown enforces hand restrictions
- [ ] Weapon swaps update visible skill bar
- [ ] Two-handed weapons disable offhand slot

### Trinkets
- [ ] Back, Amulet, 2 Rings, 2 Accessories display
- [ ] Trinket picker/search works

### Stats, Runes, Sigils, Infusions
- [ ] Stat combo dropdown shows all stat combinations
- [ ] Stat combo dropdown includes **Sentinel's** (Power / Toughness / Vitality)
- [ ] Stat combo dropdown includes **Wanderer's** (Power / Toughness / Vitality / Concentration)
- [ ] Stat combo dropdown includes **Diviner's** (Power / Precision / Ferocity / Concentration)
- [ ] Sentinel's, Wanderer's, and Diviner's each produce correct stat totals when selected
- [ ] Stat calculations update when stat package changes
- [ ] Rune slots show for armor (6 slots)
- [ ] Sigil slots show for weapons
- [ ] Rune/Sigil pickers have search
- [ ] Infusion slots display in appropriate gear
- [ ] Ring infusions allow up to 3 per ring
- [ ] Enrichment slot shows for amulet

### Food & Utility Consumables
- [ ] Food dropdown available with search
- [ ] Utility consumable dropdown available
- [ ] Stats update based on food/utility selection

### Assumed Boons
- [ ] Might stacks selector (0–25)
- [ ] Fury and Alacrity toggles
- [ ] Assumed boons persist in build
- [ ] Reset button clears assumptions

### Stats Display
- [ ] Power, Precision, Ferocity, Toughness, Vitality, Condition Damage, Expertise, Healing Power, Concentration calculate correctly
- [ ] Stats break down by source (Base, Armor, Weapon, Runes, Sigils, Infusions, Food, Assumptions)
- [ ] Stat totals are accurate
- [ ] Crit chance % calculates correctly from Precision

---

## 7. Detail Panel & Wiki Integration

- [ ] Clicking trait/skill shows details in right panel (Name, Description, Facts)
- [ ] Facts display with correct icons (boons, damage, duration)
- [ ] Hover preview tooltip appears and can be dismissed
- [ ] Expand button opens full detail modal
- [ ] Modal closes on Escape or close button
- [ ] Wiki link opens wiki page in sandboxed webview
- [ ] Switching PvE/WvW updates detail facts with highlights/flash

---

## 8. Underwater Mode

- [ ] Underwater checkbox toggles underwater skill sets
- [ ] Underwater equipment slots show (breather + 2 aquatic weapons)
- [ ] Only aquatic weapons available (Spear, Trident, Harpoon Gun)
- [ ] Land weapons hidden when underwater enabled
- [ ] **Revenant**: Certain legends disabled underwater (Glint, Kalla)
- [ ] **Ranger**: Only amphibious/aquatic pets available underwater
- [ ] **Elementalist**: Attunement-dependent skills update for underwater

---

## 9. Build Library & Management

- [ ] Library page shows all saved builds with title, profession icon, last modified
- [ ] Search filters builds by title
- [ ] "New Build" creates empty build
- [ ] Load build from library into editor
- [ ] Save/Update existing build
- [ ] Duplicate build creates copy with "(Copy)" suffix
- [ ] Delete build with confirmation
- [ ] Pin/unpin builds

### Folder Management
- [ ] Create, rename, and delete folders
- [ ] Move builds between folders via drag-drop
- [ ] Drag builds within folder to reorder
- [ ] Visual feedback during drag (hover states, drop zones)

### Copy / Cut / Paste
- [ ] Ctrl+C copies selected build to clipboard; "Build copied!" toast appears
- [ ] Ctrl+C with multiple builds selected copies all; "N builds copied!" toast appears
- [ ] Ctrl+V pastes clipboard build as new build with "(1)" title suffix
- [ ] Ctrl+V again increments suffix to "(2)", "(3)", etc.
- [ ] Ctrl+V pastes into current folder (not always root)
- [ ] Ctrl+X cuts selected build; "Build cut!" toast appears
- [ ] Ctrl+V after Ctrl+X moves build to current folder; "Build moved!" toast appears
- [ ] Ctrl+C after Ctrl+X cancels the cut (paste creates copy, not move)
- [ ] Ctrl+V with empty clipboard shows "Clipboard is empty" error toast
- [ ] Ctrl+V with non-JSON clipboard shows "Clipboard does not contain valid JSON" error toast
- [ ] Ctrl+V with array of builds in clipboard pastes all builds
- [ ] Copy/Cut/Paste work when inside folders and subfolders

### Right-Click Context Menu
- [ ] Open, Duplicate, Delete, Move, Pin/Unpin options for builds
- [ ] Copy and Cut options appear in single-build context menu
- [ ] Copy and Cut options appear in multi-select context menu
- [ ] Paste option appears in empty-area context menu
- [ ] Edit name, Delete options for folders

### Chat Link Integration
- [ ] Generate chat link button copies link to clipboard
- [ ] Chat links can be imported back (paste)
- [ ] Pre-warming loads chat links in background

---

## 10. Publishing & GitHub Pages

- [ ] Build must have title and profession before publishing
- [ ] Save prompt appears if unsaved changes exist
- [ ] Publish progress indicators show (Saving → Repo → Site → Encrypt → Upload → Deploy → Pages)
- [ ] Build data encrypted with unique key
- [ ] SPA files uploaded to GitHub
- [ ] GitHub Actions workflow triggers
- [ ] Pages build status polled until "built"
- [ ] Success message shows with published link
- [ ] Published link copied to clipboard
- [ ] Error messages display if publish fails; retry option available

### Published Page
- [ ] Build renders on GitHub Pages
- [ ] Title, profession, specializations, traits, skills, equipment display
- [ ] Notes render as markdown
- [ ] Images load properly

---

## 11. Notes Tab

- [ ] Notes textarea accepts input
- [ ] Toolbar buttons insert markdown (H1–H3, Bold, Italic, Underline, Lists, Table, HR, Link, Image)
- [ ] Toggle preview/edit mode works
- [ ] Preview renders markdown to HTML correctly
- [ ] `@` mention autocomplete shows skills/traits
- [ ] Arrow keys navigate suggestions, Enter selects
- [ ] Notes save with build and persist across save/reload

---

## 12. Build Persistence & Import/Export

- [ ] Save button saves all editor data; Ctrl+S shortcut works
- [ ] Warning on page/build change if unsaved
- [ ] Copy JSON exports current build
- [ ] Paste JSON imports from clipboard (with dirty check)
- [ ] Paste chat link imports build into editor
- [ ] Imported build loads all data correctly

---

## 13. Window Controls & UI

- [ ] Minimize, Maximize/Restore, Close buttons work
- [ ] Double-clicking title bar maximizes/restores
- [ ] Window resizing works (min 1120x740)
- [ ] Window size persists across sessions
- [ ] Version displays in titlebar
- [ ] Update check runs; notification shows when update available
- [ ] Download progress displays; restart completes update
- [ ] Dark theme is readable with good contrast
- [ ] Profession colors distinguish clearly
- [ ] Workspace switcher shows user menu with login/logout

---

## 14. Performance & Stability

- [ ] App loads within 2–3 seconds
- [ ] Profession catalog loads in under 1 second (after first)
- [ ] Switching professions responsive (< 500ms)
- [ ] Skill picker opens instantly
- [ ] Library renders 100+ builds without lag
- [ ] No crashes on normal usage
- [ ] Graceful error handling (bad network, API failures)
- [ ] Publishing doesn't freeze UI
- [ ] Multiple rapid saves don't cause issues

---

## 15. Cross-Platform

### Windows
- [ ] Installer works
- [ ] Window controls visible and functional

### Linux
- [ ] AppImage runs without issues
- [ ] Window manager integration works

---

## 16. Edge Cases & Error Handling

- [ ] GW2 API timeout shows error without crash
- [ ] GitHub API failure shows user-friendly message
- [ ] Empty build title validation
- [ ] Invalid JSON import rejected with error
- [ ] Corrupt build file handled gracefully
- [ ] 0 specializations allowed; 3+ prevented
- [ ] Empty utility slots allowed

---

## 17. Compositions (Comp Party Lines)

Compositions group builds into labeled party lines for squad planning. Access via the Comps section of the library.

### Party Line Drag-and-Drop
- [ ] Build slot can be dragged to the **last position** in a party line (was previously blocked)
- [ ] Dropping a build into a **full party line** expands the line to fit it instead of silently discarding the build
- [ ] Source party line **shrinks back** to its natural size after a build is moved out
- [ ] During a drag, the SortableJS ghost is **visible when hovering** over a full line that needs to expand
- [ ] Dropping a slot back onto its **original party line** restores it correctly (slot should not disappear)
- [ ] Clicking an empty slot does **not** add extra rows to the party line
- [ ] Builds can be reordered within the same party line via drag-and-drop
- [ ] Builds can be moved between different party lines via drag-and-drop
- [ ] Dragging a build from the pool into a party line adds it to the correct position

### Boon Coverage
- [ ] Boon coverage section shows which boons are covered per party line and for the whole squad
- [ ] Boon coverage tooltip for a **line** shows each contributing build's name and profession icon
- [ ] Boon coverage tooltip shows the **elite spec icon** (not just the base profession) when a build uses an elite spec (e.g. Scourge instead of generic Necromancer)
- [ ] Boon coverage tooltip shows the **base profession icon** for builds without an elite spec
- [ ] Squad-level boon coverage tooltip groups providers by party line label and shows elite spec icons
- [ ] Serialized builds (loaded from save) display the correct elite spec in boon tooltips
- [ ] Editor-format builds (not yet published) look up elite spec from catalog and display it correctly

---

## 18. Regression Checks

Verify these previously fixed issues have not regressed:

- [ ] Reaper shroud 5 accuracy in WvW split
- [ ] Overload skill selection updates reference panel
- [ ] Elementalist flip skills not appearing in core/cata/evoker
- [ ] Build name appears in window title
- [ ] Build summary collapsed by default
- [ ] Loading states show during catalog fetches
- [ ] Lines between skills persist after publish
- [ ] GitHub Pages setup is optional (not forced)
- [ ] **Sentinel's**, **Wanderer's**, and **Diviner's** appear in the stat combo dropdown (#29)
- [ ] Comp: build can be dragged to the last slot position in a party line without being blocked (#44)
- [ ] Comp: dropping a build into a full party line expands the line instead of discarding the build (#45)
- [ ] Comp: build dropped back onto its original party line is restored and does not disappear

---

## Reporting Issues

When filing a bug report, include:
- **Profession** and **specializations** selected
- **Game mode** (PvE or WvW)
- **Steps to reproduce**
- **Build JSON** if relevant (via Copy JSON button)
- **Platform** (Windows/Linux)
- **Screenshot** for UI issues
