import { streamRawEmails, parseEmailString } from '../parser/mboxParser.js';
import { insertBatch } from '../db/database.js';
import { saveAttachments, getEmailIdByMessageId } from '../db/attachments.js';

const BATCH_SIZE = 20;
export const BASE_TIMEOUT_MS = 8000;
const LOG_EVERY = 10;

export function decodeMimeWord(str) {
  return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, data) => {
    try {
      const buf = enc.toUpperCase() === 'B'
        ? Buffer.from(data, 'base64')
        : Buffer.from(data.replace(/_/g, ' '), 'binary');
      return buf.toString(charset);
    } catch { return str; }
  });
}

export function subjectHint(raw) {
  const m = raw.match(/^Subject:\s*(.+)$/im);
  if (!m) return '(no subject)';
  return decodeMimeWord(m[1]).slice(0, 60).trim();
}

export function timeoutForSize(bytes) {
  return Math.max(BASE_TIMEOUT_MS, Math.ceil(bytes / 1024) * 2);
}

export function parseWithTimeout(raw, envelopeDate, _parseFn = parseEmailString) {
  let timedOut = false;
  const ms = timeoutForSize(raw.length);
  const timer = new Promise(resolve =>
    setTimeout(() => { timedOut = true; resolve({ _skipReason: 'timeout' }); }, ms)
  );
  return Promise.race([_parseFn(raw, envelopeDate), timer]).then(result => {
    if (timedOut) {
      const text = `  ⚠ TIMEOUT (${(raw.length / 1024).toFixed(0)}KB, limit ${ms}ms): ${subjectHint(raw)}`;
      console.warn(text);
    }
    return result;
  });
}

async function processBatch(db, batch, mailboxId) {
  const parsed = await Promise.all(
    batch.map(({ raw, envelopeDate }) => parseWithTimeout(raw, envelopeDate))
  );

  const skipCounts = { timeout: 0, error: 0, empty: 0, duplicate: 0 };
  const valid = [];
  for (const p of parsed) {
    if (p?._skipReason) {
      skipCounts[p._skipReason] = (skipCounts[p._skipReason] || 0) + 1;
    } else if (p) {
      valid.push(p);
    }
  }

  if (valid.length === 0) return { inserted: 0, skipCounts };

  const inserted = await insertBatch(db, valid, mailboxId);
  skipCounts.duplicate += valid.length - inserted;

  const withAttachments = valid.filter(e => e.attachments?.length > 0);
  for (const email of withAttachments) {
    const emailId = await getEmailIdByMessageId(db, email.messageId, mailboxId);
    if (emailId) {
      await saveAttachments(db, emailId, email.attachments);
    }
  }

  return { inserted, skipCounts };
}

export async function indexEmails(db, mboxPath, mailboxId, onEvent = () => {}) {
  const emit = (type, payload) => onEvent({ type, ...payload });
  emit('log', { text: 'Starting email indexing...' });
  const startTime = Date.now();

  let seen = 0;
  let indexed = 0;
  let skipped = 0;
  const skipReasons = { timeout: 0, error: 0, empty: 0, duplicate: 0 };
  let batch = [];
  let batchStart = Date.now();

  function mergeSkipCounts(counts) {
    for (const [k, v] of Object.entries(counts)) {
      skipReasons[k] = (skipReasons[k] || 0) + v;
    }
  }

  for await (const item of streamRawEmails(mboxPath)) {
    seen++;
    batch.push(item);

    if (batch.length >= BATCH_SIZE) {
      const { inserted, skipCounts } = await processBatch(db, batch, mailboxId);
      indexed += inserted;
      skipped += BATCH_SIZE - inserted;
      mergeSkipCounts(skipCounts);
      batch = [];

      if (seen % LOG_EVERY === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const batchMs = Date.now() - batchStart;
        const rate = Math.round(LOG_EVERY / (batchMs / 1000));
        const text = `[${elapsed}s] Seen: ${seen} | Indexed: ${indexed} | Skipped: ${skipped} | ~${rate} emails/s`;
        console.log(text);
        emit('log', { text });
        emit('progress', { seen, indexed, skipped, elapsed: Number(elapsed), rate });
        batchStart = Date.now();
      }
    }
  }

  if (batch.length > 0) {
    const { inserted, skipCounts } = await processBatch(db, batch, mailboxId);
    indexed += inserted;
    skipped += batch.length - inserted;
    mergeSkipCounts(skipCounts);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const doneText = `✓ Done in ${elapsed}s — indexed: ${indexed}, skipped: ${skipped}, total seen: ${seen}`;
  console.log(doneText);
  emit('log', { text: doneText });
  emit('done', { indexed, seen, skipped, skipReasons });
  return indexed;
}

export function clearMailbox(db, mailboxId) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM emails WHERE mailbox_id = ?', [mailboxId], err => err ? reject(err) : resolve());
  });
}
