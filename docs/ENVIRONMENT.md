# Environment variables

All configuration comes from environment variables, normally set in the `.env` file next to `docker-compose.yml`. Portainer, Unraid, TrueNAS and Synology users can enter the same variables in their UI. The backend validates everything at startup and **refuses to start with a clear message** if a value is invalid.

> **Quoting:** Docker Compose expands `$` inside `.env` values. If a password contains `$`, wrap it in single quotes (`POSTGRES_PASSWORD='pa$$word'`) or avoid `$`. `openssl rand -hex 24` produces safe values.

## Required

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | Database password, used by both the database and the backend. Any characters are fine (the backend URL-encodes it), subject to the `$` quoting note above. **It is fixed when the database volume is first created.** Changing it later requires `ALTER USER` inside PostgreSQL. |

## Public URL, networking, proxy

| Variable | Default | Description |
|---|---|---|
| `APP_URL` | `http://localhost:8080` | URL users open. Used in emails, and `https://` turns on Secure cookies. |
| `APP_PORT` | `8080` | Host port for the web UI. |
| `APP_BIND_ADDRESS` | `0.0.0.0` | Host interface. Use `127.0.0.1` when only a local reverse proxy should reach it. |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Which hops may set `X-Forwarded-*` (Express `trust proxy`). The default trusts private networks. Can be `true`, a hop count, or a list of IPs/CIDRs. |
| `COOKIE_SECURE` | `auto` | `auto` = Secure cookies when `APP_URL` is https. Force with `true` / `false`. |

## Database

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `billcalendar` | |
| `POSTGRES_DB` | `billcalendar` | |
| `DB_DATA_PATH` | named volume `db_data` | Optional host path for PostgreSQL data (e.g. `/mnt/user/appdata/skr-bill-calendar/postgres`). |
| `APP_DATA_PATH` | named volume `backend_data` | Optional host path for backend data. Must be writable by uid **1000**. |
| `DATABASE_URL` | *(derived)* | Advanced: overrides the `POSTGRES_*` values to use an external PostgreSQL. |

## Security & accounts

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | auto-generated | ≥ 32 chars. Empty = generated on first start and stored in `/app/data/secrets/jwt_secret`. Back up the data volume or set it explicitly. Changing it signs everyone out. |
| `ACCESS_TOKEN_TTL_MINUTES` | `15` | Access-token lifetime (1–1440). |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | How long "stay signed in" lasts (1–365). |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost (10–15). |
| `ALLOW_REGISTRATION` | `true` | Allow new sign-ups. The first account can always be created and becomes admin. |
| `REQUIRE_EMAIL_VERIFICATION` | `false` | Require a verified email before sign-in. Only effective when SMTP is set. |
| `RATE_LIMIT_WINDOW_MINUTES` | `15` | Rate-limit window. |
| `RATE_LIMIT_MAX` | `1000` | API requests per IP per window. |
| `AUTH_RATE_LIMIT_MAX` | `20` | Login/register/reset attempts per IP per window. |

## Behaviour

| Variable | Default | Description |
|---|---|---|
| `DEFAULT_TIMEZONE` | `UTC` | Timezone for new accounts when the browser's can't be detected. |
| `OCCURRENCE_HORIZON_DAYS` | `400` | How far ahead recurring occurrences are materialised (31–3650). The calendar extends further on demand. |
| `LOG_LEVEL` | `info` | `fatal` · `error` · `warn` · `info` · `debug` · `trace` · `silent` |
| `RUN_MIGRATIONS` | `true` | Apply database migrations on container start. |
| `SCHEDULER_ENABLED` | `true` | Run background jobs (reminders, auto-pay). Disable only on extra API replicas. |

## Email (optional)

Enables password-reset emails, email verification and email reminders.

| Variable | Default | Description |
|---|---|---|
| `SMTP_HOST` | – | e.g. `smtp.gmail.com`, `smtp.fastmail.com`, `smtp.sendgrid.net` |
| `SMTP_PORT` | `587` | |
| `SMTP_SECURE` | `false` | `true` for port 465 (implicit TLS); `false` uses STARTTLS. |
| `SMTP_USER` / `SMTP_PASSWORD` | – | Use an app password for Gmail and similar. |
| `SMTP_FROM` | `BillFlow <no-reply@localhost>` | Sender address. |

## Web Push (optional)

| Variable | Default | Description |
|---|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | – | Generate with `docker compose run --rm app node dist/cli.js generate-vapid-keys`. Set both or neither. |
| `VAPID_SUBJECT` | `mailto:admin@localhost` | Contact URI sent to push services. |

Browsers only allow push on **HTTPS** origins (or `localhost`). On iPhone/iPad, push works in the installed Home Screen app (iOS 16.4+).

## Backups (optional `backup` profile)

| Variable | Default | Description |
|---|---|---|
| `BACKUP_PATH` | `./backups` | Host directory for dumps. |
| `BACKUP_INTERVAL_HOURS` | `24` | |
| `BACKUP_KEEP_DAYS` | `14` | Older dumps are deleted. |

## Image

| Variable | Default | Description |
|---|---|---|
| `BILLFLOW_IMAGE` | `skrunder/billflow:latest` | The app image (API + web app), pulled from Docker Hub (published for every release, amd64 + arm64). Pin a release with `:1.6` or `:1.6.0`, or use `ghcr.io/skrunder/billflow:latest`. `docker compose up -d --build` builds it from the repository instead. Before 1.6.0 there were two images, set with `BACKEND_IMAGE` and `FRONTEND_IMAGE`; those are no longer used. |

## Inside the container (advanced / development)

`NODE_ENV`, `HOST` (`0.0.0.0`), `PORT` (`8080` in the image, `4000` in development), `DATA_DIR` (`/app/data`), `WEB_DIR` (`/app/web` in the image: the built web app the API serves; unset in development, where Vite serves it), `LOG_PRETTY` (`false`), `CORS_ORIGINS` (comma-separated, only for serving the web app from a different origin), `POSTGRES_HOST` (`db`), `POSTGRES_PORT` (`5432`).
