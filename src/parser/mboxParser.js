import { simpleParser } from 'mailparser';
import { createReadStream } from 'fs';

export async function parseEmailFile(filePath) {
  const emails = [];
  const stream = createReadStream(filePath);

  const boundaryRegex = /^From\s+\S+\s+\w{3}\s+\w{3}/m;
  let currentEmail = '';

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      currentEmail += chunk.toString();
    });

    stream.on('end', async () => {
      const parts = currentEmail.split(boundaryRegex).filter(p => p.trim());

      for (const part of parts) {
        try {
          const parsed = await simpleParser('From: \n' + part);
          if (parsed.from?.text || parsed.subject) {
            emails.push({
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
            });
          }
        } catch (err) {
        }
      }

      resolve(emails);
    });

    stream.on('error', reject);
  });
}
