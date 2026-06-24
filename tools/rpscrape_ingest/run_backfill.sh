#!/usr/bin/env bash
#
# Backfill one-shot: scrapeia janela 2020-2025 (default) GB+IRE flat+jumps.
# Roda em background com nohup; ETA bruta: 1-3 dias dependendo de rate limit.
#
# Uso:
#   ./run_backfill.sh [year_start] [year_end]
#   ./run_backfill.sh 2020 2025      # default
#   ./run_backfill.sh 2024 2024      # 1 ano só (smoke)
#
# Logs vão pra $LOG_DIR/backfill-<year>-<region>-<type>.log

set -euo pipefail

YEAR_START="${1:-2020}"
YEAR_END="${2:-2025}"

RPSCRAPE_HOME="${RPSCRAPE_HOME:-/opt/rpscrape}"
INGEST_HOME="${INGEST_HOME:-/opt/horsingmaze/tools/rpscrape_ingest}"
LOG_DIR="${LOG_DIR:-/var/log/rpscrape}"
mkdir -p "$LOG_DIR"

echo "=== backfill $YEAR_START-$YEAR_END @ $(date -u --iso-8601=seconds) ==="

# Por ano × região × tipo. Saída fica em data/region/<region>/<type>/<year>.csv
cd "$RPSCRAPE_HOME/scripts"
for year in $(seq "$YEAR_START" "$YEAR_END"); do
  for region in gb ire; do
    for racetype in flat jumps; do
      LOG_FILE="$LOG_DIR/backfill-$year-$region-$racetype.log"
      echo "--- $year $region $racetype --- (log: $LOG_FILE)"
      "$RPSCRAPE_HOME/venv/bin/python" rpscrape.py \
        -y "$year" -r "$region" -t "$racetype" >> "$LOG_FILE" 2>&1 || \
        echo "WARN $year/$region/$racetype falhou (ver $LOG_FILE)"
    done
  done
done

# Ingere TUDO de uma vez (subdirs cobertos)
echo "=== ingesting all CSVs from data/region ==="
"$INGEST_HOME/venv/bin/python" "$INGEST_HOME/ingest_csv.py" \
  "$RPSCRAPE_HOME/data/region" 2>&1 | tee "$LOG_DIR/backfill-ingest.log"

# Match em batches (limite alto pra varrer tudo de uma vez)
echo "=== matching ==="
"$INGEST_HOME/venv/bin/python" "$INGEST_HOME/match_to_race_horses.py" \
  --limit 500000 2>&1 | tee "$LOG_DIR/backfill-match.log"

echo "=== done $(date -u --iso-8601=seconds) ==="
