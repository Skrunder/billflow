# Backup & restore

Your data lives in two places:

| What | Where | Importance |
|---|---|---|
| All bills, events, occurrences, history, users, settings | PostgreSQL (`db_data` volume) | **Critical** |
| Auto-generated JWT secret, future uploads | backend data (`backend_data` volume, `/app/data`) | Small. Losing it only signs everyone out. |

Follow the **3-2-1 rule**: three copies, on two kinds of media, with one off-site. Copy `./backups` to your NAS share, cloud storage (rclone, restic, Backblaze B2), or a USB drive.

## Recommendations

1. Turn on **automatic daily dumps**:
   ```bash
   docker compose --profile backup up -d
   ```
   The sidecar runs `pg_dump --format=custom` every `BACKUP_INTERVAL_HOURS` (24) into `BACKUP_PATH` (`./backups`) and deletes dumps older than `BACKUP_KEEP_DAYS` (14).
2. **Back up before every upgrade** with `./scripts/backup.sh`.
3. Prefer `pg_dump` over copying the raw `db_data` directory. Raw copies of a running PostgreSQL can be inconsistent. If your platform snapshots volumes (ZFS on TrueNAS, Btrfs on Synology, Proxmox VM backups), those are crash-consistent and a fine *extra* layer.
4. **Test a restore** now and then into a scratch copy (below).
5. Individual users can also download a JSON copy of their own data under **Settings → Your data → Export**.

## Manual backup

```bash
./scripts/backup.sh
# → backups/billcalendar-<UTC timestamp>.dump
# → backups/appdata-<UTC timestamp>.tar.gz
```

Equivalent raw commands (useful in Portainer consoles):

```bash
docker compose exec -T db pg_dump -U billcalendar -d billcalendar --format=custom > billcalendar.dump
docker compose exec -T backend tar -C /app/data -czf - . > appdata.tar.gz
```

## Restore

> Restoring **replaces** the current database. Take a fresh backup first if there is anything you want to keep.

```bash
./scripts/restore.sh backups/billcalendar-20261007T120000Z.dump backups/appdata-20261007T120000Z.tar.gz
# the appdata archive is optional
```

The script:
1. stops `frontend` and `backend`
2. drops and recreates the database
3. runs `pg_restore` with the dump
4. optionally restores `/app/data`
5. starts the stack, which applies any newer migrations automatically

Restoring an older backup into a **newer** app version works, because migrations bring the schema forward. Restoring a newer backup into an **older** version is not supported.

### Manual restore (no scripts)

```bash
docker compose stop frontend backend
docker compose exec -T db psql -U billcalendar -d postgres -c 'DROP DATABASE IF EXISTS billcalendar;' -c 'CREATE DATABASE billcalendar OWNER billcalendar;'
docker compose exec -T db pg_restore -U billcalendar -d billcalendar --no-owner --exit-on-error < billcalendar.dump
docker compose up -d
```

### Restore to a new server

1. Install the app on the new host (`git clone`, copy your `.env`, **same `POSTGRES_PASSWORD`**).
2. `docker compose up -d db` to start only the database.
3. Run `./scripts/restore.sh <dump> <appdata>`.

### Test a backup without touching production

```bash
docker run -d --name restore-test -e POSTGRES_PASSWORD=test postgres:16-alpine
sleep 5
docker exec -i restore-test createdb -U postgres billcalendar
docker exec -i restore-test pg_restore -U postgres -d billcalendar --no-owner < backups/billcalendar-XXXX.dump
docker exec -it restore-test psql -U postgres -d billcalendar -c 'SELECT count(*) FROM bill_occurrences;'
docker rm -f restore-test
```
