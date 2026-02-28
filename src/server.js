import express from 'express';
import cors from 'cors';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase, getEmails, searchEmails, getEmail, getStats, getYearCounts } from './db/database.js';
import { indexEmails } from './services/indexService.js';
import { getAttachmentsForEmail, getAttachment } from './db/attachments.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

let db;

async function startup() {
  db = await initializeDatabase();
  console.log('Database ready');
}

app.get('/api/years', async (req, res) => {
  try {
    const counts = await getYearCounts(db);
    res.json(counts);
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
    const emails = await getEmails(db, limit, offset, year, sort);
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
    const { q, limit = '50', offset = '0', year, sort } = req.query;
    if (!q) return res.status(400).json({ error: 'Query required' });
    const results = await searchEmails(db, q, parseInt(limit), parseInt(offset), year || null, sort === 'asc' ? 'asc' : 'desc');
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

app.use(express.static(resolve(__dirname, '../client/dist')));

app.get('*', (req, res) => {
  res.sendFile(resolve(__dirname, '../client/dist/index.html'));
});

startup().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
