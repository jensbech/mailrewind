export default function EmailDetail({ email }) {
  return (
    <div className="email-detail">
      <div className="header">
        <h2>{email.subject}</h2>
        <div className="meta">
          <p><strong>From:</strong> {email.from}</p>
          <p><strong>To:</strong> {email.to}</p>
          <p><strong>Date:</strong> {new Date(email.date).toLocaleString()}</p>
        </div>
      </div>

      <div className="body">
        {email.bodyHTML ? (
          <div dangerouslySetInnerHTML={{ __html: email.bodyHTML }} />
        ) : (
          <pre>{email.bodyText}</pre>
        )}
      </div>
    </div>
  );
}
