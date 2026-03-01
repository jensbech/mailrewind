import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import EmailDetail from './components/EmailDetail';
import ImportScreen from './components/ImportScreen';
import MailboxBar from './components/MailboxBar';
import DomainPicker from './components/DomainPicker';
import YearPicker from './components/YearPicker';
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

function mailboxIdsParam(selectedIds) {
  if (selectedIds === null) return {};
  return { mailboxIds: selectedIds.join(',') };
}

export default function App() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const [appReady, setAppReady] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [mailboxes, setMailboxes] = useState([]);
  const [selectedMailboxIds, setSelectedMailboxIds] = useState(null);

  const [emails, setEmails] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [yearFilter, setYearFilter] = useState([]);
  const [yearAfter, setYearAfter] = useState(null);
  const [yearBefore, setYearBefore] = useState(null);
  const [sort, setSort] = useState('desc');
  const [stats, setStats] = useState(null);
  const [years, setYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [hasAttachments, setHasAttachments] = useState(false);
  const [hasHtml, setHasHtml] = useState(false);
  const [hasSubject, setHasSubject] = useState(false);
  const [fromDomains, setFromDomains] = useState([]);
  const [attachmentType, setAttachmentType] = useState(null);
  const [largeAttachment, setLargeAttachment] = useState(false);
  const [domains, setDomains] = useState([]);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(370);
  const listRef = useRef(null);
  const filterBarRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startWidth: 0 });

  const refreshMailboxes = useCallback(async () => {
    const res = await axios.get('/api/mailboxes');
    setMailboxes(res.data);
    return res.data;
  }, []);

  useEffect(() => {
    refreshMailboxes().then(data => {
      setAppReady(true);
      if (data.length === 0) setShowImport(true);
    }).catch(() => setAppReady(true));
  }, [refreshMailboxes]);

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
      setSidebarWidth(Math.min(560, Math.max(240, dragRef.current.startWidth + dx)));
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

  const mbParam = mailboxIdsParam(selectedMailboxIds);

  useEffect(() => {
    if (!appReady || showImport) return;
    axios.get('/api/stats', { params: mbParam }).then(r => setStats(r.data)).catch(() => {});
    axios.get('/api/years', { params: mbParam }).then(r => setYears(r.data)).catch(() => {});
    axios.get('/api/domains', { params: mbParam }).then(r => setDomains(r.data)).catch(() => {});
  }, [appReady, showImport, selectedMailboxIds]);

  useEffect(() => {
    if (!filtersExpanded) return;
    function handler(e) {
      if (filterBarRef.current && !filterBarRef.current.contains(e.target)) {
        setFiltersExpanded(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filtersExpanded]);

  const fetchEmails = useCallback(async (currentOffset, replace) => {
    setLoading(true);
    try {
      const params = { limit: PAGE_SIZE + 1, offset: currentOffset, sort, ...mbParam };
      if (yearFilter.length > 0) params.years = yearFilter.join(',');
      if (yearAfter != null) params.yearAfter = yearAfter;
      if (yearBefore != null) params.yearBefore = yearBefore;
      if (hasAttachments) params.hasAttachments = '1';
      if (largeAttachment) params.largeAttachment = '1';
      if (attachmentType) params.attachmentType = attachmentType;
      if (hasHtml) params.hasHtml = '1';
      if (hasSubject) params.hasSubject = '1';
      if (fromDomains.length > 0) params.fromDomains = fromDomains.join(',');

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
  }, [debouncedSearch, yearFilter, yearAfter, yearBefore, sort, selectedMailboxIds, hasAttachments, largeAttachment, attachmentType, hasHtml, hasSubject, fromDomains]);

  useEffect(() => {
    if (!appReady || showImport) return;
    setOffset(0);
    fetchEmails(0, true);
  }, [fetchEmails, appReady, showImport]);

  const handleLoadMore = () => {
    if (!loading && hasMore) fetchEmails(offset, false);
  };

  function handleImportComplete(newMailboxId) {
    setShowImport(false);
    refreshMailboxes().then(() => {
      setSelectedMailboxIds([newMailboxId]);
    }).catch(() => {});
  }

  async function handleDeleteMailbox(id) {
    try {
      await axios.delete(`/api/mailboxes/${id}`);
      await refreshMailboxes();
      setSelectedMailboxIds(prev => {
        if (prev === null) return null;
        const next = prev.filter(x => x !== id);
        return next.length === 0 ? null : next;
      });
    } catch {
      // silently ignore — mailbox list will reflect actual state on next refresh
    }
  }

  function handleMailboxSelection(ids) {
    setSelectedMailboxIds(ids);
    setYearFilter([]);
    setSearch('');
    setSelected(null);
    setHasAttachments(false);
    setLargeAttachment(false);
    setAttachmentType(null);
    setHasHtml(false);
    setHasSubject(false);
    setFromDomains([]);
  }

  const yearRange = stats
    ? `${new Date(stats.oldest).getFullYear()} – ${new Date(stats.newest).getFullYear()}`
    : '';

  const activeFilterCount = [hasAttachments, largeAttachment, hasHtml, hasSubject, attachmentType].filter(Boolean).length
    + fromDomains.length + yearFilter.length
    + (yearAfter != null ? 1 : 0) + (yearBefore != null ? 1 : 0);

  function clearAllFilters() {
    setYearFilter([]);
    setYearAfter(null);
    setYearBefore(null);
    setHasAttachments(false);
    setLargeAttachment(false);
    setAttachmentType(null);
    setHasHtml(false);
    setHasSubject(false);
    setFromDomains([]);
  }

  if (!appReady) {
    return (
      <div className="app-loading">
        <div className="loading-dot" />
      </div>
    );
  }

  if (showImport) {
    return (
      <ImportScreen
        onComplete={handleImportComplete}
        existingMailboxes={mailboxes}
        onCancel={mailboxes.length > 0 ? () => setShowImport(false) : null}
      />
    );
  }

  return (
    <div className="app-root">
      <MailboxBar
        mailboxes={mailboxes}
        selectedIds={selectedMailboxIds}
        onSelectionChange={handleMailboxSelection}
        onAddClick={() => setShowImport(true)}
        onDeleteMailbox={handleDeleteMailbox}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode(d => !d)}
      />

      <div className="app">
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <div className="sidebar-head">
            <div className="sidebar-brand">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="m2 7 10 7 10-7"/>
              </svg>
              {stats ? (
                <>
                  <span className="sidebar-archive-count">{stats.total.toLocaleString()}</span>
                  <span className="sidebar-archive-unit">emails</span>
                  {yearRange && <span className="sidebar-archive-sep">·</span>}
                  {yearRange && <span className="sidebar-archive-range">{yearRange}</span>}
                </>
              ) : (
                <span className="sidebar-archive-unit">Email Archive</span>
              )}
              {loading && <div className="loading-dot sidebar-loading-dot" />}
            </div>
          </div>

          <div className="search-section">
            <div className="search-wrap">
              <svg className="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                className="search-input"
                type="text"
                placeholder="search mail…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>

          <div className="resize-handle" onMouseDown={onResizeStart} />

          <div className="email-list" ref={listRef}>
            {emails.length === 0 && !loading ? (
              <div className="empty-list">
                <div className="empty-list-icon">✦</div>
                <p>No emails match<br />your filters</p>
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

          <div className="filter-bar" ref={filterBarRef}>
            <div className="filter-bar-row">
              <button
                className={`filter-bar-toggle${filtersExpanded ? ' open' : ''}`}
                onClick={() => setFiltersExpanded(v => !v)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
                  <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
                  <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
                  <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
                </svg>
                <span className="filter-bar-label">Filters</span>
                {activeFilterCount > 0 && <span className="filter-bar-badge">{activeFilterCount}</span>}
                <svg className={`filter-bar-chevron${filtersExpanded ? ' open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6"/>
                </svg>
              </button>
            </div>

            <div className={`filter-panel${filtersExpanded ? ' open' : ''}`}>
              {activeFilterCount > 0 && (
                <div className="filter-panel-clear-row">
                  <span className="filter-panel-clear-count">{activeFilterCount} active</span>
                  <button className="filter-panel-clear-btn" onClick={clearAllFilters}>Clear all</button>
                </div>
              )}
              <div className="filter-section">
                <div className="filter-label">Year</div>
                <YearPicker
                  years={years}
                  value={yearFilter}
                  onChange={setYearFilter}
                  afterValue={yearAfter}
                  beforeValue={yearBefore}
                  onAfterChange={setYearAfter}
                  onBeforeChange={setYearBefore}
                />
              </div>

              <div className="filter-section">
                <div className="filter-label">Content</div>
                <div className="chip-row">
                  <button className={`chip${hasAttachments ? ' active' : ''}`} onClick={() => setHasAttachments(v => !v)}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                    </svg>
                    Has attachments
                  </button>
                  <button className={`chip${largeAttachment ? ' active' : ''}`} onClick={() => setLargeAttachment(v => !v)}>Large (&gt;1 MB)</button>
                  <button className={`chip${hasHtml ? ' active' : ''}`} onClick={() => setHasHtml(v => !v)}>HTML email</button>
                  <button className={`chip${hasSubject ? ' active' : ''}`} onClick={() => setHasSubject(v => !v)}>Has subject</button>
                </div>
              </div>

              <div className="filter-section">
                <div className="filter-label">Attachment type</div>
                <div className="chip-row">
                  {[['image','Images'],['pdf','PDF'],['document','Docs'],['media','Media']].map(([val, label]) => (
                    <button
                      key={val}
                      className={`chip${attachmentType === val ? ' active' : ''}`}
                      onClick={() => setAttachmentType(attachmentType === val ? null : val)}
                    >{label}</button>
                  ))}
                </div>
              </div>

              <div className="filter-section">
                <div className="filter-label">Sender domain</div>
                <DomainPicker domains={domains} selected={fromDomains} onChange={setFromDomains} />
              </div>

              <div className="filter-section">
                <div className="filter-label">Order</div>
                <div className="sort-row">
                  <button className={`sort-btn${sort === 'desc' ? ' active' : ''}`} onClick={() => setSort('desc')}>↓ Newest first</button>
                  <button className={`sort-btn${sort === 'asc' ? ' active' : ''}`} onClick={() => setSort('asc')}>↑ Oldest first</button>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <main className="main">
          {selected ? (
            <EmailDetail key={selected.id} email={selected} />
          ) : (
            <div className="empty-state">
              <div className="empty-state-glyph">✦</div>
              <p>Select a mail</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
