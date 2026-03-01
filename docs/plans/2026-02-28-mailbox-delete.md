# Mailbox Deletion UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a hover-reveal × delete button to each mailbox chip with an inline "are you sure" confirmation, wired to the existing `DELETE /api/mailboxes/:id` backend endpoint.

**Architecture:** `MailboxBar` gets a `confirmDeleteId` state and an `onDeleteMailbox` prop. Each mailbox chip is wrapped in a `.mailbox-chip-wrap` div that reveals a small `×` button on hover. Clicking × sets `confirmDeleteId` to that mailbox id, replacing the chip with a compact "Delete «name»? Yes / No" row. Confirming calls `onDeleteMailbox(id)` in `App.jsx`, which calls the DELETE endpoint then refreshes the mailbox list.

**Tech Stack:** React 19 hooks (useState), axios, existing CSS design tokens, no new dependencies.

---

### Task 1: Add delete UI CSS

**Files:**
- Modify: `client/src/App.css` (append to end)

**Step 1: Append the new CSS block**

Add to the very end of `client/src/App.css`:

```css
/* ── Mailbox delete ───────────────────────────────────── */

.mailbox-chip-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.mailbox-chip-delete {
  position: absolute;
  right: -6px;
  top: -6px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-1);
  color: var(--text-2);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
  padding: 0;
}

.mailbox-chip-wrap:hover .mailbox-chip-delete {
  opacity: 1;
}

.mailbox-chip-delete:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.mailbox-chip-confirm {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid var(--accent);
  background: var(--bg-1);
  font-size: 11.5px;
  white-space: nowrap;
}

.mailbox-chip-confirm-label {
  color: var(--text-1);
}

.mailbox-chip-confirm-btn {
  font-family: var(--font-sans);
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--text-2);
  cursor: pointer;
}

.mailbox-chip-confirm-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.mailbox-chip-confirm-btn--yes {
  border-color: var(--accent);
  color: var(--accent);
}

.mailbox-chip-confirm-btn--yes:hover {
  background: var(--accent);
  color: var(--bg-0);
}
```

**Step 2: Commit**

```bash
git add client/src/App.css
git commit -m "feat: add mailbox delete chip CSS"
```

---

### Task 2: Update MailboxBar with delete button and confirm state

**Files:**
- Modify: `client/src/components/MailboxBar.jsx`

**Step 1: Replace the entire file with this content**

```jsx
import { useState } from 'react';

export default function MailboxBar({ mailboxes, selectedIds, onSelectionChange, onAddClick, onDeleteMailbox }) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const allSelected = selectedIds === null;

  function toggleAll() {
    onSelectionChange(null);
  }

  function toggleMailbox(id) {
    if (allSelected) {
      onSelectionChange([id]);
      return;
    }
    const next = selectedIds.includes(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id];
    onSelectionChange(next.length === 0 ? null : next);
  }

  function isActive(id) {
    return allSelected || selectedIds.includes(id);
  }

  return (
    <div className="mailbox-bar">
      <div className="mailbox-bar-logo">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2"/>
          <path d="m2 7 10 7 10-7"/>
        </svg>
      </div>

      <div className="mailbox-chip-row">
        <button
          className={`mailbox-chip${allSelected ? ' active' : ''}`}
          onClick={toggleAll}
        >
          All
        </button>

        {mailboxes.map(m => (
          <div key={m.id} className="mailbox-chip-wrap">
            {confirmDeleteId === m.id ? (
              <div className="mailbox-chip-confirm">
                <span className="mailbox-chip-confirm-label">Delete «{m.name}»?</span>
                <button
                  className="mailbox-chip-confirm-btn mailbox-chip-confirm-btn--yes"
                  onClick={() => { onDeleteMailbox(m.id); setConfirmDeleteId(null); }}
                >Yes</button>
                <button
                  className="mailbox-chip-confirm-btn"
                  onClick={() => setConfirmDeleteId(null)}
                >No</button>
              </div>
            ) : (
              <>
                <button
                  className={`mailbox-chip${isActive(m.id) ? ' active' : ''}`}
                  onClick={() => toggleMailbox(m.id)}
                  title={`${m.count?.toLocaleString() ?? 0} emails`}
                >
                  {m.name}
                  {m.count > 0 && <span className="mailbox-chip-count">{m.count.toLocaleString()}</span>}
                </button>
                <button
                  className="mailbox-chip-delete"
                  onClick={() => setConfirmDeleteId(m.id)}
                  title="Delete mailbox"
                >×</button>
              </>
            )}
          </div>
        ))}
      </div>

      <button className="mailbox-add-btn" onClick={onAddClick} title="Import new mailbox">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
      </button>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/MailboxBar.jsx
git commit -m "feat: add hover-reveal delete button and confirm state to MailboxBar"
```

---

### Task 3: Wire delete handler in App.jsx

**Files:**
- Modify: `client/src/App.jsx`

**Step 1: Add `handleDeleteMailbox` function**

Find `function handleMailboxSelection(ids) {` (around line 154) and insert this new function directly before it:

```js
async function handleDeleteMailbox(id) {
  try {
    await axios.delete(`/api/mailboxes/${id}`);
    await refreshMailboxes();
    setSelectedMailboxIds(prev => {
      if (prev === null) return null;
      const next = prev.filter(x => x !== id);
      return next.length === 0 ? null : next;
    });
  } catch {
    // silently ignore — mailbox list will reflect actual state on next refresh
  }
}
```

**Step 2: Pass the prop to MailboxBar**

Find (around line 179):
```jsx
        onAddClick={() => setShowImport(true)}
```

Replace with:
```jsx
        onAddClick={() => setShowImport(true)}
        onDeleteMailbox={handleDeleteMailbox}
```

**Step 3: Run the full test suite**

```bash
node --experimental-test-coverage --test 'test/*.test.js' 2>&1 | tail -6
```

Expected: all tests pass, 0 fail.

**Step 4: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat: wire mailbox delete handler in App"
```
