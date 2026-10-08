# Updating & upgrading

The app follows **semantic versioning**:

* **Patch** (1.0.x): fixes only. Update any time.
* **Minor** (1.x.0): new features and additive database migrations. Safe in place.
* **Major** (x.0.0): may include breaking changes or destructive migrations. Read the release notes first.

Database migrations run automatically when the new app container starts. Your data volumes are never touched by an image update.

## Standard update (Docker Compose, built from source)

```bash
cd billflow
./scripts/backup.sh                 # 1. always back up first
git fetch --tags
git checkout v1.2.0                 # 2. or: git pull  (to follow main)
docker compose build --pull         # 3. rebuild the image with fresh base images
docker compose up -d --remove-orphans   # 4. recreate containers; migrations apply on start
docker compose logs -f app          # 5. watch for "database schema is up to date"
```

Compare `.env.example` with your `.env` after updating and add any new variables you want. New variables always have safe defaults.

## Using prebuilt images

If you set `BILLFLOW_IMAGE` to the published image (`skrunder/billflow` on Docker Hub, or `ghcr.io/skrunder/billflow`; every release, amd64 + arm64):

```bash
./scripts/backup.sh
docker compose pull
docker compose up -d --remove-orphans
```

Pin a version tag (`:1.6.0`) rather than `:latest` if you want updates to happen only when you choose.

## Platform notes

* **Portainer:** Stacks → your stack → *Pull and redeploy* (Git stacks), or *Update the stack* with "Re-pull image" enabled.
* **Unraid (Compose Manager):** *Compose Pull*, then *Compose Up*. For a Git checkout, run `git pull` in the stack folder first.
* **TrueNAS SCALE (Custom App / Dockge):** edit the app or stack and redeploy. Dockge has an *Update* button.
* **Synology Container Manager:** Project → *Action → Build* (source) or pull new images, then *Start*.

## Notes for specific versions

### 1.6.0: one container
BillFlow now runs as **one app container** (`app`, image `billflow`) plus the database. The API serves the web app itself; the separate nginx `frontend` container is gone. Your data is untouched: the database and data volumes keep their names.

1. Back up (`./scripts/backup.sh`).
2. Get the new `docker-compose.yml` (`git pull`, or copy it from the release). If you edited yours (Traefik labels, extra networks), move those edits from the old `frontend` service to `app`.
3. If your `.env` sets `BACKEND_IMAGE` / `FRONTEND_IMAGE`, replace them with `BILLFLOW_IMAGE=skrunder/billflow:latest` (or remove them to build from source).
4. Run **`docker compose up -d --remove-orphans`** (add `--build` when building from source). `--remove-orphans` removes the old `backend` and `frontend` containers; without it the old `frontend` keeps port 8080 and the new container can't start. If that already happened (the `app` container then can't reach the database either), run `docker compose up -d --remove-orphans --force-recreate` to fix it.
5. A reverse proxy that pointed at the container name `frontend` (Docker network, Cloudflare Tunnel) must now point at `app:8080`. Proxies that use the host's port 8080 need no change.
6. Commands change from `docker compose exec backend …` to `docker compose exec app …`.

**No internet on the server?** Copy the image over: `docker save billflow postgres:16-alpine | gzip > billflow-images.tar.gz` on a machine that built it, then `docker load -i billflow-images.tar.gz` and step 4 on the server.

### 1.5.2
A sign-in fix only; no database changes.

### 1.5.1
The web icon files have new names so browsers stop showing the cached old icon. Reload the page once after updating; an installed PWA's home-screen icon may still need a reinstall.

### 1.5.0: renamed to BillFlow
A name and icon change only; data, volumes and settings are untouched.
* **Email sender:** if your `.env` sets `SMTP_FROM` explicitly, change the display name there yourself (the default is now `BillFlow <no-reply@…>`).
* **Installed web app (PWA):** browsers refresh the name and icon on their own schedule; on some phones you need to remove the home-screen icon and install it again to see the new one.
* **Android:** install `billflow-1.5.0.apk` over the old app as usual; it updates in place (same package id and signing key) and keeps your data.

### 1.4.0
Adds two columns (estimated amounts). Back up first as always; the migration runs on start.

## Verifying an upgrade

```bash
docker compose ps                                    # all services "healthy"
curl -s http://localhost:8080/api/health             # {"status":"ok","version":"…"}
docker compose exec app node dist/cli.js migrate-status
```

## Rolling back

Migrations are forward-only. To return to the previous version:

```bash
docker compose down
git checkout v1.1.0                         # or set the previous image tags in .env
docker compose build
./scripts/restore.sh backups/<pre-upgrade>.dump   # restore the backup taken before upgrading
docker compose up -d
```

## Upgrading PostgreSQL (major version)

The stack pins `postgres:16-alpine`. PostgreSQL data directories are **not** compatible across major versions, so moving to 17 requires a dump and restore:

```bash
./scripts/backup.sh
docker compose down
docker volume rm skr-bill-calendar_db_data      # ⚠ only after verifying the backup!
# edit docker-compose.yml: image: postgres:17-alpine (both db and backup services)
docker compose up -d db
./scripts/restore.sh backups/<latest>.dump
```
