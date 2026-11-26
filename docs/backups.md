# Database backups

## What runs automatically

`docker-compose.prod.yml` includes a `db-backup` service. Every night (01:30 IST by default) it runs `pg_dump` on the
database and stores a compressed file in the `warehouse_backups` volume:

| Kept | Default | Env var |
|---|---|---|
| daily | 7 | `BACKUP_KEEP_DAYS` |
| weekly | 4 | `BACKUP_KEEP_WEEKS` |
| monthly | 6 | `BACKUP_KEEP_MONTHS` |

Change the time with `BACKUP_SCHEDULE` (six fields, seconds first, UTC), e.g. `0 0 22 * * *` = 03:30 IST.

This covers mistakes (bad migration, deleted data, a wiped `warehouse_pg_data` volume). It does **not** cover losing the
whole server, because the backups live on the same machine. Do step 1 below as well.

## 1. Keep a copy off the server (do this once)

Pick one:

- **Dokploy's own backups (easiest):** Dokploy → *Destinations* → add an S3-compatible bucket (AWS S3, Cloudflare R2,
  Backblaze B2, ...). Then, if you run the database as a separate Dokploy *Database* service, add a *Backup* schedule
  there. For the database inside this compose stack, use the second option.
- **Copy the dumps yourself** on a schedule from the server, e.g. with `rclone` or `scp` of the `warehouse_backups`
  volume (`docker volume inspect` shows its path under `/var/lib/docker/volumes/`).

Also back up uploaded item photos: they live in the `warehouse_media` volume, which the database dump does not contain.

## 2. Check that backups exist

On the server (Dokploy → the compose service → *Terminal*, or SSH):

```bash
docker compose -f docker-compose.prod.yml exec db-backup ls -lh /backups/daily /backups/last
```

You should see a file per day (`warehouse_inventory-YYYYMMDD-HHMMSS.sql.gz`) and a `*-latest.sql.gz` link.
The service log (`docker compose logs db-backup`) shows each run.

## 3. Restore (practise this once on a spare database, not production)

Restoring replaces current data with the backup. Stop the API first so nothing writes during the restore:

```bash
docker compose -f docker-compose.prod.yml stop api

# restore the newest daily dump (replace the file name to restore an older one)
docker compose -f docker-compose.prod.yml exec db-backup sh -c \
  'zcat /backups/last/warehouse_inventory-latest.sql.gz' \
  | docker compose -f docker-compose.prod.yml exec -T db sh -c \
  'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS $POSTGRES_DB WITH (FORCE)" \
     -c "CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER" \
   && psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

docker compose -f docker-compose.prod.yml start api
```

Afterwards open the app and check the dashboard numbers and a recent GRN. A backup you have never restored is a hope,
not a backup: repeat this test after any change to the setup.
