import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { unlink } from 'fs/promises';
import { initializeDatabase } from '../src/db/database.js';
import { SqliteStore } from '../src/auth/sessionStore.js';

const TEST_DB = 'test/test-sessions.db';

describe('SqliteStore', () => {
  let db;
  let store;

  before(async () => {
    try { await unlink(TEST_DB); } catch {}
    db = await initializeDatabase(TEST_DB);
    store = new SqliteStore(db);
  });

  after(async () => {
    db.close();
    try { await unlink(TEST_DB); } catch {}
  });

  it('set and get a session', (_, done) => {
    const sess = { cookie: { maxAge: 60000 }, user: 'alice' };
    store.set('sid1', sess, (err) => {
      assert.ifError(err);
      store.get('sid1', (err, result) => {
        assert.ifError(err);
        assert.deepStrictEqual(result.user, 'alice');
        done();
      });
    });
  });

  it('get returns null for unknown sid', (_, done) => {
    store.get('unknown', (err, result) => {
      assert.ifError(err);
      assert.strictEqual(result, null);
      done();
    });
  });

  it('destroy removes a session', (_, done) => {
    const sess = { cookie: { maxAge: 60000 }, user: 'bob' };
    store.set('sid2', sess, (err) => {
      assert.ifError(err);
      store.destroy('sid2', (err) => {
        assert.ifError(err);
        store.get('sid2', (err, result) => {
          assert.ifError(err);
          assert.strictEqual(result, null);
          done();
        });
      });
    });
  });

  it('get returns null for expired session', (_, done) => {
    const sess = { cookie: { maxAge: -1000 }, user: 'expired' };
    store.set('sid3', sess, (err) => {
      assert.ifError(err);
      store.get('sid3', (err, result) => {
        assert.ifError(err);
        assert.strictEqual(result, null);
        done();
      });
    });
  });

  it('touch updates expiration', (_, done) => {
    const sess = { cookie: { maxAge: 60000 }, user: 'carol' };
    store.set('sid4', sess, (err) => {
      assert.ifError(err);
      const updated = { cookie: { maxAge: 120000 }, user: 'carol' };
      store.touch('sid4', updated, (err) => {
        assert.ifError(err);
        store.get('sid4', (err, result) => {
          assert.ifError(err);
          assert.strictEqual(result.user, 'carol');
          done();
        });
      });
    });
  });
});
