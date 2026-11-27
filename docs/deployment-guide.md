# VPS deployment guide

Do **not** deploy without explicit approval.

## Production checklist (before go-live)

- [ ] `DJANGO_DEBUG=False`
- [ ] Strong unique `DJANGO_SECRET_KEY` (not the example value)
- [ ] `DJANGO_ALLOWED_HOSTS` set to the API hostname
- [ ] CORS origins limited to trusted mobile/web clients
- [ ] PostgreSQL listening on localhost only (or private network)
- [ ] Demo users / `seed_demo` **not** run in production (or passwords rotated immediately)
- [ ] HTTPS certificates installed and auto-renewing
- [ ] Gunicorn systemd enabled; Nginx reverse proxy verified
- [ ] Static files collected (`collectstatic`)
- [ ] Automated `pg_dump` backups scheduled and restore tested
- [ ] Mobile `app.json` `extra.apiUrl` points to `https://<api-host>/api`
- [ ] Firewall: only 80/443 public; PostgreSQL not public

## 1. Server packages

```bash
sudo apt update
sudo apt install python3-venv python3-pip nginx postgresql postgresql-contrib
```

Use Python 3.12+ for Django 6.x.

## 2. PostgreSQL

```bash
sudo -u postgres psql
CREATE DATABASE warehouse_inventory;
CREATE USER warehouse WITH PASSWORD 'REPLACE_ME';
GRANT ALL PRIVILEGES ON DATABASE warehouse_inventory TO warehouse;
\q
```

Keep PostgreSQL bound to localhost (`listen_addresses = 'localhost'`).

## 3. App user and code

```bash
sudo useradd -m -s /bin/bash warehouse
# copy project to /home/warehouse/warehouse-inventory
cd /home/warehouse/warehouse-inventory
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

## 4. Environment

Create `/home/warehouse/warehouse-inventory/backend/.env` from `.env.example`:

- `DJANGO_DEBUG=False`
- strong `DJANGO_SECRET_KEY`
- production `DJANGO_ALLOWED_HOSTS`
- DB credentials
- CORS origins for mobile/API consumers
- `COMPANY_NAME` for barcode labels

## 5. Migrate and static

```bash
cd backend
python manage.py migrate
python manage.py createcachetable
python manage.py collectstatic --noinput
# Do NOT run seed_demo in production unless explicitly requested for a staging demo box
```

## 6. Gunicorn systemd

`/etc/systemd/system/warehouse-api.service`:

```ini
[Unit]
Description=Warehouse Inventory Gunicorn
After=network.target

[Service]
User=warehouse
Group=warehouse
WorkingDirectory=/home/warehouse/warehouse-inventory/backend
EnvironmentFile=/home/warehouse/warehouse-inventory/backend/.env
ExecStart=/home/warehouse/warehouse-inventory/.venv/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8000 --workers 3
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now warehouse-api
```

## 7. Nginx reverse proxy

```nginx
server {
    listen 80;
    server_name api.example.com;

    client_max_body_size 20M;

    location /static/ {
        alias /home/warehouse/warehouse-inventory/backend/staticfiles/;
    }

    location /media/ {
        alias /home/warehouse/warehouse-inventory/backend/media/;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 8. HTTPS

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.example.com
```

## 9. Backups and restore

Daily backup example (cron as `warehouse` or root):

```bash
mkdir -p /var/backups/warehouse
pg_dump -U warehouse -h 127.0.0.1 warehouse_inventory | gzip > /var/backups/warehouse/backup_$(date +%F).sql.gz
```

Restore:

```bash
gunzip -c /var/backups/warehouse/backup_YYYY-MM-DD.sql.gz | psql -U warehouse -h 127.0.0.1 warehouse_inventory
```

Verify restore on a staging database before relying on backups in an incident.

## 10. Android APK / EAS build

1. Set API URL in [`mobile/app.json`](../mobile/app.json):

```json
"extra": {
  "apiUrl": "https://api.example.com/api"
}
```

2. Install EAS CLI and log in:

```bash
cd mobile
npm install
npx eas-cli@latest login
npx eas-cli@latest build:configure
```

3. Build a preview APK:

```bash
npx eas-cli@latest build -p android --profile preview
```

4. Optional local release build (requires Android SDK):

```bash
npx expo prebuild
cd android
./gradlew assembleRelease
```

APK/AAB artifact location depends on EAS vs Gradle. Install only on devices that can reach the production API over HTTPS.

## 11. Post-deploy smoke checks

```bash
curl -fsS https://api.example.com/api/health/
curl -fsS https://api.example.com/api/docs/ | head
```

Then: login on Android → scan/manual lookup → validate FIFO on BATCH-002 style data (staging only).
