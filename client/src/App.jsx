import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import EmailDetail from './components/EmailDetail';
import './App.css';

const PAGE_SIZE = 50;

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function truncateEmail(str, max = 42) {
  if (!str) return '';
  const match = str.match(/<([^>]+)>/);
  const addr = match ? match[1] : str;
  return addr.length > max ? addr.slice(0, max - 1) + '…' : addr;
}

export default function App() {
  const [emails, setEmails] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [sort, setSort] = useState('desc');
  const [stats, setStats] = useState(null);
  const [years, setYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(370);
  const listRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startWidth: 0 });

  const onResizeStart = useCallback((e) => {
    e.preventDefault();
    dragRef.current = { active: true, startX: e.clientX, startWidth: sidebarWidth };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, [sidebarWidth]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.startX;
      const newW = Math.min(560, Math.max(240, dragRef.current.startWidth + dx));
      setSidebarWidth(newW);
    };
    const onUp = () => {
      if (dragRef.current.active) {
        dragRef.current.active = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 320);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    axios.get('/api/stats').then(r => setStats(r.data)).catch(() => {});
    axios.get('/api/years').then(r => setYears(r.data)).catch(() => {});
  }, []);

  const fetchEmails = useCallback(async (currentOffset, replace) => {
    setLoading(true);
    try {
      const params = { limit: PAGE_SIZE + 1, offset: currentOffset, sort };
      if (yearFilter !== 'all') params.year = yearFilter;

      let res;
      if (debouncedSearch.trim()) {
        res = await axios.get('/api/search', { params: { ...params, q: debouncedSearch.trim() } });
      } else {
        res = await axios.get('/api/emails', { params });
      }

      const data = res.data;
      const more = data.length > PAGE_SIZE;
      const page = more ? data.slice(0, PAGE_SIZE) : data;

      if (replace) {
        setEmails(page);
        setTotal(more ? null : currentOffset + page.length);
        if (listRef.current) listRef.current.scrollTop = 0;
      } else {
        setEmails(prev => [...prev, ...page]);
      }
      setHasMore(more);
      setOffset(currentOffset + page.length);
    } catch {
      if (replace) setEmails([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, yearFilter, sort]);

  useEffect(() => {
    setOffset(0);
    setEmails([]);
    setTotal(null);
    fetchEmails(0, true);
  }, [fetchEmails]);

  const handleLoadMore = () => {
    if (!loading && hasMore) fetchEmails(offset, false);
  };

  const yearRange = stats
    ? `${new Date(stats.oldest).getFullYear()} – ${new Date(stats.newest).getFullYear()}`
    : '';

  return (
    <div className="app">
      <aside className="sidebar" style={{ width: sidebarWidth }}>
        <div className="sidebar-head">
          <div className="sidebar-logo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="m2 7 10 7 10-7"/>
            </svg>
            {stats ? stats.total.toLocaleString() + ' emails' : 'Email Archive'}
          </div>
          {stats && yearRange && (
            <div className="sidebar-meta">{yearRange}</div>
          )}
        </div>

        <div className="filters">
          <div className="search-wrap">
            <svg className="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              className="search-input"
              type="text"
              placeholder="search letters…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              spellCheck={false}
            />
          </div>

          <div className="filter-section">
            <div className="filter-label">Year</div>
            <div className="chip-row">
              <button
                className={`chip${yearFilter === 'all' ? ' active' : ''}`}
                onClick={() => setYearFilter('all')}
              >All</button>
              {years.map(({ year }) => (
                <button
                  key={year}
                  className={`chip${yearFilter === year ? ' active' : ''}`}
                  onClick={() => setYearFilter(year)}
                >{year}</button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <div className="filter-label">Order</div>
            <div className="sort-row">
              <button className={`sort-btn${sort === 'desc' ? ' active' : ''}`} onClick={() => setSort('desc')}>
                ↓ Newest first
              </button>
              <button className={`sort-btn${sort === 'asc' ? ' active' : ''}`} onClick={() => setSort('asc')}>
                ↑ Oldest first
              </button>
            </div>
          </div>
        </div>

        <div className="result-bar">
          <span className="result-count">
            {loading && emails.length === 0 ? (
              <span>Loading…</span>
            ) : emails.length > 0 ? (
              <span><strong>{emails.length}{hasMore ? '+' : ''}</strong> {debouncedSearch ? 'found' : 'letters'}</span>
            ) : (
              <span>No letters found</span>
            )}
          </span>
          {loading && <div className="loading-dot" />}
        </div>

        <div className="resize-handle" onMouseDown={onResizeStart} />
        <div className="email-list" ref={listRef}>
          {emails.length === 0 && !loading ? (
            <div className="empty-list">
              <div className="empty-list-icon">✦</div>
              <p>No letters match<br />your filters</p>
            </div>
          ) : (
            emails.map(email => (
              <div
                key={email.id}
                className={`email-item${selected?.id === email.id ? ' active' : ''}`}
                onClick={() => setSelected(email)}
              >
                <div className="item-date">{formatDate(email.date)}</div>
                <div className="item-subject">{email.subject || '(no subject)'}</div>
                <div className="item-from">{truncateEmail(email.from)}</div>
              </div>
            ))
          )}

          {hasMore && (
            <div className="load-more-wrap">
              <button className="load-more-btn" onClick={handleLoadMore} disabled={loading}>
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        {selected ? (
          <EmailDetail key={selected.id} email={selected} />
        ) : (
          <div className="empty-state">
            <div className="empty-state-glyph">✦</div>
            <p>Select a letter to read</p>
          </div>
        )}
      </main>
    </div>
  );
}
