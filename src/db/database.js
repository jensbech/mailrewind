import sqlite3 from 'sqlite3';
import { schema } from './schema.js';
import { mkdir } from 'fs/promises';

export async function initializeDatabase(dbPath = 'data/emails.db') {
  await mkdir('data', { recursive: true });

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);

      db.exec(schema, (err) => {
        if (err) return reject(err);
        resolve(db);
      });
    });
  });
}

export function insertEmail(db, email) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT OR IGNORE INTO emails
      (messageId, \`from\`, \`to\`, cc, bcc, subject, date, bodyText, bodyHTML, headers)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
      email.messageId,
      email.from,
      email.to,
      email.cc,
      email.bcc,
      email.subject,
      email.date,
      email.body,
      email.bodyHTML,
      email.headers
    ], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
}

export function insertBatch(db, emails) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT OR IGNORE INTO emails
      (\`messageId\`, \`from\`, \`to\`, cc, bcc, subject, date, bodyText, bodyHTML, headers)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.serialize(() => {
      db.run('BEGIN');
      let inserted = 0;
      for (const email of emails) {
        db.run(sql, [
          email.messageId, email.from, email.to, email.cc, email.bcc,
          email.subject, email.date, email.body, email.bodyHTML, email.headers
        ], function(err) { if (!err && this.changes > 0) inserted++; });
      }
      db.run('COMMIT', (err) => {
        if (err) reject(err);
        else resolve(inserted);
      });
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

export function searchEmails(db, query, limit = 50, offset = 0, year = null, sort = 'desc') {
  return new Promise((resolve, reject) => {
    const order = sort === 'asc' ? 'ASC' : 'DESC';
    const searchPattern = `%${query}%`;
    const params = [searchPattern, searchPattern, searchPattern, searchPattern];
    let sql = `SELECT * FROM emails WHERE (subject LIKE ? OR bodyText LIKE ? OR \`from\` LIKE ? OR \`to\` LIKE ?)`;

    if (year) {
      const start = new Date(`${year}-01-01`).getTime();
      const end = new Date(`${Number(year) + 1}-01-01`).getTime();
      sql += ' AND date >= ? AND date < ?';
      params.push(start, end);
    }

    sql += ` ORDER BY date ${order} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

export function getEmails(db, limit = 50, offset = 0, year = null, sort = 'desc') {
  return new Promise((resolve, reject) => {
    const order = sort === 'asc' ? 'ASC' : 'DESC';
    const params = [];
    let sql = 'SELECT * FROM emails';

    if (year) {
      const start = new Date(`${year}-01-01`).getTime();
      const end = new Date(`${Number(year) + 1}-01-01`).getTime();
      sql += ' WHERE date >= ? AND date < ?';
      params.push(start, end);
    }

    sql += ` ORDER BY date ${order} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

export function getYearCounts(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT strftime('%Y', date/1000, 'unixepoch') as year, COUNT(*) as count
       FROM emails WHERE date IS NOT NULL
       GROUP BY year ORDER BY year DESC`,
      (err, rows) => err ? reject(err) : resolve(rows || [])
    );
  });
}

export function getStats(db) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) as total, MIN(date) as oldest, MAX(date) as newest FROM emails`,
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}
