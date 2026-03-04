import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import { readdir, stat } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, sep } from 'path';
import {
  getEmails, searchEmails, getEmail, getStats, getYearCounts,
  createMailbox, getMailboxes, deleteMailbox, getTopDomains
} from './db/database.js';
import { indexEmails } from './services/indexService.js';
import { getAttachmentsForEmail, getAttachment } from './db/attachments.js';
import { SqliteStore } from './auth/sessionStore.js';
import { requireAuth, createAuthRoutes } from './auth/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAX_SSE_CLIENTS = 20;

const ALLOWED_MIME_PREFIXES = [
  'application/', 'image/', 'audio/', 'video/', 'text/', 'font/',
  'message/', 'model/', 'multipart/',
];

function sanitizeContentType(ct) {
  if (!ct) return 'application/octet-stream';
  const cleaned = ct.replace(/[\r\n]/g, '').split(';')[0].trim().toLowerCase();
  if (ALLOWED_MIME_PREFIXES.some(p => cleaned.startsWith(p))) return cleaned;
  return 'application/octet-stream';
}

function clampInt(value, defaultVal, min, max) {
  const n = parseInt(value);
  if (isNaN(n)) return defaultVal;
  return Math.min(Math.max(n, min), max);
}

function isPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

export function parseMailboxIds(query) {
  if (!query) return null;
  const ids = String(query).split(',').map(Number).filter(n => !isNaN(n) && n > 0);
  return ids.length > 0 ? ids : null;
}

