import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 200) || 'attachment';
}

export async function saveAttachments(db, emailId, attachments) {
  if (!attachments || attachments.length === 0) return;

  const dir = join('data', 'attachments', String(emailId));
  await mkdir(dir, { recursive: true });

  for (const att of attachments) {
    if (!att.content || att.content.length === 0) continue;

    const filename = sanitizeFilename(att.filename);
    const filePath = join(dir, filename);

    await writeFile(filePath, att.content);

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO attachments (emailId, filename, contentType, size, path) VALUES (?, ?, ?, ?, ?)`,
        [emailId, filename, att.contentType, att.size, filePath],
        err => err ? reject(err) : resolve()
      );
    });
  }
}

export function getAttachmentsForEmail(db, emailId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, filename, contentType, size, path FROM attachments WHERE emailId = ?`,
      [emailId],
      (err, rows) => err ? reject(err) : resolve(rows || [])
    );
  });
}

export function getAttachment(db, id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, filename, contentType, size, path FROM attachments WHERE id = ?`,
      [id],
      (err, row) => err ? reject(err) : resolve(row)
    );
  });
}

export function getEmailIdByMessageId(db, messageId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id FROM emails WHERE messageId = ?`,
      [messageId],
      (err, row) => err ? reject(err) : resolve(row?.id ?? null)
    );
  });
}
