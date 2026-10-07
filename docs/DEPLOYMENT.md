# Deployment guide

Every platform runs the same `docker-compose.yml`. The only required setting is `POSTGRES_PASSWORD`. The first start builds the two app images, which takes 3–6 minutes on a typical NAS.

**Requirements:** Docker 20.10+ with Compose v2, about 1 GB of RAM free, about 1 GB of disk, and x86-64 or ARM64.

* [Standard Linux / Proxmox](#standard-linux--proxmox)
* [Portainer](#portainer)
* [Unraid](#unraid)
* [TrueNAS SCALE](#truenas-scale)
* [Synology DSM](#synology-dsm)
* [Reverse proxies](#reverse-proxies): Nginx Proxy Manager, Traefik, Cloudflare Tunnel, nginx, Caddy
* [After installing](#after-installing)
* [Troubleshooting](#troubleshooting)

---

## Standard Linux / Proxmox

On Proxmox, use a Debian/Ubuntu **VM** or a **privileged LXC with nesting enabled** (Options → Features → `nesting=1`, `keyctl=1`), and install Docker inside it.

```bash
curl -fsSL https://get.docker.com | sh          # if Docker isn't installed yet
git clone https://github.com/<you>/skr-bill-calendar.git
cd skr-bill-calendar
cp .env.example .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
docker compose up -d
docker compose --profile backup up -d           # optional daily backups
```

Open `http://<host-ip>:8080`.

## Portainer

**Option A: Git repository (recommended, makes updates easy)**
1. *Stacks → Add stack → Repository*.
2. Repository URL: your fork or the project URL. Compose path: `docker-compose.yml`.
3. Under *Environment variables*, add `POSTGRES_PASSWORD` (and optionally `APP_URL`, `APP_PORT`).
4. *Deploy the stack*. Portainer builds the images from the repository.

**Option B: Web editor with prebuilt images.** Paste `docker-compose.yml`, set `BACKEND_IMAGE` and `FRONTEND_IMAGE` to published registry images, delete the two `build:` blocks, add the environment variables, and deploy.

## Unraid

Install **Docker Compose Manager** from Community Applications (Apps → search "Compose Manager").

1. Open a terminal and fetch the project into appdata:
   ```bash
   mkdir -p /mnt/user/appdata/skr-bill-calendar && cd /mnt/user/appdata/skr-bill-calendar
   git clone https://github.com/<you>/skr-bill-calendar.git app
   ```
2. *Docker → Compose → Add New Stack*, name it `skr-bill-calendar`. Under *Advanced*, set the stack directory to `/mnt/user/appdata/skr-bill-calendar/app`.
3. Edit the stack's **ENV** file:
   ```ini
   POSTGRES_PASSWORD=<long random string>
   APP_URL=http://<unraid-ip>:8080
   DB_DATA_PATH=/mnt/user/appdata/skr-bill-calendar/postgres
   APP_DATA_PATH=/mnt/user/appdata/skr-bill-calendar/data
   BACKUP_PATH=/mnt/user/backups/skr-bill-calendar
   ```
4. Give the backend data folder to uid 1000:
   ```bash
   mkdir -p /mnt/user/appdata/skr-bill-calendar/data && chown 1000:1000 /mnt/user/appdata/skr-bill-calendar/data
   ```
5. Click **Compose Up**. Add `--profile backup` (or start the `backup` service) for automatic dumps.

> Port 8080 is often taken on Unraid (for example by another web UI). Set `APP_PORT=8095` or any free port.

## TrueNAS SCALE

**24.10 "Electric Eel" and newer** (Docker-based apps):
1. Create datasets, e.g. `tank/apps/billcal/postgres`, `tank/apps/billcal/data` and `tank/apps/billcal/backups`. Set the `data` dataset owner to uid/gid **1000**.
2. *Apps → Discover Apps → ⋮ → Install via YAML*, or use the **Dockge** app for a full Compose workflow (recommended: it supports `build:` and `.env`).
3. With Dockge: create a stack, paste `docker-compose.yml`, and in the `.env` panel set:
   ```ini
   POSTGRES_PASSWORD=<random>
   DB_DATA_PATH=/mnt/tank/apps/billcal/postgres
   APP_DATA_PATH=/mnt/tank/apps/billcal/data
   BACKUP_PATH=/mnt/tank/apps/billcal/backups
   ```
   Clone the repo into the Dockge stacks directory so the `./backend` and `./frontend` build contexts exist, or use prebuilt images.
4. Deploy. ZFS snapshots of the datasets are a good extra safety net.

**Older SCALE releases (k3s-based):** run the stack inside a Linux VM, or use the TrueCharts/Dockge "jailmaker" approach, then follow the standard Linux steps.

## Synology DSM

DSM 7.2+ with **Container Manager**:
1. In *File Station*, create `docker/skr-bill-calendar` and upload or extract the project into it (or `git clone` over SSH).
2. Create `.env` in that folder from `.env.example` and set `POSTGRES_PASSWORD`. Optionally set `DB_DATA_PATH=/volume1/docker/skr-bill-calendar/postgres`, etc. Over SSH, run `sudo chown 1000:1000` on the backend data folder.
3. *Container Manager → Project → Create*. Pick the folder, choose "Use existing docker-compose.yml", and build.
4. Open `http://<nas-ip>:8080`.
5. To reach it from outside, use *Control Panel → Login Portal → Advanced → Reverse Proxy* (below).

Synology reverse proxy: source `HTTPS bills.example.com:443` → destination `HTTP localhost:8080`. Under *Custom Header*, click *Create → WebSocket* (adds the Upgrade headers). Then set `APP_URL=https://bills.example.com`.

---

## Reverse proxies

The app needs **one** upstream: `http://<docker-host>:8080`, or `http://frontend:8080` when the proxy shares a Docker network with the stack. After adding TLS, always set:

```ini
APP_URL=https://bills.example.com     # enables Secure cookies automatically
```

and recreate with `docker compose up -d`. Forwarded headers from private-network proxies are trusted by default (`TRUST_PROXY`), so rate limiting and audit logs see real client IPs. If your proxy is on a public IP, add it: `TRUST_PROXY=loopback, uniquelocal, 203.0.113.10`.

> To expose the app **only** through the proxy, set `APP_BIND_ADDRESS=127.0.0.1` (proxy on the same host), or remove `ports:` and attach the frontend to the proxy's Docker network.

### Nginx Proxy Manager
*Hosts → Proxy Hosts → Add*: domain `bills.example.com`, scheme `http`, forward host `<docker-host-ip>` (or `frontend` if NPM shares the network), port `8080`. Enable *Block Common Exploits* and *Websockets Support*. Under *SSL*, request a Let's Encrypt certificate with *Force SSL* and *HSTS*.

### Traefik (labels)
Add to the `frontend` service, and remove its `ports:` if Traefik handles everything:

```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.billcal.rule=Host(`bills.example.com`)
      - traefik.http.routers.billcal.entrypoints=websecure
      - traefik.http.routers.billcal.tls.certresolver=letsencrypt
      - traefik.http.services.billcal.loadbalancer.server.port=8080
      - traefik.http.middlewares.billcal-hsts.headers.stsSeconds=31536000
      - traefik.http.routers.billcal.middlewares=billcal-hsts
    networks: [internal, traefik]
```
and declare `traefik: { external: true }` under top-level `networks:`.

### Cloudflare Tunnel
Add a `cloudflared` service to the stack:

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
    networks: [internal]
```
In the Cloudflare Zero Trust dashboard, set the public hostname `bills.example.com` → service `http://frontend:8080`. Then set `APP_URL=https://bills.example.com`. You can remove the `ports:` mapping entirely. Consider a Cloudflare Access policy for an extra login layer.

### Plain nginx
```nginx
server {
    listen 443 ssl http2;
    server_name bills.example.com;
    ssl_certificate     /etc/letsencrypt/live/bills.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bills.example.com/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
}
server { listen 80; server_name bills.example.com; return 301 https://$host$request_uri; }
```

### Caddy
```
bills.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

---

## After installing

1. Open the app and **create the first account**. It becomes the administrator.
2. Settings → check your **timezone**, currency and reminder defaults.
3. Not sharing the server with others? Set `ALLOW_REGISTRATION=false` and run `docker compose up -d`.
4. Enable backups: `docker compose --profile backup up -d`.
5. Optional: configure SMTP (password reset and email reminders) and VAPID keys (push). See [ENVIRONMENT.md](ENVIRONMENT.md).
6. Install the PWA:
   * **Android / Chrome / Edge:** browser menu → *Install app* / *Add to Home screen*.
   * **iPhone / iPad (Safari):** Share → *Add to Home Screen*. Open it from the icon to allow push (iOS 16.4+).
   * **Desktop Chrome / Edge:** install icon in the address bar.

   Installation and push require **HTTPS** (except on `localhost`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `POSTGRES_PASSWORD must be set` | Create `.env` from `.env.example`, or set the variable in your platform's UI. |
| Backend restarts with `password authentication failed` | The DB volume was created with a different password. Restore the old password, or `docker compose down -v` to wipe (**destroys data**). |
| Signed out after every refresh, behind a proxy over HTTP | `APP_URL` is `https://…` but you're browsing over `http://` (Secure cookies). Use HTTPS or fix `APP_URL`. |
| Login works locally but not through the proxy | Make sure the proxy forwards to port **8080** of the frontend (not 4000) and passes the `Host` header. |
| `EACCES /app/data` on Unraid/TrueNAS | `chown 1000:1000` the host folder used for `APP_DATA_PATH`. |
| Backup sidecar `Permission denied` on Fedora/RHEL | SELinux: the compose file already adds `:z`. For custom paths, keep the `:z` suffix. |
| Reminders not arriving | Settings → *Send test notification*. Check `docker compose logs backend` for `reminder delivery failed`. Push needs HTTPS + VAPID keys. Email needs SMTP. |
| Forgot admin password, no SMTP | `docker compose exec backend node dist/cli.js reset-password you@example.com` |
| Health status | `docker compose ps`; `curl http://localhost:8080/api/health/ready` |
| Logs | `docker compose logs -f backend` (JSON lines; pipe through `npx pino-pretty` to read) |
