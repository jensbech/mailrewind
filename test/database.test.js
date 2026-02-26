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
});
