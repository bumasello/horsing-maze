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

# 1. APIs de pé? (prd=3001, teste=3000)
if ! curl -sf -m 10 http://localhost:3001/health >/dev/null; then
  notify prd_down "PROD /health (3001) não responde — horsingmaze-prd pode estar morto"
fi
if ! curl -sf -m 10 http://localhost:3000/health >/dev/null; then
  notify hml_down "TESTE /health (3000) não responde — horsingmaze-hmlmanus pode estar morto"
fi

# 2. Pipeline diário (roda SÓ no prd) completou nas últimas 26h?
if ! journalctl -u horsingmaze-prd --since "26 hours ago" --no-pager 2>/dev/null \
    | grep -q "Resultado da execução agendada: Sucesso"; then
  notify pipeline_stale "Pipeline diário do PROD sem sucesso nas últimas 26h — verificar cron/journal"
fi
