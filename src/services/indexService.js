import { parseEmailFile } from '../parser/mboxParser.js';
import { insertEmail } from '../db/database.js';

export async function indexEmails(db, mboxPath) {
  console.log('Starting email indexing...');
  const startTime = Date.now();

  try {
    let indexed = 0;

    const callback = async (email) => {
      try {
        await insertEmail(db, email);
        indexed++;

        if (indexed % 1000 === 0) {
          console.log(`Indexed ${indexed}...`);
        }
      } catch (err) {
      }
    };

    await parseEmailFile(mboxPath, callback);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Indexed ${indexed} emails in ${elapsed}s`);

    return indexed;
  } catch (err) {
    console.error('Indexing failed:', err);
    throw err;
  }
}

export async function isIndexed(db) {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as count FROM emails', (err, row) => {
      if (err) reject(err);
      else resolve(row.count > 0);
    });
  });
}
