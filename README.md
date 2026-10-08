<p align="center"><img src="frontend/public/icons/billflow-192.png" alt="BillFlow icon" width="96" height="96"></p>

<h1 align="center">BillFlow</h1>

*Formerly SKR's Bill Calendar.* See [CHANGELOG.md](CHANGELOG.md) for what's new.

A self-hosted bill and event calendar for home labs. Track one-time and recurring bills, birthdays, paydays and appointments, see everything on a calendar, mark each occurrence paid or completed on its own, and get reminders. It installs as a mobile/desktop app (PWA) and runs entirely in Docker.

```
docker compose up -d
```

---

## Download

| | |
|---|---|
| **Android app** | [**Download the latest APK**](https://github.com/Skrunder/billflow/releases/latest/download/billflow.apk) · [all releases](https://github.com/Skrunder/billflow/releases) |
| **Server and web app** | Docker image [`skrunder/billflow`](https://hub.docker.com/r/skrunder/billflow) (amd64 + arm64): `docker pull skrunder/billflow:latest`. Setup: [Quick start](#quick-start) |

Each release has the APK twice: `billflow.apk` (the link above always gets the newest) and `billflow-<version>.apk`. While this repository is private, you need to be signed in to GitHub to download. Installing and updating: [Android app](#android-app).

## Features

| | |
|---|---|
| **Bills** | One-time or recurring (daily / weekly / monthly / yearly / any custom interval such as every 2 weeks, weekly on Mon + Thu, ending on a date or after N times). Amount (or an **estimate**, with the actual amount entered when you pay), category, notes, description, due time, and **manual / auto-pay / scheduled auto-pay** payment methods. |
| **Independent occurrences** | Every due date is its **own database row** with its own status (Pending · Completed · Overdue · Skipped), completion date, amount paid, confirmation number, notes and **audit history**. Paying January never touches February. |
| **Events** | Birthdays, paydays, meetings, renewals and more, all-day or timed, recurring or not. Statuses: Upcoming · Completed · Cancelled. Events are informational only and **never count toward money totals**. |
| **Calendar** | Month, week, day and agenda views (FullCalendar), filtered to bills only, events only, or both. Overdue items are flagged and completed ones struck through. |
| **Dashboard** | Due today, this week and this month, overdue bills, upcoming events, and recently completed bills and events, with paid/remaining totals (paid bills count what was actually paid). |
| **Reminders** | At the time, 15 min, 1 hour, 1, 3 or 7 days before, or any custom schedule. Delivered in-app, by email (SMTP) or by Web Push to phones and desktops. |
| **Time zones** | Each user picks a time zone. Instants are stored in UTC and calendar dates stay as the user's local day, so DST is handled correctly. |
| **Multi-user** | Separate accounts with isolated data, categories and settings. The first account becomes the admin. Registration can be closed. |
| **Security** | bcrypt passwords, short-lived JWT access tokens held in memory, rotating httpOnly refresh cookies with reuse detection, CSRF protection, rate limiting, account lockout, strict CSP and security headers, non-root read-only containers. |
| **PWA** | Installable on Android, iPhone/iPad and desktop. Previously viewed data stays readable offline. Supports push notifications and light/dark mode. |
| **Android app** | Works without a server (data in SQLite on the phone, reminders as Android notifications, backup/restore to a file) and can optionally sync both ways with your server, offline-first. See [docs/ANDROID.md](docs/ANDROID.md). |
| **Operations** | Health checks, structured JSON logs, automatic migrations, startup config validation, a backup sidecar, backup/restore scripts, an admin CLI and JSON data export. |

## Quick start

Requirements: Docker with the Compose plugin, on any Linux host, NAS or VM (x86-64 or ARM64). Browsers: Chrome/Edge 111+, Safari 16.4+, Firefox 128+ (2023 or newer).

### Option 1: prebuilt image from Docker Hub (recommended)

The app is published on Docker Hub as **[`skrunder/billflow`](https://hub.docker.com/r/skrunder/billflow)**. Nothing is built on your server, so it starts in a minute.

```bash
git clone https://github.com/Skrunder/billflow.git    # for docker-compose.yml and .env.example
cd billflow
cp .env.example .env
# Edit .env:
#   POSTGRES_PASSWORD=<a long random string>        e.g. output of: openssl rand -hex 24
#   BILLFLOW_IMAGE=skrunder/billflow:latest
docker compose pull                                     # downloads skrunder/billflow and postgres
docker compose up -d
```

Open **http://&lt;server-ip&gt;:8080**. The first account you create becomes the administrator.

Only `docker-compose.yml` and `.env` are needed on the server: instead of cloning, you can copy those two files into an empty folder (`.env` made from `.env.example`). The repository is private, so `git clone` needs your GitHub login (`gh auth login` or a personal access token).

**Updating** to the newest release:

```bash
docker compose pull && docker compose up -d
```

**Choosing a version:** `skrunder/billflow:latest` always follows the newest release. To update only when you decide, use a version tag instead: `:1.6` (bug-fix updates of 1.6 only) or `:1.6.0` (exactly that release). All tags are listed on [Docker Hub](https://hub.docker.com/r/skrunder/billflow/tags). To fetch the image by hand: `docker pull skrunder/billflow:latest`.

The image is also published as `ghcr.io/skrunder/billflow` with the same tags. If the Docker Hub repository is private, run `docker login` on the server first.

### Option 2: build from source

```bash
git clone https://github.com/Skrunder/billflow.git
cd billflow
cp .env.example .env
# Edit .env and set POSTGRES_PASSWORD (e.g. output of: openssl rand -hex 24)
docker compose up -d                                    # builds the app image on first start
```

The first start builds the image, which takes a few minutes. To update: `git pull && docker compose up -d --build`.

### Server without internet

Pull or build the image on another machine and copy it over: `docker save skrunder/billflow:latest postgres:16-alpine | gzip > billflow-images.tar.gz` (or `billflow` instead of `skrunder/billflow:latest` if you built it). On the server, put `docker-compose.yml` and your `.env` in a folder, then run `docker load -i billflow-images.tar.gz` and `docker compose up -d`.

### Updating from 1.5 or older

Releases before 1.6.0 ran two containers (`backend` and `frontend`). The first time you update, run `docker compose up -d --remove-orphans` so the old containers are removed and free port 8080. Your data is kept. See [docs/UPGRADING.md](docs/UPGRADING.md).

## Using BillFlow

1. **Create your account.** The first account becomes the administrator. To stop strangers signing up afterwards, set `ALLOW_REGISTRATION=false` in `.env` and run `docker compose up -d`.
2. **Check Settings.** Under *Region & time*, set your time zone and currency. Under *Reminders*, choose the default reminders for new bills and events.
3. **Add bills.** Use **+** (or *Bills → New bill*). Give it a name, an amount and a due date, and turn on *Repeats* for recurring bills (monthly rent, a phone bill every 2 weeks, and so on). If you don't know the exact amount yet, tick **Amount is an estimate**.
4. **Pay a bill.** Tap the ✓ (**Mark paid**) on a bill's row, or open the occurrence and choose **Mark paid**. Enter the date and amount paid (for an estimate, enter the actual amount here), plus an optional confirmation number, then **Confirm payment**. Each month is its own record: paying, **Skip**ping or **Reopen**ing one never changes another. *Edit this occurrence* changes a single month without touching the rest.
5. **Add events.** Under *Events* you can add birthdays, paydays, appointments and renewals. Events show on the calendar and dashboard but never count toward money totals.
6. **Keep track.** The *Dashboard* shows what's due today, this week and this month, overdue bills and what's left to pay. The *Calendar* has month, week, day and list views, and can show bills, events or both. *Categories* lets you colour-code and group bills.
7. **Get reminders.** Due reminders appear under the bell icon. For email, configure SMTP in `.env`. For phone and desktop notifications, set up the push keys (`generate-vapid-keys`, see [Administration](#administration)), serve the app over HTTPS, then choose **Enable push on this device** in *Settings → Notifications*.
8. **Install it as an app.** In Chrome or Edge, use *Install app*. On iPhone or iPad, use *Share → Add to Home Screen*. The installed app opens like a native one and keeps showing your data when offline.
9. **Back up.** Turn on the backup sidecar (below) for the server. *Settings → Your data → Export all data (JSON)* downloads a copy of your own data at any time.

### Android app

The Android app works on its own, with no server needed. It keeps your data on the phone and sends reminders as Android notifications. [Download the latest APK](https://github.com/Skrunder/billflow/releases/latest/download/billflow.apk) on the phone and open it to install; Android asks once to allow installs from your browser or file manager. You can also build it yourself with `scripts/build-apk.sh` (see [docs/ANDROID.md](docs/ANDROID.md)). To update, install the newer APK over the old one; your data is kept.

To share data with your server and the web app, open *Settings → Server sync → Connect to server*, enter your server's address and sign in. If both sides already have data, choose **Combine both** or **Use the server's data**. Changes then sync both ways, and the app keeps working offline. Without a server, use *Settings → Backup* to save a backup file somewhere safe, such as Google Drive.

## Self-hosting extras

### Enable automatic daily backups (recommended)

```bash
docker compose --profile backup up -d
```

Dumps are written to `./backups` and kept for 14 days. See [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md).

### Put it behind HTTPS

Point your reverse proxy (Nginx Proxy Manager, Traefik, Cloudflare Tunnel, Caddy, plain nginx) at `http://<host>:8080`, then set `APP_URL=https://bills.example.com` in `.env` and run `docker compose up -d`. Examples are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#reverse-proxies).

## Configuration

### The `.env` file

All settings live in `.env`, next to `docker-compose.yml`. Start from `.env.example`. **Only `POSTGRES_PASSWORD` is required**; everything else has a working default. After editing `.env`, run `docker compose up -d` to apply it. Every variable is described in full in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

**Required**

| Variable | Default | What it does |
|---|---|---|
| `POSTGRES_PASSWORD` | *(none)* | Database password. Generate one with `openssl rand -hex 24`. It is fixed when the database is first created, so changing it later needs `ALTER USER` inside PostgreSQL. |

**Address and network**

| Variable | Default | What it does |
|---|---|---|
| `APP_URL` | `http://localhost:8080` | The address people open the app at. Used in emails; an `https://` address also turns on secure cookies. |
| `APP_PORT` | `8080` | Port on the host where the web app is published. |
| `APP_BIND_ADDRESS` | `0.0.0.0` | Network interface to publish on. `127.0.0.1` makes it reachable only through a reverse proxy on the same machine. |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Which proxies may pass on the visitor's real IP (`X-Forwarded-*`). The default trusts private networks. |
| `COOKIE_SECURE` | `auto` | `auto` uses secure cookies when `APP_URL` is https. Force with `true` or `false`. |

**Database and storage**

| Variable | Default | What it does |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_DB` | `billcalendar` | Database user and name. Set them before the first start only. |
| `DB_DATA_PATH` | Docker volume `db_data` | Store the database in a host folder instead, e.g. `/mnt/user/appdata/billflow/postgres` on Unraid. |
| `APP_DATA_PATH` | Docker volume `backend_data` | Host folder for the app's own data (the generated sign-in secret). Must be writable by user id 1000. |

**Accounts and security**

| Variable | Default | What it does |
|---|---|---|
| `ALLOW_REGISTRATION` | `true` | Let new people sign up. Set to `false` once your accounts exist; the first account can always be created. |
| `REQUIRE_EMAIL_VERIFICATION` | `false` | Require a confirmed email before sign-in (needs SMTP). |
| `JWT_SECRET` | generated | Secret that signs sign-ins. Leave empty to generate one on first start; changing it signs everyone out. |
| `ACCESS_TOKEN_TTL_MINUTES` | `15` | How long a sign-in token lasts before it is silently renewed. |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | How long "stay signed in" lasts. |
| `BCRYPT_ROUNDS` | `12` | Password hashing strength (10–15). |
| `RATE_LIMIT_WINDOW_MINUTES` / `RATE_LIMIT_MAX` | `15` / `1000` | API requests allowed per IP in each window. |
| `AUTH_RATE_LIMIT_MAX` | `20` | Sign-in, sign-up and password-reset attempts per IP in each window. |

**Behaviour**

| Variable | Default | What it does |
|---|---|---|
| `DEFAULT_TIMEZONE` | `UTC` | Time zone for new accounts when the browser's can't be detected. |
| `OCCURRENCE_HORIZON_DAYS` | `400` | How far ahead recurring bills and events are created. |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug`. |
| `RUN_MIGRATIONS` | `true` | Update the database structure automatically when a new version starts. |

**Email (optional):** password resets, verification and email reminders

| Variable | Default | What it does |
|---|---|---|
| `SMTP_HOST` | *(empty = email off)* | Mail server, e.g. `smtp.gmail.com`. |
| `SMTP_PORT` | `587` | |
| `SMTP_SECURE` | `false` | `true` for port 465; `false` for STARTTLS on 587. |
| `SMTP_USER` / `SMTP_PASSWORD` | | Login. Use an app password for Gmail and similar. |
| `SMTP_FROM` | `BillFlow <no-reply@localhost>` | Sender name and address. |

**Push notifications (optional):** reminders on phones and desktops

| Variable | Default | What it does |
|---|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | *(empty = push off)* | Generate a pair with `docker compose run --rm app node dist/cli.js generate-vapid-keys`. Push also needs HTTPS. |
| `VAPID_SUBJECT` | `mailto:admin@localhost` | Contact address given to the push services. |

**Backups (optional `backup` profile)**

| Variable | Default | What it does |
|---|---|---|
| `BACKUP_PATH` | `./backups` | Host folder for the database dumps. |
| `BACKUP_INTERVAL_HOURS` | `24` | How often to back up. |
| `BACKUP_KEEP_DAYS` | `14` | Older dumps are deleted. |

**Images (optional)**

| Variable | Default | What it does |
|---|---|---|
| `BILLFLOW_IMAGE` | `billflow:latest` | The app image. By default Compose builds it from this repo. To use the prebuilt image instead, see [Prebuilt images](#prebuilt-images). |

### Prebuilt images

BillFlow ships as **one image**, [`skrunder/billflow`](https://hub.docker.com/r/skrunder/billflow), with the API and the web app together (plus the official `postgres` image for the database). Every release is published to Docker Hub (and as `ghcr.io/skrunder/billflow`) for x86-64 and ARM64 (Raspberry Pi 4/5, ARM NAS), tagged with the version (`1.6.0`), the minor version (`1.6`) and `latest`. Set `BILLFLOW_IMAGE` in `.env` to use it, as in [Option 1](#option-1-prebuilt-image-from-docker-hub-recommended) of the Quick start.

### Docker Compose services

`docker-compose.yml` runs these containers on a private network. Only `app` publishes a port.

| Service | Image | What it does | Data |
|---|---|---|---|
| `app` | `billflow` (built from `Dockerfile`, or `BILLFLOW_IMAGE`) | The whole app: the web app, the API, reminders and auto-pay jobs. Runs database migrations on start. | `backend_data` volume (or `APP_DATA_PATH`) |
| `db` | `postgres:16-alpine` | PostgreSQL database. | `db_data` volume (or `DB_DATA_PATH`) |
| `backup` | `postgres:16-alpine` | **Optional** (`--profile backup`). Writes a `pg_dump` every `BACKUP_INTERVAL_HOURS` to `BACKUP_PATH`. | host folder |

Each service waits for the one before it to be healthy, restarts automatically (`unless-stopped`), and runs hardened: no privilege escalation, Linux capabilities dropped, logs capped at 5 × 10 MB, and the app with a read-only filesystem. The Compose project is named `skr-bill-calendar` and the app's volume `backend_data` (kept from before 1.6.0 so existing data stays attached).

Common commands:

```bash
docker compose up -d                       # start, or apply .env changes
docker compose --profile backup up -d      # start with automatic backups
docker compose ps                          # status and health
docker compose logs -f app                 # follow the app's logs
docker compose pull && docker compose up -d     # update when using registry images
git pull && docker compose up -d --build        # update when building from source
docker compose down                        # stop (data volumes are kept)
```

**Updating from 1.5 or older** (two containers, `backend` and `frontend`): run `docker compose up -d --remove-orphans` once, so the old containers are removed and free port 8080. (Forgot the flag? `docker compose up -d --remove-orphans --force-recreate` fixes it.) See [docs/UPGRADING.md](docs/UPGRADING.md).

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
docker compose exec app node dist/cli.js list-users
docker compose exec app node dist/cli.js reset-password you@example.com          # prints a random password
docker compose exec app node dist/cli.js reset-password you@example.com 'NewPass!'
docker compose exec app node dist/cli.js set-role friend@example.com ADMIN
docker compose exec app node dist/cli.js disable-user someone@example.com
docker compose exec app node dist/cli.js unlock-user you@example.com
docker compose exec app node dist/cli.js migrate-status                          # applied DB migrations
docker compose exec app node dist/cli.js generate-vapid-keys                      # for push notifications
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

The Docker image is built from the **repository root** (`docker build -t billflow .`). It contains the API and the built web app, which the API serves (`WEB_DIR`); in development, Vite serves the web app instead.

## Tech stack

React 18 · TypeScript · Tailwind CSS 4 · FullCalendar · TanStack Query · Vite PWA, on Node.js 22 · Express 5 · Prisma 6 · PostgreSQL 16, in Docker Compose (one app container plus PostgreSQL).

## License

[MIT](LICENSE)
