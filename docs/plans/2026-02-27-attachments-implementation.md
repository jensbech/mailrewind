# Attachment Storage & Browsing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract email attachments during MBOX indexing, save them to disk, expose two API endpoints, and display them as downloadable items inside the email detail view.

**Architecture:** mailparser already extracts attachments into `parsed.attachments`; we just stopped stripping them. After batch-inserting emails we look up their row IDs by messageId, then write each attachment Buffer to `data/attachments/<emailId>/<filename>` and insert a row into a new `attachments` table. The frontend fetches attachments when an email is selected and renders them below the body.

**Tech Stack:** Node.js fs/promises (writeFile), SQLite3, React, axios

---

## Task 1: Remove stripAttachments and return attachments from parser

**Files:**
- Modify: `src/parser/mboxParser.js`

**Step 1: Update `parseEmailString` — remove stripAttachments, add attachments field**

Replace the entire file with:

```javascript
import { simpleParser } from 'mailparser';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const BOUNDARY_RE = /^From \S+/;

function parseEnvelopeDate(fromLine) {
  const parts = fromLine.trim().split(/\s+/);
  if (parts.length < 3) return null;
  try {
    const d = new Date(parts.slice(2).join(' '));
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export async function parseEmailString(raw, envelopeDate = null) {
  try {
    const parsed = await simpleParser(raw);
    if (!parsed.from?.text && !parsed.subject) return null;
    return {
      messageId: parsed.messageId || '',
      from: parsed.from?.text || '',
      to: parsed.to?.text || '',
      cc: parsed.cc?.text || '',
      bcc: parsed.bcc?.text || '',
      subject: parsed.subject || '(no subject)',
      date: parsed.date || envelopeDate || null,
      body: parsed.text || '',
      bodyHTML: parsed.html || '',
      headers: JSON.stringify(Array.from(parsed.headers.entries())),
      attachments: (parsed.attachments || []).map(a => ({
        filename: a.filename || 'attachment',
        contentType: a.contentType || 'application/octet-stream',
        size: a.size || (a.content ? a.content.length : 0),
        content: a.content
      }))
    };
  } catch {
    return null;
  }
}

export async function* streamRawEmails(filePath) {
  const rl = createInterface({
    input: createReadStream(filePath, { highWaterMark: 64 * 1024 }),
    crlfDelay: Infinity
  });

  let current = '';
  let envelopeLine = '';

  for await (const line of rl) {
    if (BOUNDARY_RE.test(line)) {
      if (current.trim()) yield { raw: current, envelopeDate: parseEnvelopeDate(envelopeLine) };
      current = line + '\n';
      envelopeLine = line;
    } else {
      current += line + '\n';
    }
  }

  if (current.trim()) yield { raw: current, envelopeDate: parseEnvelopeDate(envelopeLine) };
}

export async function parseEmailFile(filePath, callback = null) {
  const emails = [];
  for await (const { raw, envelopeDate } of streamRawEmails(filePath)) {
    const email = await parseEmailString(raw, envelopeDate);
    if (email) {
      callback ? await callback(email) : emails.push(email);
    }
  }
  return emails;
}
```

**Step 2: Verify parser test still passes**

Run: `node --test test/parser.test.js`
Expected: PASS (2 tests)

**Step 3: Commit**

```bash
git add src/parser/mboxParser.js
git commit -m "feat: extract attachments in parser"
```

---

## Task 2: Add attachments table to schema

**Files:**
- Modify: `src/db/schema.js`

**Step 1: Append attachments table to the schema string**

After the existing trigger definitions (before the closing backtick), add:

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emailId INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  contentType TEXT,
  size INTEGER,
  path TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attachment_email ON attachments(emailId);
```

**Step 2: Commit**

```bash
git add src/db/schema.js
git commit -m "feat: attachments table schema"
```

---

## Task 3: Add attachment database functions

**Files:**
- Modify: `src/db/database.js`

**Step 1: Write the test**

Create `test/attachments.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { initializeDatabase } from '../src/db/database.js';
import { saveAttachments, getAttachmentsForEmail } from '../src/db/attachments.js';
import { unlink, rm } from 'fs/promises';

