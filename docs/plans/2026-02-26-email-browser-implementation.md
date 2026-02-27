# Email Browser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full-stack web app that ingests Google Takeout emails and provides a searchable offline browser.

**Architecture:** Node.js backend with Express API, SQLite database for indexing, React frontend for browsing. MBOX parser runs once on startup, populating the database with full-text search capability.

**Tech Stack:** Node.js, Express, SQLite3, React, TypeScript, mailparser, react-query

---

## Phase 1: Project Setup

### Task 1: Initialize Node.js project and dependencies

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/` directory structure

**Step 1: Create package.json**

```json
{
  "name": "email-browser",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "NODE_ENV=development node src/server.js",
    "build": "cd client && npm run build",
    "start": "NODE_ENV=production node src/server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "sqlite3": "^5.1.6",
    "mailparser": "^3.6.5",
    "cors": "^2.8.5",
    "dotenv": "^16.0.3"
  },
  "devDependencies": {
    "sqlite": "^5.0.1"
  }
}
```

Run: `cd /Users/home/Downloads/Takeout && npm install`
Expected: All packages install successfully

**Step 2: Create project structure**

Create these directories:
- `src/` - Node backend
- `src/db/` - Database logic
- `src/parser/` - MBOX parser
- `src/routes/` - API routes
- `client/` - React frontend
- `client/src/`
- `data/` - SQLite database (created at runtime)

**Step 3: Create .gitignore**

```
node_modules/
data/*.db
.env
.DS_Store
client/node_modules/
client/build/
dist/
```

**Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "init: project structure and dependencies"
```

---

## Phase 2: MBOX Parser

### Task 2: Write MBOX parser with tests

**Files:**
- Create: `src/parser/mboxParser.js`
- Create: `test/parser.test.js`
- Create: `test/sample.mbox` (test fixture)

**Step 1: Create sample MBOX test fixture**

```
From sender@example.com  Mon Jan  1 00:00:00 2024
From: sender@example.com
To: recipient@example.com
Subject: Test Email 1
Date: Mon, 1 Jan 2024 12:00:00 +0000
Message-ID: <msg1@example.com>

This is a test email body.

From another@example.com  Mon Jan  2 00:00:00 2024
From: another@example.com
To: recipient@example.com
Subject: Test Email 2
Date: Mon, 2 Jan 2024 13:00:00 +0000
Message-ID: <msg2@example.com>

Another test body.
```

Save to: `test/sample.mbox`

**Step 2: Write parser test**

```javascript
// test/parser.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseEmailFile } from '../src/parser/mboxParser.js';
import { readFileSync } from 'fs';

describe('MBOX Parser', () => {
  it('should parse emails from MBOX file', async () => {
    const emails = await parseEmailFile('test/sample.mbox');
    assert.strictEqual(emails.length, 2);
    assert.strictEqual(emails[0].from, 'sender@example.com');
    assert.strictEqual(emails[1].subject, 'Test Email 2');
  });

  it('should extract email fields', async () => {
    const emails = await parseEmailFile('test/sample.mbox');
    const email = emails[0];
    assert(email.from);
    assert(email.to);
    assert(email.subject);
    assert(email.date);
    assert(email.body);
    assert(email.messageId);
  });
});
```

Run: `node --test test/parser.test.js`
Expected: FAIL - parseEmailFile is not defined

**Step 3: Implement MBOX parser**

```javascript
// src/parser/mboxParser.js
import { simpleParser } from 'mailparser';
import { createReadStream } from 'fs';
import { Readable } from 'stream';

export async function parseEmailFile(filePath) {
  const emails = [];
  const stream = createReadStream(filePath);

  const boundaryRegex = /^From\s+\S+\s+\w{3}\s+\w{3}/m;
  let currentEmail = '';

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      currentEmail += chunk.toString();
    });

    stream.on('end', async () => {
      const parts = currentEmail.split(boundaryRegex).filter(p => p.trim());

      for (const part of parts) {
        try {
          const parsed = await simpleParser('From: \n' + part);
          if (parsed.from?.text || parsed.subject) {
            emails.push({
              messageId: parsed.messageId || '',
              from: parsed.from?.text || '',
              to: parsed.to?.text || '',
              cc: parsed.cc?.text || '',
              bcc: parsed.bcc?.text || '',
              subject: parsed.subject || '(no subject)',
              date: parsed.date || new Date(),
              body: parsed.text || '',
              bodyHTML: parsed.html || '',
              headers: JSON.stringify(Array.from(parsed.headers.entries()))
            });
          }
        } catch (err) {
          // Skip malformed emails
        }
      }

      resolve(emails);
    });

    stream.on('error', reject);
  });
}
```

Run: `node --test test/parser.test.js`
Expected: PASS

**Step 4: Commit**

```bash
git add src/parser/mboxParser.js test/parser.test.js test/sample.mbox
git commit -m "feat: MBOX parser with tests"
```

---

## Phase 3: SQLite Database Setup

### Task 3: Create SQLite schema and initialization

**Files:**
- Create: `src/db/schema.js`
- Create: `src/db/database.js`
- Create: `test/database.test.js`

**Step 1: Write database test**

```javascript
// test/database.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { initializeDatabase, insertEmail } from '../src/db/database.js';
import { unlink } from 'fs/promises';

describe('Database', () => {
  const testDb = 'data/test.db';

  it('should create database with schema', async () => {
    const db = await initializeDatabase(testDb);
    assert(db);
  });

  it('should insert and retrieve email', async () => {
    const db = await initializeDatabase(testDb);
    const email = {
      messageId: 'test@example.com',
      from: 'sender@example.com',
      to: 'recipient@example.com',
      cc: '',
      bcc: '',
      subject: 'Test',
      date: new Date(),
      body: 'Test body',
      bodyHTML: '<p>Test body</p>',
      headers: '{}'
    };

    await insertEmail(db, email);

    const result = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM emails WHERE messageId = ?', [email.messageId], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });

    assert.strictEqual(result.subject, 'Test');
  });

  // Cleanup
  after(async () => {
    try { await unlink(testDb); } catch {}
  });
});
```

Run: `node --test test/database.test.js`
Expected: FAIL - initializeDatabase not defined

**Step 2: Create database schema**

```javascript
// src/db/schema.js
export const schema = `
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  messageId TEXT UNIQUE NOT NULL,
  from TEXT,
  to TEXT,
  cc TEXT,
  bcc TEXT,
  subject TEXT,
  date DATETIME,
  bodyText TEXT,
  bodyHTML TEXT,
  headers TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_date ON emails(date);
CREATE INDEX IF NOT EXISTS idx_email_from ON emails(from);
CREATE INDEX IF NOT EXISTS idx_email_to ON emails(to);

CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
  subject,
  bodyText,
  from,
  to,
  content=emails,
  content_rowid=id
);

CREATE TRIGGER IF NOT EXISTS emails_ai AFTER INSERT ON emails BEGIN
  INSERT INTO emails_fts(rowid, subject, bodyText, from, to)
  VALUES (new.id, new.subject, new.bodyText, new.from, new.to);
END;

CREATE TRIGGER IF NOT EXISTS emails_ad AFTER DELETE ON emails BEGIN
  INSERT INTO emails_fts(emails_fts, rowid, subject, bodyText, from, to)
  VALUES('delete', old.id, old.subject, old.bodyText, old.from, old.to);
END;
`;
```

**Step 3: Create database initialization**

```javascript
// src/db/database.js
import sqlite3 from 'sqlite3';
import { schema } from './schema.js';
import { mkdir } from 'fs/promises';

export async function initializeDatabase(dbPath = 'data/emails.db') {
  await mkdir('data', { recursive: true });

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);

      db.exec(schema, (err) => {
        if (err) return reject(err);
        resolve(db);
      });
    });
  });
}

export function insertEmail(db, email) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT OR IGNORE INTO emails
      (messageId, from, to, cc, bcc, subject, date, bodyText, bodyHTML, headers)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
      email.messageId,
      email.from,
      email.to,
      email.cc,
      email.bcc,
      email.subject,
      email.date,
      email.body,
      email.bodyHTML,
      email.headers
    ], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
}

export function getEmail(db, id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM emails WHERE id = ?', [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function searchEmails(db, query, limit = 50, offset = 0) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT e.* FROM emails e
      JOIN emails_fts fts ON e.id = fts.rowid
      WHERE emails_fts MATCH ?
      ORDER BY e.date DESC
      LIMIT ? OFFSET ?
    `;

    db.all(sql, [query, limit, offset], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

export function getEmails(db, limit = 50, offset = 0) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM emails ORDER BY date DESC LIMIT ? OFFSET ?';
    db.all(sql, [limit, offset], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

export function getStats(db) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) as total, MIN(date) as oldest, MAX(date) as newest FROM emails`,
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}
```

Run: `node --test test/database.test.js`
Expected: PASS

**Step 4: Commit**

```bash
git add src/db/schema.js src/db/database.js test/database.test.js
git commit -m "feat: SQLite schema and database initialization"
```

---

## Phase 4: Indexing Pipeline

### Task 4: Create email indexing service

**Files:**
- Create: `src/services/indexService.js`
- Modify: `src/server.js`

**Step 1: Create indexing service**

```javascript
// src/services/indexService.js
import { parseEmailFile } from '../parser/mboxParser.js';
import { insertEmail } from '../db/database.js';

export async function indexEmails(db, mboxPath) {
  console.log('Starting email indexing...');
  const startTime = Date.now();

  try {
    const emails = await parseEmailFile(mboxPath);
    console.log(`Parsed ${emails.length} emails`);

    let indexed = 0;
    for (const email of emails) {
      try {
        await insertEmail(db, email);
        indexed++;

        if (indexed % 1000 === 0) {
          console.log(`Indexed ${indexed}/${emails.length}...`);
        }
      } catch (err) {
        // Skip duplicate or malformed emails
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Indexed ${indexed} emails in ${elapsed}s`);

    return indexed;
  } catch (err) {
    console.error('Indexing failed:', err);
    throw err;
  }
}

export async function isIndexed(db) {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as count FROM emails', (err, row) => {
      if (err) reject(err);
      else resolve(row.count > 0);
    });
  });
}
```

**Step 2: Create Express server**

```javascript
// src/server.js
import express from 'express';
import cors from 'cors';
import { initializeDatabase, getEmails, searchEmails, getEmail, getStats } from './db/database.js';
import { indexEmails, isIndexed } from './services/indexService.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

let db;
let indexedCount = 0;

// Initialize on startup
async function startup() {
  db = await initializeDatabase();

  const indexed = await isIndexed(db);
  if (!indexed) {
    const mboxPath = '/Users/home/Downloads/Takeout/Mail/All mail Including Spam and Trash.mbox';
    indexedCount = await indexEmails(db, mboxPath);
  } else {
    const stats = await getStats(db);
    indexedCount = stats.total;
  }

  console.log(`Ready! ${indexedCount} emails indexed`);
}

// API Routes
app.get('/api/emails', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50');
    const offset = parseInt(req.query.offset || '0');
    const emails = await getEmails(db, limit, offset);
    res.json(emails);
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
    const { q, limit = '50', offset = '0' } = req.query;
    if (!q) return res.status(400).json({ error: 'Query required' });

    const results = await searchEmails(db, q, parseInt(limit), parseInt(offset));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getStats(db);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

startup().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
```

**Step 3: Test server startup**

Run: `npm run dev`
Expected: Server listens on port 5000, indexes emails from Takeout folder, logs "Ready!" when complete

**Step 4: Commit**

```bash
git add src/services/indexService.js src/server.js
git commit -m "feat: email indexing and Express API"
```

---

## Phase 5: React Frontend

### Task 5: Create React app and email list component

**Files:**
- Create: `client/package.json`
- Create: `client/src/App.jsx`
- Create: `client/src/components/EmailList.jsx`
- Create: `client/src/components/EmailDetail.jsx`
- Create: `client/src/App.css`
- Create: `client/index.html`

**Step 1: Initialize React project**

```bash
cd /Users/home/Downloads/Takeout/client
npm init -y
npm install react react-dom axios
npm install -D vite @vitejs/plugin-react
```

Update `client/package.json` scripts:
```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview"
}
```

Create `client/vite.config.js`:
```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5000'
    }
  }
})
```

**Step 2: Create main App component**

```javascript
// client/src/App.jsx
import { useState, useEffect } from 'react';
import axios from 'axios';
import EmailList from './components/EmailList';
import EmailDetail from './components/EmailDetail';
import './App.css';

export default function App() {
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await axios.get('/api/stats');
        setStats(res.data);
      } catch (err) {
        console.error('Failed to fetch stats:', err);
      }
    };
    fetchStats();
  }, []);

  const handleSearch = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.get('/api/search', { params: { q: search } });
      setEmails(res.data);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadAll = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/emails?limit=100');
      setEmails(res.data);
    } catch (err) {
      console.error('Load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <div className="sidebar">
        <h1>📧 Email Browser</h1>

        {stats && (
          <div className="stats">
            <p><strong>{stats.total}</strong> emails</p>
            <p>{new Date(stats.oldest).getFullYear()} - {new Date(stats.newest).getFullYear()}</p>
          </div>
        )}

        <form onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="Search emails..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={loading}
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        <button onClick={handleLoadAll} disabled={loading} className="load-btn">
          Load Recent Emails
        </button>

        <EmailList emails={emails} selected={selectedEmail} onSelect={setSelectedEmail} />
      </div>

      <div className="main">
        {selectedEmail ? (
          <EmailDetail email={selectedEmail} />
        ) : (
          <div className="empty">
            <p>Select an email to view</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Create EmailList component**

```javascript
// client/src/components/EmailList.jsx
export default function EmailList({ emails, selected, onSelect }) {
  return (
    <div className="email-list">
      {emails.length === 0 ? (
        <p className="empty-message">No emails</p>
      ) : (
        emails.map(email => (
          <div
            key={email.id}
            className={`email-item ${selected?.id === email.id ? 'active' : ''}`}
            onClick={() => onSelect(email)}
          >
            <div className="from">{email.from || 'Unknown'}</div>
            <div className="subject">{email.subject}</div>
            <div className="date">{new Date(email.date).toLocaleDateString()}</div>
          </div>
        ))
      )}
    </div>
  );
}
```

**Step 4: Create EmailDetail component**

```javascript
// client/src/components/EmailDetail.jsx
export default function EmailDetail({ email }) {
  return (
    <div className="email-detail">
      <div className="header">
        <h2>{email.subject}</h2>
        <div className="meta">
          <p><strong>From:</strong> {email.from}</p>
          <p><strong>To:</strong> {email.to}</p>
          <p><strong>Date:</strong> {new Date(email.date).toLocaleString()}</p>
        </div>
      </div>

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

**Step 5: Create styles**

```css
/* client/src/App.css */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f5f5f5;
}

