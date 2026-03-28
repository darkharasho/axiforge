# Party Coverage Playwright Tests — Design Spec

## Overview

Add Playwright tests for the party coverage feature in both the Electron desktop app (E2E) and the web SPA. Tests cover rendering, visibility, and user interactions (expand/collapse, pill click-to-expand, self-boon toggle). SPA tests additionally cover mobile responsive behavior.

## Approach

Separate spec files per environment (Approach A), following existing project conventions:
- `tests/e2e/specs/party-coverage.spec.js`
- `tests/spa/specs/party-coverage.spec.js`

No shared helpers across e2e/spa — each file is self-contained.

## Test Data

### Profession Selection

Chosen for complementary coverage across all three categories:

| Profession   | Boons | Combo Fields | Combo Finishers | Role in Tests            |
|-------------|-------|-------------|----------------|--------------------------|
| Guardian     | 337   | 24          | 19             | Strong boon provider     |
| Elementalist | 627   | 53          | 51             | Strong fields + boons    |
| Warrior      | 436   | 9           | 64             | Strongest finishers      |
| Necromancer  | 294   | 15          | 15             | Sparse coverage baseline |

### Comp Structure

Two party lines:
- **P1:** Guardian + Elementalist (well-covered line — boons, fields, and finishers)
- **P2:** Warrior + Necromancer (sparse boons, strong finishers)

### E2E Seeding

Builds created with `makeTestBuild()` using real skill/trait IDs from fixture catalogs (guardian-catalog.json, elementalist-catalog.json, etc.). Seeded via `seedBuildFile()` / `seedCompFile()`. App launched with mock GW2 API server. Party coverage computed live by `computeCompPartyCoverage()`.

### SPA Seeding

Builds created with `makeTestBuild()` using real skill IDs, then passed through `generateCompPayload()` which calls `serializeForPublish()` — this triggers the real computation pipeline and embeds party coverage HTML in the encrypted payload. Loaded via `loadCompPage()` route mocking.

## E2E Test Cases (Electron App)

### Rendering & Visibility

1. **Party coverage container renders** — after comp opens and async compute completes, `#comp-boon-coverage-body` has children
2. **Two party lines appear** — two `.party-cov__line` elements with `data-line-label="P1"` and `data-line-label="P2"`
3. **P1 header shows profession icons** — `.party-cov__header-profs` contains Guardian + Elementalist SVG icons
4. **P1 has covered boon pills** — at least one `.party-cov__pill--boon` without `.party-cov__pill--uncovered` class (Guardian provides Might heavily)
5. **P1 has combo field pills** — `.party-cov__pill--field` elements present (Elementalist strong field coverage)
6. **P2 has finisher pills** — `.party-cov__pill--finisher` elements present (Warrior strongest finisher count)
7. **Uncovered boons styled correctly** — `.party-cov__pill--uncovered` class present on boons with no ally providers
8. **Count badges on multi-provider boons** — `.party-cov__pill-badge` visible with `×N` text when N > 1

### Interactions

9. **Line header expand/collapse** — clicking `.party-cov__line-header` toggles `.party-cov__line-body--collapsed` class; chevron (`.party-cov__line-chevron`) toggles between ▸ (collapsed) and ▾ (expanded)
10. **Lines start collapsed** — `.party-cov__line-body` has `.party-cov__line-body--collapsed` on initial render
11. **Boon pill expand** — clicking a covered boon pill populates `.party-cov__expand[data-expand-for="boons"]` with detail HTML
12. **Boon detail content** — expanded detail shows `.party-cov__src-row` with profession icon (`.party-cov__src-icon`), skill name (`.party-cov__src-name`), duration (`.party-cov__src-dur`), and target badge (`.party-cov__src-target--ally` or `.party-cov__src-target--self`)
13. **Boon pill collapse** — clicking same pill again clears the expand container
14. **Self-boon toggle** — `.party-cov__toggle-input` checkbox: unchecked hides self-only boons (pills hidden or uncovered); checking reveals them
15. **Combo field pill expand** — clicking a field pill populates `.party-cov__expand[data-expand-for="fields"]` with source rows showing field type, duration, source name
16. **Finisher pill expand** — clicking a finisher pill populates `.party-cov__expand[data-expand-for="finishers"]` with source rows showing finisher type, hit count, source name

