# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is
SKR's Bill Calendar: a self-hosted bill and event calendar. npm-workspaces monorepo:
- `packages/core` (`@skr/core`): shared business rules and API types. **Put anything that must behave identically on server, web and Android here.**
- `backend`: Express 5 + Prisma 6 + PostgreSQL 16 API (`/api/v1`)
- `frontend`: React 18 PWA (Vite, Tailwind, FullCalendar, TanStack Query)
- Android app: **planned**. See `docs/ANDROID_PLAN.md` for milestones and current status.

## Non-negotiable rules
1. **Every change must reach every app.** When fixing a bug or adding a feature, update the backend, the web app *and* the Android app (once it exists), plus `@skr/core` and sync when the data shape changes. Bump the app version and rebuild/test the APK. Don't wait to be asked.
2. **Occurrences are independent.** Bill/event templates and their occurrences are separate rows. Status changes are single-row updates by primary key, with an audit-log entry. Template edits only reconcile *untouched* (PENDING/UPCOMING, `isModified=false`, not past) occurrences. Never bulk-update occurrence status by template.
3. **Dates:** calendar days are local `YYYY-MM-DD` (`DATE` columns); instants are UTC. OVERDUE is derived, never stored.
4. **Money** is a decimal string at boundaries and summed in integer cents (`@skr/core` money helpers).
5. Migrations are forward-only and additive (see `docs/DATABASE.md`). Never edit a shipped migration.
6. Pin dependency versions exactly.

## Commands
```bash
npm install                                   # repo root, once
npm run build -w @skr/core                    # rebuild core after editing it (backend/frontend scripts do this automatically)
npm test -w @skr/core
TEST_DATABASE_URL=postgresql://test:test@localhost:55432/billcal_test npm test -w backend
#   test DB: docker run -d --rm --name skr-test-db -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=billcal_test -p 55432:5432 postgres:16-alpine
#   then:    (cd backend && DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy)
npm run typecheck -w backend && npm run typecheck -w frontend
npm run build -w frontend
docker compose build && docker compose up -d   # images build from the repo root
```

## Verification expectations
After changes: typecheck all workspaces, run the core and backend test suites, and for UI changes build the frontend and check it in a browser (desktop and ~390 px mobile width, light and dark). For Docker or entrypoint changes, build the images and smoke-test the stack.