describe('Attachments', () => {
  it('should save attachments and retrieve metadata', async () => {
    const db = await initializeDatabase('data/test-att.db');

    db.run(`INSERT OR IGNORE INTO emails (messageId, subject) VALUES ('test-att@x', 'Test')`);

    const emailId = await new Promise(r =>
      db.get(`SELECT id FROM emails WHERE messageId='test-att@x'`, (_, row) => r(row.id))
    );

    const atts = [{
      filename: 'hello.txt',
      contentType: 'text/plain',
      size: 5,
      content: Buffer.from('hello')
    }];

    await saveAttachments(db, emailId, atts);

    const rows = await getAttachmentsForEmail(db, emailId);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].filename, 'hello.txt');
    assert.strictEqual(rows[0].contentType, 'text/plain');
  });

  after(async () => {
    try { await unlink('data/test-att.db'); } catch {}
    try { await rm('data/attachments', { recursive: true }); } catch {}
  });
});
```

Run: `node --test test/attachments.test.js`
Expected: FAIL — saveAttachments not defined

**Step 2: Create `src/db/attachments.js`**

```javascript
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 200) || 'attachment';
}

export async function saveAttachments(db, emailId, attachments) {
  if (!attachments || attachments.length === 0) return;

  const dir = join('data', 'attachments', String(emailId));
  await mkdir(dir, { recursive: true });

  for (const att of attachments) {
    if (!att.content || att.content.length === 0) continue;

    const filename = sanitizeFilename(att.filename);
    const filePath = join(dir, filename);

    await writeFile(filePath, att.content);

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO attachments (emailId, filename, contentType, size, path) VALUES (?, ?, ?, ?, ?)`,
        [emailId, filename, att.contentType, att.size, filePath],
        err => err ? reject(err) : resolve()
      );
    });
  }
}

export function getAttachmentsForEmail(db, emailId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, filename, contentType, size, path FROM attachments WHERE emailId = ?`,
      [emailId],
      (err, rows) => err ? reject(err) : resolve(rows || [])
    );
  });
}

