## Version v0.6.7 — April 18, 2026

### Bug Fixes

- **Editing a build no longer generates a new published URL** — previously, saving any change to a build (notes, traits, equipment, etc.) would silently clear its publish metadata. The next time you published, axiforge treated the build as unpublished and generated a brand-new link — breaking any existing comp SPA links and Discord embeds pointing at the old URL. Builds now correctly reuse the same URL on every republish.
- **Build history now shows the correct author for synced changes** — when a shared build was updated and synced from another org member without an embedded author tag, the history entry would show "unknown" instead of the org name. It now correctly attributes the change to the org.

## Version v0.6.6 — April 18, 2026

### Bug Fixes

- **Disconnect org dialog no longer hides behind the settings window** — clicking Disconnect on an org now correctly shows the confirmation dialog on top of the settings modal instead of underneath it.

## Version v0.6.5 — April 17, 2026

### New Features

- **Shared comps publish to the org's site** — publishing a comp that lives in a shared org folder now routes to the org's `axibuilds` repository (matching the existing behavior for individual shared builds). The published URL is the same for every org member.
- **Publish URLs sync to teammates automatically** — when you publish a shared build or comp, the published file ID, key, and slug are now pushed to the shared library repo. Teammates receive the canonical URL on their next sync and can share the link without having to publish the build themselves.
- **Shared badge on comp list** — comps living in a shared org folder now show an amber "Shared" badge in the comp list alongside the game mode and publish status badges.

### Bug Fixes

- **Published comp missing a build link** — publishing a comp could result in one or more party line slots appearing empty (no link) on the published page. This happened when a build ID was present in a party line slot but missing from the comp's internal build list due to data divergence. The publish pipeline now uses the union of both sources so every filled slot always has a link.
- **Discord webhook settings not saving** — entering a webhook URL in Settings and clicking Save would silently fail if the IPC call encountered an error, leaving the modal open with no feedback and losing the URL when the user closed it. The Save button now shows an inline error message on failure and re-enables so you can retry.
- **Build history showed "local" for all shared changes** — the build history panel always displayed "local" as the author for changes synced from org members. It now shows the actual GitHub username of whoever made the change.
- **Build history entries were too generic** — sync history entries all said "build updated" regardless of what changed. Each entry now lists the specific fields that were modified (title, profession, skills, equipment, etc.).
- **Reconnecting an org folder didn't sync existing content** — connecting to a shared org folder for the first time (or after a disconnect) would show the empty folder without pulling the existing builds and comps stored remotely. Content is now fetched immediately on connect.
- **Shared subfolder re-linked under wrong parent on reconnect** — when reconnecting to a shared org folder that contained subfolders, those subfolders could be re-linked under the wrong parent in the library tree. They are now correctly re-linked under the shared root.

---

## Version v0.6.4 — April 16, 2026

### New Features

