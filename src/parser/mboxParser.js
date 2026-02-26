import { simpleParser } from 'mailparser';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

export async function parseEmailFile(filePath, callback = null) {
  const emails = [];
  let currentEmail = '';
  let isPaused = false;
  let pendingEmail = null;

  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  async function processEmail(emailStr) {
    try {
      const parsed = await simpleParser(emailStr);
      if (parsed.from?.text || parsed.subject) {
        const email = {
          messageId: parsed.messageId || '',
          from: parsed.from?.text || '',
          to: parsed.to?.text || '',
          cc: parsed.cc?.text || '',
          bcc: parsed.bcc?.text || '',
          subject: parsed.subject || '(no subject)',
          date: parsed.date || new Date(),
          body: parsed.text || '',
          bodyHTML: parsed.html || '',
          headers: JSON.stringify(Array.from(parsed.headers.entries()))
        };
        if (callback) {
          await callback(email);
        } else {
          emails.push(email);
        }
      }
    } catch (err) {
    }
  }

  return new Promise((resolve, reject) => {
    rl.on('line', (line) => {
      if (line.match(/^From\s+\S+\s+\w{3}\s+\w{3}/)) {
        if (currentEmail.trim() && !isPaused) {
          isPaused = true;
          rl.pause();
          processEmail(currentEmail).then(() => {
            isPaused = false;
            rl.resume();
          });
        }
        currentEmail = line + '\n';
      } else {
        currentEmail += line + '\n';
      }
    });

    rl.on('close', async () => {
      if (currentEmail.trim()) {
        await processEmail(currentEmail);
      }
      resolve(emails);
    });

    rl.on('error', reject);
  });
}