## SPA Test Cases

### Desktop Viewport (1280×800)

1. **Party coverage renders** — `.party-cov__line` elements present on comp page
2. **Two party lines with labels** — P1 and P2 labels visible
3. **P1 header content** — profession icons and covered boon indicators in header
4. **All three sections present** — `[data-section="boons"]`, `[data-section="fields"]`, `[data-section="finishers"]` per line
5. **Line expand/collapse** — clicking header toggles body visibility and chevron
6. **Boon pill expand** — clicking covered boon pill shows source detail rows
7. **Combo field pill expand** — clicking field pill shows source details
8. **Finisher pill expand** — clicking finisher pill shows source details
9. **Self-boon toggle** — toggling checkbox changes boon pill visibility

### Mobile Viewport (375×667)

10. **Party coverage renders at mobile width** — container visible without horizontal overflow
11. **Header boons wrap** — `.party-cov__header-boons` uses flex-wrap (mobile CSS override), boon icons wrap to multiple rows instead of overflowing
12. **Pills tappable at narrow width** — pill elements have sufficient size and are not clipped
13. **Expand/collapse works via tap** — line header and pill taps work same as desktop clicks
14. **Expanded detail fits viewport** — `.party-cov__expand` content does not exceed viewport width (no horizontal scroll)

## Key Selectors Reference

| Element                  | Selector                                        |
|--------------------------|------------------------------------------------|
| Party line               | `.party-cov__line`                             |
| Line label               | `.party-cov__line-label`                       |
| Line header (clickable)  | `.party-cov__line-header`                      |
| Line body                | `.party-cov__line-body`                        |
| Collapsed state          | `.party-cov__line-body--collapsed`             |
| Chevron                  | `.party-cov__line-chevron`                     |
| Header prof icons        | `.party-cov__header-profs`                     |
| Header boon icons        | `.party-cov__header-boons`                     |
| Section (by type)        | `.party-cov__section[data-section="boons"]`    |
| Boon pill                | `.party-cov__pill--boon`                       |
| Field pill               | `.party-cov__pill--field`                      |
| Finisher pill            | `.party-cov__pill--finisher`                   |
| Uncovered pill           | `.party-cov__pill--uncovered`                  |
| Count badge              | `.party-cov__pill-badge`                       |
| Self-boon toggle         | `.party-cov__toggle-input`                     |
| Expand container         | `.party-cov__expand[data-expand-for="..."]`    |
| Source row               | `.party-cov__src-row`                          |
| Source name              | `.party-cov__src-name`                         |
| Source duration          | `.party-cov__src-dur`                          |
| Source target (ally)     | `.party-cov__src-target--ally`                 |
| Source target (self)     | `.party-cov__src-target--self`                 |
| Boon coverage body (e2e) | `#comp-boon-coverage-body`                     |

## Build Fixture Strategy

Builds need real skill IDs that produce boon/field/finisher facts when scanned by the extraction pipeline. The fixture catalogs contain full GW2 API skill data with fact arrays.

For each profession, select skills known to produce facts:
- **Guardian:** Heal skill with Might/Regeneration, utility with Aegis/Protection, elite with Quickness
- **Elementalist:** Attunement skills with combo fields (Fire/Water/Ice), weapon skills with finishers
- **Warrior:** Burst skills with blast finishers, banners/shouts with boons
- **Necromancer:** Wells with combo fields, shroud skills with finishers

Exact skill IDs will be determined during implementation by inspecting fixture catalog JSON for skills with appropriate fact types.

## Files to Create

1. `tests/e2e/specs/party-coverage.spec.js` — 16 E2E test cases
2. `tests/spa/specs/party-coverage.spec.js` — 14 SPA test cases (9 desktop + 5 mobile, filtered by viewport tag)