- **Shared builds publish to the org's site** — when you publish a build that lives in a shared org folder, it now always goes to that org's `axibuilds` repository (and the org's GitHub Pages site) regardless of your personal publishing target. Your personal publishing settings are unaffected.

### Bug Fixes

- **Publishing "Repository owner" dropdown now works** — the dropdown in Settings → Publishing was toggling open but the menu was invisible. The menu is now rendered via a portal (appended to `document.body`) so it escapes the modal's overflow and stacking-context constraints that were clipping it.

---

## Version v0.6.3 — April 16, 2026

### New Features

- **Build change history with revert support** — every save now records a timestamped history entry. Right-click any build in the library and choose **View History** to see a log of local saves and sync-received changes (with author and what changed). Each entry has a "Revert to this version" button to roll back to that snapshot.

### Bug Fixes

- **Game mode toggle no longer gets stuck** — loading a build from the library could leave the PvE/WvW buttons showing the wrong active state, causing clicks to silently do nothing. This is now fixed.
- **Disconnect button in settings now works** — clicking Disconnect did nothing in some cases. Now shows a confirmation dialog and properly disconnects.
- **Both settings sections no longer show at the same time** — the shared library setup and connected sections could briefly appear simultaneously when opening settings. Fixed.
- **Synced notes and other fields now appear immediately when opening a build** — if a remote change arrived between the last library render and clicking Load, the build could open with stale data. A fresh fetch is now done at load time.
- **Builds updated remotely no longer silently overwrite unsaved local edits** — if you have unsaved changes in the editor and another user syncs an update, you now get a toast notification instead of losing your work.

### Other Changes

- **Sync is much faster to detect changes** — polling now does a single lightweight API call (HEAD SHA check) first; a full tree fetch only happens when something actually changed. This makes the 60-second poll essentially free when nothing has changed.
- **Changes from other users appear when you switch back to the app** — the app now pulls for updates when the window gains focus (with a 10-second cooldown), so you see fresh data as soon as you return from another window rather than waiting for the next poll.
- **Sync starts immediately on launch** — on startup the app now pulls right away instead of waiting up to 60 seconds for the first poll tick.
- **Concurrent sync requests are coalesced** — rapid focus switches or multiple triggers no longer stack up parallel fetches that could race and corrupt local data.
- **Rate limit and auth errors are handled gracefully** — hitting the GitHub API rate limit pauses sync automatically and resumes after the backoff window. An expired token stops polling and surfaces an error in the UI instead of retrying indefinitely.

---

## Version v0.6.2 — April 16, 2026

### New Features
- **Connecting to a shared org automatically opens the library** — after clicking Connect, the settings modal closes and you're taken straight to the library with the shared folder already visible and showing its sync progress. Previously you had to navigate there manually.

### Bug Fixes
- **Builds and comps update live when another user changes them** — previously, a change synced from another user (such as a gamemode change) would be written to the local store but the library wouldn't reflect it until you navigated away and back. The library now updates immediately as items finish syncing, so nothing unexpectedly disappears from view.

## Version v0.6.1 — April 16, 2026

### Bug Fixes
- **App no longer crashes on launch** — a missing closing brace introduced in v0.6.0 caused a syntax error that prevented the app from starting. This patch resolves the crash.

## Version v0.6.0 — April 16, 2026

### New Features
- **Persistent sync status on every item** — builds and comps in shared folders now always show a green checkmark (✓) next to their name, a spinner while actively syncing, or a warning icon if the last sync failed. This works across all library views (list, table, grid, icon, columns) and updates live as items sync — similar to how OneDrive shows per-file sync state. The status also appears correctly after a re-render, not just during the sync event.
- **"Sync Now" syncs the entire folder tree** — right-clicking a shared folder (or any subfolder within it) and choosing "Sync Now" now pulls all builds, comps, and subfolders under the shared root, and shows the folder spinner while in progress.

### Bug Fixes
- **Push queue no longer silently swallows errors** — previously a failed push could cause subsequent items in the queue to run concurrently, risking SHA conflicts. The queue now correctly re-throws failures so serialization is maintained.
- **Sharing a folder is now serialized with pending saves** — sharing a folder with existing builds no longer races with debounced push timers for the same items.
- **Unsharing a folder cancels pending pushes** — any builds or comps that were queued to sync are now cancelled when their folder is unshared, preventing them from re-appearing on GitHub after removal.
- **Unsharing fails cleanly if GitHub deletion errors** — if any file fails to delete during unshare, the folder is no longer incorrectly marked as unshared locally, leaving the state consistent.
- **Force-push is now serialized** — the "force push" operation now goes through the same queue as normal pushes, preventing concurrent commits.
- **Disconnecting cancels all pending syncs** — pending push timers are now cleared when you disconnect from the shared library, preventing spurious errors after disconnect.

## Version v0.5.4 — April 16, 2026

### Bug Fixes
- **Sharing a folder now uploads all existing builds and comps** — when sharing a folder that already contained builds (including those in subfolders), none of the content was being pushed to GitHub. Only the folder metadata was uploaded. This is now fixed: all builds and comps in the folder and its subfolders are pushed when you share.
- **Share and Unshare now show sync progress** — the spinner and checkmark indicators now appear in the sidebar and content area during share and unshare operations, the same as they do for regular saves.

## Version v0.5.3 — April 16, 2026

### Bug Fixes
- **"Unshare Folder" option now appears for org owners** — the option was missing from the shared folder context menu even when the user was an org owner. This was caused by a transient GitHub API failure during setup silently overwriting the owner flag with `false`. The app now self-heals the flag on the next library open and is more resilient to API failures when determining org role.

## Version v0.5.2 — April 16, 2026

### Bug Fixes
- **Renaming a build as a member no longer makes it disappear** — if saving failed for any reason the inline rename input would get stuck in the DOM. Now the library always re-renders correctly and shows an error toast if something goes wrong.
- **Builds not fully syncing when moving a comp into a shared folder** — when multiple builds were pushed at the same time they could race and partially fail. Pushes are now serialized, and a failed push due to a stale SHA automatically retries using the latest remote SHA.
- **Subfolder change not picked up during comp moves** — builds that were already in the destination subfolder would be skipped and their subfolder metadata on GitHub would go stale. They are now re-synced along with the rest.
- **Sync failures are now visible** — when a push to GitHub fails (e.g. insufficient repository access), a toast notification is shown instead of failing silently.
- **Library now pulls fresh data when you open it** — instead of waiting up to 5 minutes for the background poller, the shared library syncs immediately whenever you navigate to the library page.

## Version v0.5.1 — April 16, 2026

### New Features
- **Shared library permissions** — only org owners can unshare a shared folder or move builds and comps out of one. The "Unshare" and "Move to Folder" options are hidden from the menu for regular members, and drag-and-drop moves out of shared folders are silently blocked. Moving a comp into a shared folder now warns you if any of its referenced builds live outside the folder, and offers to move them together so everything stays in sync. Unsharing a folder now also removes all of its content from the GitHub repository.

## Version v0.5.0 — April 16, 2026

### New Features
- **Shared build library via GitHub organizations** — org members can now share build folders with their entire organization. An admin sets up the shared library once from Settings → Shared Library, then any org member can connect and get all shared folders pulled down automatically. Changes sync in real time: saving a build pushes to GitHub within 2 seconds, and the app polls for remote changes every 5 minutes. Shared folders show a sync status indicator (spinner while syncing, checkmark when done) in the sidebar, content area, and build editor. Subfolders within shared folders are also synced via `meta.json`, so the full folder hierarchy is preserved for new members.
- **Signet active skill effects** — signets now have a 3-state toggle: passive on, passive off, and active used. The "active" state simulates using the signet's active skill, showing the stat changes that result (e.g. Signet of Bane removes its passive power bonus and applies the active effect). The Attributes panel and stat breakdown tooltips update immediately when toggling.

### Bug Fixes
- Fixed a double-scrollbar issue on certain panel layouts caused by incorrect total height calculation.

## Version v0.4.3 — April 15, 2026

### Bug Fixes
- **Builds appeared to disappear after updating to v0.4.2** — an internal app-name change in v0.4.2 caused Electron to store data under a new folder, leaving existing builds stranded at the previous location. This release restores the original data path so your builds reappear automatically on launch. No data was lost; if you want to verify, your builds live at `~/.config/axiforge-desktop/data/` on Linux and `%APPDATA%/axiforge-desktop/data/` on Windows.

## Version v0.4.2 — April 15, 2026

### New Features
- **Signet passive toggles** — the Equipment tab now includes a Signet Passives section alongside the boon and sigil toggles. Equipped stat-granting signets (Bane Signet, Signet of Might, Signet of Spite, and others) show a toggle that is on by default. Click or right-click to simulate using the signet's active, and the Attributes panel plus stat breakdown tooltips update immediately.

### Bug Fixes
- **Attributes showed wrong Crit Chance** — the displayed Critical Chance now matches the value used in calculations.
- **Party Coverage missing boons** — boons applied by traits and signets now appear correctly in Party Coverage.
- **Published comps re-encrypt on republish** — when a build inside a published comp is republished, the comp is now re-encrypted so viewers see the updated build.
- **Immobilize not registering on Entangle** — the wiki parser now recognizes both "immobilize" and "chill" condition variants, so Entangle and similar skills report the correct conditions.
- **KDE taskbar grouping** — the dev-mode window now shows its own taskbar icon in KDE/Wayland instead of being grouped with whichever process launched Electron.

## Version v0.4.1 — April 15, 2026

### New Features
- **Window size and position persistence** — the app now remembers your window size and position between launches, so it reopens exactly where you left it.

### Bug Fixes
- **Fixed titlebar overlap on Linux AppImage** — the app content no longer bleeds into the titlebar area in packaged Linux builds. This was caused by a conflict between Electron's `titleBarStyle` and the custom frameless window on Linux.
- **Discord release notifications** — webhook messages now display with the correct bot identity and include the app avatar as an embed thumbnail.

## Version v0.4.0 — April 12, 2026

### New Features
- **Themed build pages** — a new "Themed build pages" toggle in Settings applies per-profession color themes to build pages. When enabled, opening a build shifts the entire UI (backgrounds, panels, accents, buttons) to match the profession's colors: Guardian blue, Warrior orange, Necromancer green, Engineer copper, Ranger lime, Thief rose, Mesmer purple, Elementalist red, and Revenant burgundy. Navigate away and the theme smoothly transitions back to your chosen palette. Published build links bake in the profession theme so viewers see it in the browser too.
- **Builds can belong to multiple compositions** — builds are no longer locked to a single comp. The editor now shows a Comps tab listing all linked compositions, and context menus offer per-comp unlinking. Duplicating a build no longer carries over comp associations.

## Version v0.3.14 — April 11, 2026

### Bug Fixes
- Build and comp notes are no longer silently cut off at 12,000 characters — the limit has been raised to 100,000 characters, supporting long-form build guides
- Windows taskbar icon now follows the system/taskbar theme instead of the app theme

## Version v0.3.13 — April 11, 2026

### Bug Fixes
- Weapon swapping between a two-handed weapon set and a one-handed weapon set no longer miscounts infusions — previously, switching to a one-handed mainhand would count an extra infusion slot
- Stat breakdown hover tooltip rows now align consistently (removed misaligned icons)

### Other Changes
- Dev mode no longer suppresses window focus on Vite hot-reload

## Version v0.3.12 — April 11, 2026

### New Features
- Stat breakdown hover now shows the specific trait name (e.g. "Forceful Greatsword") instead of a generic "Trait bonus" label
- Stat breakdown entries now display a colored category pill (trait, equipment, boon, food, rune, sigil, etc.) for easier identification
- App icon now adapts to system theme on macOS and Windows (light icon on dark backgrounds, dark icon on light backgrounds)

### Bug Fixes
- Forceful Greatsword warrior trait now correctly doubles its Power bonus (+120 → +240) when a greatsword or underwater spear is equipped

## Version v0.3.11 — April 11, 2026

### Bug Fixes
- Composition builder now analyzes weapon skills from all Elementalist attunements, not just the active one — blast finishers like Frozen Burst, Earthquake, and Churning Earth are now correctly listed
- Composition builder now includes combo finishers and fields from utility bundle skills (e.g., Engineer kits, Elementalist conjure weapons)
- Fixed build library table view header having a gap below the filter bar and rows rendering above the sticky header when scrolling

## Version v0.3.10 — April 10, 2026

### Bug Fixes
- Fixed Pinnacle of Strength trait applying +10 Power as a passive bonus instead of correctly modifying Might per-stack Power (30 → 40 per stack)
- Fixed Pinnacle of Strength not granting its passive 5% critical chance increase
- Fixed signet passive stat bonuses not updating the attributes panel immediately when selecting a skill — previously required saving the build first

## Version v0.3.9 — April 10, 2026

### Bug Fixes
- Fixed equipment stats not being preserved when sharing builds via axicode — mixed-stat builds (e.g. Berserker armor + Assassin trinkets) now encode and decode per-slot stats correctly
- Fixed imported axicode builds showing "Select stats..." on all equipment slots instead of the actual stat combo

### Other Changes
- Moved axicode source into the monorepo under `packages/axicode` and renamed packages to the `@axiapps` scope (`@axiapps/code`, `@axiapps/gw2-data`)

## Version v0.3.8 — April 10, 2026

### Bug Fixes
- Fixed Critical Strike Chance calculation being 5% too high across all builds — the formula was double-counting the base crit chance on top of what Precision already provides (#193)
- Crit Chance now displays with 2 decimal places to match the in-game tooltip precision

## Version v0.3.7 — April 10, 2026

### Bug Fixes
- Fixed weapon dropdowns showing empty after clearing the API cache — the in-memory catalog cache was not being flushed alongside the disk cache, causing stale data to be served

## Version v0.3.6 — April 10, 2026

### Bug Fixes
- Fixed the shared build website (SPA) pegging CPU to 100% and causing high temperatures in Chrome and Edge — the ambient background animation now uses GPU-composited transforms instead of expensive gradient repaints

## Version v0.3.5 — April 10, 2026

### Bug Fixes
- Fixed a bug where clicking Save could delete equipped weapons (greatsword, axe, etc.) from a build, making them impossible to re-equip
- Fixed catalog cache not distinguishing between game modes, which could return stale data when switching between PvE, WvW, and PvP

## Version v0.3.4 — April 10, 2026

### Bug Fixes
- Fixed Discord webhook sharing failing with a 400 error for large comps — embeds that exceed Discord's 6000-character or 25-field limits are now automatically split across multiple embeds (grid in the first, build legend in continuation embeds)
- Discord error responses now include the full error body in the error message, making it easier to diagnose webhook issues
- Comp titles and descriptions that exceed Discord's limits are now truncated gracefully instead of causing a rejection

## Version v0.3.3 — April 10, 2026

### Bug Fixes
- Fixed "require is not defined" error in packaged builds — the gw2-data engine CJS modules are now properly converted to ESM during the renderer Vite build

## Version v0.3.2 — April 10, 2026

### Bug Fixes
- Fixed crash on AppImage launch caused by EPIPE error when stdout/stderr pipe is closed by the parent process

## Version v0.3.1 — April 10, 2026

### Bug Fixes
- Fixed crash on launch for Linux AppImage and Windows installer builds — the new gw2-data package was not being included in the packaged app

## Version v0.3.0 — April 10, 2026

### New Features
- New `@axi/gw2-data` engine package — stat computation, boon analysis, combo detection, and tooltip rendering are now powered by a dedicated calculation engine with full test coverage
- Wiki-sourced skill and trait facts replace hardcoded balance split data, providing accurate per-mode (PvE/WvW/PvP) tooltips that stay up-to-date with game patches
- Wiki shared-name resolution automatically disambiguates skills and traits that share names across professions
- Recharge and cast time badges now appear in tooltip and detail panel headers
- Discord embed notifications for new releases (when webhook is configured)
- Color theme system with 9 forge-themed palettes

### Bug Fixes
- Published web builds no longer show a blank page (fixed CJS-to-ESM conversion for the gw2-data engine package in the Vite SPA build)
- @Weapons tags now render as styled chips with icons in published builds instead of raw text
- Percentage-based wiki facts now correctly preserve the % symbol
- Profession dropdown is now disabled until all catalogs finish loading, preventing selection errors
- Berserker Burst Recharge reduction now displays correctly in tooltips
- Fatal Frenzy trait now shows correct Condition Damage values and proper PvE/WvW split
- Berserker Blood Reaction trait bonuses now apply correctly, including berserk toggle from skills panel
- Signet of Fury passive bonus and active bonus now display correctly in tooltips
- Weapon tooltips now show proper timing badges and recharge values
- Elementalist tooltips no longer show incorrect values
- Infusion stat calculations now compute correctly
- Missing tooltips for traits with WvW splits now display properly
- Hover tooltips now use compact trait skill lists instead of full skill cards

### Other Changes
- Renderer modules now delegate stat computation to the engine bridge instead of duplicating logic
- Wiki name collision detection with profession-specific suffix retries
- In-memory catalog caching and concurrent request deduplication for faster load times

## Version v0.2.0 — April 9, 2026

### New Features
- Complete visual overhaul with the new "Cool Midnight + Clean Orange" design language
- Modernized color palette with warm orange accents replacing the previous blue theme across all interactive elements
- Updated typography system using Outfit for headings and DM Sans for body text
- Redesigned settings modal with card-based sections, SVG icons, and staggered entrance animations
- Published SPA rebranded with the AxiForge orange/gold color scheme and updated navbar branding

### Other Changes
- Migrated all focus states, selection highlights, toggles, tooltips, and drag indicators to the new accent color
- Updated mobile styles for color consistency with the desktop app

## Version v0.1.9 — April 8, 2026

### Bug Fixes
- Rune, sigil, food, utility, and relic mentions in build notes now render as styled tooltip chips in the published SPA instead of plain text
- Generic `@[item:...]` mentions are automatically resolved to their specific type (rune, food, sigil, etc.) at publish time
- Unresolved mentions now render as styled chips instead of falling back to plain text

### Other Changes
- Unified design system with consistent CSS tokens across all UI components

## Version v0.1.8 — April 7, 2026

### New Features
- Build editor now starts with a completely blank state — no profession, specializations, traits, or skills are pre-selected
- Empty specialization slots display interactive placeholder cards that open the spec picker on click
- Skill bar renders disabled placeholder slots (weapon, heal, utility, elite) when no profession is selected
- Profession dropdown shows placeholder text instead of defaulting to the first class
- Selecting a new specialization no longer auto-picks the first trait in each tier — all trait choices start blank
- Switching professions or starting a new build no longer auto-fills skills

## Version v0.1.7 — April 6, 2026

### Bug Fixes
- Relic of the Thief tooltip now shows Stack Duration and Maximum Stacks facts
- Fixes CI test failures from v0.1.6

## Version v0.1.6 — April 6, 2026

### New Features
- Skill tooltips now show traited fact overrides when matching traits are equipped
- Weapon @ mentions in build notes for quick reference
- Expanded signet passive buff audit coverage across all professions

### Bug Fixes
- Paragon Strengthening Stanzas trait now shows accurate chant effect descriptions instead of raw numbers
- Signet passive buffs now properly affect stat totals
- Forceful Greatsword and other trait passive buffs now correctly apply to stat totals
- Berserker burst recharge reduction no longer missing from tooltip calculations
- Versatile Rage now shows correct 5s recharge rate and tooltip timing
- Wiki audit parser now correctly handles percentage-based buff descriptions (e.g. Paragon chants)

### Other Changes
- Updated WvW skill balance split data

## Version v0.1.5 — April 6, 2026

### New Features
- Hovering over relics in the relic selector dropdown now shows a tooltip with the relic's description and effects, anchored to the side of the menu

## Version v0.1.4 — April 5, 2026

### Bug Fixes
- Two-handed weapons (greatsword, hammer, longbow, rifle, short bow, staff, spear) now correctly show higher stats than one-handed weapons
- Boon coverage tracker now uses correct stat weights for two-handed weapons

## Version v0.1.3 — April 5, 2026

### Other Changes
- App titlebar badge updated from "alpha" to "beta"
- Simplified release process to standard semver versioning

## Version v0.1.2 — April 5, 2026

### New Features
- Burst recharge reduction is now included in stat calculations
- Updated WvW skill balance splits data

### Bug Fixes
- Trait connector lines in published web builds now stay aligned when the browser window is resized

## Version v0.1.0 — April 1, 2026

### New Features
- Grouped profession selector for streamlined build creation
- Handle all trait-modified boon values including fury stats, might modifier, and game-mode splits
- Add 15 missing stat sets for PvE and WvW

### Bug Fixes
- Allow more than 5 players per party line in comp view (auto-expands on drop)
- Imported build codes without an elite spec now correctly name the build after the core profession
- Traits now properly respect assumed boons
- Include relic description and facts in SPA published builds and equipment panel
- Add missing Giver's stats
- Builds in profession smart folders now appear correctly under All Builds

