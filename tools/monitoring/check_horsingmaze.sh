#!/usr/bin/env bash
# Watchdog do HorsingMaze — roda via cron do SISTEMA (independente do Node).
# Alerta via ntfy.sh se: (1) API fora do ar; (2) pipeline diário não completou
# nas últimas 26h (pegaria a regressão do setupCronJob comentado, que ficou
# 30h invisível em 2026-07-04).
#
# Instalação (crontab do mazedev): */30 * * * * /caminho/check_horsingmaze.sh
# Assinar alertas: https://ntfy.sh/<TOPIC> (navegador ou app ntfy)

set -u
TOPIC="${HM_NTFY_TOPIC:-horsingmaze-maze-alerts-x7k2}"
STATE_DIR="${HOME}/.cache/horsingmaze-watchdog"
mkdir -p "$STATE_DIR"

notify() {
  # Rate-limit: no máximo 1 alerta por problema a cada 6h
  local key="$1" msg="$2"
  local stamp="$STATE_DIR/$key"
  if [ -f "$stamp" ] && [ $(( $(date +%s) - $(stat -c %Y "$stamp") )) -lt 21600 ]; then
    return
  fi
  touch "$stamp"
  curl -s -m 10 -H "Title: HorsingMaze ALERT" -H "Priority: high" \
    -d "$msg ($(date '+%d/%m %H:%M'))" "https://ntfy.sh/$TOPIC" >/dev/null
}

# 1. API de pé?
if ! curl -sf -m 10 http://localhost:3000/health >/dev/null; then
  notify api_down "API /health não responde — serviço horsingmaze-hmlmanus pode estar morto"
  exit 0
fi

# 2. Pipeline diário completou nas últimas 26h?
if ! journalctl -u horsingmaze-hmlmanus --since "26 hours ago" --no-pager 2>/dev/null \
    | grep -q "Resultado da execução agendada: Sucesso"; then
  notify pipeline_stale "Pipeline diário SEM execução com sucesso nas últimas 26h — verificar cron/journal"
fi
