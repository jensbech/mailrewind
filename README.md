# Mailrewind

Browse and search your old email archives. Import `.mbox` files, then filter by year, sender domain, attachments, and more.

## Quick start

```
docker compose up --build
```

Open [localhost:3001](http://localhost:3001). Pick an `.mbox` file from the file picker and import it into a mailbox.

By default the container looks for `.mbox` files in `~/Downloads`. Change this with the `MBOX_DIR` env var:

```
MBOX_DIR=/path/to/mbox/files docker compose up --build
```

## What it does

- Parses `.mbox` files and indexes emails into SQLite
- Full-text search across subjects and bodies
- Filter by year, month, sender domain, attachment type
- View HTML emails rendered inline
- Download attachments

## Authentication

Optional GitHub OAuth authentication can be enabled to restrict access.

1. [Create a GitHub OAuth App](https://github.com/settings/developers) with the callback URL `https://yourdomain.com/auth/callback`
2. Copy `.env.example` to `.env` and fill in the values:

```
ENABLE_AUTH=true
ALLOWED_USERS=your-github-username
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
SESSION_SECRET=<openssl rand -hex 32>
BASE_URL=https://yourdomain.com
```

3. Run with `docker compose up --build`

When auth is disabled (default), the server binds to localhost only. When enabled, it binds to `0.0.0.0` and enforces HTTPS via redirect when behind a reverse proxy.

## Stack

Node 20, Express, SQLite, Vite + React
