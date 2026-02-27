# Import UI + Multi-Mailbox Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Docker deployment, a multi-mailbox system, and an in-browser import flow with live progress streaming.

**Architecture:** SQLite gains a `mailboxes` table; all email queries accept a `mailboxIds` filter. The backend exposes SSE for live import progress. The React frontend adds a multi-select top bar and a fullscreen import screen.

**Tech Stack:** Node.js/Express (ESM), SQLite3 (callback API), React 19 + Vite, SSE for streaming, Docker + Compose.

---

### Task 1: Docker setup

**Files:**
- Create: `Dockerfile`
- Create: `compose.yml`

**Step 1: Create the Dockerfile**

```dockerfile
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src/ ./src/
COPY --from=client-build /app/client/dist ./client/dist
EXPOSE 3001
CMD ["node", "src/server.js"]
```

**Step 2: Fix the `__dirname` bug in server.js**

`__dirname` is undefined in ES modules. The catch-all route (line 112) uses it. Replace that route with:

```js
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

Add those lines near the top of `src/server.js` (after the existing imports), then the existing `resolve()` calls and `__dirname` usage will work.

**Step 3: Create compose.yml**

```yaml
services:
  app:
    build: .
    ports:
      - "3001:3001"
    volumes:
      - ${MBOX_DIR:-~/Downloads}:/data
      - email-db:/app/data
    environment:
      - MBOX_PATH=${MBOX_PATH:-}
      - MAILBOX_NAME=${MAILBOX_NAME:-}

volumes:
  email-db:
```

**Step 4: Verify build**

```bash
docker compose build
```
Expected: build completes, no errors. The client bundle is built inside the image.

**Step 5: Commit**

```bash
git add Dockerfile compose.yml src/server.js
git commit -m "feat: add Docker setup and fix __dirname in ESM"
```

---

### Task 2: DB schema — mailboxes + migration

**Files:**
- Modify: `src/db/schema.js`
- Modify: `src/db/database.js`

**Step 1: Update schema.js**

Replace the entire contents with the new schema that adds the `mailboxes` table and `mailbox_id` column to `emails`:

```js
export const schema = `
CREATE TABLE IF NOT EXISTS mailboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  messageId TEXT NOT NULL,
  mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  \`from\` TEXT,
  \`to\` TEXT,
  cc TEXT,
  bcc TEXT,
  subject TEXT,
  date DATETIME,
  bodyText TEXT,
  bodyHTML TEXT,
  headers TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(messageId, mailbox_id)
);

CREATE INDEX IF NOT EXISTS idx_email_date ON emails(date);
CREATE INDEX IF NOT EXISTS idx_email_from ON emails(\`from\`);
CREATE INDEX IF NOT EXISTS idx_email_to ON emails(\`to\`);
CREATE INDEX IF NOT EXISTS idx_email_mailbox ON emails(mailbox_id);

CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
  subject,
  bodyText,
  \`from\`,
  \`to\`,
  content=emails,
  content_rowid=id
);

CREATE TRIGGER IF NOT EXISTS emails_ai AFTER INSERT ON emails BEGIN
  INSERT INTO emails_fts(rowid, subject, bodyText, \`from\`, \`to\`)
  VALUES (new.id, new.subject, new.bodyText, new.\`from\`, new.\`to\`);
END;

CREATE TRIGGER IF NOT EXISTS emails_ad AFTER DELETE ON emails BEGIN
  INSERT INTO emails_fts(emails_fts, rowid, subject, bodyText, \`from\`, \`to\`)
  VALUES('delete', old.id, old.subject, old.bodyText, old.\`from\`, old.\`to\`);
END;

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
`;
```

**Step 2: Add migration logic to initializeDatabase in database.js**

The migration checks if the old schema (without `mailboxes`) is present and drops+recreates all tables so the new schema applies cleanly. Because this is a personal tool, data loss on migration is acceptable — the user will re-import.

Replace `initializeDatabase` in `src/db/database.js`:

```js
export async function initializeDatabase(dbPath = 'data/emails.db') {
  await mkdir('data', { recursive: true });

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, async (err) => {
      if (err) return reject(err);

      try {
        const needsMigration = await new Promise((res, rej) => {
          db.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='mailboxes'",
            (e, row) => e ? rej(e) : res(!row)
          );
        });

        if (needsMigration) {
          await new Promise((res, rej) => {
            db.exec(`
              DROP TABLE IF EXISTS emails_fts;
              DROP TRIGGER IF EXISTS emails_ai;
              DROP TRIGGER IF EXISTS emails_ad;
              DROP TABLE IF EXISTS attachments;
              DROP TABLE IF EXISTS emails;
            `, e => e ? rej(e) : res());
          });
          console.log('DB migrated to multi-mailbox schema (existing data cleared — please re-import)');
        }

        db.exec(schema, (e) => e ? reject(e) : resolve(db));
      } catch (e) {
        reject(e);
      }
    });
  });
}
```

**Step 3: Verify fresh DB creation**

```bash
node -e "import('./src/db/database.js').then(m => m.initializeDatabase('data/test.db')).then(() => { console.log('ok'); process.exit(0); })"
```
Expected: `ok` with no errors. Delete `data/test.db` after.

**Step 4: Commit**

```bash
git add src/db/schema.js src/db/database.js
git commit -m "feat: add mailboxes table and migration"
```

---

### Task 3: Mailbox CRUD + updated query functions

**Files:**
- Modify: `src/db/database.js`
- Modify: `src/db/attachments.js`

**Step 1: Add mailbox CRUD to database.js**

Add these functions at the top of the exports (after `initializeDatabase`):

```js
export function createMailbox(db, name) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO mailboxes (name) VALUES (?)',
      [name],
      function(err) { err ? reject(err) : resolve({ id: this.lastID, name }); }
    );
  });
}

