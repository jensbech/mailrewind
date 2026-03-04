import session from 'express-session';

const Store = session.Store;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

export class SqliteStore extends Store {
  constructor(db) {
    super();
    this.db = db;
    this._cleanupTimer = setInterval(() => this._clearExpired(), CLEANUP_INTERVAL_MS);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  _clearExpired() {
    this.db.run('DELETE FROM sessions WHERE expired <= ?', [Date.now()], () => {});
  }

  get(sid, cb) {
    this.db.get(
      'SELECT sess FROM sessions WHERE sid = ? AND expired > ?',
      [sid, Date.now()],
      (err, row) => {
        if (err) return cb(err);
        if (!row) return cb(null, null);
        try {
          cb(null, JSON.parse(row.sess));
        } catch (e) {
          cb(e);
        }
      }
    );
  }

  set(sid, sess, cb) {
    const maxAge = sess.cookie?.maxAge || 86400000;
    const expired = Date.now() + maxAge;
    this.db.run(
      'INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)',
      [sid, JSON.stringify(sess), expired],
      (err) => cb(err)
    );
  }

  destroy(sid, cb) {
    this.db.run('DELETE FROM sessions WHERE sid = ?', [sid], (err) => cb(err));
  }

  touch(sid, sess, cb) {
    const maxAge = sess.cookie?.maxAge || 86400000;
    const expired = Date.now() + maxAge;
    this.db.run(
      'UPDATE sessions SET expired = ? WHERE sid = ?',
      [expired, sid],
      (err) => cb(err)
    );
  }
}