.app {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 320px;
  background: white;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar h1 {
  padding: 20px;
  font-size: 24px;
  border-bottom: 1px solid #e0e0e0;
}

.stats {
  padding: 15px 20px;
  background: #f9f9f9;
  border-bottom: 1px solid #e0e0e0;
}

.stats p {
  font-size: 14px;
  color: #666;
  margin: 5px 0;
}

.sidebar form {
  padding: 15px 20px;
  display: flex;
  gap: 10px;
  border-bottom: 1px solid #e0e0e0;
}

.sidebar input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.sidebar button {
  padding: 8px 12px;
  background: #1a73e8;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.load-btn {
  margin: 10px 20px 0;
  width: calc(100% - 40px);
}

.sidebar button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.email-list {
  flex: 1;
  overflow-y: auto;
  border-right: 1px solid #e0e0e0;
}

.email-item {
  padding: 12px 20px;
  border-bottom: 1px solid #e0e0e0;
  cursor: pointer;
  transition: background 0.2s;
}

.email-item:hover {
  background: #f5f5f5;
}

.email-item.active {
  background: #e8f0fe;
}

.email-item .from {
  font-weight: 500;
  font-size: 14px;
  margin-bottom: 4px;
}

.email-item .subject {
  font-size: 13px;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.email-item .date {
  font-size: 12px;
  color: #999;
}

.main {
  flex: 1;
  background: white;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
}

.email-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.email-detail .header {
  padding: 30px;
  border-bottom: 1px solid #e0e0e0;
  background: #fafafa;
}

.email-detail h2 {
  margin-bottom: 15px;
  font-size: 22px;
}

.meta {
  font-size: 14px;
  color: #666;
}

.meta p {
  margin: 5px 0;
}

.email-detail .body {
  flex: 1;
  overflow-y: auto;
  padding: 30px;
  font-size: 14px;
  line-height: 1.6;
}

.email-detail pre {
  background: #f5f5f5;
  padding: 15px;
  border-radius: 4px;
  overflow-x: auto;
}

.empty-message {
  text-align: center;
  color: #999;
  padding: 20px;
  font-size: 14px;
}
```

**Step 6: Create HTML entry point**

```html
<!-- client/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Email Browser</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

Create `client/src/main.jsx`:
```javascript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

**Step 7: Commit**

```bash
cd /Users/home/Downloads/Takeout
git add client/
git commit -m "feat: React frontend with email browser UI"
```

---

## Phase 6: Integration & Testing

### Task 6: Test full app end-to-end

**Step 1: Start backend**

Run: `npm run dev` (from /Users/home/Downloads/Takeout)
Expected: Server on port 5000, emails indexed

**Step 2: Start frontend (in new terminal)**

Run: `cd client && npm run dev`
Expected: Vite dev server on port 5173

**Step 3: Test in browser**

1. Open http://localhost:5173
2. Should see email stats
3. Click "Load Recent Emails" - should populate list
4. Click an email - should show in detail view
5. Search for a term - should return results

**Step 4: Build for production**

Run: `cd client && npm run build`
Expected: Build directory created with optimized assets

**Step 5: Create start script**

Update `package.json`:
```json
"scripts": {
  "dev": "NODE_ENV=development node src/server.js",
  "build": "cd client && npm run build",
  "start": "NODE_ENV=production node src/server.js"
}
```

Modify `src/server.js` to serve frontend:
```javascript
// Add this before route definitions
app.use(express.static('client/dist'));
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/../client/dist/index.html');
});
```

**Step 6: Final commit**

```bash
git add package.json src/server.js
git commit -m "feat: production build and integration"
```

---

## Summary

This implementation plan covers:
- ✅ MBOX parser with full-text search
- ✅ SQLite database with FTS5
- ✅ Express.js REST API
- ✅ React frontend with search and browse
- ✅ Email detail view with HTML rendering
- ✅ Statistics and metadata
- ✅ Production build setup

**Total estimated time: 2-3 hours**

Each task is self-contained with tests and commits. Follow TDD: write failing tests, implement, verify, commit.
