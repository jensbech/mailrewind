export const schema = `
CREATE TABLE IF NOT EXISTS mailboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  messageId TEXT NOT NULL,
  mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  \`from\` TEXT,
  \`to\` TEXT,
  cc TEXT,
  bcc TEXT,
  subject TEXT,
  date DATETIME,
  bodyText TEXT,
  bodyHTML TEXT,
  headers TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(messageId, mailbox_id)
);

CREATE INDEX IF NOT EXISTS idx_email_date ON emails(date);
CREATE INDEX IF NOT EXISTS idx_email_from ON emails(\`from\`);
CREATE INDEX IF NOT EXISTS idx_email_to ON emails(\`to\`);
CREATE INDEX IF NOT EXISTS idx_email_mailbox ON emails(mailbox_id);

CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
  subject,
  bodyText,
  \`from\`,
  \`to\`,
  content=emails,
  content_rowid=id
);

CREATE TRIGGER IF NOT EXISTS emails_ai AFTER INSERT ON emails BEGIN
  INSERT INTO emails_fts(rowid, subject, bodyText, \`from\`, \`to\`)
  VALUES (new.id, new.subject, new.bodyText, new.\`from\`, new.\`to\`);
END;

CREATE TRIGGER IF NOT EXISTS emails_ad AFTER DELETE ON emails BEGIN
  INSERT INTO emails_fts(emails_fts, rowid, subject, bodyText, \`from\`, \`to\`)
  VALUES('delete', old.id, old.subject, old.bodyText, old.\`from\`, old.\`to\`);
END;

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emailId INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  contentType TEXT,
  size INTEGER,
  path TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attachment_email ON attachments(emailId);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expired INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);
`;
