# Import UI + Multi-Mailbox Design

## Overview

Add a Docker-first import flow and multi-mailbox support. Users run the app via `compose.yml`, mount their mbox files, and manage named mailboxes through a browser UI with live import progress.

## Deployment

- `Dockerfile`: two-stage build — build the React client, then serve via Express
- `compose.yml`: mounts host directory to `/data` (default `~/Downloads/Takeout`), named Docker volume persists SQLite DB, exposes port 3001
- Headless mode: `MBOX_PATH` + `MAILBOX_NAME` env vars auto-start import on startup

## Database Schema Changes

New `mailboxes` table:
```
id INTEGER PRIMARY KEY
name TEXT NOT NULL
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Changes to existing tables:
- `emails`: add `mailbox_id INTEGER REFERENCES mailboxes(id)`, unique constraint becomes `UNIQUE(messageId, mailbox_id)`
- `attachments`: add `mailbox_id INTEGER REFERENCES mailboxes(id)`
- All queries gain `WHERE mailbox_id IN (...)` filtering

## Backend API Changes

New mailbox endpoints:
- `GET /api/mailboxes` → `[{ id, name, count, oldest, newest }]`
- `POST /api/mailboxes` → `{ name }` → creates and returns new mailbox
- `DELETE /api/mailboxes/:id` → deletes mailbox + all its emails/attachments

Import endpoints:
- `GET /api/import/status` → `{ status: 'idle'|'running'|'done'|'error', seen, indexed, mailboxId }`
- `POST /api/import/start` → `{ path, mailboxId }` → kicks off import, returns 202
- `GET /api/import/events` → SSE stream of `{ type: 'log'|'progress', ... }` events

Modified email endpoints:
- All accept optional `?mailboxIds=1,2,3` (comma-separated). If omitted, returns across all mailboxes.
- Affected: `/api/emails`, `/api/search`, `/api/stats`, `/api/years`

`indexService.js` changes:
- `indexEmails(db, mboxPath, mailboxId, onEvent)` — adds mailbox ID and progress callback
- Emits `{ type: 'log', text }` and `{ type: 'progress', seen, indexed, skipped, elapsed }` every 10 emails
- Server buffers recent events (ring buffer, last 200) so late-connecting clients can catch up

## Frontend Changes

### Top bar (new)
Persistent bar above the full app layout:
```
✦  [ All ]  [✓ Gmail Archive ] [✓ Work 2019 ] [ Personal ]  [ + ]
```
- Multi-select chip row — clicking toggles a mailbox on/off
- "All" chip selects all mailboxes (default state)
- Active chips highlighted with amber accent (matches existing chip style)
- `[ + ]` opens the import screen
- Chip shows name + email count badge

### Import screen
Shown fullscreen when no mailboxes exist. Also accessible via `[ + ]` when mailboxes exist.

Two-step flow:
1. **Name step**: text input "Name this mailbox" — user types e.g. "Gmail Archive"
2. **Import step**: path input pre-filled with `/data/`, "Start Import" button

During import:
- Terminal-style log panel: dark background, amber monospace text, auto-scrolls, last 100 lines
- Running counter: `Seen: 1,240 · Indexed: 1,238 · Skipped: 2 · ~24 emails/s`
- Live via SSE (`EventSource` on `/api/import/events`)

When done:
- "✦ Done — 12,450 emails indexed"
- "Add another file to this mailbox" button (re-runs import into same mailboxId)
- "Open Archive" button (closes import screen, activates the new mailbox)

### App.jsx changes
- `activeMailboxIds: number[]` state (default: all)
- All API calls pass `?mailboxIds=` param
- Switching/toggling chips updates state and resets email list
- Import screen shown when `mailboxes.length === 0`

## Success Criteria
- `docker compose up` starts the app; user mounts mbox dir and imports via browser
- Multiple mailboxes creatable; each independently importable
- Multi-select works: browsing 2+ mailboxes shows merged results
- Adding a second mbox to existing mailbox appends without duplicates (deduped by messageId within mailbox)
- Live log and counter update during import via SSE
- Re-import from sidebar header works
- Headless import via env vars still works
