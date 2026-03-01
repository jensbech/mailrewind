# Year Threshold Filter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add "After [year]" and "Before [year]" threshold inputs to the year picker dropdown, and fix the empty-state copy.

**Architecture:** Two new state values (`yearAfter`, `yearBefore`) in App.jsx flow as props into YearPicker, as query params to the API routes, and as SQL conditions in database.js. The existing discrete year multi-select is unchanged; thresholds stack additively with it.

**Tech Stack:** React (JSX), CSS custom properties, Express.js, better-sqlite3

---

### Task 1: Fix empty-state copy

**Files:**
- Modify: `client/src/App.jsx:413`

**Step 1: Make the change**

Find the line:
```jsx
<p>Select a letter to read</p>
```
Change to:
```jsx
<p>Select a mail</p>
```

**Step 2: Commit**

```bash
git add client/src/App.jsx
git commit -m "fix: update empty state copy to 'Select a mail'"
```

---

### Task 2: Add yearAfter / yearBefore state to App.jsx

**Files:**
- Modify: `client/src/App.jsx`

**Step 1: Add state declarations** (after `yearFilter` state, ~line 48)

```jsx
const [yearAfter, setYearAfter] = useState(null);
const [yearBefore, setYearBefore] = useState(null);
```

**Step 2: Add params to fetchEmails** (inside `fetchEmails`, after the `yearFilter` params line ~line 138)

```js
if (yearAfter != null) params.yearAfter = yearAfter;
if (yearBefore != null) params.yearBefore = yearBefore;
```

**Step 3: Add to fetchEmails dependency array** (~line 170)

Add `yearAfter, yearBefore` to the `useCallback` dependency array.

**Step 4: Add to activeFilterCount** (~line 220)

```js
const activeFilterCount = [hasAttachments, largeAttachment, hasHtml, hasSubject, attachmentType].filter(Boolean).length
  + fromDomains.length + yearFilter.length
  + (yearAfter != null ? 1 : 0) + (yearBefore != null ? 1 : 0);
```

**Step 5: Add to clearAllFilters** (~line 222)

```js
setYearAfter(null);
setYearBefore(null);
```

**Step 6: Pass props to YearPicker** (~line 360)

```jsx
<YearPicker
  years={years}
  value={yearFilter}
  onChange={setYearFilter}
  afterValue={yearAfter}
  beforeValue={yearBefore}
  onAfterChange={setYearAfter}
  onBeforeChange={setYearBefore}
/>
```

**Step 7: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat: add yearAfter/yearBefore state and params in App"
```

---

### Task 3: Update YearPicker component

**Files:**
- Modify: `client/src/components/YearPicker.jsx`

**Step 1: Accept new props**

```jsx
export default function YearPicker({ years, value, onChange, afterValue, beforeValue, onAfterChange, onBeforeChange }) {
```

**Step 2: Update trigger label** to reflect thresholds

Replace the existing `label` computation:
```jsx
const label = (() => {
  const parts = [];
  if (afterValue != null && beforeValue != null) parts.push(`${afterValue}–${beforeValue}`);
  else if (afterValue != null) parts.push(`After ${afterValue}`);
  else if (beforeValue != null) parts.push(`Before ${beforeValue}`);
  if (value.length === 1) parts.push(String(value[0]));
  else if (value.length > 1) parts.push(`${value.length} years`);
  return parts.length > 0 ? parts.join(' · ') : 'All years';
})();
```

**Step 3: Add threshold rows at the top of the dropdown**, above the "All years" button:

```jsx
{open && (
  <div className="year-picker-dropdown">
    <div className="year-picker-thresholds">
      <label className="year-picker-threshold-row">
        <span className="year-picker-threshold-label">After</span>
        <input
          className="year-picker-threshold-input"
          type="number"
          placeholder="year"
          value={afterValue ?? ''}
          onMouseDown={e => e.stopPropagation()}
          onChange={e => {
            const v = e.target.value;
            onAfterChange(v === '' ? null : parseInt(v, 10));
          }}
        />
      </label>
      <label className="year-picker-threshold-row">
        <span className="year-picker-threshold-label">Before</span>
        <input
          className="year-picker-threshold-input"
          type="number"
          placeholder="year"
          value={beforeValue ?? ''}
          onMouseDown={e => e.stopPropagation()}
          onChange={e => {
            const v = e.target.value;
            onBeforeChange(v === '' ? null : parseInt(v, 10));
          }}
        />
      </label>
    </div>
    <div className="year-picker-divider" />
    <button
      className={`year-picker-item${value.length === 0 ? ' selected' : ''}`}
      onMouseDown={e => { e.preventDefault(); onChange([]); }}
    >
      ...existing All years + year list...
    </button>
    ...existing year list...
  </div>
)}
```

Note: keep the existing "All years" button and year map below the divider intact.

**Step 4: Commit**

```bash
git add client/src/components/YearPicker.jsx
git commit -m "feat: add before/after threshold inputs to YearPicker"
```

---

### Task 4: Add CSS for threshold rows

**Files:**
- Modify: `client/src/App.css` (after `.year-picker-dropdown` block, ~line 441)

**Step 1: Add styles**

```css
.year-picker-thresholds {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 6px 2px;
}

.year-picker-threshold-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: default;
}

