# Security Fixes — Progress Tracker

Plan file: `docs/plans/2026-03-04-security-fixes.md`

## Status as of 2026-03-04

### Completed

| Task | Description |
|------|-------------|
| Task 1 | Install helmet (backend) + dompurify (frontend) |
| Task 2 | Fix path traversal in `/api/import/start` — validate path is within filesDir |
| Task 3 | Remove absolute server paths from `/api/files` response; client uses `f.name` |
| Task 4 | Sanitize HTML email bodies with DOMPurify to prevent stored XSS |
| Task 5 | Remove `cors()`, add `helmet({ contentSecurityPolicy: false })`, uninstall cors |
| Task 6 | Warn in `src/auth/auth.js` when `ENABLE_AUTH=true` but `SESSION_SECRET` not set |
| Task 7 | Warn in `src/server.js` at startup when auth is disabled |
| Task 8 | Add `RUN chown -R node:node /app` + `USER node` to Dockerfile |
| Task 9 | Full test suite (185 pass, 0 fail) + client build verified |

All tasks complete.
