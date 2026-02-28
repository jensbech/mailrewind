import sqlite3 from 'sqlite3';
import { schema } from './schema.js';
import { mkdir } from 'fs/promises';

export async function initializeDatabase(dbPath = 'data/emails.db') {
  await mkdir('data', { recursive: true });

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, async (err) => {
      if (err) return reject(err);

      try {
        const needsMigration = await new Promise((res, rej) => {
          db.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='mailboxes'",
            (e, row) => e ? rej(e) : res(!row)
          );
        });

        if (needsMigration) {
          await new Promise((res, rej) => {
            db.exec(`
              DROP TABLE IF EXISTS emails_fts;
              DROP TRIGGER IF EXISTS emails_ai;
              DROP TRIGGER IF EXISTS emails_ad;
              DROP TABLE IF EXISTS attachments;
              DROP TABLE IF EXISTS emails;
            `, e => e ? rej(e) : res());
          });
          console.log('DB migrated to multi-mailbox schema (existing data cleared — please re-import)');
        }

        db.exec(schema, (e) => {
          if (e) return reject(e);
          db.run('PRAGMA foreign_keys = ON', (e2) => e2 ? reject(e2) : resolve(db));
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

export function createMailbox(db, name) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO mailboxes (name) VALUES (?)',
      [name],
      function(err) { err ? reject(err) : resolve({ id: this.lastID, name }); }
    );
  });
}

export function getMailboxes(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT m.id, m.name, m.created_at,
              COUNT(e.id) as count,
              MIN(e.date) as oldest,
              MAX(e.date) as newest
       FROM mailboxes m
       LEFT JOIN emails e ON e.mailbox_id = m.id
       GROUP BY m.id
       ORDER BY m.created_at ASC`,
      (err, rows) => err ? reject(err) : resolve(rows || [])
    );
  });
}

export function deleteMailbox(db, id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM mailboxes WHERE id = ?', [id], err => err ? reject(err) : resolve());
  });
}

export function insertBatch(db, emails, mailboxId) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT OR IGNORE INTO emails
      (\`messageId\`, mailbox_id, \`from\`, \`to\`, cc, bcc, subject, date, bodyText, bodyHTML, headers)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.serialize(() => {
      db.run('BEGIN');
      let inserted = 0;
      for (const email of emails) {
        db.run(sql, [
          email.messageId, mailboxId, email.from, email.to, email.cc, email.bcc,
          email.subject, email.date, email.body, email.bodyHTML, email.headers
        ], function(err) { if (!err && this.changes > 0) inserted++; });
      }
      db.run('COMMIT', (err) => err ? reject(err) : resolve(inserted));
    });
  });
}

export function getEmail(db, id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM emails WHERE id = ?', [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function getEmails(db, limit = 50, offset = 0, year = null, sort = 'desc', mailboxIds = null) {
  return new Promise((resolve, reject) => {
    const order = sort === 'asc' ? 'ASC' : 'DESC';
    const params = [];
    const conditions = [];

    if (mailboxIds && mailboxIds.length > 0) {
      conditions.push(`mailbox_id IN (${mailboxIds.map(() => '?').join(',')})`);
      params.push(...mailboxIds);
    }
    if (year) {
      const start = new Date(`${year}-01-01`).getTime();
      const end = new Date(`${Number(year) + 1}-01-01`).getTime();
      conditions.push('date >= ? AND date < ?');
      params.push(start, end);
    }

    let sql = 'SELECT * FROM emails';
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ` ORDER BY date ${order} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

export function searchEmails(db, query, limit = 50, offset = 0, year = null, sort = 'desc', mailboxIds = null) {
  return new Promise((resolve, reject) => {
    const order = sort === 'asc' ? 'ASC' : 'DESC';
    const searchPattern = `%${query}%`;
    const params = [searchPattern, searchPattern, searchPattern, searchPattern];
    const conditions = [
      `(subject LIKE ? OR bodyText LIKE ? OR \`from\` LIKE ? OR \`to\` LIKE ?)`
    ];

    if (mailboxIds && mailboxIds.length > 0) {
      conditions.push(`mailbox_id IN (${mailboxIds.map(() => '?').join(',')})`);
      params.push(...mailboxIds);
    }
    if (year) {
      const start = new Date(`${year}-01-01`).getTime();
      const end = new Date(`${Number(year) + 1}-01-01`).getTime();
      conditions.push('date >= ? AND date < ?');
      params.push(start, end);
    }

    let sql = 'SELECT * FROM emails WHERE ' + conditions.join(' AND ');
    sql += ` ORDER BY date ${order} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

export function getYearCounts(db, mailboxIds = null) {
  return new Promise((resolve, reject) => {
    const params = [];
    let where = 'WHERE date IS NOT NULL';
    if (mailboxIds && mailboxIds.length > 0) {
      where += ` AND mailbox_id IN (${mailboxIds.map(() => '?').join(',')})`;
      params.push(...mailboxIds);
    }
    db.all(
      `SELECT strftime('%Y', date/1000, 'unixepoch') as year, COUNT(*) as count
       FROM emails ${where}
       GROUP BY year ORDER BY year DESC`,
      params,
      (err, rows) => err ? reject(err) : resolve(rows || [])
    );
  });
}

export function getStats(db, mailboxIds = null) {
  return new Promise((resolve, reject) => {
    const params = [];
    let where = '';
    if (mailboxIds && mailboxIds.length > 0) {
      where = `WHERE mailbox_id IN (${mailboxIds.map(() => '?').join(',')})`;
      params.push(...mailboxIds);
    }
    db.get(
      `SELECT COUNT(*) as total, MIN(date) as oldest, MAX(date) as newest FROM emails ${where}`,
      params,
      (err, row) => err ? reject(err) : resolve(row)
    );
  });
}
