# Security Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all security vulnerabilities found in the audit: path traversal, stored XSS, CORS, missing security headers, session secret warning, and non-root Docker user.

**Architecture:** All fixes are isolated changes — no architectural changes required. Backend fixes touch `src/app.js`, `src/auth/auth.js`, `src/server.js`, `Dockerfile`. Frontend fix touches `client/src/components/EmailDetail.jsx`. Corresponding tests updated in `test/server.test.js`.

**Tech Stack:** Node/Express (backend), React/Vite (frontend), Docker, Node built-in test runner + supertest.

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`
- Modify: `client/package.json`

**Step 1: Install helmet in the backend**

Run: `npm install helmet`
Expected: `helmet` added to `dependencies` in `package.json`

**Step 2: Install dompurify in the frontend**

Run: `cd client && npm install dompurify`
Expected: `dompurify` added to `dependencies` in `client/package.json`

**Step 3: Verify installs**

Run: `node -e "import('helmet').then(() => console.log('helmet ok'))"` from project root.
Run: `cd client && node -e "require('dompurify')" 2>&1 || echo "browser-only ok"` — dompurify is browser-only so this is expected to not work in Node; just confirm the package exists in `client/node_modules`.

---

### Task 2: Fix path traversal in `/api/import/start` (Critical)

This is the highest-priority fix. The server must validate that any path passed to import is strictly within `filesDir`.

**Files:**
- Modify: `src/app.js`
- Modify: `test/server.test.js`

**Step 1: Write the failing tests**

In `test/server.test.js`, find the `describe('POST /api/import/start', ...)` block and add these two tests after the existing `'returns 400 when mailboxId is missing'` test:

```js
it('returns 400 when path is outside filesDir', async () => {
  const { app: secApp } = createApp(db, { filesDir: resolve('test') });
  const res = await supertest(secApp)
    .post('/api/import/start')
    .send({ path: '/etc/passwd', mailboxId: mailboxId });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /invalid path/i);
});

