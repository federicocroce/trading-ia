#!/usr/bin/env bash
# Respaldo de data/trading.db — el activo más valioso del proyecto.
# El código se reescribe; los 4 meses de medición forward, no.
#
# Por qué no es un `cp`: la DB corre en modo WAL. Copiar el archivo mientras el
# backend escribe puede capturar un estado partido (el .db sin su -wal). El
# comando `.backup` de SQLite toma una foto consistente aunque haya escrituras.
#
# Uso:
#   ./scripts/backup-db.sh                    # a ~/Backups/trading, conserva 7
#   TRADING_BACKUP_DIR=/Volumes/USB/tr ./scripts/backup-db.sh
#   TRADING_BACKUP_KEEP=14 ./scripts/backup-db.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="$REPO_ROOT/data/trading.db"
DEST="${TRADING_BACKUP_DIR:-$HOME/Backups/trading}"
KEEP="${TRADING_BACKUP_KEEP:-7}"

[ -f "$DB" ] || { echo "✗ No existe $DB" >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo "✗ Falta sqlite3 en PATH" >&2; exit 1; }

mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$DEST/.tmp-$STAMP.db"
OUT="$DEST/trading-$STAMP.db.gz"

echo "→ Copiando (snapshot consistente sobre WAL)…"
sqlite3 "$DB" ".backup '$TMP'"

# Verificar ANTES de comprimir: un backup corrupto que no se puede restaurar es
# peor que no tener backup, porque da falsa tranquilidad.
echo "→ Verificando integridad…"
CHECK="$(sqlite3 "$TMP" 'PRAGMA integrity_check;')"
if [ "$CHECK" != "ok" ]; then
  echo "✗ Backup CORRUPTO, no se conserva: $CHECK" >&2
  rm -f "$TMP"
  exit 1
fi

# Sanity extra: que las tablas de evidencia tengan filas.
SENALES="$(sqlite3 "$TMP" 'SELECT count(*) FROM signal_tracking;' 2>/dev/null || echo 0)"
if [ "$SENALES" -eq 0 ]; then
  echo "✗ El backup no tiene señales en signal_tracking — algo salió mal" >&2
  rm -f "$TMP"
  exit 1
fi

# Pasar el archivo a journal DELETE antes de archivarlo: `.backup` conserva el
# modo WAL, y una base WAL NO se puede abrir con `sqlite3 -readonly` si no está
# su -shm al lado. Justo el modo en que uno inspecciona un backup cuando lo
# necesita. Así queda un archivo único que abre en cualquier lado.
sqlite3 "$TMP" 'PRAGMA journal_mode=DELETE;' > /dev/null
rm -f "$TMP-wal" "$TMP-shm"

gzip -c "$TMP" > "$OUT"
rm -f "$TMP"

echo "✓ $OUT  ($(du -h "$OUT" | cut -f1), $SENALES señales)"

# Rotación: conservar los KEEP más nuevos.
BORRADOS=0
while IFS= read -r viejo; do
  rm -f "$viejo"
  BORRADOS=$((BORRADOS + 1))
done < <(ls -1t "$DEST"/trading-*.db.gz 2>/dev/null | tail -n +"$((KEEP + 1))")
[ "$BORRADOS" -gt 0 ] && echo "  rotación: $BORRADOS backup(s) viejo(s) eliminado(s), se conservan $KEEP"

echo "  destino: $DEST  ($(ls -1 "$DEST"/trading-*.db.gz 2>/dev/null | wc -l | tr -d ' ') copias, $(du -sh "$DEST" | cut -f1))"
echo
echo "Recordatorio: esto sigue estando en la misma máquina. Para respaldo real,"
echo "apuntá TRADING_BACKUP_DIR a un disco externo o carpeta sincronizada a la nube."
