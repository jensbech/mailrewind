import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { unlink, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { initializeDatabase, createMailbox, insertBatch } from '../src/db/database.js';
import {
  saveAttachments, getAttachmentsForEmail, getAttachment, getEmailIdByMessageId
} from '../src/db/attachments.js';

const TEST_DB = 'data/test-attachments.db';
let db;
let emailId;
let mailboxId;

describe('Attachments', () => {
  before(async () => {
    try { await unlink(TEST_DB); } catch {}
    try { await rm('data/attachments', { recursive: true }); } catch {}
    db = await initializeDatabase(TEST_DB);
    const mb = await createMailbox(db, 'Att Test Mailbox');
    mailboxId = mb.id;
    await insertBatch(db, [{
      messageId: '<att-test@test.com>',
      from: 'a@test.com',
      to: 'b@test.com',
      cc: '', bcc: '',
      subject: 'Attachment Test',
      date: Date.now(),
      body: 'body',
      bodyHTML: '', headers: '[]'
    }], mailboxId);
    emailId = await getEmailIdByMessageId(db, '<att-test@test.com>', mailboxId);
  });

  after(async () => {
    db.close();
    try { await unlink(TEST_DB); } catch {}
    try { await rm('data/attachments', { recursive: true }); } catch {}
  });

  describe('getEmailIdByMessageId', () => {
    it('returns the email id for a known messageId + mailboxId', async () => {
      const id = await getEmailIdByMessageId(db, '<att-test@test.com>', mailboxId);
      assert.strictEqual(typeof id, 'number');
    });

    it('returns null for an unknown messageId', async () => {
      const id = await getEmailIdByMessageId(db, '<nobody@nowhere.com>', mailboxId);
      assert.strictEqual(id, null);
    });
  });

  describe('saveAttachments', () => {
    it('saves an attachment to disk and inserts metadata', async () => {
      await saveAttachments(db, emailId, [{
        filename: 'hello.txt',
        contentType: 'text/plain',
        size: 5,
        content: Buffer.from('hello')
      }]);
      const rows = await getAttachmentsForEmail(db, emailId);
      assert.ok(rows.some(r => r.filename === 'hello.txt'));
    });

    it('writes the file content to the expected path', async () => {
      const rows = await getAttachmentsForEmail(db, emailId);
      const row = rows.find(r => r.filename === 'hello.txt');
      assert.ok(row);
      const content = await readFile(row.path);
      assert.strictEqual(content.toString(), 'hello');
    });

    it('sanitizes dangerous characters in filenames', async () => {
      await saveAttachments(db, emailId, [{
        filename: 'bad/name:file?.txt',
        contentType: 'text/plain',
        size: 3,
        content: Buffer.from('bad')
      }]);
      const rows = await getAttachmentsForEmail(db, emailId);
      const saved = rows.find(r => r.filename === 'bad-name-file-.txt');
      assert.ok(saved, 'Sanitized filename should be stored');
    });

    it('uses "attachment" as fallback for empty filename', async () => {
      await saveAttachments(db, emailId, [{
        filename: '',
        contentType: 'application/octet-stream',
        size: 1,
        content: Buffer.from('x')
      }]);
      const rows = await getAttachmentsForEmail(db, emailId);
      assert.ok(rows.some(r => r.filename === 'attachment'));
    });

    it('does nothing when attachments array is null', async () => {
      const before = (await getAttachmentsForEmail(db, emailId)).length;
      await saveAttachments(db, emailId, null);
      const after = (await getAttachmentsForEmail(db, emailId)).length;
      assert.strictEqual(before, after);
    });

    it('does nothing when attachments array is empty', async () => {
      const before = (await getAttachmentsForEmail(db, emailId)).length;
      await saveAttachments(db, emailId, []);
      const after = (await getAttachmentsForEmail(db, emailId)).length;
      assert.strictEqual(before, after);
    });

    it('skips attachments with null content', async () => {
      const before = (await getAttachmentsForEmail(db, emailId)).length;
      await saveAttachments(db, emailId, [{
        filename: 'skip-null.txt',
        contentType: 'text/plain',
        size: 0,
        content: null
      }]);
      const after = (await getAttachmentsForEmail(db, emailId)).length;
      assert.strictEqual(before, after);
    });

    it('skips attachments with zero-length content', async () => {
      const before = (await getAttachmentsForEmail(db, emailId)).length;
      await saveAttachments(db, emailId, [{
        filename: 'skip-empty.txt',
        contentType: 'text/plain',
        size: 0,
        content: Buffer.alloc(0)
      }]);
      const after = (await getAttachmentsForEmail(db, emailId)).length;
      assert.strictEqual(before, after);
    });
  });

  describe('getAttachmentsForEmail', () => {
    it('returns list of attachment metadata', async () => {
      const rows = await getAttachmentsForEmail(db, emailId);
      assert.ok(Array.isArray(rows));
      assert.ok(rows.length >= 1);
      const row = rows[0];
      assert.ok(row.id);
      assert.ok(row.filename);
      assert.ok(row.contentType);
      assert.ok(row.path);
    });

    it('returns empty array for email with no attachments', async () => {
      const rows = await getAttachmentsForEmail(db, 999999);
      assert.deepStrictEqual(rows, []);
    });
  });

  describe('getAttachment', () => {
    it('returns a single attachment by id', async () => {
      const all = await getAttachmentsForEmail(db, emailId);
      const att = await getAttachment(db, all[0].id);
      assert.ok(att);
      assert.strictEqual(att.id, all[0].id);
      assert.ok(att.filename);
    });

    it('returns undefined for a non-existent id', async () => {
      const att = await getAttachment(db, 999999);
      assert.strictEqual(att, undefined);
    });
  });

  describe('error paths with closed DB', () => {
    let closedDb;

    before(async () => {
      const tempDb = 'data/test-closed-att.db';
      try { await unlink(tempDb); } catch {}
      closedDb = await initializeDatabase(tempDb);
      closedDb.close();
      try { await unlink(tempDb); } catch {}
    });

    it('saveAttachments rejects when db.run fails', async () => {
      await assert.rejects(() => saveAttachments(closedDb, 99999, [{
        filename: 'err.txt',
        contentType: 'text/plain',
        size: 4,
        content: Buffer.from('test')
      }]));
    });

    it('getAttachmentsForEmail rejects on DB error', async () => {
      await assert.rejects(() => getAttachmentsForEmail(closedDb, 1));
    });

    it('getAttachment rejects on DB error', async () => {
      await assert.rejects(() => getAttachment(closedDb, 1));
    });

    it('getEmailIdByMessageId rejects on DB error', async () => {
      await assert.rejects(() => getEmailIdByMessageId(closedDb, '<test>', 1));
    });
  });
});
