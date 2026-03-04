import { initializeDatabase, createMailbox } from './db/database.js';
import { createApp } from './app.js';
import { createAuthConfig } from './auth/auth.js';

const PORT = process.env.PORT || 3001;

async function startup() {
  const db = await initializeDatabase();
  const authConfig = createAuthConfig();
  const { app, runImport } = createApp(db, { authConfig });

  const host = authConfig.enabled ? '0.0.0.0' : '127.0.0.1';

  if (authConfig.enabled) {
    console.log(`Auth enabled. Allowed users: ${authConfig.allowedUsers.join(', ')}`);
  } else {
    console.warn('WARNING: Authentication is disabled (ENABLE_AUTH != true). Binding to localhost only.');
  }

  if (process.env.MBOX_PATH && process.env.MAILBOX_NAME) {
    const mailbox = await createMailbox(db, process.env.MAILBOX_NAME);
    console.log(`Headless import: ${process.env.MBOX_PATH} → "${mailbox.name}"`);
    runImport(process.env.MBOX_PATH, mailbox.id);
  }

  app.listen(PORT, host, () => console.log(`Server running on http://${host}:${PORT}`));
}

startup().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
