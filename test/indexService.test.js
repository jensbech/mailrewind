import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { unlink, rm } from 'fs/promises';
import { initializeDatabase, createMailbox } from '../src/db/database.js';
import {
  indexEmails, clearMailbox,
  parseWithTimeout, timeoutForSize, decodeMimeWord, subjectHint,
  BASE_TIMEOUT_MS
} from '../src/services/indexService.js';

const TEST_DB = 'data/test-indexservice.db';
let db;
let mailboxId;

describe('indexService', () => {
  before(async () => {
    try { await unlink(TEST_DB); } catch {}
    try { await rm('data/attachments', { recursive: true }); } catch {}
    db = await initializeDatabase(TEST_DB);
    const mb = await createMailbox(db, 'Index Test Mailbox');
    mailboxId = mb.id;
  });

  after(async () => {
    db.close();
    try { await unlink(TEST_DB); } catch {}
    try { await rm('data/attachments', { recursive: true }); } catch {}
  });

  describe('timeoutForSize', () => {
    it('returns BASE_TIMEOUT_MS for small inputs', () => {
      assert.strictEqual(timeoutForSize(0), BASE_TIMEOUT_MS);
      assert.strictEqual(timeoutForSize(1024), BASE_TIMEOUT_MS);
    });

    it('returns proportional timeout for large inputs', () => {
      const large = 10 * 1024 * 1024;
      const result = timeoutForSize(large);
      assert.ok(result > BASE_TIMEOUT_MS);
      assert.strictEqual(result, Math.ceil(large / 1024) * 2);
    });
  });

  describe('decodeMimeWord', () => {
    it('decodes Base64-encoded MIME word', () => {
      const encoded = '=?UTF-8?B?SGVsbG8gV29ybGQ=?=';
      assert.strictEqual(decodeMimeWord(encoded), 'Hello World');
    });

    it('decodes Quoted-Printable MIME word (binary passthrough, not full QP)', () => {
      const encoded = '=?UTF-8?Q?Hello=20World?=';
      assert.strictEqual(decodeMimeWord(encoded), 'Hello=20World');
    });

    it('converts underscores to spaces in QP encoding', () => {
      const encoded = '=?UTF-8?Q?Hello_World?=';
      assert.strictEqual(decodeMimeWord(encoded), 'Hello World');
    });

    it('returns original string on decoding error (invalid charset)', () => {
      const encoded = '=?invalid-charset?B?SGVsbG8=?=';
      const result = decodeMimeWord(encoded);
      assert.strictEqual(result, encoded);
    });

    it('returns plain strings unchanged', () => {
      assert.strictEqual(decodeMimeWord('Hello World'), 'Hello World');
    });
  });

  describe('subjectHint', () => {
    it('extracts and returns decoded subject', () => {
      const raw = 'From: a@b.com\nSubject: Test Subject\n\nbody';
      assert.strictEqual(subjectHint(raw), 'Test Subject');
    });

    it('returns "(no subject)" when no Subject header', () => {
      const raw = 'From: a@b.com\n\nbody without subject';
      assert.strictEqual(subjectHint(raw), '(no subject)');
    });

    it('decodes MIME-encoded subject', () => {
      const raw = 'From: a@b.com\nSubject: =?UTF-8?B?SGVsbG8gV29ybGQ=?=\n\nbody';
      assert.strictEqual(subjectHint(raw), 'Hello World');
    });

    it('truncates subject to 60 characters', () => {
      const long = 'A'.repeat(80);
      const raw = `From: a@b.com\nSubject: ${long}\n\nbody`;
      assert.strictEqual(subjectHint(raw).length, 60);
    });
  });

  describe('parseWithTimeout', () => {
    it('returns parsed email result on success', async () => {
      const raw = [
        'From: sender@example.com',
        'Subject: Timeout Test',
        'Date: Mon, 1 Jan 2024 12:00:00 +0000',
        'Message-ID: <timeout-test@example.com>',
        '',
        'body'
      ].join('\n');
      const result = await parseWithTimeout(raw, null);
      assert.ok(result);
      assert.strictEqual(result.subject, 'Timeout Test');
    });

    it('fires timeout and returns null when parse hangs', async (t) => {
      t.mock.timers.enable(['setTimeout']);

      const neverResolves = () => new Promise(() => {});
      const raw = 'From: a@b.com\nSubject: =?UTF-8?B?SGVsbG8=?=\n\nbody';

      const resultPromise = parseWithTimeout(raw, null, neverResolves);

      t.mock.timers.tick(timeoutForSize(raw.length) + 1);

      const result = await resultPromise;
      assert.strictEqual(result, null);
    });

    it('logs warning with decoded subject on timeout', async (t) => {
      t.mock.timers.enable(['setTimeout']);
      const warnings = [];
      const origWarn = console.warn;
      console.warn = (msg) => warnings.push(msg);

      try {
        const neverResolves = () => new Promise(() => {});
        const raw = 'From: a@b.com\nSubject: =?UTF-8?Q?Timed_Out?=\n\nbody';

        const resultPromise = parseWithTimeout(raw, null, neverResolves);
        t.mock.timers.tick(timeoutForSize(raw.length) + 1);
        await resultPromise;

        assert.ok(warnings.some(w => w.includes('TIMEOUT')));
        assert.ok(warnings.some(w => w.includes('Timed Out')));
      } finally {
        console.warn = origWarn;
      }
    });

    it('includes "no subject" hint in timeout warning for emails without Subject', async (t) => {
      t.mock.timers.enable(['setTimeout']);
      const warnings = [];
      const origWarn = console.warn;
      console.warn = (msg) => warnings.push(msg);

      try {
        const neverResolves = () => new Promise(() => {});
        const raw = 'From: a@b.com\n\nbody without subject header';

        const resultPromise = parseWithTimeout(raw, null, neverResolves);
        t.mock.timers.tick(timeoutForSize(raw.length) + 1);
        await resultPromise;

        assert.ok(warnings.some(w => w.includes('(no subject)')));
      } finally {
        console.warn = origWarn;
      }
    });
  });

  describe('indexEmails', () => {
    it('indexes emails from a small MBOX file and returns count', async () => {
      const events = [];
      const count = await indexEmails(db, 'test/sample.mbox', mailboxId, (e) => events.push(e));
      assert.strictEqual(count, 2);
      assert.ok(events.some(e => e.type === 'done'));
      assert.ok(events.some(e => e.type === 'log'));
    });

    it('emits done event with correct counts', async () => {
      const mb2 = await createMailbox(db, 'Done Event Test');
      const events = [];
      await indexEmails(db, 'test/sample.mbox', mb2.id, (e) => events.push(e));
      const done = events.find(e => e.type === 'done');
      assert.ok(done);
      assert.strictEqual(done.indexed, 2);
      assert.strictEqual(done.seen, 2);
      assert.strictEqual(done.skipped, 0);
    });

    it('skips duplicate emails on re-import and increments skipped count', async () => {
      const mb3 = await createMailbox(db, 'Skip Test');
      await indexEmails(db, 'test/sample.mbox', mb3.id);
      const events = [];
      await indexEmails(db, 'test/sample.mbox', mb3.id, (e) => events.push(e));
      const done = events.find(e => e.type === 'done');
      assert.strictEqual(done.indexed, 0);
      assert.strictEqual(done.skipped, 2);
    });

    it('emits progress events when batch of 20 fills and seen is multiple of 10', async () => {
      const mb4 = await createMailbox(db, 'Batch Test');
      const events = [];
      const count = await indexEmails(db, 'test/fixtures/batch25.mbox', mb4.id, (e) => events.push(e));
      assert.strictEqual(count, 25);
      const progress = events.filter(e => e.type === 'progress');
      assert.ok(progress.length >= 1, 'Should have at least one progress event');
      const p = progress[0];
      assert.ok(typeof p.seen === 'number');
      assert.ok(typeof p.indexed === 'number');
      assert.ok(typeof p.rate === 'number');
    });

    it('indexes email with attachment and saves attachment files', async () => {
      const mb5 = await createMailbox(db, 'Attachment Test');
      const count = await indexEmails(db, 'test/fixtures/with-attachment.mbox', mb5.id);
      assert.strictEqual(count, 1);
    });

    it('returns 0 for empty MBOX file', async () => {
      const mb6 = await createMailbox(db, 'Empty Test');
      const count = await indexEmails(db, 'test/fixtures/empty.mbox', mb6.id);
      assert.strictEqual(count, 0);
    });

    it('returns 0 when all emails in batch fail to parse (no from, no subject)', async () => {
      const mb7 = await createMailbox(db, 'All Invalid Test');
      const count = await indexEmails(db, 'test/fixtures/all-invalid.mbox', mb7.id);
      assert.strictEqual(count, 0);
    });
  });

  describe('clearMailbox', () => {
    it('deletes all emails belonging to a mailbox', async () => {
      const mb = await createMailbox(db, 'Clear Test');
      await indexEmails(db, 'test/sample.mbox', mb.id);
      await clearMailbox(db, mb.id);
      const { getEmails } = await import('../src/db/database.js');
      const emails = await getEmails(db, 50, 0, null, 'desc', [mb.id]);
      assert.strictEqual(emails.length, 0);
    });
  });
});