export function getAttachment(db, id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, filename, contentType, size, path FROM attachments WHERE id = ?`,
      [id],
      (err, row) => err ? reject(err) : resolve(row)
    );
  });
}

export function getEmailIdByMessageId(db, messageId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id FROM emails WHERE messageId = ?`,
      [messageId],
      (err, row) => err ? reject(err) : resolve(row?.id ?? null)
    );
  });
}
```

**Step 3: Run test**

Run: `node --test test/attachments.test.js`
Expected: PASS

**Step 4: Commit**

```bash
git add src/db/attachments.js test/attachments.test.js
git commit -m "feat: attachment DB functions and tests"
```

---

## Task 4: Save attachments during indexing

**Files:**
- Modify: `src/services/indexService.js`

**Step 1: Update `processBatch` to save attachments after inserting emails**

Replace the import line and `processBatch` function:

```javascript
import { streamRawEmails, parseEmailString } from '../parser/mboxParser.js';
import { insertBatch } from '../db/database.js';
import { saveAttachments, getEmailIdByMessageId } from '../db/attachments.js';
```

Replace `processBatch`:

```javascript
async function processBatch(db, batch) {
  const parsed = await Promise.all(
    batch.map(({ raw, envelopeDate }) => parseWithTimeout(raw, envelopeDate))
  );
  const valid = parsed.filter(Boolean);
  if (valid.length === 0) return 0;

  const count = await insertBatch(db, valid);

  const withAttachments = valid.filter(e => e.attachments?.length > 0);
  for (const email of withAttachments) {
    const emailId = await getEmailIdByMessageId(db, email.messageId);
    if (emailId) {
      await saveAttachments(db, emailId, email.attachments);
    }
  }

  return count;
}
```

**Step 2: Test indexing still starts cleanly**

Run: `node -e "import('./src/db/database.js').then(m => m.initializeDatabase()).then(() => console.log('DB OK'))"`
Expected: `DB OK`

**Step 3: Commit**

```bash
git add src/services/indexService.js
git commit -m "feat: save attachments during indexing"
```

---

## Task 5: Add API endpoints for attachments

**Files:**
- Modify: `src/server.js`

**Step 1: Add imports and two new routes**

Add to the top imports:
```javascript
import { createRequire } from 'module';
import { resolve } from 'path';
import { getAttachmentsForEmail, getAttachment } from './db/attachments.js';
```

Add these two routes after the existing `/api/stats` route (before `app.use(express.static...)`):

```javascript
app.get('/api/emails/:id/attachments', async (req, res) => {
  try {
    const attachments = await getAttachmentsForEmail(db, req.params.id);
    res.json(attachments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/attachments/:id/download', async (req, res) => {
  try {
    const att = await getAttachment(db, req.params.id);
    if (!att) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', att.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${att.filename}"`);
    res.sendFile(resolve(att.path));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Start server and verify routes exist**

Run: `npm run dev` (wait for "Ready!"), then in another terminal:
```bash
curl http://localhost:3001/api/emails/1/attachments
```
Expected: `[]` (no attachments yet — reindex needed, but endpoint responds correctly)

Stop server.

**Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat: attachment API endpoints"
```

---

## Task 6: Update EmailDetail to show attachments

**Files:**
- Modify: `client/src/components/EmailDetail.jsx`
- Modify: `client/src/App.css`

**Step 1: Rewrite EmailDetail with attachment fetching**

```javascript
import { useState, useEffect } from 'react';
import axios from 'axios';

function fileIcon(contentType) {
  if (!contentType) return '📎';
  if (contentType.startsWith('image/')) return '🖼️';
  if (contentType.startsWith('video/')) return '🎬';
  if (contentType.startsWith('audio/')) return '🎵';
  if (contentType.includes('pdf')) return '📄';
  if (contentType.includes('zip') || contentType.includes('compressed')) return '🗜️';
  if (contentType.includes('word') || contentType.includes('document')) return '📝';
  if (contentType.includes('sheet') || contentType.includes('excel')) return '📊';
  return '📎';
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function EmailDetail({ email }) {
  const [attachments, setAttachments] = useState([]);

  useEffect(() => {
    if (!email?.id) return;
    setAttachments([]);
    axios.get(`/api/emails/${email.id}/attachments`)
      .then(res => setAttachments(res.data))
      .catch(() => setAttachments([]));
  }, [email?.id]);

  return (
    <div className="email-detail">
      <div className="email-header">
        <h2>{email.subject}</h2>
        <div className="meta">
          <p><strong>From:</strong> {email.from}</p>
          <p><strong>To:</strong> {email.to}</p>
          <p><strong>Date:</strong> {new Date(email.date).toLocaleString()}</p>
        </div>
      </div>

      {attachments.length > 0 && (
        <div className="attachments">
          <h3>Attachments ({attachments.length})</h3>
          <div className="attachment-list">
            {attachments.map(att => (
              <a
                key={att.id}
                href={`/api/attachments/${att.id}/download`}
                className="attachment-item"
                download={att.filename}
              >
                <span className="attachment-icon">{fileIcon(att.contentType)}</span>
                <span className="attachment-name">{att.filename}</span>
                <span className="attachment-size">{formatSize(att.size)}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="body">
        {email.bodyHTML ? (
          <div dangerouslySetInnerHTML={{ __html: email.bodyHTML }} />
        ) : (
          <pre>{email.bodyText}</pre>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Add attachment CSS to App.css**

Append to the end of `client/src/App.css`:

```css
.attachments {
  padding: 15px 30px;
  border-bottom: 1px solid #e0e0e0;
  background: #fffbf0;
}

.attachments h3 {
  font-size: 13px;
  font-weight: 600;
  color: #555;
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  text-decoration: none;
  color: #333;
  font-size: 13px;
  transition: background 0.15s, border-color 0.15s;
}

.attachment-item:hover {
  background: #e8f0fe;
  border-color: #1a73e8;
}

.attachment-icon {
  font-size: 16px;
}

.attachment-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-size {
  color: #999;
  font-size: 11px;
  flex-shrink: 0;
}
```

**Step 3: Also rename `.header` to `.email-header` in App.css** to avoid collision with the new class

Find in `App.css`:
```css
.email-detail .header {
```
Replace with:
```css
.email-detail .email-header {
```

**Step 4: Build the frontend**

Run: `cd client && npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
cd /Users/home/Downloads/Takeout
git add client/src/components/EmailDetail.jsx client/src/App.css
git commit -m "feat: attachment display in email detail"
```

---

## Task 7: Reindex and verify end-to-end

**Step 1: Delete old DB and reindex**

```bash
rm -f data/emails.db
rm -rf data/attachments
REINDEX=true npm run dev
```

Watch logs — attachments will be saved as indexing runs. Emails with attachments will take slightly longer.

**Step 2: Open the app**

Open `http://localhost:3001`. Find an email with attachments (look for older emails with PDFs, images). Select it — the attachments section should appear above the body with download chips.

**Step 3: Verify download**

Click an attachment chip — the file should download with the correct filename and type.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete attachment support with reindex"
```

---

## Summary

| Component | Change |
|-----------|--------|
| `mboxParser.js` | Remove `stripAttachments`, return `attachments[]` from parsed email |
| `schema.js` | Add `attachments` table + index |
| `src/db/attachments.js` | New file: `saveAttachments`, `getAttachmentsForEmail`, `getAttachment`, `getEmailIdByMessageId` |
| `indexService.js` | After batch insert, save attachments for emails that have them |
| `server.js` | Two new routes: list attachments, download file |
| `EmailDetail.jsx` | Fetch + display attachments with icons, filename, size, download link |
| `App.css` | Attachment section styles |