it('returns 400 when path traverses outside filesDir', async () => {
  const { app: secApp } = createApp(db, { filesDir: resolve('test') });
  const res = await supertest(secApp)
    .post('/api/import/start')
    .send({ path: resolve('test/../package.json'), mailboxId: mailboxId });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /invalid path/i);
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A2 "outside filesDir\|traverses outside"`
Expected: both tests FAIL (currently no path validation exists)

**Step 3: Add path validation to `/api/import/start` in `src/app.js`**

Add `sep` to the existing path import at the top:
```js
import { dirname, join, resolve, sep } from 'path';
```

Replace the body of the `app.post('/api/import/start', ...)` handler (lines 135–145) with:
```js
app.post('/api/import/start', async (req, res) => {
  if (importState.status === 'running') {
    return res.status(409).json({ error: 'Import already running' });
  }
  const { path: mboxPath, mailboxId } = req.body;
  if (!mboxPath) return res.status(400).json({ error: 'path required' });
  if (!mailboxId) return res.status(400).json({ error: 'mailboxId required' });

  const safeDir = resolve(filesDir) + sep;
  const requestedPath = resolve(mboxPath);
  if (!requestedPath.startsWith(safeDir)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  runImport(requestedPath, mailboxId);
  res.status(202).json({ ok: true });
});
```

**Step 4: Update existing tests that send paths outside filesDir**

The existing import tests use default `filesDir: '/data'` but send paths like `'test/sample.mbox'`. Update them to use a custom `filesDir` pointing to the `test/` directory:

Find and replace the test `'starts an import and returns 202, completing with done status'`:
```js
it('starts an import and returns 202, completing with done status', async () => {
  const { app: importApp } = createApp(db, { filesDir: resolve('test') });
  const mb = await createMailbox(db, 'Import Start Test');
  const res = await supertest(importApp)
    .post('/api/import/start')
    .send({ path: resolve('test/sample.mbox'), mailboxId: mb.id });
  assert.strictEqual(res.status, 202);
  assert.strictEqual(res.body.ok, true);
  const status = await waitForImportDone(importApp);
  assert.strictEqual(status.status, 'done');
});
```

Find and replace the test `'tracks progress events during batch import'`:
```js
it('tracks progress events during batch import (covers runImport progress handler)', async () => {
  const { app: progressApp } = createApp(db, { filesDir: resolve('test') });
  const mb = await createMailbox(db, 'Progress Test');
  await supertest(progressApp)
    .post('/api/import/start')
    .send({ path: resolve('test/fixtures/batch25.mbox'), mailboxId: mb.id });
  const status = await waitForImportDone(progressApp);
  assert.strictEqual(status.status, 'done');
  assert.strictEqual(status.seen, 25);
});
```

Find and replace the test `'sets error status when import fails'`:
```js
it('sets error status when import fails (covers runImport catch handler)', async () => {
  const { app: errImportApp } = createApp(brokenDb, { filesDir: resolve('test') });
  await supertest(errImportApp)
    .post('/api/import/start')
    .send({ path: resolve('test/sample.mbox'), mailboxId: 1 });
  const status = await waitForImportDone(errImportApp);
  assert.strictEqual(status.status, 'error');
  assert.ok(status.error);
});
```

**Step 5: Run tests to verify new tests pass**

Run: `npm test 2>&1 | grep -E "path traversal|outside filesDir|traverses outside|▶|✓|✗|FAIL|PASS" | head -40`
Expected: new security tests pass; all import tests pass.

**Step 6: Commit**

```bash
git add src/app.js test/server.test.js
git commit -m "fix: validate import path is within filesDir to prevent path traversal"
```

---

### Task 3: Remove full paths from `/api/files` response

`/api/files` currently returns the full absolute server-side path in `path`. This is the client-side vector that enables Task 2's attack. With Task 2's fix, the path traversal is blocked at the server, but there's no need to expose absolute paths to the client.

**Files:**
- Modify: `src/app.js`
- Modify: `client/src/components/ImportScreen.jsx`
- Modify: `test/server.test.js`

**Step 1: Write failing test**

In `test/server.test.js`, find the test `'returns .mbox files sorted by name with correct path and size'` and add a new test after it:

```js
it('does not return absolute server paths in file listing', async () => {
  const dir = 'data/test-files-nopath';
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, 'test.mbox'), 'content');
    const { app: filesApp } = createApp(db, { filesDir: dir });
    const res = await supertest(filesApp).get('/api/files');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 1);
    assert.strictEqual(res.body[0].path, undefined);
    assert.strictEqual(res.body[0].name, 'test.mbox');
    assert.ok(typeof res.body[0].size === 'number');
  } finally {
    await rm(dir, { recursive: true });
  }
});
```

**Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A2 "does not return absolute"`
Expected: FAIL — `path` is currently present in the response.

**Step 3: Update `/api/files` in `src/app.js` to omit `path`**

Find the `app.get('/api/files', ...)` handler and change the map to omit the `path` field:

Old:
```js
return { name, path: filePath, size };
```

New:
```js
return { name, size };
```

**Step 4: Update the existing test that checks `res.body[0].path`**

In `test/server.test.js`, find the test `'returns .mbox files sorted by name with correct path and size'` and remove the `path` assertion:

Old:
```js
assert.strictEqual(res.body[0].name, 'a.mbox');
assert.strictEqual(res.body[0].path, join(resolve(dir), 'a.mbox'));
assert.strictEqual(res.body[0].size, 10);
```

New:
```js
assert.strictEqual(res.body[0].name, 'a.mbox');
assert.strictEqual(res.body[0].path, undefined);
assert.strictEqual(res.body[0].size, 10);
```

**Step 5: Update `ImportScreen.jsx` to use `f.name` instead of `f.path`**

