import { useState, useEffect } from 'react';
import axios from 'axios';
import DOMPurify from 'dompurify';

function fileIcon(contentType) {
  if (!contentType) return '📎';
  if (contentType.startsWith('image/')) return '🖼';
  if (contentType.startsWith('video/')) return '🎬';
  if (contentType.startsWith('audio/')) return '🎵';
  if (contentType.includes('pdf')) return '📄';
  if (contentType.includes('zip') || contentType.includes('compressed') || contentType.includes('rar')) return '🗜';
  if (contentType.includes('word') || contentType.includes('document')) return '📝';
  if (contentType.includes('sheet') || contentType.includes('excel')) return '📊';
  if (contentType.includes('presentation') || contentType.includes('powerpoint')) return '📊';
  return '📎';
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatFullDate(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export default function EmailDetail({ email }) {
  const [attachments, setAttachments] = useState([]);

  useEffect(() => {
    if (!email?.id) return;
    setAttachments([]);
    axios.get(`/api/emails/${email.id}/attachments`)
      .then(r => setAttachments(r.data))
      .catch(() => setAttachments([]));
  }, [email?.id]);

  return (
    <div className="email-detail">
      <div className="detail-header">
        <div className="detail-subject">{email.subject || '(no subject)'}</div>
        <div className="detail-meta">
          <span className="meta-label">From</span>
          <span className="meta-value">{email.from || '—'}</span>
          <span className="meta-label">To</span>
          <span className="meta-value">{email.to || '—'}</span>
          {email.cc && <>
            <span className="meta-label">CC</span>
            <span className="meta-value">{email.cc}</span>
          </>}
          <span className="meta-label">Date</span>
          <span className="meta-value date-value">{formatFullDate(email.date)}</span>
        </div>
      </div>

      {attachments.length > 0 && (
        <div className="attachments-bar">
          {attachments.map(att => (
            <a
              key={att.id}
              href={`/api/attachments/${att.id}/download`}
              className="attachment-chip"
              download={att.filename}
            >
              <span className="att-icon">{fileIcon(att.contentType)}</span>
              <span className="att-name">{att.filename}</span>
              <span className="att-size">{formatSize(att.size)}</span>
              <span className="att-dl">↓</span>
            </a>
          ))}
        </div>
      )}

      <div className="detail-body">
        {email.bodyHTML ? (
          <div className="body-html" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(email.bodyHTML) }} />
        ) : (
          <pre className="body-plain">{email.bodyText || '(no body)'}</pre>
        )}
      </div>
    </div>
  );
}
