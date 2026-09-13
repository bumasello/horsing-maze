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

# ⚠️ OCUPADO NÃO É MORTO.
# O retreino noturno usa TensorFlow síncrono e bloqueia o event loop do Node por
# HORAS: /health não responde e "sucesso em 26h" fica falso, com o serviço
# perfeitamente vivo. Medido em 2026-09-13: a execução começou 00:00 e terminou
# 03:14:49 COM SUCESSO — e no meio dispararam dois alertas falsos, 01:00 e 01:30.
# O usuário ignorou os dois, que é exatamente o que um alarme mentiroso ensina.
#
# As linhas [HEALTH] são excluídas de propósito: elas são geradas por ESTE
# watchdog batendo no endpoint, então contá-las tornaria todo serviço "ocupado".
# Durante o bloqueio elas somem justamente porque a requisição não chega ao
# handler — o que sobra no journal é trabalho real.
ocupado() {
  local desde
  desde=$(date -d '20 minutes ago' '+%Y-%m-%d %H:%M:%S')
  journalctl -u "$1" --since "$desde" --no-pager 2>/dev/null \
    | grep -v '\[HEALTH\]' | grep -q .
}

sucesso_em() {
  journalctl -u horsingmaze-prd --since "$1" --no-pager 2>/dev/null \
    | grep -q "Resultado da execução agendada: Sucesso"
}

# 1. APIs de pé? (prd=3001, teste=3000)
if ! curl -sf -m 10 http://localhost:3001/health >/dev/null; then
  if ocupado horsingmaze-prd; then
    echo "prd: /health mudo, mas a unit segue logando — ocupado (pipeline), não morto"
  else
    notify prd_down "PROD /health (3001) não responde — horsingmaze-prd pode estar morto"
  fi
fi
if ! curl -sf -m 10 http://localhost:3000/health >/dev/null; then
  notify hml_down "TESTE /health (3000) não responde — horsingmaze-hmlmanus pode estar morto"
fi

# 2. Pipeline diário (roda SÓ no prd) completou nas últimas 26h?
if ! sucesso_em "26 hours ago"; then
  # Trabalhando E com sucesso dentro de 34h = execução em andamento, não falha.
  # O teto de 34h é deliberado: dá ~8h de folga sobre o ciclo diário e impede
  # que um pipeline travado em laço, logando para sempre, cale o alarme.
  if ocupado horsingmaze-prd && sucesso_em "34 hours ago"; then
    echo "pipeline sem sucesso em 26h, mas a unit está logando — execução em curso"
  else
    notify pipeline_stale "Pipeline diário do PROD sem sucesso nas últimas 26h — verificar cron/journal"
  fi
fi
