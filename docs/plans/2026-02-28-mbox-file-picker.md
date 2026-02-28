# mbox File Picker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the manual path text input on the import screen with a clickable list of `.mbox` files discovered from the server.

**Architecture:** New `GET /api/files` endpoint scans a configurable directory (default `/data`) for `*.mbox` files and returns name/path/size. `ImportScreen` fetches this on mount and renders a selectable list; clicking a file selects it (highlighted) and enables Start Import. Falls back to the manual text input if the scan fails.

**Tech Stack:** Node.js `fs/promises` (readdir + stat), Express, React hooks (useState/useEffect), existing CSS design tokens.

---

### Task 1: Add `GET /api/files` endpoint

**Files:**
- Modify: `src/app.js`
- Test: `test/server.test.js`

**Step 1: Add the failing tests**

Append a new describe block to `test/server.test.js` (before the final closing `});`):

```js
describe('GET /api/files', () => {
  it('returns empty array when directory has no .mbox files', async () => {
    const dir = 'data/test-files-empty';
    await mkdir(dir, { recursive: true });
    const { app: filesApp } = createApp(db, { filesDir: dir });
    const res = await supertest(filesApp).get('/api/files');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, []);
    await rm(dir, { recursive: true });
  });

  it('returns .mbox files sorted by name with correct path and size', async () => {
    const dir = 'data/test-files-scan';
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'b.mbox'), 'content b');
    await writeFile(join(dir, 'a.mbox'), 'content aa');
    await writeFile(join(dir, 'ignored.txt'), 'not mbox');
    const { app: filesApp } = createApp(db, { filesDir: dir });
    const res = await supertest(filesApp).get('/api/files');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 2);
    assert.strictEqual(res.body[0].name, 'a.mbox');
    assert.strictEqual(res.body[0].path, join(dir, 'a.mbox'));
    assert.ok(typeof res.body[0].size === 'number' && res.body[0].size > 0);
    assert.strictEqual(res.body[1].name, 'b.mbox');
    await rm(dir, { recursive: true });
  });

  it('returns 500 when filesDir does not exist', async () => {
    const { app: filesApp } = createApp(db, { filesDir: '/nonexistent/__xyz__' });
    const res = await supertest(filesApp).get('/api/files');
    assert.strictEqual(res.status, 500);
  });
});
```

**Step 2: Run the tests to confirm they fail**

