import { useState } from 'react';

export default function MailboxBar({ mailboxes, selectedIds, onSelectionChange, onAddClick, onDeleteMailbox, darkMode, onToggleDark, user }) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const allSelected = selectedIds === null;

  function toggleAll() {
    onSelectionChange(null);
  }

  function toggleMailbox(id) {
    if (allSelected) {
      onSelectionChange([id]);
      return;
    }
    const next = selectedIds.includes(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id];
    onSelectionChange(next.length === 0 ? null : next);
  }

  function isActive(id) {
    return allSelected || selectedIds.includes(id);
  }

  const mailboxToDelete = mailboxes.find(m => m.id === confirmDeleteId);

  return (
    <>
      <div className="mailbox-bar">
        <div className="mailbox-chip-row">
          {mailboxes.length > 1 && (
            <button
              className={`mailbox-chip${allSelected ? ' active' : ''}`}
              onClick={toggleAll}
            >
              All
            </button>
          )}

          {mailboxes.map(m => (
            <div key={m.id} className="mailbox-chip-wrap">
              <button
                className={`mailbox-chip${isActive(m.id) ? ' active' : ''}`}
                onClick={() => toggleMailbox(m.id)}
              >
                {m.name}
                {m.count > 0 && <span className="mailbox-chip-count">{m.count.toLocaleString()}</span>}
              </button>
              <button
                className="mailbox-chip-delete"
                onClick={() => setConfirmDeleteId(m.id)}
                title="Delete mailbox"
              >
                <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 1l10 10M11 1L1 11"/>
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div className="mailbox-bar-actions">
          <button className="mailbox-import-btn" onClick={onAddClick}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Import
          </button>
          <button className="theme-toggle-btn" onClick={onToggleDark}>
            {darkMode ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4"/>
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
            {darkMode ? 'Dark' : 'Light'}
          </button>
          {user && (
            <a href="/auth/logout" className="logout-btn" title={`Signed in as ${user.username}`}>
              {user.username} (sign out)
            </a>
          )}
        </div>
      </div>

      {confirmDeleteId !== null && mailboxToDelete && (
        <div className="mailbox-delete-backdrop" onClick={() => setConfirmDeleteId(null)}>
          <div className="mailbox-delete-modal" onClick={e => e.stopPropagation()}>
            <div className="mailbox-delete-modal-title">Delete mailbox?</div>
            <p className="mailbox-delete-modal-msg">
              <strong>{mailboxToDelete.name}</strong> and all its indexed emails will be permanently removed. This cannot be undone.
            </p>
            <div className="mailbox-delete-modal-actions">
              <button className="mailbox-delete-modal-cancel" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
              <button
                className="mailbox-delete-modal-confirm"
                onClick={() => { onDeleteMailbox(confirmDeleteId); setConfirmDeleteId(null); }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
