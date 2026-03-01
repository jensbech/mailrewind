import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

export default function ImportScreen({ onComplete, existingMailboxes = [], onCancel }) {
  const [step, setStep] = useState('name');
  const [mailboxName, setMailboxName] = useState('');
  const [targetMailboxId, setTargetMailboxId] = useState(null);
  const [mboxPath, setMboxPath] = useState('/data/');
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(null);
  const [skipReasons, setSkipReasons] = useState(null);
  const [importStatus, setImportStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [files, setFiles] = useState(null);
  const [filesError, setFilesError] = useState(false);
  const logsEndRef = useRef(null);
  const esRef = useRef(null);
  const logIdRef = useRef(0);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => () => esRef.current?.close(), []);

  function fetchFiles() {
    setFiles(null);
    setFilesError(false);
    axios.get('/api/files')
      .then(res => setFiles(res.data))
      .catch(() => setFilesError(true));
  }

  useEffect(() => {
    if (step === 'import') fetchFiles();
  }, [step]);

  async function handleNameSubmit(e) {
    e.preventDefault();
    const name = mailboxName.trim();
    if (!name) return;

    try {
      const res = await axios.post('/api/mailboxes', { name });
      setTargetMailboxId(res.data.id);
      setStep('import');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  function handleSelectExisting(id) {
    setTargetMailboxId(id);
    setStep('import');
  }

  async function handleImportStart(e) {
    e.preventDefault();
    if (!mboxPath.trim() || !targetMailboxId) return;

    setImportStatus('running');
    setLogs([]);
    setProgress(null);
    setError(null);
    setSkipReasons(null);

    esRef.current?.close();
    const es = new EventSource('/api/import/events');
    esRef.current = es;

    es.onmessage = (ev) => {
      const event = JSON.parse(ev.data);
      if (event.type === 'log') {
        setLogs(prev => [...prev.slice(-99), { id: logIdRef.current++, text: event.text }]);
      } else if (event.type === 'progress') {
        setProgress(event);
      } else if (event.type === 'done') {
        setImportStatus('done');
        setProgress(p => ({ ...p, indexed: event.indexed, skipped: event.skipped }));
        if (event.skipped > 0) setSkipReasons(event.skipReasons);
        es.close();
      } else if (event.type === 'error') {
        setImportStatus('error');
        setError(event.message);
        es.close();
      }
    };

    es.onerror = () => {
      setImportStatus('error');
      setError('Connection to import stream lost.');
      es.close();
    };

    try {
      await axios.post('/api/import/start', { path: mboxPath.trim(), mailboxId: targetMailboxId });
    } catch (err) {
      setImportStatus('error');
      setError(err.response?.data?.error || err.message);
      es.close();
    }
  }

  function formatSize(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
    if (bytes >= 1e3) return Math.round(bytes / 1e3) + ' KB';
    return bytes + ' B';
  }

  function handleAddAnother() {
    setImportStatus('idle');
    setLogs([]);
    setProgress(null);
    setMboxPath('/data/');
    fetchFiles();
  }

  return (
    <div className="import-screen">
      <div className="import-box">
        <div className="import-logo-row">
          <div className="import-logo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="m2 7 10 7 10-7"/>
            </svg>
            Email Archive
          </div>
          {onCancel && (
            <button className="import-close-btn" onClick={onCancel} title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          )}
        </div>

        {step === 'name' && (
          <div className="import-step">
            <div className="import-step-title">Name this mailbox</div>
            <form onSubmit={handleNameSubmit} className="import-form">
              <input
                className="import-input"
                type="text"
                placeholder="e.g. Gmail Archive, Work 2019…"
                value={mailboxName}
                onChange={e => setMailboxName(e.target.value)}
                autoFocus
              />
              <button className="import-btn" type="submit" disabled={!mailboxName.trim()}>
                Continue →
              </button>
            </form>

            {existingMailboxes.length > 0 && (
              <div className="import-existing">
                <div className="import-existing-label">or add to an existing mailbox</div>
                <div className="import-existing-list">
                  {existingMailboxes.map(m => (
                    <button key={m.id} className="import-existing-btn" onClick={() => handleSelectExisting(m.id)}>
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'import' && (
          <div className="import-step">
            {importStatus === 'idle' && (
              <>
                <div className="import-step-header">
                  <button className="import-back-btn" onClick={() => setStep('name')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5M12 5l-7 7 7 7"/>
                    </svg>
                    Back
                  </button>
                  <div className="import-step-title">Select an mbox file</div>
                </div>

                {files === null && !filesError && (
                  <div className="import-file-loading">
                    <div className="loading-dot" /> Scanning /data/…
                  </div>
                )}

                {filesError && (
                  <>
                    <div className="import-hint import-hint--error">
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
                          className={`import-file-row${mboxPath === f.path ? ' import-file-row--selected' : ''}`}
                          onClick={() => setMboxPath(f.path)}
                        >
                          <span className="import-file-name">{f.name}</span>
                          <span className="import-file-size">{formatSize(f.size)}</span>
                        </button>
                      ))}
                    </div>
                    <button className="import-btn" type="submit" disabled={!mboxPath.endsWith('.mbox')}>
                      Start Import
                    </button>
                  </form>
                )}
              </>
            )}

            {(importStatus === 'running' || importStatus === 'done' || importStatus === 'error') && (
              <>
                <div className="import-status-bar">
                  <div className="import-status-bar-left">
                    {importStatus === 'running' && <><div className="loading-dot" /><span>Importing…</span></>}
                    {importStatus === 'done' && <span className="import-status-done">✦ Done</span>}
                    {importStatus === 'error' && <span className="import-status-error">Import failed</span>}
                  </div>
                  {progress?.elapsed != null && (
                    <span className="import-elapsed">{progress.elapsed}s elapsed</span>
                  )}
                </div>

                <div className="import-stats-grid">
                  <div className="import-stat">
                    <div className="import-stat-value">{(progress?.indexed ?? 0).toLocaleString()}</div>
                    <div className="import-stat-label">Indexed</div>
                  </div>
                  <div className={`import-stat${(progress?.skipped ?? 0) > 0 ? ' import-stat--warn' : ''}`}>
                    <div className="import-stat-value">{(progress?.skipped ?? 0).toLocaleString()}</div>
                    <div className="import-stat-label">Skipped</div>
                  </div>
                  <div className="import-stat">
                    <div className="import-stat-value">
                      {importStatus === 'running' && progress?.rate ? `~${progress.rate}` : progress?.elapsed != null ? `${progress.elapsed}s` : '—'}
                    </div>
                    <div className="import-stat-label">{importStatus === 'running' ? 'per second' : 'elapsed'}</div>
                  </div>
                </div>

                {importStatus === 'error' && (
                  <div className="import-error">{error}</div>
                )}

                {importStatus === 'done' && (
                  <div className="import-done">
                    {skipReasons && (
                      <div className="import-skip-summary">
                        <div className="import-skip-title">
                          {(progress?.skipped ?? 0).toLocaleString()} email{progress?.skipped !== 1 ? 's' : ''} skipped
                        </div>
                        {skipReasons.duplicate > 0 && (
                          <div className="import-skip-row">
                            <span className="import-skip-count">{skipReasons.duplicate.toLocaleString()}</span>
                            duplicate message IDs — already in archive
                          </div>
                        )}
                        {skipReasons.empty > 0 && (
                          <div className="import-skip-row">
                            <span className="import-skip-count">{skipReasons.empty.toLocaleString()}</span>
                            no sender or subject — likely system messages
                          </div>
                        )}
                        {skipReasons.timeout > 0 && (
                          <div className="import-skip-row">
                            <span className="import-skip-count">{skipReasons.timeout.toLocaleString()}</span>
                            parse timed out — email too large or complex
                          </div>
                        )}
                        {skipReasons.error > 0 && (
                          <div className="import-skip-row">
                            <span className="import-skip-count">{skipReasons.error.toLocaleString()}</span>
                            malformed — could not be parsed
                          </div>
                        )}
                      </div>
                    )}
                    <div className="import-done-actions">
                      <button className="import-btn-secondary" onClick={handleAddAnother}>
                        Add another file to this mailbox
                      </button>
                      <button className="import-btn" onClick={() => onComplete(targetMailboxId)}>
                        Open Archive →
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
