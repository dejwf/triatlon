#!/bin/sh
# Pravidelná záloha databáze (pg_dump, gzip) do /backups; starší než BACKUP_KEEP_DAYS se mažou.
# V den závodu zkrátit interval (např. BACKUP_INTERVAL_SECONDS=900).
set -eu
mkdir -p /backups
while true; do
  file="/backups/triatlon-$(date +%Y%m%d-%H%M%S).sql.gz"
  if pg_dump -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner | gzip > "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "Záloha: $file"
  else
    rm -f "$file.tmp"
    echo "Záloha selhala!" >&2
  fi
  find /backups -name 'triatlon-*.sql.gz' -mtime "+${BACKUP_KEEP_DAYS:-14}" -delete
  sleep "${BACKUP_INTERVAL_SECONDS:-86400}"
done
