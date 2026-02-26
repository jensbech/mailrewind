import { useState, useEffect } from 'react';
import axios from 'axios';
import EmailList from './components/EmailList';
import EmailDetail from './components/EmailDetail';
import './App.css';

export default function App() {
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await axios.get('/api/stats');
        setStats(res.data);
      } catch (err) {
        console.error('Failed to fetch stats:', err);
      }
    };
    fetchStats();
  }, []);

  const handleSearch = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.get('/api/search', { params: { q: search } });
      setEmails(res.data);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadAll = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/emails?limit=100');
      setEmails(res.data);
    } catch (err) {
      console.error('Load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <div className="sidebar">
        <h1>📧 Email Browser</h1>

        {stats && (
          <div className="stats">
            <p><strong>{stats.total}</strong> emails</p>
            <p>{new Date(stats.oldest).getFullYear()} - {new Date(stats.newest).getFullYear()}</p>
          </div>
        )}

        <form onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="Search emails..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={loading}
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        <button onClick={handleLoadAll} disabled={loading} className="load-btn">
          Load Recent Emails
        </button>

        <EmailList emails={emails} selected={selectedEmail} onSelect={setSelectedEmail} />
      </div>

      <div className="main">
        {selectedEmail ? (
          <EmailDetail email={selectedEmail} />
        ) : (
          <div className="empty">
            <p>Select an email to view</p>
          </div>
        )}
      </div>
    </div>
  );
}
