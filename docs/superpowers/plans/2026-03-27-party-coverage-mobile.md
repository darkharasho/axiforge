# Party Coverage Mobile Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the party coverage component responsive on mobile phones in the SPA by adding CSS-only overrides behind a media query.

**Architecture:** Append a single `@media (max-width: 480px)` block to the end of the party coverage styles in `comps.css`. No HTML or JS changes. Desktop layout unchanged.

**Tech Stack:** CSS (media queries, flexbox)

**Spec:** `docs/superpowers/specs/2026-03-27-party-coverage-mobile-design.md`

---

### Task 1: Add mobile media query for party coverage

**Files:**
- Modify: `src/renderer/styles/comps.css:2155` (append after last party-cov rule)

- [ ] **Step 1: Add the mobile media query block**

Append this block at the end of `src/renderer/styles/comps.css` (after line 2155, the `.party-cov__src-target--self` rule):

```css
/* ── Party Coverage: mobile overrides ────────────────────────────────── */
@media (max-width: 480px) {
  /* Boon icons wrap to second row, right-aligned */
  .party-cov__header-boons {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  /* Tighten horizontal padding */
  .party-cov__line-header {
    padding: 10px 10px;
  }

  .party-cov__line-body {
    padding: 4px 10px 12px;
  }

  .party-cov__section {
    padding: 8px 10px;
  }

  /* Tighten vertical spacing */
  .party-cov__line {
    margin-bottom: 6px;
  }

  .party-cov__section {
    margin-bottom: 6px;
  }

  .comp-boon-cov__body {
    padding: 0 8px 8px;
  }
}
```

- [ ] **Step 2: Verify no duplicate `.party-cov__section` in the media query**

The two `.party-cov__section` rules in the media query should be merged into one:

```css
  .party-cov__section {
    padding: 8px 10px;
    margin-bottom: 6px;
  }
```

Update the block so the final media query is:

```css
/* ── Party Coverage: mobile overrides ────────────────────────────────── */
@media (max-width: 480px) {
  /* Boon icons wrap to second row, right-aligned */
  .party-cov__header-boons {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  /* Tighten horizontal padding */
  .party-cov__line-header {
    padding: 10px 10px;
  }

  .party-cov__line-body {
    padding: 4px 10px 12px;
  }

  .party-cov__section {
    padding: 8px 10px;
    margin-bottom: 6px;
  }

  /* Tighten vertical spacing */
  .party-cov__line {
    margin-bottom: 6px;
  }

  .comp-boon-cov__body {
    padding: 0 8px 8px;
  }
}
```

- [ ] **Step 3: Run unit tests to check for regressions**

Run: `npm test`
Expected: All existing tests pass (CSS-only change, no logic affected).

- [ ] **Step 4: Run SPA Playwright tests**

Run: `npm run test:spa`
Expected: All existing SPA tests pass. The `comp-boon-collapse` spec tests collapse/expand behavior which is unaffected by padding changes.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles/comps.css
git commit -m "style: add mobile responsive overrides for party coverage"
```
