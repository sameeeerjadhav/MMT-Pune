#!/bin/sh
set -e

echo "Waiting for database..."
python - <<'PY'
import os, time
import psycopg2

host = os.getenv("DB_HOST", "db")
port = int(os.getenv("DB_PORT", "5432"))
name = os.getenv("DB_NAME", "warehouse_inventory")
user = os.getenv("DB_USER", "warehouse")
password = os.getenv("DB_PASSWORD", "warehouse_pass")

for i in range(60):
    try:
        conn = psycopg2.connect(dbname=name, user=user, password=password, host=host, port=port)
        conn.close()
        print("Database is ready.")
        break
    except Exception as e:
        print(f"DB not ready ({i+1}/60): {e}")
        time.sleep(2)
else:
    raise SystemExit("Database never became ready")
PY

python manage.py migrate --noinput
python manage.py createcachetable
python manage.py collectstatic --noinput
exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3 --timeout 120
