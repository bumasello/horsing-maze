#!/usr/bin/env bash
#
# Cron diário: scrapeia o dia ANTERIOR (D-1) UK/IRE, ingere no Supabase, resolve matching.
#
# Cron sugerido no mazeserver: 0 20 * * *  (20:00 UTC, depois de RP consolidar comments)
#
# Pré-requisitos no servidor:
#   * Python 3.13+ (pyenv ou system)
#   * rpscrape clonado em $RPSCRAPE_HOME (default /opt/rpscrape) com venv + .env (token RP)
#   * ingestor instalado em $INGEST_HOME (default /opt/horsingmaze/tools/rpscrape_ingest)
#     com venv + .env (DB_*)
#
# Logs vão pra $LOG_DIR/rpscrape-YYYY-MM-DD.log

set -euo pipefail

RPSCRAPE_HOME="${RPSCRAPE_HOME:-/opt/rpscrape}"
INGEST_HOME="${INGEST_HOME:-/opt/horsingmaze/tools/rpscrape_ingest}"
LOG_DIR="${LOG_DIR:-/var/log/rpscrape}"

mkdir -p "$LOG_DIR"

# Datas em UK time (RP é UK) — usa ontem
YESTERDAY=$(date -u -d "yesterday" +"%Y/%m/%d")
DATE_PRETTY=$(date -u -d "yesterday" +"%Y-%m-%d")
LOG_FILE="$LOG_DIR/rpscrape-$DATE_PRETTY.log"

echo "=== run_daily.sh $YESTERDAY @ $(date -u --iso-8601=seconds) ===" >> "$LOG_FILE"

# 0. Renova access_token via Cognito (JWT expira em 30 min)
echo "--- refresh token ---" >> "$LOG_FILE"
"$INGEST_HOME/venv/bin/python" "$INGEST_HOME/refresh_token.py" \
  --rpscrape-env "$RPSCRAPE_HOME/.env" >> "$LOG_FILE" 2>&1 || {
  echo "FATAL: refresh_token falhou, abortando" >> "$LOG_FILE"
  exit 1
}

# 1. Scrape GB + IRE flat + jumps em sequência (rpscrape não tem combo "all UK+IRE")
cd "$RPSCRAPE_HOME/scripts"
for region in gb ire; do
  for racetype in flat jumps; do
    echo "--- scraping $region $racetype ---" >> "$LOG_FILE"
    "$RPSCRAPE_HOME/venv/bin/python" rpscrape.py \
      -d "$YESTERDAY" -r "$region" -t "$racetype" >> "$LOG_FILE" 2>&1 || \
      echo "WARN: $region $racetype falhou (talvez sem corridas)" >> "$LOG_FILE"
  done
done

# 2. Ingere todos os CSVs gerados (dir = data/region)
echo "--- ingesting CSVs ---" >> "$LOG_FILE"
"$INGEST_HOME/venv/bin/python" "$INGEST_HOME/ingest_csv.py" \
  "$RPSCRAPE_HOME/data/region" >> "$LOG_FILE" 2>&1

# 3. Resolve matching dos novos registros (até 30 dias atrás pra cobrir backfill atrasado)
SINCE=$(date -u -d "30 days ago" +"%Y-%m-%d")
echo "--- matching since $SINCE ---" >> "$LOG_FILE"
"$INGEST_HOME/venv/bin/python" "$INGEST_HOME/match_to_race_horses.py" \
  --since "$SINCE" --limit 100000 >> "$LOG_FILE" 2>&1

echo "=== done $(date -u --iso-8601=seconds) ===" >> "$LOG_FILE"
