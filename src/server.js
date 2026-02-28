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
