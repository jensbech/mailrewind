# Attachment Storage & Browsing — Design

## Goal
Extract email attachments from the MBOX during indexing, store them on disk, and display them in the email detail view with download support.

## Storage Layout
```
data/
  emails.db
  attachments/
    <email-id>/
      report.pdf
      photo.jpg
```

Each email gets a folder named by its database row ID. Filenames are sanitised (strip path separators, replace unsafe characters).

## Database
New `attachments` table added to schema:
```sql
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emailId INTEGER NOT NULL REFERENCES emails(id),
  filename TEXT,
  contentType TEXT,
  size INTEGER,
  path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attachment_email ON attachments(emailId);
```

## Parser
- Remove `stripAttachments` workaround from `mboxParser.js`
- Return `attachments: parsed.attachments` array from `parseEmailString`
- Each attachment: `{ filename, content (Buffer), contentType, size }`

## Indexing
- `insertBatch` saves email rows as before
- After each email insert, call `saveAttachments(db, emailId, attachments)`
  - Write each `content` Buffer to `data/attachments/<emailId>/<filename>`
  - Insert row into `attachments` table
- Reindex picks up all attachments from scratch

## API
- `GET /api/emails/:id/attachments` — returns array of `{ id, filename, contentType, size }`
- `GET /api/attachments/:id/download` — streams file from disk with correct Content-Type

## Frontend
- `EmailDetail` fetches `/api/emails/:id/attachments` when an email is selected
- Renders an **Attachments** section below the email body when count > 0
- Each attachment: file-type icon, filename, human-readable size, download link
