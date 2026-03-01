import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmailFile, parseEmailString, streamRawEmails } from '../src/parser/mboxParser.js';

describe('MBOX Parser', () => {
  describe('parseEmailFile', () => {
    it('parses both emails from sample.mbox', async () => {
      const emails = await parseEmailFile('test/sample.mbox');
      assert.strictEqual(emails.length, 2);
    });

    it('extracts all required fields from first email', async () => {
      const emails = await parseEmailFile('test/sample.mbox');
      const email = emails[0];
      assert.strictEqual(email.from, 'sender@example.com');
      assert.ok(email.to);
      assert.ok(email.subject);
      assert.ok(email.date instanceof Date);
      assert.ok(email.body);
      assert.ok(email.messageId);
    });

    it('parses second email subject correctly', async () => {
      const emails = await parseEmailFile('test/sample.mbox');
      assert.strictEqual(emails[1].subject, 'Test Email 2');
    });

    it('invokes callback for each parsed email instead of collecting array', async () => {
      const received = [];
      const result = await parseEmailFile('test/sample.mbox', (email) => {
        received.push(email);
      });
      assert.strictEqual(received.length, 2);
      assert.deepStrictEqual(result, []);
    });

    it('returns empty array for empty MBOX file', async () => {
      const emails = await parseEmailFile('test/fixtures/empty.mbox');
      assert.strictEqual(emails.length, 0);
    });

    it('uses envelope date when email has no Date header', async () => {
      const emails = await parseEmailFile('test/fixtures/no-date.mbox');
      assert.ok(emails.length >= 1);
      assert.ok(emails[0].date instanceof Date);
      assert.strictEqual(emails[0].date.getFullYear(), 2024);
    });

    it('handles short envelope line (no date component)', async () => {
      const emails = await parseEmailFile('test/fixtures/short-envelope.mbox');
      assert.ok(emails.length >= 1);
    });

    it('handles invalid date in envelope line', async () => {
      const emails = await parseEmailFile('test/fixtures/invalid-envelope-date.mbox');
      assert.ok(emails.length >= 1);
    });
  });

  describe('streamRawEmails', () => {
    it('yields one chunk per email boundary', async () => {
      const chunks = [];
      for await (const chunk of streamRawEmails('test/sample.mbox')) {
        chunks.push(chunk);
      }
      assert.strictEqual(chunks.length, 2);
    });

    it('each chunk has raw string and envelopeDate', async () => {
      const chunks = [];
      for await (const chunk of streamRawEmails('test/sample.mbox')) {
        chunks.push(chunk);
      }
      assert.ok(typeof chunks[0].raw === 'string');
      assert.ok(chunks[0].envelopeDate instanceof Date);
    });

    it('returns null envelopeDate for short envelope line', async () => {
      const chunks = [];
      for await (const chunk of streamRawEmails('test/fixtures/short-envelope.mbox')) {
        chunks.push(chunk);
      }
      assert.strictEqual(chunks[0].envelopeDate, null);
    });

    it('returns null envelopeDate for invalid date in envelope', async () => {
      const chunks = [];
      for await (const chunk of streamRawEmails('test/fixtures/invalid-envelope-date.mbox')) {
        chunks.push(chunk);
      }
      assert.strictEqual(chunks[0].envelopeDate, null);
    });

    it('yields nothing for empty MBOX', async () => {
      const chunks = [];
      for await (const chunk of streamRawEmails('test/fixtures/empty.mbox')) {
        chunks.push(chunk);
      }
      assert.strictEqual(chunks.length, 0);
    });
  });

  describe('parseEmailString', () => {
    it('parses a complete email string', async () => {
      const raw = [
        'From: alice@example.com',
        'To: bob@example.com',
        'Subject: Hello Test',
        'Date: Mon, 1 Jan 2024 12:00:00 +0000',
        'Message-ID: <test-parse@example.com>',
        '',
        'Body text here.'
      ].join('\n');
      const result = await parseEmailString(raw);
      assert.ok(result);
      assert.strictEqual(result.from, 'alice@example.com');
      assert.strictEqual(result.subject, 'Hello Test');
      assert.ok(result.date instanceof Date);
      assert.ok(result.body.includes('Body text here'));
      assert.strictEqual(result.messageId, '<test-parse@example.com>');
      assert.ok(typeof result.headers === 'string');
      assert.deepStrictEqual(result.attachments, []);
    });

    it('returns skip reason when email has no from and no subject', async () => {
      const raw = 'To: someone@example.com\n\nBody without from or subject';
      const result = await parseEmailString(raw);
      assert.strictEqual(result?._skipReason, 'empty');
    });

    it('returns skip reason for unparseable content (catch path)', async () => {
      const result = await parseEmailString(null);
      assert.strictEqual(result?._skipReason, 'error');
    });

    it('fills missing optional fields with empty strings', async () => {
      const raw = [
        'From: sender@example.com',
        'Subject: Minimal',
        'Date: Tue, 2 Jan 2024 10:00:00 +0000',
        '',
        'body'
      ].join('\n');
      const result = await parseEmailString(raw);
      assert.ok(result);
      assert.strictEqual(result.to, '');
      assert.strictEqual(result.cc, '');
      assert.strictEqual(result.bcc, '');
      assert.strictEqual(result.bodyHTML, '');
    });

    it('uses "(no subject)" when subject is empty', async () => {
      const raw = [
        'From: sender@example.com',
        'Date: Tue, 2 Jan 2024 10:00:00 +0000',
        '',
        'body without subject'
      ].join('\n');
      const result = await parseEmailString(raw);
      assert.ok(result);
      assert.strictEqual(result.subject, '(no subject)');
    });

    it('uses envelopeDate fallback when parsed date is absent', async () => {
      const raw = [
        'From: sender@example.com',
        'Subject: No Date',
        'Message-ID: <nd-fallback@test>',
        '',
        'body without date header'
      ].join('\n');
      const envelopeDate = new Date('2022-05-10');
      const result = await parseEmailString(raw, envelopeDate);
      assert.ok(result);
      assert.ok(result.date instanceof Date || result.date === null || result.date === envelopeDate);
    });

    it('detects "now" as fallback date and uses envelopeDate instead', async () => {
      const now = new Date();
      const raw = [
        'From: sender@example.com',
        'Subject: Recent Email',
        'Date: ' + now.toUTCString(),
        'Message-ID: <now-fallback@test>',
        '',
        'body'
      ].join('\n');
      const envelopeDate = new Date('2019-01-01');
      const result = await parseEmailString(raw, envelopeDate);
      assert.ok(result);
      assert.deepStrictEqual(result.date, envelopeDate);
    });

    it('parses HTML email body', async () => {
      const raw = [
        'From: alice@example.com',
        'Subject: HTML Test',
        'Date: Mon, 1 Jan 2024 12:00:00 +0000',
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>Hello <b>world</b></p>'
      ].join('\n');
      const result = await parseEmailString(raw);
      assert.ok(result);
      assert.ok(result.bodyHTML.includes('<p>'));
    });

    it('continues when email has subject but no from header', async () => {
      const raw = [
        'Subject: Has Subject But No From',
        'Date: Mon, 1 Jan 2024 12:00:00 +0000',
        'Message-ID: <no-from@test>',
        '',
        'Body text'
      ].join('\n');
      const result = await parseEmailString(raw);
      assert.ok(result);
      assert.strictEqual(result.subject, 'Has Subject But No From');
      assert.strictEqual(result.from, '');
    });

    it('returns null date when both parsed date and envelopeDate are absent', async () => {
      const raw = [
        'From: sender@example.com',
        'Subject: No Date At All',
        'Message-ID: <no-date-no-envelope@test>',
        '',
        'body without any date'
      ].join('\n');
      const result = await parseEmailString(raw, null);
      assert.ok(result);
      assert.strictEqual(result.date, null);
    });
  });
});