export function getMailboxes(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT m.id, m.name, m.created_at,
              COUNT(e.id) as count,
              MIN(e.date) as oldest,
              MAX(e.date) as newest
       FROM mailboxes m
       LEFT JOIN emails e ON e.mailbox_id = m.id
       GROUP BY m.id
       ORDER BY m.created_at ASC`,
      (err, rows) => err ? reject(err) : resolve(rows || [])
    );
  });
}

export function deleteMailbox(db, id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM mailboxes WHERE id = ?', [id], err => err ? reject(err) : resolve());
  });
}
```

**Step 2: Update insertBatch to accept mailboxId**

Replace `insertBatch`:

```js
export function insertBatch(db, emails, mailboxId) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT OR IGNORE INTO emails
      (\`messageId\`, mailbox_id, \`from\`, \`to\`, cc, bcc, subject, date, bodyText, bodyHTML, headers)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.serialize(() => {
      db.run('BEGIN');
      let inserted = 0;
      for (const email of emails) {
        db.run(sql, [
          email.messageId, mailboxId, email.from, email.to, email.cc, email.bcc,
          email.subject, email.date, email.body, email.bodyHTML, email.headers
        ], function(err) { if (!err && this.changes > 0) inserted++; });
      }
      db.run('COMMIT', (err) => err ? reject(err) : resolve(inserted));
    });
  });
}
```

**Step 3: Update getEmails to accept mailboxIds array**

Replace `getEmails`:

```js
export function getEmails(db, limit = 50, offset = 0, year = null, sort = 'desc', mailboxIds = null) {
  return new Promise((resolve, reject) => {
    const order = sort === 'asc' ? 'ASC' : 'DESC';
    const params = [];
    const conditions = [];

    if (mailboxIds && mailboxIds.length > 0) {
      conditions.push(`mailbox_id IN (${mailboxIds.map(() => '?').join(',')})`);
      params.push(...mailboxIds);
    }
    if (year) {
      const start = new Date(`${year}-01-01`).getTime();
      const end = new Date(`${Number(year) + 1}-01-01`).getTime();
      conditions.push('date >= ? AND date < ?');
      params.push(start, end);
    }

    let sql = 'SELECT * FROM emails';
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ` ORDER BY date ${order} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}
```

**Step 4: Update searchEmails to accept mailboxIds array**

Replace `searchEmails`:

```js
export function searchEmails(db, query, limit = 50, offset = 0, year = null, sort = 'desc', mailboxIds = null) {
  return new Promise((resolve, reject) => {
    const order = sort === 'asc' ? 'ASC' : 'DESC';
    const searchPattern = `%${query}%`;
    const params = [searchPattern, searchPattern, searchPattern, searchPattern];
    const conditions = [
      `(subject LIKE ? OR bodyText LIKE ? OR \`from\` LIKE ? OR \`to\` LIKE ?)`
    ];

    if (mailboxIds && mailboxIds.length > 0) {
      conditions.push(`mailbox_id IN (${mailboxIds.map(() => '?').join(',')})`);
      params.push(...mailboxIds);
    }
    if (year) {
      const start = new Date(`${year}-01-01`).getTime();
      const end = new Date(`${Number(year) + 1}-01-01`).getTime();
      conditions.push('date >= ? AND date < ?');
      params.push(start, end);
    }

    let sql = 'SELECT * FROM emails WHERE ' + conditions.join(' AND ');
    sql += ` ORDER BY date ${order} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}
```

**Step 5: Update getYearCounts and getStats to accept mailboxIds**

Replace both functions:

```js
export function getYearCounts(db, mailboxIds = null) {
  return new Promise((resolve, reject) => {
    const params = [];
    let where = 'WHERE date IS NOT NULL';
    if (mailboxIds && mailboxIds.length > 0) {
      where += ` AND mailbox_id IN (${mailboxIds.map(() => '?').join(',')})`;
      params.push(...mailboxIds);
    }
    db.all(
      `SELECT strftime('%Y', date/1000, 'unixepoch') as year, COUNT(*) as count
       FROM emails ${where}
       GROUP BY year ORDER BY year DESC`,
      params,
      (err, rows) => err ? reject(err) : resolve(rows || [])
    );
  });
}

export function getStats(db, mailboxIds = null) {
  return new Promise((resolve, reject) => {
    const params = [];
    let where = '';
    if (mailboxIds && mailboxIds.length > 0) {
      where = `WHERE mailbox_id IN (${mailboxIds.map(() => '?').join(',')})`;
      params.push(...mailboxIds);
    }
    db.get(
      `SELECT COUNT(*) as total, MIN(date) as oldest, MAX(date) as newest FROM emails ${where}`,
      params,
      (err, row) => err ? reject(err) : resolve(row)
    );
  });
}
```

**Step 6: Update attachments.js — scope getEmailIdByMessageId by mailboxId**

Replace `getEmailIdByMessageId`:

```js
export function getEmailIdByMessageId(db, messageId, mailboxId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id FROM emails WHERE messageId = ? AND mailbox_id = ?`,
      [messageId, mailboxId],
      (err, row) => err ? reject(err) : resolve(row?.id ?? null)
    );
  });
}
```

**Step 7: Commit**

```bash
git add src/db/database.js src/db/attachments.js
git commit -m "feat: add mailbox CRUD and mailboxIds filtering to all queries"
```

---

### Task 4: Update indexService.js

**Files:**
- Modify: `src/services/indexService.js`

**Step 1: Update indexEmails signature and processBatch**

Replace the entire file:

```js
import { streamRawEmails, parseEmailString } from '../parser/mboxParser.js';
import { insertBatch } from '../db/database.js';
import { saveAttachments, getEmailIdByMessageId } from '../db/attachments.js';

