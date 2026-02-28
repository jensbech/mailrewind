export default function MailboxBar({ mailboxes, selectedIds, onSelectionChange, onAddClick }) {
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

  return (
    <div className="mailbox-bar">
      <div className="mailbox-bar-logo">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2"/>
          <path d="m2 7 10 7 10-7"/>
        </svg>
      </div>

      <div className="mailbox-chip-row">
        <button
          className={`mailbox-chip${allSelected ? ' active' : ''}`}
          onClick={toggleAll}
        >
          All
        </button>

        {mailboxes.map(m => (
          <button
            key={m.id}
            className={`mailbox-chip${isActive(m.id) ? ' active' : ''}`}
            onClick={() => toggleMailbox(m.id)}
            title={`${m.count?.toLocaleString() ?? 0} emails`}
          >
            {m.name}
            {m.count > 0 && <span className="mailbox-chip-count">{m.count?.toLocaleString()}</span>}
          </button>
        ))}
      </div>

      <button className="mailbox-add-btn" onClick={onAddClick} title="Import new mailbox">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
      </button>
    </div>
  );
}
