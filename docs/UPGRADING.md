# Updating & upgrading

The app follows **semantic versioning**:

* **Patch** (1.0.x): fixes only. Update any time.
* **Minor** (1.x.0): new features and additive database migrations. Safe in place.
* **Major** (x.0.0): may include breaking changes or destructive migrations. Read the release notes first.

Database migrations run automatically when the new backend container starts. Your data volumes are never touched by an image update.

## Standard update (Docker Compose, built from source)

```bash
cd skr-bill-calendar
./scripts/backup.sh                 # 1. always back up first
git fetch --tags
git checkout v1.2.0                 # 2. or: git pull  (to follow main)
docker compose build --pull         # 3. rebuild images with fresh base images
docker compose up -d                # 4. recreate containers; migrations apply on start
docker compose logs -f backend      # 5. watch for "database schema is up to date"
```

Compare `.env.example` with your `.env` after updating and add any new variables you want. New variables always have safe defaults.

## Using prebuilt images

If you set `BACKEND_IMAGE` / `FRONTEND_IMAGE` to registry images (for example from the project's GitHub Container Registry):

```bash
./scripts/backup.sh
docker compose pull
docker compose up -d
```

Pin a version tag (`:1.2.0`) rather than `:latest` if you want updates to happen only when you choose.

## Platform notes

* **Portainer:** Stacks → your stack → *Pull and redeploy* (Git stacks), or *Update the stack* with "Re-pull image" enabled.
* **Unraid (Compose Manager):** *Compose Pull*, then *Compose Up*. For a Git checkout, run `git pull` in the stack folder first.
* **TrueNAS SCALE (Custom App / Dockge):** edit the app or stack and redeploy. Dockge has an *Update* button.
* **Synology Container Manager:** Project → *Action → Build* (source) or pull new images, then *Start*.

## Notes for specific versions

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
docker compose exec backend node dist/cli.js migrate-status
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