const BATCH_SIZE = 20;
const BASE_TIMEOUT_MS = 8000;
const LOG_EVERY = 10;

function decodeMimeWord(str) {
  return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, data) => {
    try {
      const buf = enc.toUpperCase() === 'B'
        ? Buffer.from(data, 'base64')
        : Buffer.from(data.replace(/_/g, ' '), 'binary');
      return buf.toString(charset);
    } catch { return str; }
  });
}

function subjectHint(raw) {
  const m = raw.match(/^Subject:\s*(.+)$/im);
  if (!m) return '(no subject)';
  return decodeMimeWord(m[1]).slice(0, 60).trim();
}

function timeoutForSize(bytes) {
  return Math.max(BASE_TIMEOUT_MS, Math.ceil(bytes / 1024) * 2);
}

function parseWithTimeout(raw, envelopeDate) {
  let timedOut = false;
  const ms = timeoutForSize(raw.length);
  const timer = new Promise(resolve =>
    setTimeout(() => { timedOut = true; resolve(null); }, ms)
  );
  return Promise.race([parseEmailString(raw, envelopeDate), timer]).then(result => {
    if (timedOut) {
      const text = `  ⚠ TIMEOUT (${(raw.length / 1024).toFixed(0)}KB, limit ${ms}ms): ${subjectHint(raw)}`;
      console.warn(text);
    }
    return result;
  });
}

async function processBatch(db, batch, mailboxId) {
  const parsed = await Promise.all(
    batch.map(({ raw, envelopeDate }) => parseWithTimeout(raw, envelopeDate))
  );
  const valid = parsed.filter(Boolean);
  if (valid.length === 0) return 0;

  const count = await insertBatch(db, valid, mailboxId);

  const withAttachments = valid.filter(e => e.attachments?.length > 0);
  for (const email of withAttachments) {
    const emailId = await getEmailIdByMessageId(db, email.messageId, mailboxId);
    if (emailId) {
      await saveAttachments(db, emailId, email.attachments);
    }
  }

  return count;
}

export async function indexEmails(db, mboxPath, mailboxId, onEvent = () => {}) {
  const emit = (type, payload) => onEvent({ type, ...payload });
  emit('log', { text: 'Starting email indexing...' });
  const startTime = Date.now();

  let seen = 0;
  let indexed = 0;
  let skipped = 0;
  let batch = [];
  let batchStart = Date.now();

  for await (const item of streamRawEmails(mboxPath)) {
    seen++;
    batch.push(item);

    if (batch.length >= BATCH_SIZE) {
      const result = await processBatch(db, batch, mailboxId);
      indexed += result;
      skipped += BATCH_SIZE - result;
      batch = [];

      if (seen % LOG_EVERY === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const batchMs = Date.now() - batchStart;
        const rate = Math.round(LOG_EVERY / (batchMs / 1000));
        const text = `[${elapsed}s] Seen: ${seen} | Indexed: ${indexed} | Skipped: ${skipped} | ~${rate} emails/s`;
        console.log(text);
        emit('log', { text });
        emit('progress', { seen, indexed, skipped, elapsed: Number(elapsed), rate });
        batchStart = Date.now();
      }
    }
  }

  if (batch.length > 0) {
    const result = await processBatch(db, batch, mailboxId);
    indexed += result;
    skipped += batch.length - result;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const doneText = `✓ Done in ${elapsed}s — indexed: ${indexed}, skipped: ${skipped}, total seen: ${seen}`;
  console.log(doneText);
  emit('log', { text: doneText });
  emit('done', { indexed, seen, skipped });
  return indexed;
}

export function clearMailbox(db, mailboxId) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM emails WHERE mailbox_id = ?', [mailboxId], err => err ? reject(err) : resolve());
  });
}
```

**Step 2: Commit**

```bash
git add src/services/indexService.js
git commit -m "feat: add mailboxId and onEvent callback to indexEmails"
```

---

### Task 5: Rewrite server.js

**Files:**
- Modify: `src/server.js`

This is the largest change. Replace the entire file:

```js
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
  initializeDatabase, getEmails, searchEmails, getEmail, getStats, getYearCounts,
  createMailbox, getMailboxes, deleteMailbox
} from './db/database.js';
import { indexEmails } from './services/indexService.js';
import { getAttachmentsForEmail, getAttachment } from './db/attachments.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

