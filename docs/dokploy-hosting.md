# Host API on Dokploy — `mmt.labxco.cloud`

**What goes on the VPS:** Django API + PostgreSQL only.  
**Mobile app:** stays on phones; point it at `https://mmt.labxco.cloud/api`.

VPS IP (from your A record): `2.24.138.74`  
Dokploy: `http://2.24.138.74:3000`

---

## 0. DNS (Hostinger)

1. **Delete** any `ALIAS` / `CNAME` for `mmt` that points to `*.cdn.hstgr.net` (conflicts with VPS).
2. Keep a single **A** record:
   - Type: `A`
   - Name: `mmt`
   - Value: `2.24.138.74`
   - TTL: `300`
3. Wait until DNS resolves:

```bash
nslookup mmt.labxco.cloud
```

It must return `2.24.138.74`.

---

## 1. Push code (with Docker files)

From your PC, commit and push `develop-durgesh` (or `main`) including:

- `backend/Dockerfile`
- `backend/entrypoint.sh`
- `docker-compose.prod.yml`

Connect the same GitHub repo in Dokploy if not already linked.

---

## 2. Dokploy — create project

1. Open Dokploy → **Projects** → **Create project** (e.g. `mmt-warehouse`).
2. Create environment: `production`.
3. Add service → **Compose**.
4. Connect the Git repo; set compose file to: **`docker-compose.prod.yml`**.
5. Ensure the compose network name matches Dokploy (often `dokploy-network`). If deploy fails on network, in Dokploy service settings use the network Dokploy shows, or change `docker-compose.prod.yml` `networks.dokploy-network` to that name.

---

## 3. Environment variables (Dokploy → Compose → Environment)

Set these (use a long random secret):

Generate `DJANGO_SECRET_KEY` once (it signs every login token) and paste it into Dokploy only — never into git:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
# or: openssl rand -base64 64
```

The API refuses to start with `DJANGO_DEBUG=False` if the key is missing, shorter than 32 characters or a placeholder.
Changing the key later signs everyone out (they just log in again), so pick it once and keep a copy in a password manager.

```env
DJANGO_SECRET_KEY=REPLACE_WITH_LONG_RANDOM_SECRET
DJANGO_NUM_PROXIES=1
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=mmt.labxco.cloud
DJANGO_CSRF_TRUSTED_ORIGINS=https://mmt.labxco.cloud
DJANGO_CORS_ALLOWED_ORIGINS=
DB_NAME=warehouse_inventory
DB_USER=warehouse
DB_PASSWORD=REPLACE_WITH_STRONG_DB_PASSWORD
COMPANY_NAME=Airport Equipment Manufacturing
```

`DJANGO_NUM_PROXIES` is how many reverse proxies sit in front of the API: `1` for Traefik alone, `2` if Cloudflare
(or another proxy) is also in front. It decides which IP address the login lockout and rate limits see; a wrong value
makes everyone look like the proxy (too low) or lets callers fake their address (too high).

Nightly database backups run automatically (`db-backup` service). Read [backups.md](backups.md) to set up an
off-server copy and to practise a restore.

Do **not** run `seed_demo` on production unless you want demo users/data.

---

## 4. Domain + HTTPS in Dokploy

1. On the **api** service (or compose domain settings), add domain: **`mmt.labxco.cloud`**.
2. Enable **HTTPS / Let's Encrypt** (Dokploy Traefik).
3. Path / port: container port **`8000`** for the `api` service.
4. Deploy.

After deploy:

```bash
curl -fsS https://mmt.labxco.cloud/api/health/
```

Expect a healthy JSON response.

Swagger: `https://mmt.labxco.cloud/api/docs/`

---

## 5. Create your first admin user (on the server)

In Dokploy → api container → terminal (or SSH):

```bash
python manage.py createsuperuser
```

Or create staff via Django shell. Do not rely on local `Demo@12345` users unless you seed intentionally.

---

## 6. Point the mobile app at production

In `mobile/app.json`:

```json
"extra": {
  "apiUrl": "https://mmt.labxco.cloud/api",
  "preferRemoteApiInDev": true
}
```

- Release APK always uses `apiUrl`.
- Expo Go uses the VPS when `preferRemoteApiInDev` is `true`.
- For local `runserver`, set `preferRemoteApiInDev` to `false` (then Expo uses your LAN IP `:8000`).

---

## 7. Firewall checklist

On the VPS, public ports should be:

- `80` / `443` — Traefik (app + HTTPS)
- `3000` — Dokploy UI (restrict by IP if possible)
- **Not** public: PostgreSQL `5432`

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Domain still opens Hostinger site | Remove CDN ALIAS; wait for DNS |
| 502 Bad Gateway | Check api container logs; DB password / migrate errors |
| DisallowedHost | `DJANGO_ALLOWED_HOSTS=mmt.labxco.cloud` |
| SSL pending | DNS must already point to VPS before Let's Encrypt |
| Mobile cannot login | Confirm `https://mmt.labxco.cloud/api/health/` and rebuild app with new `apiUrl` |
