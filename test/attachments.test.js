import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { initializeDatabase } from '../src/db/database.js';
import { saveAttachments, getAttachmentsForEmail } from '../src/db/attachments.js';
import { unlink, rm } from 'fs/promises';

describe('Attachments', () => {
  it('should save attachments and retrieve metadata', async () => {
    const db = await initializeDatabase('data/test-att.db');

    await new Promise(resolve =>
      db.run(`INSERT OR IGNORE INTO emails (messageId, subject) VALUES ('test-att@x', 'Test')`, resolve)
    );

    const emailId = await new Promise(r =>
      db.get(`SELECT id FROM emails WHERE messageId='test-att@x'`, (_, row) => r(row.id))
    );

    const atts = [{
      filename: 'hello.txt',
      contentType: 'text/plain',
      size: 5,
      content: Buffer.from('hello')
    }];

    await saveAttachments(db, emailId, atts);

    const rows = await getAttachmentsForEmail(db, emailId);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].filename, 'hello.txt');
    assert.strictEqual(rows[0].contentType, 'text/plain');
  });

  after(async () => {
    try { await unlink('data/test-att.db'); } catch {}
    try { await rm('data/attachments', { recursive: true }); } catch {}
  });
});