```bash
node --test 'test/server.test.js' 2>&1 | grep -A 2 "GET /api/files"
```
Expected: 3 failures (route doesn't exist yet).

**Step 3: Add `readdir`/`stat` import and `filesDir` option to `src/app.js`**

At the top of `src/app.js`, add to the existing node imports:
```js
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
```

Change the `createApp` signature (line 21):
```js
export function createApp(db, { heartbeatMs = 15000, filesDir = '/data' } = {}) {
```

**Step 4: Add the route to `src/app.js`**

Insert this block after the `GET /api/attachments/:id/download` handler (after line 215) and before `app.use(express.static(...))`:

```js
app.get('/api/files', async (req, res) => {
  try {
    const entries = await readdir(filesDir);
    const mboxNames = entries.filter(f => f.endsWith('.mbox'));
    const files = await Promise.all(
      mboxNames.map(async (name) => {
        const filePath = join(filesDir, name);
        const { size } = await stat(filePath);
        return { name, path: filePath, size };
      })
    );
    files.sort((a, b) => a.name.localeCompare(b.name));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 5: Run the new tests to verify they pass**

```bash
node --test 'test/server.test.js' 2>&1 | grep -E "(pass|fail|GET /api/files)"
```
Expected: 3 new tests PASS.

**Step 6: Run the full test suite to check nothing is broken**

```bash
node --experimental-test-coverage --test 'test/*.test.js' 2>&1 | tail -5
```
Expected: all tests pass, 0 fail.

**Step 7: Commit**

```bash
git add src/app.js test/server.test.js
git commit -m "feat: add GET /api/files endpoint to list mbox files"
```

---

### Task 2: Update ImportScreen with file picker UI

**Files:**
- Modify: `client/src/components/ImportScreen.jsx`
- Modify: `client/src/App.css`

**Step 1: Add new state variables to `ImportScreen.jsx`**

After the existing `useState` declarations (after line 15), add:
```js
const [files, setFiles] = useState(null);     // null=loading, []=empty, [...]=loaded
const [filesError, setFilesError] = useState(false);
const [selectedPath, setSelectedPath] = useState(null);
```

**Step 2: Add effect to fetch files when the import step loads**

Add after the existing `useEffect` hooks (after line 21):
```js
useEffect(() => {
  if (step !== 'import') return;
  setFiles(null);
  setFilesError(false);
  setSelectedPath(null);
  axios.get('/api/files')
    .then(res => setFiles(res.data))
    .catch(() => setFilesError(true));
}, [step]);
```

**Step 3: Add `formatSize` helper inside the component**

Add before the `return` statement:
```js
function formatSize(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return Math.round(bytes / 1e3) + ' KB';
  return bytes + ' B';
}
```

**Step 4: Replace the idle-state block in the render**

Find this block (lines 139–160):
```jsx
{importStatus === 'idle' && (
  <>
    <div className="import-step-title">Specify mbox path</div>
    <div className="import-hint">
      Files mounted at <code>/data/</code> via compose.yml volume
    </div>
    <form onSubmit={handleImportStart} className="import-form">
      <input
        className="import-input import-input-mono"
        type="text"
        placeholder="/data/mail.mbox"
        value={mboxPath}
        onChange={e => setMboxPath(e.target.value)}
        autoFocus
        spellCheck={false}
      />
      <button className="import-btn" type="submit" disabled={!mboxPath.trim()}>
        Start Import
      </button>
    </form>
  </>
)}
```

Replace it with:
```jsx
{importStatus === 'idle' && (
  <>
    <div className="import-step-title">Select an mbox file</div>

    {files === null && !filesError && (
      <div className="import-file-loading">
        <div className="loading-dot" /> Scanning /data/…
      </div>
    )}

    {filesError && (
      <>
        <div className="import-hint" style={{ color: 'var(--accent)', marginBottom: 12 }}>
          Could not read /data/ — enter path manually
        </div>
        <form onSubmit={handleImportStart} className="import-form">
          <input
            className="import-input import-input-mono"
            type="text"
            placeholder="/data/mail.mbox"
            value={mboxPath}
            onChange={e => setMboxPath(e.target.value)}
            autoFocus
            spellCheck={false}
          />
          <button className="import-btn" type="submit" disabled={!mboxPath.trim()}>
            Start Import
          </button>
        </form>
      </>
    )}

    {files !== null && !filesError && files.length === 0 && (
      <div className="import-file-empty">No .mbox files found in /data/</div>
    )}

    {files !== null && !filesError && files.length > 0 && (
      <form onSubmit={handleImportStart} className="import-form">
        <div className="import-file-list">
          {files.map(f => (
            <button
              key={f.path}
              type="button"
              className={`import-file-row${selectedPath === f.path ? ' import-file-row--selected' : ''}`}
              onClick={() => { setSelectedPath(f.path); setMboxPath(f.path); }}
            >
              <span className="import-file-name">{f.name}</span>
              <span className="import-file-size">{formatSize(f.size)}</span>
            </button>
          ))}
        </div>
        <button className="import-btn" type="submit" disabled={!selectedPath}>
          Start Import
        </button>
      </form>
    )}
  </>
)}
```

**Step 5: Update `handleAddAnother` to reset picker state**

Find `handleAddAnother` (around line 87) and replace it:
```js
function handleAddAnother() {
  setImportStatus('idle');
  setLogs([]);
  setProgress(null);
  setMboxPath('/data/');
  setSelectedPath(null);
  setFiles(null);
  setFilesError(false);
}
```

**Step 6: Add file picker CSS to `client/src/App.css`**

Append to the end of `client/src/App.css`:
```css
/* ── File picker ─────────────────────────────────────── */

.import-file-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
  font-size: 13px;
  padding: 12px 0;
}

.import-file-empty {
  padding: 20px 0;
  color: var(--text-2);
  font-size: 13px;
}

.import-file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
  max-height: 240px;
  overflow-y: auto;
}

.import-file-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s, border-color 0.1s;
  width: 100%;
}

.import-file-row:hover {
  background: var(--bg-hover);
}

.import-file-row--selected {
  background: var(--bg-selected);
  border-color: var(--accent);
}

.import-file-name {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-0);
}

.import-file-size {
  font-size: 12px;
  color: var(--text-2);
  flex-shrink: 0;
  margin-left: 12px;
}
```

**Step 7: Build the client and smoke-test**

```bash
cd client && npm run build && cd ..
npm run dev
```
Open http://localhost:3001, click Import, name a mailbox, confirm the file list appears with filenames and sizes, click a file to select it (it should highlight), and verify Start Import becomes enabled.

**Step 8: Commit**

```bash
git add client/src/components/ImportScreen.jsx client/src/App.css
git commit -m "feat: replace mbox path input with file picker"
```