In `client/src/components/ImportScreen.jsx`:

Change the initial state (line 8):
Old: `const [mboxPath, setMboxPath] = useState('/data/');`
New: `const [mboxPath, setMboxPath] = useState('');`

Change the file button key and click handler (around lines 221–226):
Old:
```jsx
<button
  key={f.path}
  type="button"
  className={`import-file-row${mboxPath === f.path ? ' import-file-row--selected' : ''}`}
  onClick={() => setMboxPath(f.path)}
>
```
New:
```jsx
<button
  key={f.name}
  type="button"
  className={`import-file-row${mboxPath === f.name ? ' import-file-row--selected' : ''}`}
  onClick={() => setMboxPath(f.name)}
>
```

Change the import start handler — the server now needs to resolve the filename to a full path within filesDir. The client sends just the filename:
In `handleImportStart` (line 96), the `path: mboxPath.trim()` already does this correctly — no change needed. The server receives the filename and resolves it.

Wait — the server still needs to receive a path that starts with filesDir. Since the client now sends just `'archive.mbox'`, `resolve('archive.mbox')` = `/Users/jens/proj/pers/mailrewind/archive.mbox` which is NOT within `/data`. Fix this by having the server join filesDir + filename before resolving:

In `src/app.js`, update the path validation in `/api/import/start` to first join with filesDir:
```js
const { path: mboxPath, mailboxId } = req.body;
if (!mboxPath) return res.status(400).json({ error: 'path required' });
if (!mailboxId) return res.status(400).json({ error: 'mailboxId required' });

// If the path is not absolute, treat it as a filename within filesDir
const candidatePath = mboxPath.startsWith('/') ? mboxPath : join(resolve(filesDir), mboxPath);
const safeDir = resolve(filesDir) + sep;
const requestedPath = resolve(candidatePath);
if (!requestedPath.startsWith(safeDir)) {
  return res.status(400).json({ error: 'Invalid path' });
}
```

Also update `handleAddAnother` in `ImportScreen.jsx` (line 115):
Old: `setMboxPath('/data/');`
New: `setMboxPath('');`

**Step 6: Run tests**

Run: `npm test 2>&1 | grep -E "does not return|path and size|✓|✗" | head -20`
Expected: all pass.

**Step 7: Commit**

```bash
git add src/app.js client/src/components/ImportScreen.jsx test/server.test.js
git commit -m "fix: remove absolute server paths from /api/files response"
```

---

### Task 4: Fix Stored XSS with DOMPurify (High)

**Files:**
- Modify: `client/src/components/EmailDetail.jsx`

DOMPurify was installed in Task 1. Now use it before rendering HTML email bodies.

**Step 1: Update `EmailDetail.jsx`**

Add the import at the top of the file (after the existing imports):
```js
import DOMPurify from 'dompurify';
```

Change the `dangerouslySetInnerHTML` usage:

Old:
```jsx
<div className="body-html" dangerouslySetInnerHTML={{ __html: email.bodyHTML }} />
```

New:
```jsx
<div className="body-html" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(email.bodyHTML) }} />
```

**Step 2: Build the client to verify no import errors**

Run: `cd client && npm run build 2>&1 | tail -10`
Expected: build succeeds with no errors.

**Step 3: Commit**

```bash
git add client/src/components/EmailDetail.jsx client/package.json client/package-lock.json
git commit -m "fix: sanitize HTML email bodies with DOMPurify to prevent stored XSS"
```

---

### Task 5: Remove CORS and add security headers (Medium)

Vite's dev proxy forwards `/api` requests to Express as same-origin, so CORS is not needed in dev or production. Helmet adds standard security headers.

**Files:**
- Modify: `src/app.js`
- Modify: `package.json`

**Step 1: Remove CORS from `src/app.js`**

Remove the import:
Old: `import cors from 'cors';`
— delete this line entirely.

