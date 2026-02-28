# Design: Mailbox Deletion UI

**Date:** 2026-02-28

## Problem

There is no way to remove an imported mailbox from the GUI. The backend `DELETE /api/mailboxes/:id` endpoint exists but is unreachable from the frontend, and has a typo bug in the route definition.

## Solution

Hover-reveal × button on each mailbox chip with an inline "are you sure" confirmation replacing the chip content.

## Backend

Fix typo in `src/app.js`: route is `'/api/mailboxes:id'` (missing `/`), must be `'/api/mailboxes/:id'`.

Add one test in `test/server.test.js`: `DELETE /api/mailboxes/:id` returns 204 and the mailbox no longer appears in `GET /api/mailboxes`.

## Frontend

### MailboxBar

- Add `onDeleteMailbox` prop (called with mailbox id after confirmation).
- Add `confirmDeleteId` state (null or a mailbox id).
- Each mailbox chip becomes a `.mailbox-chip-wrap` div containing:
  1. Existing chip `<button>` — behavior unchanged.
  2. A small `×` `<button>` (`.mailbox-chip-delete`) — invisible by default, fades in on wrapper hover.
- When `×` is clicked: set `confirmDeleteId` to that mailbox's id.
- While `confirmDeleteId === m.id`: replace chip content with `"Delete «name»?"` + `Confirm` / `Cancel` buttons.
- Cancel clears `confirmDeleteId`. Confirm calls `onDeleteMailbox(id)`.

### App.jsx

- `handleDeleteMailbox(id)`: calls `DELETE /api/mailboxes/:id`, then `refreshMailboxes()`. If the deleted mailbox was in `selectedMailboxIds`, resets selection to `null`.
- Pass `onDeleteMailbox={handleDeleteMailbox}` to `<MailboxBar>`.

## CSS

New classes appended to `App.css`:

- `.mailbox-chip-wrap` — `position: relative`, `display: inline-flex`
- `.mailbox-chip-delete` — absolute × button, `opacity: 0`, transitions to `opacity: 1` on `.mailbox-chip-wrap:hover`
- `.mailbox-chip-confirm` — inline confirm row inside the chip wrap
- `.mailbox-chip-confirm-btn` — small confirm/cancel buttons
