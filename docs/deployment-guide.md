# VPS deployment guide

Do **not** deploy without explicit approval.

## 1. Server packages

```bash
sudo apt update
sudo apt install python3-venv python3-pip nginx postgresql postgresql-contrib
```

## 2. PostgreSQL

```bash
sudo -u postgres psql
CREATE DATABASE warehouse_inventory;
CREATE USER warehouse WITH PASSWORD 'REPLACE_ME';
GRANT ALL PRIVILEGES ON DATABASE warehouse_inventory TO warehouse;
\q
```

Keep PostgreSQL bound to localhost.

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

## 5. Migrate and static

```bash
cd backend
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py seed_demo   # demo only — skip in production
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

    location /static/ {
        alias /home/warehouse/warehouse-inventory/backend/staticfiles/;
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

## 9. Backups

```bash
pg_dump -U warehouse warehouse_inventory > backup_$(date +%F).sql
```

Restore:

```bash
psql -U warehouse warehouse_inventory < backup_YYYY-MM-DD.sql
```

## 10. Android APK

```bash
cd mobile
npx expo install
# Set extra.apiUrl in app.json to https://api.example.com/api
npx eas build -p android --profile preview
# or locally after prebuild:
npx expo prebuild
cd android && ./gradlew assembleRelease
```

APK output path depends on EAS vs local Gradle build.
