import { useState, useEffect } from 'react';
import axios from 'axios';

function fileIcon(contentType) {
  if (!contentType) return '📎';
  if (contentType.startsWith('image/')) return '🖼️';
  if (contentType.startsWith('video/')) return '🎬';
  if (contentType.startsWith('audio/')) return '🎵';
  if (contentType.includes('pdf')) return '📄';
  if (contentType.includes('zip') || contentType.includes('compressed')) return '🗜️';
  if (contentType.includes('word') || contentType.includes('document')) return '📝';
  if (contentType.includes('sheet') || contentType.includes('excel')) return '📊';
  return '📎';
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function EmailDetail({ email }) {
  const [attachments, setAttachments] = useState([]);

  useEffect(() => {
    if (!email?.id) return;
    setAttachments([]);
    axios.get(`/api/emails/${email.id}/attachments`)
      .then(res => setAttachments(res.data))
      .catch(() => setAttachments([]));
  }, [email?.id]);

  return (
    <div className="email-detail">
      <div className="email-header">
        <h2>{email.subject}</h2>
        <div className="meta">
          <p><strong>From:</strong> {email.from}</p>
          <p><strong>To:</strong> {email.to}</p>
          <p><strong>Date:</strong> {new Date(email.date).toLocaleString()}</p>
        </div>
      </div>

      {attachments.length > 0 && (
        <div className="attachments">
          <h3>Attachments ({attachments.length})</h3>
          <div className="attachment-list">
            {attachments.map(att => (
              <a
                key={att.id}
                href={`/api/attachments/${att.id}/download`}
                className="attachment-item"
                download={att.filename}
              >
                <span className="attachment-icon">{fileIcon(att.contentType)}</span>
                <span className="attachment-name">{att.filename}</span>
                <span className="attachment-size">{formatSize(att.size)}</span>
              </a>
            ))}
          </div>
        </div>
      )}

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
