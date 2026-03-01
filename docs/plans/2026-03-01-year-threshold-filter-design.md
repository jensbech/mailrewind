# Year Threshold Filter Design

**Date:** 2026-03-01

## Overview

Add "before" and "after" year threshold inputs to the existing year picker dropdown, alongside the existing discrete year multi-select. Also fix the empty-state copy from "Select a letter to read" to "Select a mail".

## UI

Two compact rows at the top of the year picker dropdown, above the year list:

```
┌─────────────────────────────┐
│ After   [ 2015 ]            │
│ Before  [ 2022 ]            │
├─────────────────────────────┤
│ ✓ All years                 │
│   2024  (142)               │
│ ✓ 2023  (891)  ✓           │
│   2022  (1,203)             │
└─────────────────────────────┘
```

- Each row is a label + small number input (~60px wide)
- Empty input = no threshold applied
- Filter applies on blur or debounced input change
- Thresholds and discrete year checkboxes are additive (AND logic)

**Trigger label** updates to reflect active thresholds:
- Neither: `All years`
- After only: `After 2015`
- Before only: `Before 2022`
- Both: `2015–2022`
- With discrete years also checked: `2015–2022 · 3 years`

## State

Two new state values in `App.jsx`:

```js
const [yearAfter, setYearAfter] = useState(null);   // integer or null
const [yearBefore, setYearBefore] = useState(null);  // integer or null
```

Passed to `YearPicker` as `afterValue`, `beforeValue`, `onAfterChange`, `onBeforeChange`.

Both are included in `activeFilterCount` when non-null.

Both are reset by "Clear all" in the filter panel.

## Backend

### API

`/api/emails` and `/api/search` accept two new query params:
- `yearAfter` — integer year (inclusive lower bound: `>= yearAfter-01-01`)
- `yearBefore` — integer year (exclusive upper bound: `< yearBefore-01-01`)

### Database

`getEmails` and `searchEmails` in `database.js` get two new optional params (`yearAfter`, `yearBefore`). Each adds an `AND` condition when present:

- `yearAfter`: `date >= <yearAfter-01-01 ms timestamp>`
- `yearBefore`: `date < <yearBefore-01-01 ms timestamp>`

The existing `years` array clause is unchanged and stacks with these.

## Fixes

- Empty state copy: `"Select a letter to read"` → `"Select a mail"`
