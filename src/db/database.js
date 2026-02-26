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

export function getEmail(db, id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM emails WHERE id = ?', [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function searchEmails(db, query, limit = 50, offset = 0) {
  return new Promise((resolve, reject) => {
    const searchPattern = `%${query}%`;
    const sql = `
      SELECT * FROM emails
      WHERE subject LIKE ? OR bodyText LIKE ? OR \`from\` LIKE ? OR \`to\` LIKE ?
      ORDER BY date DESC
      LIMIT ? OFFSET ?
    `;

    db.all(sql, [searchPattern, searchPattern, searchPattern, searchPattern, limit, offset], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

export function getEmails(db, limit = 50, offset = 0) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM emails ORDER BY date DESC LIMIT ? OFFSET ?';
    db.all(sql, [limit, offset], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
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
