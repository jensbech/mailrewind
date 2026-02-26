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
