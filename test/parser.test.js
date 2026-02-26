import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseEmailFile } from '../src/parser/mboxParser.js';

describe('MBOX Parser', () => {
  it('should parse emails from MBOX file', async () => {
    const emails = await parseEmailFile('test/sample.mbox');
    assert.strictEqual(emails.length, 2);
    assert.strictEqual(emails[0].from, 'sender@example.com');
    assert.strictEqual(emails[1].subject, 'Test Email 2');
  });

  it('should extract email fields', async () => {
    const emails = await parseEmailFile('test/sample.mbox');
    const email = emails[0];
    assert(email.from);
    assert(email.to);
    assert(email.subject);
    assert(email.date);
    assert(email.body);
    assert(email.messageId);
  });
});