.year-picker-threshold-label {
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--text-2);
  width: 36px;
}

.year-picker-threshold-input {
  width: 64px;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-2);
  color: var(--text-1);
  font-family: var(--font-sans);
  font-size: 12px;
  outline: none;
}

.year-picker-threshold-input:focus {
  border-color: var(--accent);
}

.year-picker-threshold-input::-webkit-inner-spin-button,
.year-picker-threshold-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
}

.year-picker-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
```

**Step 2: Commit**

```bash
git add client/src/App.css
git commit -m "feat: add CSS for year picker threshold inputs"
```

---

### Task 5: Update API routes in server

**Files:**
- Modify: `src/app.js`

**Step 1: Parse yearAfter/yearBefore in `/api/emails`** (after the `years` parse line ~line 159)

```js
const yearAfter = req.query.yearAfter ? parseInt(req.query.yearAfter) : null;
const yearBefore = req.query.yearBefore ? parseInt(req.query.yearBefore) : null;
```

Update the `getEmails` call to pass them:
```js
res.json(await getEmails(db, limit, offset, years, sort, mailboxIds, hasAttachments, month, hasHtml, hasSubject, fromDomains, attachmentType, largeAttachment, yearAfter, yearBefore));
```

**Step 2: Same for `/api/search`** (after the `years` parse line ~line 189)

```js
const yearAfter = req.query.yearAfter ? parseInt(req.query.yearAfter) : null;
const yearBefore = req.query.yearBefore ? parseInt(req.query.yearBefore) : null;
```

Update the `searchEmails` call:
```js
res.json(await searchEmails(db, q, parseInt(limit), parseInt(offset), years, sort === 'asc' ? 'asc' : 'desc', mailboxIds, hasAttachments, month, hasHtml, hasSubject, fromDomains, attachmentType, largeAttachment, yearAfter, yearBefore));
```

**Step 3: Commit**

```bash
git add src/app.js
git commit -m "feat: pass yearAfter/yearBefore through API routes"
```

---

### Task 6: Update database query functions

**Files:**
- Modify: `src/db/database.js`

**Step 1: Add params to `getEmails` signature** (~line 117)

```js
export function getEmails(db, limit = 50, offset = 0, years = null, sort = 'desc', mailboxIds = null, hasAttachments = false, month = null, hasHtml = false, hasSubject = false, fromDomains = null, attachmentType = null, largeAttachment = false, yearAfter = null, yearBefore = null) {
```

**Step 2: Add SQL conditions** after the `years` block (~line 133)

```js
if (yearAfter != null) {
  conditions.push('date >= ?');
  params.push(new Date(`${yearAfter}-01-01`).getTime());
}
if (yearBefore != null) {
  conditions.push('date < ?');
  params.push(new Date(`${yearBefore}-01-01`).getTime());
}
```

**Step 3: Same for `searchEmails` signature** (~line 163)

```js
export function searchEmails(db, query, limit = 50, offset = 0, years = null, sort = 'desc', mailboxIds = null, hasAttachments = false, month = null, hasHtml = false, hasSubject = false, fromDomains = null, attachmentType = null, largeAttachment = false, yearAfter = null, yearBefore = null) {
```

**Step 4: Add same SQL conditions** in `searchEmails` after its `years` block

```js
if (yearAfter != null) {
  conditions.push('date >= ?');
  params.push(new Date(`${yearAfter}-01-01`).getTime());
}
if (yearBefore != null) {
  conditions.push('date < ?');
  params.push(new Date(`${yearBefore}-01-01`).getTime());
}
```

**Step 5: Commit**

```bash
git add src/db/database.js
git commit -m "feat: add yearAfter/yearBefore SQL filter conditions"
```
