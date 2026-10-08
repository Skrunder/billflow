# SKR's Bill Calendar

A self-hosted bill and event calendar for home labs. Track one-time and recurring bills, birthdays, paydays and appointments, see everything on a calendar, mark each occurrence paid or completed on its own, and get reminders. It installs as a mobile/desktop app (PWA) and runs entirely in Docker.

```
docker compose up -d
```

---

## Features

| | |
|---|---|
| **Bills** | One-time or recurring (daily / weekly / monthly / yearly / any custom interval such as every 2 weeks, weekly on Mon + Thu, ending on a date or after N times). Amount, category, notes, description, due time, and **manual / auto-pay / scheduled auto-pay** payment methods. |
| **Independent occurrences** | Every due date is its **own database row** with its own status (Pending · Completed · Overdue · Skipped), completion date, amount paid, confirmation number, notes and **audit history**. Paying January never touches February. |
| **Events** | Birthdays, paydays, meetings, renewals and more, all-day or timed, recurring or not. Statuses: Upcoming · Completed · Cancelled. Events are informational only and **never count toward money totals**. |
| **Calendar** | Month, week, day and agenda views (FullCalendar), filtered to bills only, events only, or both. Overdue items are flagged and completed ones struck through. |
| **Dashboard** | Due today, this week and this month, overdue bills, upcoming events, and recently completed bills and events, with paid/remaining totals. |
| **Reminders** | At the time, 15 min, 1 hour, 1, 3 or 7 days before, or any custom schedule. Delivered in-app, by email (SMTP) or by Web Push to phones and desktops. |
| **Time zones** | Each user picks a time zone. Instants are stored in UTC and calendar dates stay as the user's local day, so DST is handled correctly. |
| **Multi-user** | Separate accounts with isolated data, categories and settings. The first account becomes the admin. Registration can be closed. |
| **Security** | bcrypt passwords, short-lived JWT access tokens held in memory, rotating httpOnly refresh cookies with reuse detection, CSRF protection, rate limiting, account lockout, strict CSP and security headers, non-root read-only containers. |
| **PWA** | Installable on Android, iPhone/iPad and desktop. Previously viewed data stays readable offline. Supports push notifications and light/dark mode. |
| **Android app** | Standalone APK that needs no server: data in SQLite on the phone, reminders as Android notifications, backup/restore to a file. See [docs/ANDROID.md](docs/ANDROID.md). |
| **Operations** | Health checks, structured JSON logs, automatic migrations, startup config validation, a backup sidecar, backup/restore scripts, an admin CLI and JSON data export. |

## Quick start

Requirements: Docker with the Compose plugin, on any Linux host, NAS or VM.

```bash
git clone https://github.com/<you>/skr-bill-calendar.git
cd skr-bill-calendar
cp .env.example .env
# Edit .env and set POSTGRES_PASSWORD (e.g. output of: openssl rand -hex 24)
docker compose up -d
```

Open **http://&lt;server-ip&gt;:8080**. The first account you create becomes the administrator.

> The first start builds the images, which takes a few minutes. Later starts are instant.

### Enable automatic daily backups (recommended)

```bash
docker compose --profile backup up -d
```

Dumps are written to `./backups` and kept for 14 days. See [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md).

### Put it behind HTTPS

Point your reverse proxy (Nginx Proxy Manager, Traefik, Cloudflare Tunnel, Caddy, plain nginx) at `http://<host>:8080`, then set `APP_URL=https://bills.example.com` in `.env` and run `docker compose up -d`. Examples are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#reverse-proxies).

## Documentation

| Topic | Document |
|---|---|
| System, auth, frontend and Docker architecture; folder structure | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Database schema, relationships, occurrence model, migrations | [docs/DATABASE.md](docs/DATABASE.md) |
| REST API reference | [docs/API.md](docs/API.md) |
| Every environment variable | [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) |
| Deployment: Unraid, TrueNAS SCALE, Synology, Portainer, Proxmox, Linux, reverse proxies | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Backups and restores | [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) |
| Updating and upgrading | [docs/UPGRADING.md](docs/UPGRADING.md) |
| UI wireframes | [docs/WIREFRAMES.md](docs/WIREFRAMES.md) |
| Roadmap and milestones | [docs/ROADMAP.md](docs/ROADMAP.md) |

## Administration

The backend image ships a small CLI:

```bash
docker compose exec backend node dist/cli.js list-users
docker compose exec backend node dist/cli.js reset-password you@example.com          # prints a random password
docker compose exec backend node dist/cli.js reset-password you@example.com 'NewPass!'
docker compose exec backend node dist/cli.js set-role friend@example.com ADMIN
docker compose exec backend node dist/cli.js disable-user someone@example.com
docker compose exec backend node dist/cli.js unlock-user you@example.com
docker compose exec backend node dist/cli.js migrate-status                          # applied DB migrations
docker compose exec backend node dist/cli.js generate-vapid-keys                      # for push notifications
```

Without SMTP configured, `reset-password` is how a forgotten password gets reset.

## Development

The repo is an npm-workspaces monorepo:

| Package | Path | What it is |
|---|---|---|
| `@skr/core` | `packages/core` | Shared business rules: recurrence, time zones, scheduling, statuses, money, reminders, validation, API types. Used by every app. |
| backend | `backend` | Express + Prisma REST API |
| frontend | `frontend` | React PWA |

```bash
npm install                      # once, at the repo root (installs every workspace)

# Database for development and tests
docker run -d --name billcal-dev-db -e POSTGRES_USER=dev -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=billcal -p 5432:5432 postgres:16-alpine

# Backend (http://localhost:4000)
cd backend
export DATABASE_URL=postgresql://dev:dev@localhost:5432/billcal NODE_ENV=development LOG_PRETTY=true
npx prisma migrate deploy
npm run dev                      # builds @skr/core first

# Frontend (http://localhost:5173, proxies /api to :4000)
cd frontend && npm run dev

# Standalone app (no server, data kept in the browser): http://localhost:5173
cd frontend && npm run dev:standalone        # build: npm run build:standalone → dist-standalone/

# Editing packages/core? Rebuild it on change in another terminal:
npm run dev -w @skr/core
```

Tests:

```bash
npm test -w @skr/core                                                              # shared rules
TEST_DATABASE_URL=postgresql://dev:dev@localhost:5432/billcal_test npm test -w backend  # API integration
npm test                                                                           # everything
```

The backend integration suite proves the core guarantees. Completing, skipping or reopening one occurrence never changes another, each occurrence keeps its own history, template edits preserve completed occurrences, users cannot see each other's data, and refresh-token rotation and CSRF behave as designed.

Docker images are built from the **repository root** (`docker build -f backend/Dockerfile .`), because both apps include `packages/core`.

## Tech stack

React 18 · TypeScript · Tailwind CSS · FullCalendar · TanStack Query · Vite PWA, on Node.js 22 · Express 5 · Prisma 6 · PostgreSQL 16, served by nginx (unprivileged) in Docker Compose.

## License

[MIT](LICENSE)