export function createApp(db, { heartbeatMs = 15000, filesDir = '/data', authConfig = {} } = {}) {
  const app = express();
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
      },
    },
  }));
  app.use(express.json({ limit: '100kb' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const searchLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const importLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api/', apiLimiter);

  if (authConfig.enabled) {
    app.set('trust proxy', 1);
    app.use((req, res, next) => {
      if (!req.headers['x-forwarded-proto'] || req.headers['x-forwarded-proto'] === 'https') return next();
      res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    });
    app.use(session({
      store: new SqliteStore(db),
      secret: authConfig.sessionSecret,
      resave: false,
      saveUninitialized: false,
      name: 'mailrewind.sid',
      cookie: {
        httpOnly: true,
        secure: 'auto',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
      },
    }));
    app.use('/auth', createAuthRoutes(authConfig));
    app.use(requireAuth(authConfig));
  }

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
        importState.seen = event.seen;
        importState.skipped = event.skipped;
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
      console.error('GET /api/mailboxes error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/mailboxes', async (req, res) => {
    try {
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
      const trimmed = name.trim().slice(0, 255);
      res.status(201).json(await createMailbox(db, trimmed));
    } catch (err) {
      console.error('POST /api/mailboxes error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/mailboxes/:id', async (req, res) => {
    try {
      if (!isPositiveInt(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
      await deleteMailbox(db, req.params.id);
      res.status(204).end();
    } catch (err) {
      console.error('DELETE /api/mailboxes error:', err);
      res.status(500).json({ error: 'Internal server error' });
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

  app.post('/api/import/start', importLimiter, async (req, res) => {
    if (importState.status === 'running') {
      return res.status(409).json({ error: 'Import already running' });
    }
    const { path: mboxPath, mailboxId } = req.body;
    if (!mboxPath) return res.status(400).json({ error: 'path required' });
    if (!mailboxId || !isPositiveInt(mailboxId)) return res.status(400).json({ error: 'Valid mailboxId required' });

    const safeDir = resolve(filesDir) + sep;
    const candidatePath = mboxPath.startsWith('/') ? mboxPath : join(resolve(filesDir), mboxPath);
    const requestedPath = resolve(candidatePath);
    if (!requestedPath.startsWith(safeDir)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    runImport(requestedPath, mailboxId);
    res.status(202).json({ ok: true });
  });

  app.get('/api/import/events', (req, res) => {
    if (sseClients.size >= MAX_SSE_CLIENTS) {
      return res.status(503).json({ error: 'Too many connections' });
    }

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
    }, heartbeatMs);

    req.on('close', () => {
      sseClients.delete(res);
      clearInterval(heartbeat);
    });
  });

  app.get('/api/years', async (req, res) => {
    try {
      const mailboxIds = parseMailboxIds(req.query.mailboxIds);
      res.json(await getYearCounts(db, mailboxIds));
    } catch (err) {
      console.error('GET /api/years error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/emails', async (req, res) => {
    try {
      const limit = clampInt(req.query.limit, 50, 1, 200);
      const offset = clampInt(req.query.offset, 0, 0, 1000000);
      const years = req.query.years
        ? String(req.query.years).split(',').map(s => s.trim()).filter(s => /^\d{4}$/.test(s))
        : null;
      const sort = req.query.sort === 'asc' ? 'asc' : 'desc';
      const mailboxIds = parseMailboxIds(req.query.mailboxIds);
      const hasAttachments = req.query.hasAttachments === '1';
      const month = req.query.month ? clampInt(req.query.month, null, 1, 12) : null;
      const hasHtml = req.query.hasHtml === '1';
      const hasSubject = req.query.hasSubject === '1';
      const fromDomains = req.query.fromDomains ? String(req.query.fromDomains).split(',').map(s => s.trim()).filter(Boolean) : null;
      const attachmentType = req.query.attachmentType || null;
      const largeAttachment = req.query.largeAttachment === '1';
      const yearAfter = req.query.yearAfter && /^\d{4}$/.test(req.query.yearAfter) ? parseInt(req.query.yearAfter) : null;
      const yearBefore = req.query.yearBefore && /^\d{4}$/.test(req.query.yearBefore) ? parseInt(req.query.yearBefore) : null;
      res.json(await getEmails(db, limit, offset, years, sort, mailboxIds, hasAttachments, month, hasHtml, hasSubject, fromDomains, attachmentType, largeAttachment, yearAfter, yearBefore));
    } catch (err) {
      console.error('GET /api/emails error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/emails/:id', async (req, res) => {
    try {
      if (!isPositiveInt(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
      const email = await getEmail(db, req.params.id);
      if (!email) return res.status(404).json({ error: 'Not found' });
      res.json(email);
    } catch (err) {
      console.error('GET /api/emails/:id error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/search', searchLimiter, async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.status(400).json({ error: 'Query required' });
      const limit = clampInt(req.query.limit, 50, 1, 200);
      const offset = clampInt(req.query.offset, 0, 0, 1000000);
      const sort = req.query.sort === 'asc' ? 'asc' : 'desc';
      const years = req.query.years
        ? String(req.query.years).split(',').map(s => s.trim()).filter(s => /^\d{4}$/.test(s))
        : null;
      const mailboxIds = parseMailboxIds(req.query.mailboxIds);
      const hasAttachments = req.query.hasAttachments === '1';
      const month = req.query.month ? clampInt(req.query.month, null, 1, 12) : null;
      const hasHtml = req.query.hasHtml === '1';
      const hasSubject = req.query.hasSubject === '1';
      const fromDomains = req.query.fromDomains ? String(req.query.fromDomains).split(',').map(s => s.trim()).filter(Boolean) : null;
      const attachmentType = req.query.attachmentType || null;
      const largeAttachment = req.query.largeAttachment === '1';
      const yearAfter = req.query.yearAfter && /^\d{4}$/.test(req.query.yearAfter) ? parseInt(req.query.yearAfter) : null;
      const yearBefore = req.query.yearBefore && /^\d{4}$/.test(req.query.yearBefore) ? parseInt(req.query.yearBefore) : null;
      res.json(await searchEmails(db, q, limit, offset, years, sort, mailboxIds, hasAttachments, month, hasHtml, hasSubject, fromDomains, attachmentType, largeAttachment, yearAfter, yearBefore));
    } catch (err) {
      console.error('GET /api/search error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/domains', async (req, res) => {
    try {
      const mailboxIds = parseMailboxIds(req.query.mailboxIds);
      res.json(await getTopDomains(db, mailboxIds));
    } catch (err) {
      console.error('GET /api/domains error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/stats', async (req, res) => {
    try {
      const mailboxIds = parseMailboxIds(req.query.mailboxIds);
      res.json(await getStats(db, mailboxIds));
    } catch (err) {
      console.error('GET /api/stats error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/emails/:id/attachments', async (req, res) => {
    try {
      if (!isPositiveInt(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
      res.json(await getAttachmentsForEmail(db, req.params.id));
    } catch (err) {
      console.error('GET /api/emails/:id/attachments error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/attachments/:id/download', async (req, res) => {
    try {
      if (!isPositiveInt(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
      const att = await getAttachment(db, req.params.id);
      if (!att) return res.status(404).json({ error: 'Not found' });

      const safePath = resolve(att.path);
      const attachmentsBase = resolve('data', 'attachments') + sep;
      if (!safePath.startsWith(attachmentsBase)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const safeFilename = att.filename.replace(/[\r\n"]/g, '_');
      res.setHeader('Content-Type', sanitizeContentType(att.contentType));
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.sendFile(safePath);
    } catch (err) {
      console.error('GET /api/attachments/:id/download error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/files', async (req, res) => {
    try {
      const entries = await readdir(resolve(filesDir));
      const mboxNames = entries.filter(f => f.endsWith('.mbox'));
      const files = await Promise.all(
        mboxNames.map(async (name) => {
          const { size } = await stat(join(resolve(filesDir), name));
          return { name, size };
        })
      );
      files.sort((a, b) => a.name.localeCompare(b.name));
      res.json(files);
    } catch (err) {
      console.error('GET /api/files error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.use(express.static(resolve(__dirname, '../client/dist')));

  app.get('{*path}', (req, res) => {
    res.sendFile(resolve(__dirname, '../client/dist/index.html'));
  });

  return { app, runImport, importState, sseClients, pushEvent };
}
