# Party Coverage Mobile Responsiveness

## Problem

The party coverage component in the SPA has no responsive styles. On mobile phones (~375px), the line header packs chevron + label + 5 profession icons + 12 boon icons into a single row, causing overflow or crushed icons. The expanded body sections also waste horizontal and vertical space at narrow widths.

## Target

SPA viewed on mobile phones. Desktop and Electron layouts remain unchanged.

## Approach

Add a `@media (max-width: 480px)` block to `comps.css` with targeted overrides. No HTML or JS changes.

## Changes

### 1. Header boon overflow

Add `flex-wrap: wrap` and `justify-content: flex-end` to `.party-cov__header-boons`.

- Boons that fit remain on row 1 next to the profession icons.
- Overflow boons wrap to a second row, right-aligned beneath the first.
- Chevron, label, and profession icons never wrap — only the boons container wraps internally.

### 2. Reduce horizontal padding

Tighten side padding on mobile to reclaim horizontal space:

| Selector | Desktop | Mobile |
|---|---|---|
| `.party-cov__line-header` | `padding: 10px 16px` | `padding: 10px 10px` |
| `.party-cov__line-body` | `padding: 4px 16px 16px` | `padding: 4px 10px 12px` |
| `.party-cov__section` | `padding: 10px 12px` | `padding: 8px 10px` |

### 3. Reduce vertical dead space

Tighten vertical margins/padding to reduce gaps between elements:

| Selector | Desktop | Mobile |
|---|---|---|
| `.party-cov__line` | `margin-bottom: 8px` | `margin-bottom: 6px` |
| `.party-cov__section` | `margin-bottom: 8px` | `margin-bottom: 6px` |
| `.comp-boon-cov__body` | `padding: 0 12px 12px` | `padding: 0 8px 8px` |

### 4. No touch target changes

Pills and source rows retain their current sizes. No padding increases for touch targets.

### 5. Desktop unchanged

All changes are scoped behind `@media (max-width: 480px)`. No existing styles are modified.

## Files Modified

- `src/renderer/styles/comps.css` — append mobile media query block after the existing party coverage styles (~line 2155)

## Testing

- Verify on Chrome DevTools mobile emulation (iPhone SE, 375px) that:
  - Collapsed headers show boons wrapping right-aligned when they overflow
  - Expanded body sections have tighter padding with no horizontal overflow
  - Desktop layout at >480px is unchanged
- Run existing Playwright tests to confirm no regressions
