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

## Stack

Node 20, Express, SQLite, Vite + React
