export default function EmailList({ emails, selected, onSelect }) {
  return (
    <div className="email-list">
      {emails.length === 0 ? (
        <p className="empty-message">No emails</p>
      ) : (
        emails.map(email => (
          <div
            key={email.id}
            className={`email-item ${selected?.id === email.id ? 'active' : ''}`}
            onClick={() => onSelect(email)}
          >
            <div className="from">{email.from || 'Unknown'}</div>
            <div className="subject">{email.subject}</div>
            <div className="date">{new Date(email.date).toLocaleDateString()}</div>
          </div>
        ))
      )}
    </div>
  );
}
