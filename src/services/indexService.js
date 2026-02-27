import { streamRawEmails, parseEmailString } from '../parser/mboxParser.js';
import { insertBatch } from '../db/database.js';
import { saveAttachments, getEmailIdByMessageId } from '../db/attachments.js';

const BATCH_SIZE = 20;
const BASE_TIMEOUT_MS = 8000;
const LOG_EVERY = 10;

function decodeMimeWord(str) {
  return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, data) => {
    try {
      const buf = enc.toUpperCase() === 'B'
        ? Buffer.from(data, 'base64')
        : Buffer.from(data.replace(/_/g, ' '), 'binary');
      return buf.toString(charset);
    } catch { return str; }
  });
}

function subjectHint(raw) {
  const m = raw.match(/^Subject:\s*(.+)$/im);
  if (!m) return '(no subject)';
  return decodeMimeWord(m[1]).slice(0, 60).trim();
}

function timeoutForSize(bytes) {
  return Math.max(BASE_TIMEOUT_MS, Math.ceil(bytes / 1024) * 2);
}

function parseWithTimeout(raw, envelopeDate) {
  let timedOut = false;
  const ms = timeoutForSize(raw.length);
  const timer = new Promise(resolve =>
    setTimeout(() => { timedOut = true; resolve(null); }, ms)
  );
  return Promise.race([parseEmailString(raw, envelopeDate), timer]).then(result => {
    if (timedOut) {
      console.warn(`  ⚠ TIMEOUT (${(raw.length / 1024).toFixed(0)}KB, limit ${ms}ms): ${subjectHint(raw)}`);
    }
    return result;
  });
}

async function processBatch(db, batch) {
  const parsed = await Promise.all(
    batch.map(({ raw, envelopeDate }) => parseWithTimeout(raw, envelopeDate))
  );
  const valid = parsed.filter(Boolean);
  if (valid.length === 0) return 0;

  const count = await insertBatch(db, valid);

  const withAttachments = valid.filter(e => e.attachments?.length > 0);
  for (const email of withAttachments) {
    const emailId = await getEmailIdByMessageId(db, email.messageId);
    if (emailId) {
      await saveAttachments(db, emailId, email.attachments);
    }
  }

  return count;
}

export async function indexEmails(db, mboxPath) {
  console.log('Starting email indexing...');
  const startTime = Date.now();

  let seen = 0;
  let indexed = 0;
  let skipped = 0;
  let batchNum = 0;
  let batch = [];
  let batchStart = Date.now();

  for await (const item of streamRawEmails(mboxPath)) {
    seen++;
    batch.push(item);

    if (batch.length >= BATCH_SIZE) {
      batchNum++;
      const before = indexed;
      const result = await processBatch(db, batch);
      indexed += result;
      skipped += BATCH_SIZE - result;
      batch = [];

      if (seen % LOG_EVERY === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const batchMs = Date.now() - batchStart;
        const rate = Math.round((LOG_EVERY / (batchMs / 1000)));
        console.log(`[${elapsed}s] Seen: ${seen} | Indexed: ${indexed} | Skipped: ${skipped} | ~${rate} emails/s`);
        batchStart = Date.now();
      }
    }
  }

  if (batch.length > 0) {
    const result = await processBatch(db, batch);
    indexed += result;
    skipped += batch.length - result;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`✓ Done in ${elapsed}s — indexed: ${indexed}, skipped: ${skipped}, total seen: ${seen}`);
  return indexed;
}

export async function isIndexed(db) {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as count FROM emails', (err, row) => {
      if (err) reject(err);
      else resolve(row.count > 0);
    });
  });
}

export function clearEmails(db) {
  return new Promise((resolve, reject) => {
    db.exec('DELETE FROM emails', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
