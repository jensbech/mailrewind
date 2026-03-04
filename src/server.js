import { initializeDatabase, createMailbox } from './db/database.js';
import { createApp } from './app.js';
import { createAuthConfig } from './auth/auth.js';

const PORT = process.env.PORT || 3001;

async function startup() {
  const db = await initializeDatabase();
  const authConfig = createAuthConfig();
  const { app, runImport } = createApp(db, { authConfig });

  if (authConfig.enabled) {
    console.log(`Auth enabled. Allowed users: ${authConfig.allowedUsers.join(', ')}`);
  } else {
    console.warn('WARNING: Authentication is disabled (ENABLE_AUTH != true). All data is publicly accessible.');
  }

  if (process.env.MBOX_PATH && process.env.MAILBOX_NAME) {
    const mailbox = await createMailbox(db, process.env.MAILBOX_NAME);
    console.log(`Headless import: ${process.env.MBOX_PATH} → "${mailbox.name}"`);
    runImport(process.env.MBOX_PATH, mailbox.id);
  }

  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

startup().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
