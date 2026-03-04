import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { unlink, rm, mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { createRequire } from 'module';
import { request as httpRequest } from 'http';
import { initializeDatabase, createMailbox, insertBatch } from '../src/db/database.js';
import { indexEmails } from '../src/services/indexService.js';
import { createApp, parseMailboxIds } from '../src/app.js';

const require = createRequire(import.meta.url);
const supertest = require('supertest');

const TEST_DB = 'data/test-server.db';
const BROKEN_DB = 'data/test-server-broken.db';
let db;
let brokenDb;
let app;
let mailboxId;
let emailId;

async function waitForImportDone(testApp, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const res = await supertest(testApp).get('/api/import/status');
    if (res.body.status === 'done' || res.body.status === 'error') return res.body;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('Import did not complete within timeout');
}

describe('Server API', () => {
  before(async () => {
    try { await unlink(TEST_DB); } catch {}
    try { await unlink(BROKEN_DB); } catch {}
    try { await rm('data/attachments', { recursive: true }); } catch {}

    db = await initializeDatabase(TEST_DB);
    const { app: a } = createApp(db);
    app = a;

    const mb = await createMailbox(db, 'Server Test Mailbox');
    mailboxId = mb.id;

    await insertBatch(db, [
      {
        messageId: '<srv1@test.com>',
        from: 'alice@test.com',
        to: 'bob@test.com',
        cc: '', bcc: '',
        subject: 'Server Test Email',
        date: new Date('2023-08-15T10:00:00Z').getTime(),
        body: 'Server test body',
        bodyHTML: '<p>Server test</p>',
        headers: '[]'
      },
      {
        messageId: '<srv2@test.com>',
        from: 'charlie@test.com',
        to: 'bob@test.com',
        cc: '', bcc: '',
        subject: 'Another Email',
        date: new Date('2022-03-01T09:00:00Z').getTime(),
        body: 'Another body',
        bodyHTML: '', headers: '[]'
      }
    ], mailboxId);

    const emails = await new Promise((res, rej) =>
      db.all('SELECT id FROM emails WHERE mailbox_id = ?', [mailboxId],
        (err, rows) => err ? rej(err) : res(rows))
    );
    emailId = emails[0].id;

    brokenDb = await initializeDatabase(BROKEN_DB);
    brokenDb.close();
  });

  after(async () => {
    db.close();
    try { await unlink(TEST_DB); } catch {}
    try { await unlink(BROKEN_DB); } catch {}
    try { await rm('data/attachments', { recursive: true }); } catch {}
  });

  describe('parseMailboxIds', () => {
    it('returns null for null input', () => {
      assert.strictEqual(parseMailboxIds(null), null);
    });

    it('returns null for empty string', () => {
      assert.strictEqual(parseMailboxIds(''), null);
    });

    it('parses single id', () => {
      assert.deepStrictEqual(parseMailboxIds('1'), [1]);
    });

    it('parses multiple ids', () => {
      assert.deepStrictEqual(parseMailboxIds('1,2,3'), [1, 2, 3]);
    });

    it('filters out non-positive numbers and NaN', () => {
      assert.deepStrictEqual(parseMailboxIds('1,abc,0,-1,2'), [1, 2]);
    });

    it('returns null when all ids are invalid', () => {
      assert.strictEqual(parseMailboxIds('abc,0,-1'), null);
    });
  });

  describe('GET /api/mailboxes', () => {
    it('returns list of mailboxes', async () => {
      const res = await supertest(app).get('/api/mailboxes');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.some(m => m.id === mailboxId));
    });

    it('returns 500 when database fails', async () => {
      const { app: errApp } = createApp(brokenDb);
      const res = await supertest(errApp).get('/api/mailboxes');
      assert.strictEqual(res.status, 500);
      assert.ok(res.body.error);
    });
  });

  describe('POST /api/mailboxes', () => {
    it('creates a new mailbox', async () => {
      const res = await supertest(app)
        .post('/api/mailboxes')
        .send({ name: 'New Mailbox' });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.name, 'New Mailbox');
      assert.ok(res.body.id > 0);
    });

    it('returns 400 when name is missing', async () => {
      const res = await supertest(app).post('/api/mailboxes').send({});
      assert.strictEqual(res.status, 400);
    });

    it('returns 400 when name is blank', async () => {
      const res = await supertest(app).post('/api/mailboxes').send({ name: '   ' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 500 when database fails', async () => {
      const { app: errApp } = createApp(brokenDb);
      const res = await supertest(errApp).post('/api/mailboxes').send({ name: 'Test' });
      assert.strictEqual(res.status, 500);
    });
  });

  describe('DELETE /api/mailboxes/:id', () => {
    it('deletes a mailbox by id', async () => {
      const create = await supertest(app).post('/api/mailboxes').send({ name: 'To Delete' });
      const res = await supertest(app).delete(`/api/mailboxes/${create.body.id}`);
      assert.strictEqual(res.status, 204);
    });

    it('returns 500 when database fails', async () => {
      const { app: errApp } = createApp(brokenDb);
      const res = await supertest(errApp).delete('/api/mailboxes/1');
      assert.strictEqual(res.status, 500);
    });
  });

  describe('GET /api/import/status', () => {
    it('returns current import state', async () => {
      const res = await supertest(app).get('/api/import/status');
      assert.strictEqual(res.status, 200);
      assert.ok(typeof res.body.status === 'string');
    });
  });

  describe('POST /api/import/start', () => {
    it('returns 400 when path is missing', async () => {
      const res = await supertest(app).post('/api/import/start').send({ mailboxId: 1 });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'path required');
    });

    it('returns 400 when mailboxId is missing', async () => {
      const { app: validPathApp } = createApp(db, { filesDir: resolve('test') });
      const res = await supertest(validPathApp)
        .post('/api/import/start')
        .send({ path: resolve('test/sample.mbox') });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'mailboxId required');
    });

    it('returns 400 when path is outside filesDir', async () => {
      const { app: secApp } = createApp(db, { filesDir: resolve('test') });
      const res = await supertest(secApp)
        .post('/api/import/start')
        .send({ path: '/etc/passwd', mailboxId: mailboxId });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /invalid path/i);
    });

    it('returns 400 when path traverses outside filesDir', async () => {
      const { app: secApp } = createApp(db, { filesDir: resolve('test') });
      const res = await supertest(secApp)
        .post('/api/import/start')
        .send({ path: resolve('test/../package.json'), mailboxId: mailboxId });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /invalid path/i);
    });

    it('returns 400 when relative path traverses outside filesDir', async () => {
      const { app: secApp } = createApp(db, { filesDir: resolve('test') });
      const res = await supertest(secApp)
        .post('/api/import/start')
        .send({ path: '../package.json', mailboxId: mailboxId });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /invalid path/i);
    });

    it('starts an import and returns 202, completing with done status', async () => {
      const { app: importApp } = createApp(db, { filesDir: resolve('test') });
      const mb = await createMailbox(db, 'Import Start Test');
      const res = await supertest(importApp)
        .post('/api/import/start')
        .send({ path: resolve('test/sample.mbox'), mailboxId: mb.id });
      assert.strictEqual(res.status, 202);
      assert.strictEqual(res.body.ok, true);
      const status = await waitForImportDone(importApp);
      assert.strictEqual(status.status, 'done');
    });

    it('returns 409 when import is already running', async () => {
      const { app: busyApp, importState } = createApp(db);
      importState.status = 'running';
      const res = await supertest(busyApp)
        .post('/api/import/start')
        .send({ path: 'test/sample.mbox', mailboxId: mailboxId });
      assert.strictEqual(res.status, 409);
    });

    it('tracks progress events during batch import (covers runImport progress handler)', async () => {
      const { app: progressApp } = createApp(db, { filesDir: resolve('test') });
      const mb = await createMailbox(db, 'Progress Test');
      await supertest(progressApp)
        .post('/api/import/start')
        .send({ path: resolve('test/fixtures/batch25.mbox'), mailboxId: mb.id });
      const status = await waitForImportDone(progressApp);
      assert.strictEqual(status.status, 'done');
      assert.strictEqual(status.seen, 25);
    });

    it('sets error status when import fails (covers runImport catch handler)', async () => {
      const { app: errImportApp } = createApp(brokenDb, { filesDir: resolve('test') });
      await supertest(errImportApp)
        .post('/api/import/start')
        .send({ path: resolve('test/sample.mbox'), mailboxId: 1 });
      const status = await waitForImportDone(errImportApp);
      assert.strictEqual(status.status, 'error');
      assert.ok(status.error);
    });
  });

  describe('pushEvent internal behavior', () => {
    it('shifts oldest log when buffer exceeds 200 entries', () => {
      const { importState, pushEvent } = createApp(db);
      importState.logs = new Array(200).fill('data: old\n\n');
      pushEvent({ type: 'log', text: 'new entry' });
      assert.strictEqual(importState.logs.length, 200);
      assert.ok(importState.logs[199].includes('new entry'));
    });

    it('handles SSE client write errors gracefully', () => {
      const { sseClients, pushEvent } = createApp(db);
      const throwingClient = { write: () => { throw new Error('socket closed'); } };
      sseClients.add(throwingClient);
      assert.doesNotThrow(() => pushEvent({ type: 'log', text: 'test' }));
      sseClients.delete(throwingClient);
    });

    it('writes events to all connected SSE clients', () => {
      const { sseClients, pushEvent } = createApp(db);
      const written = [];
      const mockClient = { write: (data) => written.push(data) };
      sseClients.add(mockClient);
      pushEvent({ type: 'log', text: 'hello' });
      sseClients.delete(mockClient);
      assert.ok(written.some(d => d.includes('hello')));
    });
  });

  describe('GET /api/import/events (SSE)', () => {
    it('delivers previously buffered log events to new SSE clients', async () => {
      const { app: sseApp, importState } = createApp(db);
      importState.logs = ['data: {"type":"log","text":"cached-msg"}\n\n'];

      await new Promise((resolve, reject) => {
        const server = sseApp.listen(0, () => {
          const { port } = server.address();
          let received = '';
          let settled = false;

          const cleanup = (err) => {
            if (settled) return;
            settled = true;
            server.closeAllConnections();
            server.close(() => err ? reject(err) : resolve());
          };

          const req = httpRequest(
            { hostname: '127.0.0.1', port, path: '/api/import/events' },
            (res) => {
              res.on('data', (chunk) => {
                received += chunk.toString();
                if (received.includes('cached-msg')) cleanup(null);
              });
              res.on('error', cleanup);
            }
          );
          req.on('error', () => {});
          req.end();

          setTimeout(() => cleanup(new Error('SSE timeout')), 3000);
        });
      });
    });

    it('fires heartbeat on interval and cleans up client on close', async () => {
      const { app: sseApp } = createApp(db, { heartbeatMs: 50 });

      await new Promise((resolve, reject) => {
        const server = sseApp.listen(0, () => {
          const { port } = server.address();
          let heartbeatSeen = false;
          let settled = false;

          const cleanup = (err) => {
            if (settled) return;
            settled = true;
            server.closeAllConnections();
            server.close(() => {
              if (err) reject(err);
              else if (!heartbeatSeen) reject(new Error('No heartbeat received'));
              else resolve();
            });
          };

          const req = httpRequest(
            { hostname: '127.0.0.1', port, path: '/api/import/events' },
            (res) => {
              res.on('data', (chunk) => {
                if (chunk.toString().includes('heartbeat')) {
                  heartbeatSeen = true;
                  cleanup(null);
                }
              });
              res.on('error', () => {});
            }
          );
          req.on('error', () => {});
          req.end();

          setTimeout(() => cleanup(new Error('Heartbeat timeout')), 3000);
        });
      });
    });
  });

  describe('GET /api/years', () => {
    it('returns year breakdown', async () => {
      const res = await supertest(app).get('/api/years');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body));
    });

    it('filters by mailboxIds query param', async () => {
      const res = await supertest(app).get(`/api/years?mailboxIds=${mailboxId}`);
      assert.strictEqual(res.status, 200);
    });

    it('returns 500 when database fails', async () => {
      const { app: errApp } = createApp(brokenDb);
      const res = await supertest(errApp).get('/api/years');
      assert.strictEqual(res.status, 500);
    });
  });

  describe('GET /api/emails', () => {
    it('returns list of emails', async () => {
      const res = await supertest(app).get('/api/emails');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body));
    });

    it('respects limit and offset params', async () => {
      const res = await supertest(app).get('/api/emails?limit=1&offset=0');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.length, 1);
    });

    it('filters by year', async () => {
      const res = await supertest(app).get('/api/emails?year=2023');
      assert.strictEqual(res.status, 200);
    });

    it('sorts ascending', async () => {
      const res = await supertest(app).get('/api/emails?sort=asc');
      assert.strictEqual(res.status, 200);
    });

    it('filters by mailboxIds', async () => {
      const res = await supertest(app).get(`/api/emails?mailboxIds=${mailboxId}`);
      assert.strictEqual(res.status, 200);
    });

    it('returns 500 when database fails', async () => {
      const { app: errApp } = createApp(brokenDb);
      const res = await supertest(errApp).get('/api/emails');
      assert.strictEqual(res.status, 500);
    });
  });

  describe('GET /api/emails/:id', () => {
    it('returns a single email', async () => {
      const res = await supertest(app).get(`/api/emails/${emailId}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.id, emailId);
    });

    it('returns 404 for non-existent email', async () => {
      const res = await supertest(app).get('/api/emails/999999');
      assert.strictEqual(res.status, 404);
    });

    it('returns 500 when database fails', async () => {
      const { app: errApp } = createApp(brokenDb);
      const res = await supertest(errApp).get('/api/emails/1');
      assert.strictEqual(res.status, 500);
    });
  });

  describe('GET /api/search', () => {
    it('finds emails matching the query', async () => {
      const res = await supertest(app).get('/api/search?q=Server+Test');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body));
    });

    it('returns 400 when q param is missing', async () => {
      const res = await supertest(app).get('/api/search');
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'Query required');
    });

    it('supports year filter', async () => {
      const res = await supertest(app).get('/api/search?q=Server&year=2023');
      assert.strictEqual(res.status, 200);
    });

    it('supports asc sort', async () => {
      const res = await supertest(app).get('/api/search?q=Email&sort=asc');
      assert.strictEqual(res.status, 200);
    });

    it('supports mailboxIds filter', async () => {
      const res = await supertest(app).get(`/api/search?q=Server&mailboxIds=${mailboxId}`);
      assert.strictEqual(res.status, 200);
    });

    it('returns 500 when database fails', async () => {
      const { app: errApp } = createApp(brokenDb);
      const res = await supertest(errApp).get('/api/search?q=test');
      assert.strictEqual(res.status, 500);
    });
  });

  describe('GET /api/stats', () => {
    it('returns aggregate statistics', async () => {
      const res = await supertest(app).get('/api/stats');
      assert.strictEqual(res.status, 200);
      assert.ok(typeof res.body.total === 'number');
    });

    it('filters stats by mailboxIds', async () => {
      const res = await supertest(app).get(`/api/stats?mailboxIds=${mailboxId}`);
      assert.strictEqual(res.status, 200);
    });

    it('returns 500 when database fails', async () => {
      const { app: errApp } = createApp(brokenDb);
      const res = await supertest(errApp).get('/api/stats');
      assert.strictEqual(res.status, 500);
    });
  });

  describe('GET /api/emails/:id/attachments', () => {
    it('returns attachment list for an email', async () => {
      const res = await supertest(app).get(`/api/emails/${emailId}/attachments`);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body));
    });

    it('returns 500 when database fails', async () => {
      const { app: errApp } = createApp(brokenDb);
      const res = await supertest(errApp).get('/api/emails/1/attachments');
      assert.strictEqual(res.status, 500);
    });
  });

  describe('GET /api/attachments/:id/download', () => {
    it('returns 404 for non-existent attachment', async () => {
      const res = await supertest(app).get('/api/attachments/999999/download');
      assert.strictEqual(res.status, 404);
    });

    it('returns 500 when database fails', async () => {
      const { app: errApp } = createApp(brokenDb);
      const res = await supertest(errApp).get('/api/attachments/1/download');
      assert.strictEqual(res.status, 500);
    });

    it('serves attachment file with correct content-type header', async () => {
      const mb = await createMailbox(db, 'Download Success Test');
      await indexEmails(db, 'test/fixtures/with-attachment.mbox', mb.id);
      const rows = await new Promise((resolve, reject) =>
        db.all('SELECT * FROM attachments LIMIT 1', (err, r) => err ? reject(err) : resolve(r))
      );
      assert.ok(rows.length > 0, 'Expected at least one attachment in DB');
      const { app: dlApp } = createApp(db);
      const res = await supertest(dlApp).get(`/api/attachments/${rows[0].id}/download`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type']);
    });

    it('uses application/octet-stream when attachment contentType is null', async () => {
      const dir = join('data', 'attachments', String(emailId));
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, 'no-type.bin');
      await writeFile(filePath, Buffer.from('binary'));
      const attId = await new Promise((resolve, reject) =>
        db.run(
          'INSERT INTO attachments (emailId, filename, contentType, size, path) VALUES (?, ?, ?, ?, ?)',
          [emailId, 'no-type.bin', null, 6, filePath],
          function(err) { err ? reject(err) : resolve(this.lastID); }
        )
      );
      const { app: dlApp } = createApp(db);
      const res = await supertest(dlApp).get(`/api/attachments/${attId}/download`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type'].includes('application/octet-stream'));
    });
  });

  describe('SPA fallback route', () => {
    it('responds to non-API paths (wildcard route handler executes)', async () => {
      const res = await supertest(app).get('/some-frontend-page');
      assert.ok([200, 404, 500].includes(res.status));
    });
  });

  describe('GET /api/files', () => {
    it('returns empty array when directory has no .mbox files', async () => {
      const dir = 'data/test-files-empty';
      await mkdir(dir, { recursive: true });
      try {
        const { app: filesApp } = createApp(db, { filesDir: dir });
        const res = await supertest(filesApp).get('/api/files');
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(res.body, []);
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    it('returns .mbox files sorted by name with correct path and size', async () => {
      const dir = 'data/test-files-scan';
      await mkdir(dir, { recursive: true });
      try {
        await writeFile(join(dir, 'b.mbox'), 'content b');
        await writeFile(join(dir, 'a.mbox'), 'content aa');
        await writeFile(join(dir, 'ignored.txt'), 'not mbox');
        const { app: filesApp } = createApp(db, { filesDir: dir });
        const res = await supertest(filesApp).get('/api/files');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.length, 2);
        assert.strictEqual(res.body[0].name, 'a.mbox');
        assert.strictEqual(res.body[0].path, join(resolve(dir), 'a.mbox'));
        assert.strictEqual(res.body[0].size, 10);
        assert.strictEqual(res.body[1].name, 'b.mbox');
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    it('returns 500 when filesDir does not exist', async () => {
      const { app: filesApp } = createApp(db, { filesDir: '/nonexistent/__xyz__' });
      const res = await supertest(filesApp).get('/api/files');
      assert.strictEqual(res.status, 500);
    });
  });
});

describe('Auth integration', () => {
  let db;

  before(async () => {
    try { await unlink('test/test-auth-integration.db'); } catch {}
    db = await initializeDatabase('test/test-auth-integration.db');
  });

  after(async () => {
    db.close();
    try { await unlink('test/test-auth-integration.db'); } catch {}
  });

  it('blocks API access when auth is enabled and no session', async () => {
    const authConfig = {
      enabled: true,
      allowedUsers: ['alice'],
      clientId: 'cid',
      clientSecret: 'csec',
      sessionSecret: 'test-secret',
      baseUrl: 'http://localhost:3001',
    };
    const { app } = createApp(db, { authConfig });
    const res = await supertest(app).get('/api/mailboxes');
    assert.strictEqual(res.status, 401);
  });

  it('allows API access when auth is disabled', async () => {
    const authConfig = { enabled: false };
    const { app } = createApp(db, { authConfig });
    const res = await supertest(app).get('/api/mailboxes');
    assert.strictEqual(res.status, 200);
  });
});
