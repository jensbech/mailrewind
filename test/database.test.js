import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { unlink } from 'fs/promises';
import {
  initializeDatabase, createMailbox, getMailboxes, deleteMailbox,
  insertBatch, getEmail, getEmails, searchEmails, getYearCounts, getStats
} from '../src/db/database.js';

const TEST_DB = 'data/test-database.db';
let db;
let mailboxId;

describe('Database', () => {
  before(async () => {
    try { await unlink(TEST_DB); } catch {}
    db = await initializeDatabase(TEST_DB);
    const mb = await createMailbox(db, 'Test Mailbox');
    mailboxId = mb.id;
    await insertBatch(db, [{
      messageId: '<hello@test.com>',
      from: 'alice@test.com',
      to: 'bob@test.com',
      cc: 'carol@test.com',
      bcc: '',
      subject: 'Hello World',
      date: new Date('2023-06-15T12:00:00Z').getTime(),
      body: 'Hello body text',
      bodyHTML: '<p>Hello</p>',
      headers: '[]'
    }], mailboxId);
  });

  after(async () => {
    db.close();
    try { await unlink(TEST_DB); } catch {}
  });

  describe('initializeDatabase', () => {
    it('returns a database instance', () => {
      assert.ok(db);
    });

    it('is idempotent on repeated calls (no-migration path)', async () => {
      const db2 = await initializeDatabase(TEST_DB);
      assert.ok(db2);
      db2.close();
    });

    it('runs migration on a fresh database (migration path)', async () => {
      const freshDb = 'data/test-fresh.db';
      try { await unlink(freshDb); } catch {}
      const freshConn = await initializeDatabase(freshDb);
      assert.ok(freshConn);
      freshConn.close();
      try { await unlink(freshDb); } catch {}
    });
  });

  describe('createMailbox', () => {
    it('creates a mailbox and returns id + name', async () => {
      const mb = await createMailbox(db, 'My Mailbox');
      assert.strictEqual(mb.name, 'My Mailbox');
      assert.ok(mb.id > 0);
    });
  });

  describe('getMailboxes', () => {
    it('returns array of mailboxes with email counts', async () => {
      const mailboxes = await getMailboxes(db);
      assert.ok(Array.isArray(mailboxes));
      assert.ok(mailboxes.length >= 1);
      const mb = mailboxes.find(m => m.id === mailboxId);
      assert.ok(mb);
      assert.strictEqual(mb.name, 'Test Mailbox');
      assert.ok(mb.count >= 1);
    });
  });

  describe('deleteMailbox', () => {
    it('removes a mailbox by id', async () => {
      const mb = await createMailbox(db, 'To Delete');
      await deleteMailbox(db, mb.id);
      const mailboxes = await getMailboxes(db);
      assert.ok(!mailboxes.find(m => m.id === mb.id));
    });
  });

  describe('insertBatch', () => {
    it('inserts new emails and returns inserted count', async () => {
      const count = await insertBatch(db, [{
        messageId: '<new@test.com>',
        from: 'x@test.com',
        to: 'y@test.com',
        cc: '', bcc: '',
        subject: 'New Email',
        date: new Date('2022-03-01').getTime(),
        body: 'new body',
        bodyHTML: '', headers: '[]'
      }], mailboxId);
      assert.strictEqual(count, 1);
    });

    it('skips duplicate (messageId + mailboxId) and returns 0', async () => {
      const count = await insertBatch(db, [{
        messageId: '<hello@test.com>',
        from: 'alice@test.com',
        to: 'bob@test.com',
        cc: '', bcc: '',
        subject: 'Duplicate',
        date: new Date('2023-06-15').getTime(),
        body: 'dup', bodyHTML: '', headers: '[]'
      }], mailboxId);
      assert.strictEqual(count, 0);
    });

    it('handles empty batch', async () => {
      const count = await insertBatch(db, [], mailboxId);
      assert.strictEqual(count, 0);
    });
  });

  describe('getEmail', () => {
    it('returns the email row for a valid id', async () => {
      const emails = await getEmails(db, 1, 0, null, 'desc', [mailboxId]);
      const email = await getEmail(db, emails[0].id);
      assert.ok(email);
      assert.ok(email.subject);
    });

    it('returns undefined for a non-existent id', async () => {
      const email = await getEmail(db, 999999);
      assert.strictEqual(email, undefined);
    });
  });

  describe('getEmails', () => {
    it('returns emails with no filters', async () => {
      const emails = await getEmails(db);
      assert.ok(emails.length >= 1);
    });

    it('treats empty mailboxIds array same as no filter', async () => {
      const emails = await getEmails(db, 50, 0, null, 'desc', []);
      assert.ok(emails.length >= 1);
    });

    it('filters by mailboxIds', async () => {
      const emails = await getEmails(db, 50, 0, null, 'desc', [mailboxId]);
      assert.ok(emails.every(e => e.mailbox_id === mailboxId));
    });

    it('filters by year (matching)', async () => {
      const emails = await getEmails(db, 50, 0, ['2023'], 'desc', [mailboxId]);
      assert.ok(emails.length >= 1);
    });

    it('returns empty array for year with no emails', async () => {
      const emails = await getEmails(db, 50, 0, ['1990'], 'desc', [mailboxId]);
      assert.strictEqual(emails.length, 0);
    });

    it('sorts ascending', async () => {
      await insertBatch(db, [{
        messageId: '<older@test.com>',
        from: 'a@t.com', to: 'b@t.com', cc: '', bcc: '',
        subject: 'Older',
        date: new Date('2020-01-01').getTime(),
        body: '', bodyHTML: '', headers: '[]'
      }], mailboxId);
      const emails = await getEmails(db, 10, 0, null, 'asc', [mailboxId]);
      assert.ok(emails.length >= 2);
      assert.ok(emails[0].date <= emails[1].date);
    });

    it('paginates with limit and offset', async () => {
      const first = await getEmails(db, 1, 0, null, 'desc', [mailboxId]);
      const second = await getEmails(db, 1, 1, null, 'desc', [mailboxId]);
      assert.strictEqual(first.length, 1);
      assert.ok(first[0].id !== second[0]?.id);
    });
  });

  describe('searchEmails', () => {
    it('finds emails matching query in subject', async () => {
      const results = await searchEmails(db, 'Hello', 50, 0, null, 'desc', [mailboxId]);
      assert.ok(results.length >= 1);
      assert.ok(results.some(e => e.subject.includes('Hello')));
    });

    it('finds emails matching query in body', async () => {
      const results = await searchEmails(db, 'body text', 50, 0, null, 'desc', [mailboxId]);
      assert.ok(results.length >= 1);
    });

    it('filters by mailboxIds', async () => {
      const results = await searchEmails(db, 'Hello', 50, 0, null, 'desc', [mailboxId]);
      assert.ok(results.every(e => e.mailbox_id === mailboxId));
    });

    it('filters by year (matching)', async () => {
      const results = await searchEmails(db, 'Hello', 50, 0, ['2023'], 'asc', [mailboxId]);
      assert.ok(results.length >= 1);
    });

    it('returns empty for year with no results', async () => {
      const results = await searchEmails(db, 'Hello', 50, 0, ['1990'], 'desc', [mailboxId]);
      assert.strictEqual(results.length, 0);
    });

    it('searches across all mailboxes when mailboxIds is null', async () => {
      const results = await searchEmails(db, 'Hello', 50, 0, null, 'desc', null);
      assert.ok(results.length >= 1);
    });

    it('treats empty mailboxIds array same as no filter', async () => {
      const results = await searchEmails(db, 'Hello', 50, 0, null, 'desc', []);
      assert.ok(results.length >= 1);
    });
  });

  describe('getYearCounts', () => {
    it('returns year buckets with counts for given mailboxIds', async () => {
      const counts = await getYearCounts(db, [mailboxId]);
      assert.ok(counts.length >= 1);
      assert.ok(counts[0].year);
      assert.ok(counts[0].count >= 1);
    });

    it('returns all years when mailboxIds is null', async () => {
      const counts = await getYearCounts(db, null);
      assert.ok(counts.length >= 1);
    });

    it('treats empty mailboxIds array same as no filter', async () => {
      const counts = await getYearCounts(db, []);
      assert.ok(Array.isArray(counts));
    });
  });

  describe('getStats', () => {
    it('returns total count and date range for given mailboxIds', async () => {
      const stats = await getStats(db, [mailboxId]);
      assert.ok(stats.total >= 1);
    });

    it('returns aggregate stats when mailboxIds is null', async () => {
      const stats = await getStats(db, null);
      assert.ok(stats.total >= 1);
    });

    it('treats empty mailboxIds array same as no filter', async () => {
      const stats = await getStats(db, []);
      assert.ok(typeof stats.total === 'number');
    });
  });

  describe('sessions table', () => {
    it('sessions table exists after initialization', async () => {
      const row = await new Promise((resolve, reject) => {
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'", (err, row) => {
          err ? reject(err) : resolve(row);
        });
      });
      assert.ok(row, 'sessions table should exist');
    });
  });

  describe('error paths with closed DB', () => {
    let closedDb;

    before(async () => {
      const tempDb = 'data/test-closed.db';
      try { await unlink(tempDb); } catch {}
      closedDb = await initializeDatabase(tempDb);
      closedDb.close();
      try { await unlink(tempDb); } catch {}
    });

    it('createMailbox rejects on DB error', async () => {
      await assert.rejects(() => createMailbox(closedDb, 'test'));
    });

    it('getMailboxes rejects on DB error', async () => {
      await assert.rejects(() => getMailboxes(closedDb));
    });

    it('deleteMailbox rejects on DB error', async () => {
      await assert.rejects(() => deleteMailbox(closedDb, 1));
    });

    it('insertBatch rejects on DB error', async () => {
      await assert.rejects(() => insertBatch(closedDb, [{
        messageId: '<x@test>', from: 'a@b.com', to: 'c@d.com',
        cc: '', bcc: '', subject: 'X', date: null,
        body: '', bodyHTML: '', headers: '[]'
      }], 1));
    });

    it('getEmail rejects on DB error', async () => {
      await assert.rejects(() => getEmail(closedDb, 1));
    });

    it('getEmails rejects on DB error', async () => {
      await assert.rejects(() => getEmails(closedDb));
    });

    it('searchEmails rejects on DB error', async () => {
      await assert.rejects(() => searchEmails(closedDb, 'test'));
    });

    it('getYearCounts rejects on DB error', async () => {
      await assert.rejects(() => getYearCounts(closedDb));
    });

    it('getStats rejects on DB error', async () => {
      await assert.rejects(() => getStats(closedDb));
    });
  });

  describe('initializeDatabase connection error', () => {
    it('rejects when DB path is in a non-existent directory', async () => {
      await assert.rejects(() => initializeDatabase('/nonexistent/__test__/db.sqlite'));
    });
  });
});