Remove the middleware:
Old: `app.use(cors());`
— delete this line entirely.

**Step 2: Add helmet to `src/app.js`**

Add the import after the existing imports:
```js
import helmet from 'helmet';
```

Add the middleware as the first `app.use` (before `express.json()`):
```js
app.use(helmet({ contentSecurityPolicy: false }));
```

Note: CSP is disabled because the Vite build produces inline scripts/styles for module preloading, and configuring a correct CSP for those requires hashing each inline script — beyond scope here. The other helmet defaults (`X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `X-DNS-Prefetch-Control`, etc.) still apply.

**Step 3: Remove `cors` from dependencies in `package.json`**

Run: `npm uninstall cors`
Expected: `cors` removed from `package.json` dependencies.

**Step 4: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: all tests pass. The auth integration test creates an app with auth enabled — helmet should not interfere.

**Step 5: Commit**

```bash
git add src/app.js package.json package-lock.json
git commit -m "fix: remove permissive CORS, add helmet security headers"
```

---

### Task 6: Warn when SESSION_SECRET is missing with auth enabled (Low)

**Files:**
- Modify: `src/auth/auth.js`

**Step 1: Update `createAuthConfig`**

In `src/auth/auth.js`, update the `createAuthConfig` function to log a warning when auth is enabled but `SESSION_SECRET` is not set:

Old:
```js
sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
```

New:
```js
sessionSecret: (() => {
  if (enabled && !env.SESSION_SECRET) {
    console.warn(
      'WARNING: ENABLE_AUTH=true but SESSION_SECRET is not set. ' +
      'Sessions will be invalidated on every restart. ' +
      'Set SESSION_SECRET to a stable random value.'
    );
  }
  return env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
})(),
```

**Step 2: Run tests**

Run: `npm test 2>&1 | tail -10`
Expected: all pass (the auth tests use explicit `sessionSecret: 'test-secret'` so the warning won't fire there).

**Step 3: Commit**

```bash
git add src/auth/auth.js
git commit -m "fix: warn when ENABLE_AUTH=true but SESSION_SECRET is unset"
```

---

### Task 7: Add startup warning when auth is disabled (Medium)

**Files:**
- Modify: `src/server.js`

**Step 1: Update `server.js` startup logging**

In `src/server.js`, update the startup function to warn when auth is disabled:

Old:
```js
if (authConfig.enabled) {
  console.log(`Auth enabled. Allowed users: ${authConfig.allowedUsers.join(', ')}`);
}
```

New:
```js
if (authConfig.enabled) {
  console.log(`Auth enabled. Allowed users: ${authConfig.allowedUsers.join(', ')}`);
} else {
  console.warn('WARNING: Authentication is disabled (ENABLE_AUTH != true). All data is publicly accessible.');
}
```

**Step 2: Commit**

```bash
git add src/server.js
git commit -m "fix: warn at startup when authentication is disabled"
```

---

### Task 8: Run as non-root user in Docker (Informational)

**Files:**
- Modify: `Dockerfile`

**Step 1: Add USER directive to Dockerfile**

The `node:22-alpine` base image includes a built-in `node` user (uid 1000). Add it before the CMD:

Find the final stage in `Dockerfile` and insert before `EXPOSE 3001`:

Old:
```dockerfile
EXPOSE 3001
CMD ["node", "src/server.js"]
```

New:
```dockerfile
RUN chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "src/server.js"]
```

The `chown` ensures the app directory is owned by the node user before switching. The mounted `/data` volume will still be accessible since volumes are mounted at runtime with the host permissions.

**Step 2: Commit**

```bash
git add Dockerfile
git commit -m "fix: run container as non-root node user"
```

---

### Task 9: Run full test suite and verify

**Step 1: Run all tests**

Run: `npm test`
Expected: all tests pass with no failures.

**Step 2: Build the client**

Run: `npm run build`
Expected: Vite build completes successfully.
