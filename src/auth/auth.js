import { Router } from 'express';
import crypto from 'crypto';

const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

export function createAuthConfig(env = process.env) {
  const enabled = env.ENABLE_AUTH === 'true';
  const allowedUsers = (env.ALLOWED_USERS || '')
    .split(',')
    .map(u => u.trim().toLowerCase())
    .filter(Boolean);

  if (enabled) {
    if (!env.SESSION_SECRET) {
      throw new Error('ENABLE_AUTH=true requires SESSION_SECRET to be set.');
    }
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      throw new Error('ENABLE_AUTH=true requires GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.');
    }
  }

  return {
    enabled,
    allowedUsers,
    clientId: env.GITHUB_CLIENT_ID || '',
    clientSecret: env.GITHUB_CLIENT_SECRET || '',
    sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    baseUrl: env.BASE_URL || 'http://localhost:3001',
  };
}

export function requireAuth(config) {
  return (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();

    const user = req.session?.user;
    if (!user) {
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      return res.redirect('/auth/login');
    }

    if (!config.allowedUsers.includes(user.username.toLowerCase())) {
      if (req.path.startsWith('/api/')) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return res.redirect('/auth/denied');
    }

    next();
  };
}

export function createAuthRoutes(config) {
  const router = Router();

  router.get('/login', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mailrewind - Sign In</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0d1117;color:#c9d1d9}
  .card{text-align:center;padding:2rem;border:1px solid #30363d;border-radius:8px;background:#161b22}
  h1{margin:0 0 1rem;font-size:1.4rem}
  a{display:inline-block;padding:.75rem 1.5rem;background:#238636;color:#fff;text-decoration:none;border-radius:6px;font-weight:600}
  a:hover{background:#2ea043}
</style>
</head>
<body><div class="card"><h1>Mailrewind</h1><a href="/auth/github">Sign in with GitHub</a></div></body>
</html>`);
  });

  router.get('/denied', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.status(403).send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Access Denied</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0d1117;color:#c9d1d9}
  .card{text-align:center;padding:2rem;border:1px solid #30363d;border-radius:8px;background:#161b22}
  h1{margin:0 0 .5rem;font-size:1.4rem;color:#f85149}
  a{color:#58a6ff}
</style>
</head>
<body><div class="card"><h1>Access Denied</h1><p>Your GitHub account is not on the allowed list.</p><a href="/auth/logout">Sign out</a></div></body>
</html>`);
  });

  router.get('/github', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = { value: state, created: Date.now() };
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: `${config.baseUrl}/auth/callback`,
      scope: 'read:user',
      state,
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
  });

  router.get('/callback', async (req, res) => {
    try {
      const { code, state } = req.query;
      const stored = req.session.oauthState;
      if (!code || !state || !stored || state !== stored.value) {
        return res.redirect('/auth/login');
      }
      if (Date.now() - stored.created > OAUTH_STATE_MAX_AGE_MS) {
        return res.redirect('/auth/login');
      }
      delete req.session.oauthState;

      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        return res.redirect('/auth/login');
      }

      const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'Mailrewind' },
      });
      const userData = await userRes.json();
      const username = (userData.login || '').toLowerCase();

      if (!config.allowedUsers.includes(username)) {
        return res.redirect('/auth/denied');
      }

      req.session.regenerate((err) => {
        if (err) return res.redirect('/auth/login');
        req.session.user = { username, avatar: userData.avatar_url };
        req.session.save(() => res.redirect('/'));
      });
    } catch {
      res.redirect('/auth/login');
    }
  });

  router.get('/me', (req, res) => {
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json(req.session.user);
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('mailrewind.sid');
      res.json({ ok: true });
    });
  });

  return router;
}