let db;

const importState = {
  status: 'idle',
  seen: 0,
  indexed: 0,
  skipped: 0,
  mailboxId: null,
  error: null,
  logs: [],
};
const sseClients = new Set();

function pushEvent(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  importState.logs.push(line);
  if (importState.logs.length > 200) importState.logs.shift();
  for (const res of sseClients) {
    try { res.write(line); } catch {}
  }
}

async function startup() {
  db = await initializeDatabase();

  if (process.env.MBOX_PATH && process.env.MAILBOX_NAME) {
    const mailbox = await createMailbox(db, process.env.MAILBOX_NAME);
    console.log(`Headless import: ${process.env.MBOX_PATH} → "${mailbox.name}"`);
    runImport(process.env.MBOX_PATH, mailbox.id);
  }
}

function runImport(mboxPath, mailboxId) {
  importState.status = 'running';
  importState.seen = 0;
  importState.indexed = 0;
  importState.skipped = 0;
  importState.mailboxId = mailboxId;
  importState.error = null;
  importState.logs = [];

  indexEmails(db, mboxPath, mailboxId, (event) => {
    if (event.type === 'progress') {
      importState.seen = event.seen;
      importState.indexed = event.indexed;
      importState.skipped = event.skipped;
    } else if (event.type === 'done') {
      importState.status = 'done';
      importState.indexed = event.indexed;
    }
    pushEvent(event);
  }).catch((err) => {
    importState.status = 'error';
    importState.error = err.message;
    pushEvent({ type: 'error', message: err.message });
  });
}

app.get('/api/mailboxes', async (req, res) => {
  try {
    res.json(await getMailboxes(db));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mailboxes', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    res.status(201).json(await createMailbox(db, name.trim()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/mailboxes/:id', async (req, res) => {
  try {
    await deleteMailbox(db, req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/import/status', (req, res) => {
  res.json({
    status: importState.status,
    seen: importState.seen,
    indexed: importState.indexed,
    skipped: importState.skipped,
    mailboxId: importState.mailboxId,
    error: importState.error,
  });
});

app.post('/api/import/start', async (req, res) => {
  if (importState.status === 'running') {
    return res.status(409).json({ error: 'Import already running' });
  }
  const { path: mboxPath, mailboxId } = req.body;
  if (!mboxPath) return res.status(400).json({ error: 'path required' });
  if (!mailboxId) return res.status(400).json({ error: 'mailboxId required' });

  runImport(mboxPath, mailboxId);
  res.status(202).json({ ok: true });
});

app.get('/api/import/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  for (const line of importState.logs) {
    res.write(line);
  }

  sseClients.add(res);
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch {}
  }, 15000);

  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(heartbeat);
  });
});

function parseMailboxIds(query) {
  if (!query) return null;
  const ids = String(query).split(',').map(Number).filter(n => !isNaN(n) && n > 0);
  return ids.length > 0 ? ids : null;
}

