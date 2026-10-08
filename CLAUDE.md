# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is
SKR's Bill Calendar: a self-hosted bill and event calendar. npm-workspaces monorepo:
- `packages/core` (`@skr/core`): shared business rules and API types. **Put anything that must behave identically on server, web and Android here.**
- `backend`: Express 5 + Prisma 6 + PostgreSQL 16 API (`/api/v1`)
- `frontend`: React 18 PWA (Vite, Tailwind, FullCalendar, TanStack Query)
- Android app: `frontend/android` (Capacitor 8), the standalone build with native SQLite and phone notifications. Building/installing: `docs/ANDROID.md`; sync milestones: `docs/ANDROID_PLAN.md`.

## Non-negotiable rules
1. **Every change must reach every app.** When fixing a bug or adding a feature, update the backend, the web app *and* the Android app (once it exists), plus `@skr/core` and sync when the data shape changes. Bump the version in every `package.json` (root, core, backend, frontend, plus the `@skr/core` dependency pins and `package-lock.json`), then rebuild and test the APK. Don't wait to be asked.
2. **Occurrences are independent.** Bill/event templates and their occurrences are separate rows. Status changes are single-row updates by primary key, with an audit-log entry. Template edits only reconcile *untouched* (PENDING/UPCOMING, `isModified=false`, not past) occurrences. Never bulk-update occurrence status by template.
3. **Dates:** calendar days are local `YYYY-MM-DD` (`DATE` columns); instants are UTC. OVERDUE is derived, never stored.
4. **Money** is a decimal string at boundaries and summed in integer cents (`@skr/core` money helpers).
5. Migrations are forward-only and additive (see `docs/DATABASE.md`). Never edit a shipped migration.
6. Pin dependency versions exactly, and don't adopt any release (direct or transitive) that is less than two weeks old. `npm audit --omit=dev` must stay at 0. Root `package.json` `overrides` pin transitive packages for security (`deepmerge-ts`) or the two-week rule (`chai`, `std-env`, `tinyrainbow`); review them whenever the parent package is upgraded. npm may ignore an override for an existing lockfile entry, so verify with `npm ls <pkg>`.
7. **Screens never call the server directly.** UI code uses the hooks in `frontend/src/api/hooks.ts`, which go through `DataRepository` (`frontend/src/data/`). New data operations must be added to the interface *and* to every implementation, plus the contract test in `frontend/src/data/remote.test.ts`. Server-only account features belong in `frontend/src/data/account.ts`.
8. Buttons inside forms must have an explicit `type`. A bare `<button>` submits the form.
9. **Server and device engines must stay in step.** Any change to how the API behaves (`backend/src/modules`, `backend/src/services`) needs the same change in the on-device engine (`frontend/src/data/local/engine.ts`, plus a new step in `schema.ts` for data-shape changes), with tests on both sides. Shared rules go in `@skr/core`, not into either engine.
10. **Sync** (`/api/v1/sync`, `packages/core/src/sync.ts`): new columns on synced tables must be added to the sync record schema, the server mappers (`backend/src/services/sync.mappers.ts`) and the phone. API responses must never include `syncXid` (it's a BigInt).

## Commands
```bash
npm install                                   # repo root, once
npm run build -w @skr/core                    # rebuild core after editing it (backend/frontend scripts do this automatically)
npm test -w @skr/core
TEST_DATABASE_URL=postgresql://test:test@localhost:55432/billcal_test npm test -w backend
#   test DB: docker run -d --rm --name skr-test-db -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=billcal_test -p 55432:5432 postgres:16-alpine
#   then:    (cd backend && DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy)
npm run typecheck -w backend && npm run typecheck -w frontend
npm run build -w frontend                      # server-backed web app
npm run dev:standalone -w frontend             # standalone app on the on-device engine (browser)
docker compose build && docker compose up -d   # images build from the repo root
scripts/build-apk.sh [debug]                  # Android APK → dist-apk/ (Docker; signing key: docs/ANDROID.md)
```

## Verification expectations
After changes: typecheck all workspaces, run the core and backend test suites, and for UI changes build the frontend and check it in a browser (desktop and ~390 px mobile width, light and dark). For Docker or entrypoint changes, build the images and smoke-test the stack. For changes that reach the Android app, build the debug APK and check it in the emulator (`docs/ANDROID.md`, Testing).
