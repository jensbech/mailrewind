import { useState, useRef, useEffect } from 'react';

export default function DomainPicker({ domains, selected, onChange }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const lowerSearch = search.toLowerCase().trim();

  const suggestions = domains.filter(({ domain }) =>
    lowerSearch === '' || domain.includes(lowerSearch)
  );

  const canAddCustom = lowerSearch.length > 2 &&
    lowerSearch.includes('.') &&
    !domains.some(d => d.domain === lowerSearch) &&
    !selected.includes(lowerSearch);

  function toggle(domain) {
    if (selected.includes(domain)) {
      onChange(selected.filter(d => d !== domain));
    } else {
      onChange([...selected, domain]);
      setSearch('');
    }
  }

  function addCustom() {
    if (canAddCustom && !selected.includes(lowerSearch)) {
      onChange([...selected, lowerSearch]);
      setSearch('');
    }
  }

  function remove(domain) {
    onChange(selected.filter(d => d !== domain));
  }

  function handleKeyDown(e) {
    if (e.key === 'Backspace' && search === '' && selected.length > 0) {
      onChange(selected.slice(0, -1));
    } else if (e.key === 'Enter' && search) {
      e.preventDefault();
      const first = suggestions.find(d => !selected.includes(d.domain));
      if (first) toggle(first.domain);
      else if (canAddCustom) addCustom();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const showDropdown = open && (suggestions.length > 0 || canAddCustom);

  return (
    <div className="domain-picker" ref={ref}>
      <div
        className={`domain-picker-input${open ? ' focused' : ''}`}
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {selected.map(domain => (
          <span key={domain} className="domain-picker-tag">
            {domain}
            <button
              className="domain-picker-tag-remove"
              onMouseDown={e => { e.preventDefault(); remove(domain); }}
              tabIndex={-1}
            >×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="domain-picker-text"
          placeholder={selected.length === 0 ? 'type to search…' : ''}
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
      </div>

      {showDropdown && (
        <div className="domain-picker-dropdown">
          {suggestions.map(({ domain, count }) => {
            const isSelected = selected.includes(domain);
            return (
              <button
                key={domain}
                className={`domain-picker-item${isSelected ? ' selected' : ''}`}
                onMouseDown={e => { e.preventDefault(); toggle(domain); }}
              >
                <span className="domain-picker-item-label">{domain}</span>
                <span className="domain-picker-item-right">
                  <span className="domain-picker-item-count">{count.toLocaleString()}</span>
                  {isSelected && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5"/>
                    </svg>
                  )}
                </span>
              </button>
            );
          })}
          {canAddCustom && (
            <button
              className="domain-picker-item domain-picker-item--add"
              onMouseDown={e => { e.preventDefault(); addCustom(); }}
            >
              <span>Add "{lowerSearch}"</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
