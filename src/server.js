import { initializeDatabase, createMailbox } from './db/database.js';
import { createApp } from './app.js';

const PORT = process.env.PORT || 3001;

async function startup() {
  const db = await initializeDatabase();
  const { app, runImport } = createApp(db);

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
