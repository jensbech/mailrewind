import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { unlink } from 'fs/promises';
import { createRequire } from 'module';
import { initializeDatabase } from '../src/db/database.js';
import { createAuthConfig, requireAuth, createAuthRoutes } from '../src/auth/auth.js';

const require = createRequire(import.meta.url);
const supertest = require('supertest');

import express from 'express';
import session from 'express-session';
import { SqliteStore } from '../src/auth/sessionStore.js';

const TEST_DB = 'test/test-auth.db';

describe('Auth', () => {
  let db;

  before(async () => {
    try { await unlink(TEST_DB); } catch {}
    db = await initializeDatabase(TEST_DB);
  });

  after(async () => {
    db.close();
    try { await unlink(TEST_DB); } catch {}
  });

  describe('createAuthConfig', () => {
    it('returns config from environment variables', () => {
      const env = {
        ENABLE_AUTH: 'true',
        ALLOWED_USERS: 'alice,bob',
        GITHUB_CLIENT_ID: 'cid',
        GITHUB_CLIENT_SECRET: 'csec',
        SESSION_SECRET: 'secret',
        BASE_URL: 'http://localhost:3001',
      };
      const config = createAuthConfig(env);
      assert.strictEqual(config.enabled, true);
      assert.deepStrictEqual(config.allowedUsers, ['alice', 'bob']);
      assert.strictEqual(config.clientId, 'cid');
      assert.strictEqual(config.clientSecret, 'csec');
    });

    it('returns enabled=false when ENABLE_AUTH is not true', () => {
      const config = createAuthConfig({});
      assert.strictEqual(config.enabled, false);
    });

    it('trims and lowercases usernames', () => {
      const env = { ENABLE_AUTH: 'true', ALLOWED_USERS: ' Alice , BOB ' };
      const config = createAuthConfig(env);
      assert.deepStrictEqual(config.allowedUsers, ['alice', 'bob']);
    });
  });

  describe('requireAuth middleware', () => {
    it('calls next() when session has valid user', () => {
      const config = { allowedUsers: ['alice'] };
      const mw = requireAuth(config);
      const req = { session: { user: { username: 'alice' } }, path: '/api/test' };
      let called = false;
      mw(req, {}, () => { called = true; });
      assert.ok(called);
    });

    it('returns 401 JSON for /api/ requests without session', () => {
      const config = { allowedUsers: ['alice'] };
      const mw = requireAuth(config);
      const req = { session: {}, path: '/api/test' };
      let status, body;
      const res = {
        status(s) { status = s; return this; },
        json(b) { body = b; },
      };
      mw(req, res, () => {});
      assert.strictEqual(status, 401);
      assert.deepStrictEqual(body, { error: 'Unauthorized' });
    });

    it('redirects non-API requests to /auth/login', () => {
      const config = { allowedUsers: ['alice'] };
      const mw = requireAuth(config);
      const req = { session: {}, path: '/some-page' };
      let redirected;
      const res = { redirect(url) { redirected = url; } };
      mw(req, res, () => {});
      assert.strictEqual(redirected, '/auth/login');
    });

    it('returns 403 when user is not in allowedUsers', () => {
      const config = { allowedUsers: ['alice'] };
      const mw = requireAuth(config);
      const req = { session: { user: { username: 'eve' } }, path: '/api/test' };
      let status, body;
      const res = {
        status(s) { status = s; return this; },
        json(b) { body = b; },
      };
      mw(req, res, () => {});
      assert.strictEqual(status, 403);
    });
  });

  describe('auth routes', () => {
    let app;

    before(() => {
      app = express();
      app.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: false,
        store: new SqliteStore(db),
      }));
      const config = {
        enabled: true,
        allowedUsers: ['alice'],
        clientId: 'test-cid',
        clientSecret: 'test-csec',
        sessionSecret: 'test-secret',
        baseUrl: 'http://localhost:3001',
      };
      app.use('/auth', createAuthRoutes(config));
    });

    it('GET /auth/me returns 401 when not logged in', async () => {
      const res = await supertest(app).get('/auth/me');
      assert.strictEqual(res.status, 401);
    });

    it('GET /auth/github redirects to GitHub OAuth', async () => {
      const res = await supertest(app).get('/auth/github');
      assert.strictEqual(res.status, 302);
      assert.ok(res.headers.location.startsWith('https://github.com/login/oauth/authorize'));
      assert.ok(res.headers.location.includes('client_id=test-cid'));
    });

    it('GET /auth/login returns the login page HTML', async () => {
      const res = await supertest(app).get('/auth/login');
      assert.strictEqual(res.status, 200);
      assert.ok(res.text.includes('Sign in with GitHub'));
    });

    it('GET /auth/logout destroys session and redirects', async () => {
      const res = await supertest(app).get('/auth/logout');
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.location, '/auth/login');
    });
  });
});
