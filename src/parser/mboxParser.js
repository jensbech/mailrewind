import { simpleParser } from 'mailparser';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const BOUNDARY_RE = /^From \S+/;

function parseEnvelopeDate(fromLine) {
  const parts = fromLine.trim().split(/\s+/);
  if (parts.length < 3) return null;
  try {
    const d = new Date(parts.slice(2).join(' '));
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export async function parseEmailString(raw, envelopeDate = null) {
  const parseStart = Date.now();
  try {
    const parsed = await simpleParser(raw);
    if (!parsed.from?.text && !parsed.subject) return { _skipReason: 'empty' };
    const parsedMs = parsed.date?.getTime();
    const isNowFallback = parsedMs && Math.abs(parsedMs - parseStart) < 60000;
    const date = (isNowFallback ? null : parsed.date) || envelopeDate || null;
    return {
      messageId: parsed.messageId || '',
      from: parsed.from?.text || '',
      to: parsed.to?.text || '',
      cc: parsed.cc?.text || '',
      bcc: parsed.bcc?.text || '',
      subject: parsed.subject || '(no subject)',
      date,
      body: parsed.text || '',
      bodyHTML: parsed.html || '',
      headers: JSON.stringify(Array.from(parsed.headers.entries())),
      attachments: (parsed.attachments || []).map(a => ({
        filename: a.filename || 'attachment',
        contentType: a.contentType || 'application/octet-stream',
        size: a.size || (a.content ? a.content.length : 0),
        content: a.content
      }))
    };
  } catch {
    return { _skipReason: 'error' };
  }
}

export async function* streamRawEmails(filePath) {
  const rl = createInterface({
    input: createReadStream(filePath, { highWaterMark: 64 * 1024 }),
    crlfDelay: Infinity
  });

  let current = '';
  let envelopeLine = '';

  for await (const line of rl) {
    if (BOUNDARY_RE.test(line)) {
      if (current.trim()) yield { raw: current, envelopeDate: parseEnvelopeDate(envelopeLine) };
      current = line + '\n';
      envelopeLine = line;
    } else {
      current += line + '\n';
    }
  }

  if (current.trim()) yield { raw: current, envelopeDate: parseEnvelopeDate(envelopeLine) };
}

export async function parseEmailFile(filePath, callback = null) {
  const emails = [];
  for await (const { raw, envelopeDate } of streamRawEmails(filePath)) {
    const email = await parseEmailString(raw, envelopeDate);
    if (email && !email._skipReason) {
      callback ? await callback(email) : emails.push(email);
    }
  }
  return emails;
}
