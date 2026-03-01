import { useState, useRef, useEffect } from 'react';

export default function YearPicker({ years, value, onChange, afterValue, beforeValue, onAfterChange, onBeforeChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function toggle(year) {
    if (value.includes(year)) {
      onChange(value.filter(y => y !== year));
    } else {
      onChange([...value, year]);
    }
  }

  const label = (() => {
    const parts = [];
    if (afterValue != null && beforeValue != null) parts.push(`${afterValue}–${beforeValue}`);
    else if (afterValue != null) parts.push(`After ${afterValue}`);
    else if (beforeValue != null) parts.push(`Before ${beforeValue}`);
    if (value.length === 1) parts.push(String(value[0]));
    else if (value.length > 1) parts.push(`${value.length} years`);
    return parts.length > 0 ? parts.join(' · ') : 'All years';
  })();

  const checkmark = (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  );

  return (
    <div className="year-picker" ref={ref}>
      <button
        className={`year-picker-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(v => !v)}
      >
        <span className="year-picker-value">{label}</span>
        <svg className={`year-picker-chevron${open ? ' open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>

      {open && (
        <div className="year-picker-dropdown">
          <div className="year-picker-thresholds">
            <label className="year-picker-threshold-row">
              <span className="year-picker-threshold-label">After</span>
              <input
                className="year-picker-threshold-input"
                type="number"
                placeholder="year"
                value={afterValue ?? ''}
                onMouseDown={e => e.stopPropagation()}
                onChange={e => {
                  const v = e.target.value;
                  onAfterChange(v === '' ? null : parseInt(v, 10));
                }}
              />
            </label>
            <label className="year-picker-threshold-row">
              <span className="year-picker-threshold-label">Before</span>
              <input
                className="year-picker-threshold-input"
                type="number"
                placeholder="year"
                value={beforeValue ?? ''}
                onMouseDown={e => e.stopPropagation()}
                onChange={e => {
                  const v = e.target.value;
                  onBeforeChange(v === '' ? null : parseInt(v, 10));
                }}
              />
            </label>
          </div>
          <div className="year-picker-divider" />
          <button
            className={`year-picker-item${value.length === 0 ? ' selected' : ''}`}
            onMouseDown={e => { e.preventDefault(); onChange([]); }}
          >
            <span className="year-picker-item-label">All years</span>
            {value.length === 0 && checkmark}
          </button>
          {years.map(({ year, count }) => {
            const selected = value.includes(year);
            return (
              <button
                key={year}
                className={`year-picker-item${selected ? ' selected' : ''}`}
                onMouseDown={e => { e.preventDefault(); toggle(year); }}
              >
                <span className="year-picker-item-label">{year}</span>
                <span className="year-picker-item-right">
                  <span className="year-picker-item-count">{count.toLocaleString()}</span>
                  {selected && checkmark}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