app.get('/api/years', async (req, res) => {
  try {
    const mailboxIds = parseMailboxIds(req.query.mailboxIds);
    res.json(await getYearCounts(db, mailboxIds));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/emails', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50');
    const offset = parseInt(req.query.offset || '0');
    const year = req.query.year || null;
    const sort = req.query.sort === 'asc' ? 'asc' : 'desc';
    const mailboxIds = parseMailboxIds(req.query.mailboxIds);
    res.json(await getEmails(db, limit, offset, year, sort, mailboxIds));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/emails/:id', async (req, res) => {
  try {
    const email = await getEmail(db, req.params.id);
    if (!email) return res.status(404).json({ error: 'Not found' });
    res.json(email);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const { q, limit = '50', offset = '0', year, sort } = req.query;
    if (!q) return res.status(400).json({ error: 'Query required' });
    const mailboxIds = parseMailboxIds(req.query.mailboxIds);
    res.json(await searchEmails(db, q, parseInt(limit), parseInt(offset), year || null, sort === 'asc' ? 'asc' : 'desc', mailboxIds));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const mailboxIds = parseMailboxIds(req.query.mailboxIds);
    res.json(await getStats(db, mailboxIds));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/emails/:id/attachments', async (req, res) => {
  try {
    res.json(await getAttachmentsForEmail(db, req.params.id));
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

app.use(express.static(resolve(__dirname, '../client/dist')));

app.get('*', (req, res) => {
  res.sendFile(resolve(__dirname, '../client/dist/index.html'));
});

startup().then(() => {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
```

**Step 2: Verify server starts**

```bash
npm run dev
```
Expected: `Server running on http://localhost:3001`

Test mailbox creation:
```bash
curl -s -X POST http://localhost:3001/api/mailboxes -H 'Content-Type: application/json' -d '{"name":"Test"}' | cat
```
Expected: `{"id":1,"name":"Test"}`

Test mailbox list:
```bash
curl -s http://localhost:3001/api/mailboxes | cat
```
Expected: array with the test mailbox.

**Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat: add mailbox + import SSE API, wire mailboxIds to all endpoints"
```

---

### Task 6: ImportScreen component

**Files:**
- Create: `client/src/components/ImportScreen.jsx`

**Step 1: Create the component**

```jsx
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

export default function ImportScreen({ onComplete, existingMailboxes = [] }) {
  const [step, setStep] = useState('name');
  const [mailboxName, setMailboxName] = useState('');
  const [targetMailboxId, setTargetMailboxId] = useState(null);
  const [mboxPath, setMboxPath] = useState('/data/');
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(null);
  const [importStatus, setImportStatus] = useState('idle');
  const [error, setError] = useState(null);
  const logsEndRef = useRef(null);
  const esRef = useRef(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => () => esRef.current?.close(), []);

  async function handleNameSubmit(e) {
    e.preventDefault();
    const name = mailboxName.trim();
    if (!name) return;

    try {
      const res = await axios.post('/api/mailboxes', { name });
      setTargetMailboxId(res.data.id);
      setStep('import');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  function handleSelectExisting(id) {
    setTargetMailboxId(id);
    setStep('import');
  }

  async function handleImportStart(e) {
    e.preventDefault();
    if (!mboxPath.trim() || !targetMailboxId) return;

    setImportStatus('running');
    setLogs([]);
    setProgress(null);
    setError(null);

    esRef.current?.close();
    const es = new EventSource('/api/import/events');
    esRef.current = es;

    es.onmessage = (ev) => {
      const event = JSON.parse(ev.data);
      if (event.type === 'log') {
        setLogs(prev => [...prev.slice(-99), event.text]);
      } else if (event.type === 'progress') {
        setProgress(event);
      } else if (event.type === 'done') {
        setImportStatus('done');
        setProgress(p => ({ ...p, indexed: event.indexed }));
        es.close();
      } else if (event.type === 'error') {
        setImportStatus('error');
        setError(event.message);
        es.close();
      }
    };

    try {
      await axios.post('/api/import/start', { path: mboxPath.trim(), mailboxId: targetMailboxId });
    } catch (err) {
      setImportStatus('error');
      setError(err.response?.data?.error || err.message);
      es.close();
    }
  }

  function handleAddAnother() {
    setImportStatus('idle');
    setLogs([]);
    setProgress(null);
    setMboxPath('/data/');
  }

  return (
    <div className="import-screen">
      <div className="import-box">
        <div className="import-logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="m2 7 10 7 10-7"/>
          </svg>
          Email Archive
        </div>

        {step === 'name' && (
          <div className="import-step">
            <div className="import-step-title">Name this mailbox</div>
            <form onSubmit={handleNameSubmit} className="import-form">
              <input
                className="import-input"
                type="text"
                placeholder="e.g. Gmail Archive, Work 2019…"
                value={mailboxName}
                onChange={e => setMailboxName(e.target.value)}
                autoFocus
              />
              <button className="import-btn" type="submit" disabled={!mailboxName.trim()}>
                Continue →
              </button>
            </form>

            {existingMailboxes.length > 0 && (
              <div className="import-existing">
                <div className="import-existing-label">or add to an existing mailbox</div>
                <div className="import-existing-list">
                  {existingMailboxes.map(m => (
                    <button key={m.id} className="import-existing-btn" onClick={() => handleSelectExisting(m.id)}>
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'import' && (
          <div className="import-step">
            {importStatus === 'idle' && (
              <>
                <div className="import-step-title">Specify mbox path</div>
                <div className="import-hint">
                  Files mounted at <code>/data/</code> via compose.yml volume
                </div>
                <form onSubmit={handleImportStart} className="import-form">
                  <input
                    className="import-input import-input-mono"
                    type="text"
                    placeholder="/data/mail.mbox"
                    value={mboxPath}
                    onChange={e => setMboxPath(e.target.value)}
                    autoFocus
                    spellCheck={false}
                  />
                  <button className="import-btn" type="submit" disabled={!mboxPath.trim()}>
                    Start Import
                  </button>
                </form>
              </>
            )}

            {(importStatus === 'running' || importStatus === 'done' || importStatus === 'error') && (
              <>
                <div className="import-log-panel">
                  {logs.map((line, i) => (
                    <div key={i} className="import-log-line">{line}</div>
                  ))}
                  <div ref={logsEndRef} />
                </div>

                {progress && (
                  <div className="import-counter">
                    Seen: {progress.seen?.toLocaleString()} · Indexed: {progress.indexed?.toLocaleString()} · Skipped: {(progress.skipped ?? 0).toLocaleString()}
                    {progress.rate ? ` · ~${progress.rate} emails/s` : ''}
                  </div>
                )}

                {importStatus === 'error' && (
                  <div className="import-error">{error}</div>
                )}

                {importStatus === 'done' && (
                  <div className="import-done">
                    <span>✦ Done — {progress?.indexed?.toLocaleString()} emails indexed</span>
                    <div className="import-done-actions">
                      <button className="import-btn-secondary" onClick={handleAddAnother}>
                        Add another file to this mailbox
                      </button>
                      <button className="import-btn" onClick={() => onComplete(targetMailboxId)}>
                        Open Archive →
                      </button>
                    </div>
                  </div>
                )}

                {importStatus === 'running' && (
                  <div className="import-running-indicator">
                    <div className="loading-dot" /> Importing…
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/ImportScreen.jsx
git commit -m "feat: add ImportScreen component with SSE live log"
```

---

### Task 7: MailboxBar component

**Files:**
- Create: `client/src/components/MailboxBar.jsx`

**Step 1: Create the component**

```jsx
export default function MailboxBar({ mailboxes, selectedIds, onSelectionChange, onAddClick }) {
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
          <button
            key={m.id}
            className={`mailbox-chip${isActive(m.id) ? ' active' : ''}`}
            onClick={() => toggleMailbox(m.id)}
            title={`${m.count?.toLocaleString() ?? 0} emails`}
          >
            {m.name}
            {m.count > 0 && <span className="mailbox-chip-count">{m.count?.toLocaleString()}</span>}
          </button>
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
git commit -m "feat: add MailboxBar multi-select component"
```

---

### Task 8: Wire App.jsx + add CSS

**Files:**
- Modify: `client/src/App.jsx`
- Modify: `client/src/App.css`

**Step 1: Rewrite App.jsx**

Replace the entire file:

```jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import EmailDetail from './components/EmailDetail';
import ImportScreen from './components/ImportScreen';
import MailboxBar from './components/MailboxBar';
import './App.css';

const PAGE_SIZE = 50;

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function truncateEmail(str, max = 42) {
  if (!str) return '';
  const match = str.match(/<([^>]+)>/);
  const addr = match ? match[1] : str;
  return addr.length > max ? addr.slice(0, max - 1) + '…' : addr;
}

function mailboxIdsParam(selectedIds) {
  if (selectedIds === null) return {};
  return { mailboxIds: selectedIds.join(',') };
}

export default function App() {
  const [appReady, setAppReady] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [mailboxes, setMailboxes] = useState([]);
  const [selectedMailboxIds, setSelectedMailboxIds] = useState(null);

  const [emails, setEmails] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [sort, setSort] = useState('desc');
  const [stats, setStats] = useState(null);
  const [years, setYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(370);
  const listRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startWidth: 0 });

  const refreshMailboxes = useCallback(async () => {
    const res = await axios.get('/api/mailboxes');
    setMailboxes(res.data);
    return res.data;
  }, []);

  useEffect(() => {
    refreshMailboxes().then(data => {
      setAppReady(true);
      if (data.length === 0) setShowImport(true);
    }).catch(() => setAppReady(true));
  }, [refreshMailboxes]);

  const onResizeStart = useCallback((e) => {
    e.preventDefault();
    dragRef.current = { active: true, startX: e.clientX, startWidth: sidebarWidth };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, [sidebarWidth]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.startX;
      setSidebarWidth(Math.min(560, Math.max(240, dragRef.current.startWidth + dx)));
    };
    const onUp = () => {
      if (dragRef.current.active) {
        dragRef.current.active = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 320);
    return () => clearTimeout(t);
  }, [search]);

  const mbParam = mailboxIdsParam(selectedMailboxIds);

  useEffect(() => {
    if (!appReady || showImport) return;
    axios.get('/api/stats', { params: mbParam }).then(r => setStats(r.data)).catch(() => {});
    axios.get('/api/years', { params: mbParam }).then(r => setYears(r.data)).catch(() => {});
  }, [appReady, showImport, selectedMailboxIds]);

  const fetchEmails = useCallback(async (currentOffset, replace) => {
    setLoading(true);
    try {
      const params = { limit: PAGE_SIZE + 1, offset: currentOffset, sort, ...mbParam };
      if (yearFilter !== 'all') params.year = yearFilter;

      let res;
      if (debouncedSearch.trim()) {
        res = await axios.get('/api/search', { params: { ...params, q: debouncedSearch.trim() } });
      } else {
        res = await axios.get('/api/emails', { params });
      }

      const data = res.data;
      const more = data.length > PAGE_SIZE;
      const page = more ? data.slice(0, PAGE_SIZE) : data;

      if (replace) {
        setEmails(page);
        if (listRef.current) listRef.current.scrollTop = 0;
      } else {
        setEmails(prev => [...prev, ...page]);
      }
      setHasMore(more);
      setOffset(currentOffset + page.length);
    } catch {
      if (replace) setEmails([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, yearFilter, sort, selectedMailboxIds]);

  useEffect(() => {
    if (!appReady || showImport) return;
    setOffset(0);
    setEmails([]);
    fetchEmails(0, true);
  }, [fetchEmails, appReady, showImport]);

  const handleLoadMore = () => {
    if (!loading && hasMore) fetchEmails(offset, false);
  };

  function handleImportComplete(newMailboxId) {
    setShowImport(false);
    refreshMailboxes().then(() => {
      setSelectedMailboxIds([newMailboxId]);
    });
  }

  function handleMailboxSelection(ids) {
    setSelectedMailboxIds(ids);
    setYearFilter('all');
    setSearch('');
    setSelected(null);
  }

  const yearRange = stats
    ? `${new Date(stats.oldest).getFullYear()} – ${new Date(stats.newest).getFullYear()}`
    : '';

  if (!appReady) {
    return (
      <div className="app-loading">
        <div className="loading-dot" />
      </div>
    );
  }

  if (showImport) {
    return <ImportScreen onComplete={handleImportComplete} existingMailboxes={mailboxes} />;
  }

  return (
    <div className="app-root">
      <MailboxBar
        mailboxes={mailboxes}
        selectedIds={selectedMailboxIds}
        onSelectionChange={handleMailboxSelection}
        onAddClick={() => setShowImport(true)}
      />

      <div className="app">
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <div className="sidebar-head">
            <div className="sidebar-logo">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="m2 7 10 7 10-7"/>
              </svg>
              {stats ? stats.total.toLocaleString() + ' emails' : 'Email Archive'}
            </div>
            {stats && yearRange && (
              <div className="sidebar-meta">{yearRange}</div>
            )}
          </div>

          <div className="filters">
            <div className="search-wrap">
              <svg className="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                className="search-input"
                type="text"
                placeholder="search letters…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                spellCheck={false}
              />
            </div>

            <div className="filter-section">
              <div className="filter-label">Year</div>
              <div className="chip-row">
                <button className={`chip${yearFilter === 'all' ? ' active' : ''}`} onClick={() => setYearFilter('all')}>All</button>
                {years.map(({ year }) => (
                  <button key={year} className={`chip${yearFilter === year ? ' active' : ''}`} onClick={() => setYearFilter(year)}>{year}</button>
                ))}
              </div>
            </div>

            <div className="filter-section">
              <div className="filter-label">Order</div>
              <div className="sort-row">
                <button className={`sort-btn${sort === 'desc' ? ' active' : ''}`} onClick={() => setSort('desc')}>↓ Newest first</button>
                <button className={`sort-btn${sort === 'asc' ? ' active' : ''}`} onClick={() => setSort('asc')}>↑ Oldest first</button>
              </div>
            </div>
          </div>

          <div className="result-bar">
            <span className="result-count">
              {loading && emails.length === 0 ? (
                <span>Loading…</span>
              ) : emails.length > 0 ? (
                <span><strong>{emails.length}{hasMore ? '+' : ''}</strong> {debouncedSearch ? 'found' : 'letters'}</span>
              ) : (
                <span>No letters found</span>
              )}
            </span>
            {loading && <div className="loading-dot" />}
          </div>

          <div className="resize-handle" onMouseDown={onResizeStart} />

          <div className="email-list" ref={listRef}>
            {emails.length === 0 && !loading ? (
              <div className="empty-list">
                <div className="empty-list-icon">✦</div>
                <p>No letters match<br />your filters</p>
              </div>
            ) : (
              emails.map(email => (
                <div
                  key={email.id}
                  className={`email-item${selected?.id === email.id ? ' active' : ''}`}
                  onClick={() => setSelected(email)}
                >
                  <div className="item-date">{formatDate(email.date)}</div>
                  <div className="item-subject">{email.subject || '(no subject)'}</div>
                  <div className="item-from">{truncateEmail(email.from)}</div>
                </div>
              ))
            )}

            {hasMore && (
              <div className="load-more-wrap">
                <button className="load-more-btn" onClick={handleLoadMore} disabled={loading}>
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        </aside>

        <main className="main">
          {selected ? (
            <EmailDetail key={selected.id} email={selected} />
          ) : (
            <div className="empty-state">
              <div className="empty-state-glyph">✦</div>
              <p>Select a letter to read</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
```

**Step 2: Add CSS for new components to App.css**

Append to the end of `client/src/App.css`:

```css
/* ── App root with top bar ────────────────────────────── */

.app-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-root .app {
  flex: 1;
  min-height: 0;
}

/* ── App loading state ────────────────────────────────── */

.app-loading {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── Mailbox top bar ──────────────────────────────────── */

.mailbox-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  height: 40px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.mailbox-bar::-webkit-scrollbar {
  display: none;
}

.mailbox-bar-logo {
  color: var(--accent);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  opacity: 0.7;
}

.mailbox-chip-row {
  display: flex;
  gap: 5px;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none;
}

.mailbox-chip-row::-webkit-scrollbar {
  display: none;
}

.mailbox-chip {
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 500;
  padding: 3px 9px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.15s;
  letter-spacing: 0.01em;
  user-select: none;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.mailbox-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim2);
}

.mailbox-chip.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}

.mailbox-chip-count {
  font-size: 10px;
  opacity: 0.7;
  font-family: var(--font-mono);
}

.mailbox-add-btn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--text-2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.mailbox-add-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim2);
}

/* ── Import screen ────────────────────────────────────── */

.import-screen {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-0);
  padding: 24px;
}

.import-box {
  width: 100%;
  max-width: 560px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 36px 40px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.import-logo {
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  color: var(--accent);
  display: flex;
  align-items: center;
  gap: 10px;
  letter-spacing: 0.01em;
}

.import-step-title {
  font-family: var(--font-sans);
  font-size: 18px;
  font-weight: 600;
  color: var(--text-0);
  letter-spacing: -0.01em;
  margin-bottom: 16px;
}

.import-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.import-input {
  width: 100%;
  background: var(--bg-2);
  border: 1px solid var(--border);
  color: var(--text-0);
  font-family: var(--font-sans);
  font-size: 14px;
  padding: 10px 14px;
  border-radius: 6px;
  outline: none;
  transition: border-color 0.2s;
}

.import-input-mono {
  font-family: var(--font-mono);
  font-size: 13px;
}

.import-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-dim2);
}

.import-hint {
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--text-3);
  margin-bottom: 10px;
}

.import-hint code {
  font-family: var(--font-mono);
  color: var(--text-2);
  background: var(--bg-3);
  padding: 1px 5px;
  border-radius: 3px;
}

.import-btn {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 10px 20px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  align-self: flex-end;
}

.import-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.import-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.import-btn-secondary {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  padding: 8px 16px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-2);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.import-btn-secondary:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.import-existing {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border-subtle);
}

.import-existing-label {
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-bottom: 10px;
}

.import-existing-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.import-existing-btn {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  padding: 5px 12px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--text-1);
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s;
}

.import-existing-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim2);
}

.import-log-panel {
  background: #1a1814;
  border-radius: 6px;
  padding: 14px 16px;
  height: 220px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.65;
  scrollbar-width: thin;
  scrollbar-color: #3a3630 transparent;
}

.import-log-line {
  color: #c4954a;
  white-space: pre-wrap;
  word-break: break-all;
}

.import-counter {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-2);
  margin-top: 10px;
  letter-spacing: 0.01em;
}

.import-running-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--text-3);
  margin-top: 10px;
}

.import-error {
  font-family: var(--font-mono);
  font-size: 12px;
  color: #c0392b;
  background: rgba(192, 57, 43, 0.06);
  border: 1px solid rgba(192, 57, 43, 0.2);
  border-radius: 5px;
  padding: 10px 14px;
  margin-top: 10px;
  word-break: break-all;
}

.import-done {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 10px;
}

.import-done > span {
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 600;
  color: var(--accent);
}

.import-done-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
```

**Step 3: Verify the dev build works**

```bash
cd client && npm run dev
```
Expected: Vite dev server starts. Browser shows either the import screen (if DB is empty) or the main archive.

**Step 4: Test the full flow manually**
1. Clear the database: `rm -f data/emails.db`
2. Restart the backend: `npm run dev`
3. Open http://localhost:5173
4. Import screen should appear
5. Enter a mailbox name, click Continue
6. Enter the mbox path, click Start Import
7. Logs and counter should appear in real time
8. When done, "Open Archive" should show the email browser with the mailbox tab active

**Step 5: Commit**

```bash
git add client/src/App.jsx client/src/App.css
git commit -m "feat: wire up MailboxBar and ImportScreen into App, add all CSS"
```

---

### Task 9: End-to-end Docker verification

**Step 1: Build and run**

```bash
docker compose up --build
```
Expected: server starts at http://localhost:3001

**Step 2: Verify import works in Docker**

Open http://localhost:3001. Import screen should appear (fresh container, empty DB).
Create a mailbox, enter path `/data/Takeout/Mail/All mail Including Spam and Trash.mbox`, start import.

**Step 3: Verify persistence**

```bash
docker compose down
docker compose up
```
Expected: app opens directly to email archive (no import screen) — DB was persisted in the named volume.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: complete import UI and multi-mailbox support"
```
