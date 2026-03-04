# Security Fixes — Progress Tracker

Plan file: `docs/plans/2026-03-04-security-fixes.md`

## Status as of 2026-03-04

### Completed

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `941df64` | Install helmet (backend) + dompurify (frontend) |
| Task 2 | `941df64`, `b3df2df` | Fix path traversal in `/api/import/start` — validate path is within filesDir |
| Task 3 | `aca3f81`, `19a65fe` | Remove absolute server paths from `/api/files` response; client uses `f.name` |
| Task 4 | `97e933c` | Sanitize HTML email bodies with DOMPurify to prevent stored XSS |

### Remaining

| Task | Description |
|------|-------------|
| Task 5 | Remove `cors()`, add `helmet({ contentSecurityPolicy: false })` to app.js; `npm uninstall cors` |
| Task 6 | Warn in `src/auth/auth.js` when `ENABLE_AUTH=true` but `SESSION_SECRET` not set |
| Task 7 | Warn in `src/server.js` at startup when auth is disabled |
| Task 8 | Add `RUN chown -R node:node /app` + `USER node` to Dockerfile |
| Task 9 | Run full `npm test` + `npm run build` to verify everything |

## To Resume

Run: `npm test` to confirm 185 tests pass on current HEAD (`97e933c`), then continue from Task 5.
