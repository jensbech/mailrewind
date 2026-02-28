import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

export default function ImportScreen({ onComplete, existingMailboxes = [] }) {
  const [step, setStep] = useState('name');
  const [mailboxName, setMailboxName] = useState('');
  const [targetMailboxId, setTargetMailboxId] = useState(null);
  const [mboxPath, setMboxPath] = useState('/data/');
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(null);
  const [importStatus, setImportStatus] = useState('idle');
  const [error, setError] = useState(null);
  const logsEndRef = useRef(null);
  const esRef = useRef(null);
  const logIdRef = useRef(0);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => () => esRef.current?.close(), []);

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
        setProgress(p => ({ ...p, indexed: event.indexed }));
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

  function handleAddAnother() {
    setImportStatus('idle');
    setLogs([]);
    setProgress(null);
    setMboxPath('/data/');
  }

  return (
    <div className="import-screen">
      <div className="import-box">
        <div className="import-logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="m2 7 10 7 10-7"/>
          </svg>
          Email Archive
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

            {(importStatus === 'running' || importStatus === 'done' || importStatus === 'error') && (
              <>
                <div className="import-log-panel">
                  {logs.map(entry => (
                    <div key={entry.id} className="import-log-line">{entry.text}</div>
                  ))}
                  <div ref={logsEndRef} />
                </div>

                {progress && (
                  <div className="import-counter">
                    Seen: {progress.seen?.toLocaleString()} · Indexed: {progress.indexed?.toLocaleString()} · Skipped: {(progress.skipped ?? 0).toLocaleString()}
                    {progress.rate ? ` · ~${progress.rate} emails/s` : ''}
                  </div>
                )}

                {importStatus === 'error' && (
                  <div className="import-error">{error}</div>
                )}

                {importStatus === 'done' && (
                  <div className="import-done">
                    <span>✦ Done — {progress?.indexed?.toLocaleString()} emails indexed</span>
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

                {importStatus === 'running' && (
                  <div className="import-running-indicator">
                    <div className="loading-dot" /> Importing…
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
