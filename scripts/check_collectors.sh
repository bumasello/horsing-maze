#!/usr/bin/env bash
# Watchdog dos coletores do bspnode e do backup. RODA NO MAZESERVER.
#
# Por que aqui e não no bspnode: se o bspnode morrer, quem precisa gritar é
# outra máquina. Vigia rodando dentro da máquina vigiada não detecta silêncio —
# é o mesmo motivo pelo qual o backup é pull.
#
# Reusa o canal que JÁ existe (ntfy.sh, mesmo tópico do check_horsingmaze.sh).
# Não inventar um segundo canal: dois canais é um a mais para manter e um a
# mais para deixar de ler.
#
# O que vigia:
#   1. bspnode inalcançável                    (o caso do silêncio total)
#   2. pp_ew_collector parado                  (cron 0 6-21 UTC, de hora em hora)
#   3. smarkets_collector parado               (cron */15 8-21 UTC)
#   4. CSVs de BSP velhos                      (cron 2:30 UTC, diário)
#   5. backup sem rodar, ou com falha/mutação  (cron 3:30 local no mazeserver)
#
# Uso:
#   ./check_collectors.sh              # normal, para o cron
#   DRY_RUN=1 ./check_collectors.sh    # mostra o que alertaria, sem enviar
#   SELFTEST=1 ./check_collectors.sh   # envia UM alerta de teste e sai
#
# Instalação (crontab do mazedev):  7 * * * * /home/mazedev/check_collectors.sh

set -u

TOPIC="${HM_NTFY_TOPIC:-horsingmaze-maze-alerts-x7k2}"
STATE_DIR="${HOME}/.cache/horsingmaze-watchdog"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/bspnode_backup}"
SRC_HOST="${SRC_HOST:-ubuntu@100.92.130.99}"
BACKUP_LOG="${BACKUP_LOG:-$HOME/logs/backup_bspnode.log}"
MANIFEST="${MANIFEST:-/mnt/dados/backup/bspnode/.manifest/manifest.current}"
DRY_RUN="${DRY_RUN:-0}"

mkdir -p "$STATE_DIR"
alertas=0

# Mesmo contrato do check_horsingmaze.sh: no máximo 1 alerta por problema a
# cada 6h, para um coletor quebrado não virar 24 notificações por dia.
notify() {
  local key="$1" msg="$2"
  alertas=$((alertas + 1))
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [DRY_RUN] alertaria '$key': $msg"
    return
  fi
  local stamp="$STATE_DIR/$key"
  if [ -f "$stamp" ] && [ $(( $(date +%s) - $(stat -c %Y "$stamp") )) -lt 21600 ]; then
    echo "  (silenciado por rate-limit de 6h) $key"
    return
  fi
  touch "$stamp"
  curl -s -m 10 -H "Title: HorsingMaze COLETA" -H "Priority: high" \
    -d "$msg ($(date '+%d/%m %H:%M'))" "https://ntfy.sh/$TOPIC" >/dev/null
  echo "  ⚠️  alertado: $key"
}

if [ "${SELFTEST:-0}" = "1" ]; then
  curl -s -m 10 -H "Title: HorsingMaze TESTE" -H "Priority: default" \
    -d "Teste do watchdog de coleta — se você está lendo isto, o canal funciona. ($(date '+%d/%m %H:%M'))" \
    "https://ntfy.sh/$TOPIC" >/dev/null
  echo "✅ notificação de teste enviada para ntfy.sh/$TOPIC"
  exit 0
fi

hora_utc=$((10#$(date -u +%H)))
echo "🔎 watchdog de coleta — $(date -u '+%F %T UTC')"

# ------------------------------------------------- 1. o bspnode está vivo?
# Uma chamada só devolve o frescor de tudo: menos ida e volta, e um timeout
# único decide "inalcançável".
remoto=$(ssh -n -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=20 \
         -o StrictHostKeyChecking=accept-new "$SRC_HOST" '
  agora=$(date -u +%s)
  idade() { [ -f "$1" ] && echo $(( (agora - $(stat -c %Y "$1")) / 60 )) || echo AUSENTE; }
  echo "pp_ew $(idade pp_ew_data/pp_ew_v1_$(date -u +%Y%m%d).csv)"
  echo "smarkets $(idade smarkets_data/smarkets_book_v3_$(date -u +%Y%m%d).csv)"
  b=$(ls -1t betfair_sp_data/*.csv 2>/dev/null | head -1)
  if [ -n "$b" ]; then echo "bsp $(( (agora - $(stat -c %Y "$b")) / 60 ))"; else echo "bsp AUSENTE"; fi
  echo "disco $(df --output=pcent / | tail -1 | tr -dc 0-9)"
' 2>/dev/null)

if [ -z "$remoto" ]; then
  notify bspnode_mudo "bspnode INALCANÇÁVEL — coleta de each-way, Smarkets e BSP parada, e o backup não roda"
  echo "📊 RESUMO alertas=$alertas (bspnode mudo, demais checagens puladas)"
  exit 1
fi

campo() { echo "$remoto" | awk -v k="$1" '$1==k{print $2}'; }

# ------------------------------------------------- 2. termos de each-way (PP)
# De hora em hora entre 06 e 21 UTC. 90 min tolera uma batida perdida + execução.
pp=$(campo pp_ew)
if [ "$hora_utc" -ge 7 ] && [ "$hora_utc" -le 21 ]; then
  if [ "$pp" = "AUSENTE" ]; then
    notify pp_ew_ausente "Coletor de each-way (Paddy Power) sem arquivo hoje — janela cega parou de crescer"
  elif [ "$pp" -gt 90 ]; then
    notify pp_ew_parado "Coletor de each-way parado há ${pp} min (esperado: de hora em hora)"
  else
    echo "  ✅ pp_ew            ${pp} min"
  fi
else
  echo "  ⏸  pp_ew            fora da janela (06–21 UTC)"
fi

# ------------------------------------------------- 3. livro do Smarkets
# A cada 15 min entre 08 e 21 UTC. 45 min tolera duas batidas perdidas.
smk=$(campo smarkets)
if [ "$hora_utc" -ge 9 ] && [ "$hora_utc" -le 21 ]; then
  if [ "$smk" = "AUSENTE" ]; then
    notify smarkets_ausente "Coletor do Smarkets sem arquivo hoje — bid-ask do dia perdido para sempre"
  elif [ "$smk" -gt 45 ]; then
    notify smarkets_parado "Coletor do Smarkets parado há ${smk} min (esperado: a cada 15 min)"
  else
    echo "  ✅ smarkets         ${smk} min"
  fi
else
  echo "  ⏸  smarkets         fora da janela (08–21 UTC)"
fi

# ------------------------------------------------- 4. CSVs de BSP
# Cron diário às 02:30 UTC. 30h cobre um dia inteiro + folga.
bsp=$(campo bsp)
if [ "$bsp" = "AUSENTE" ]; then
  notify bsp_ausente "Nenhum CSV de BSP no bspnode — verificar diretório"
elif [ "$bsp" -gt 1800 ]; then
  notify bsp_velho "CSVs de BSP sem atualização há $((bsp / 60))h (cron das 02:30 UTC não rodou ou a Betfair bloqueou)"
else
  echo "  ✅ bsp              $((bsp / 60))h"
fi

# ------------------------------------------------- 5. disco do bspnode
disco=$(campo disco)
if [ -n "$disco" ] && [ "$disco" -ge 85 ]; then
  notify bspnode_disco "Disco do bspnode em ${disco}% — coleta para quando encher"
else
  echo "  ✅ disco bspnode    ${disco}%"
fi

# ------------------------------------------------- 6. o backup rodou e passou?
if [ ! -f "$MANIFEST" ]; then
  notify backup_sem_manifesto "Backup do bspnode nunca gerou manifesto — verificar $MANIFEST"
else
  idade_bkp=$(( ( $(date +%s) - $(stat -c %Y "$MANIFEST") ) / 3600 ))
  if [ "$idade_bkp" -gt 30 ]; then
    notify backup_velho "Backup do bspnode sem rodar há ${idade_bkp}h (cron das 03:30 local)"
  else
    echo "  ✅ backup           ${idade_bkp}h"
  fi
fi

# A última linha de RESUMO do log diz se a última execução achou problema.
if [ -f "$BACKUP_LOG" ]; then
  resumo=$(grep 'RESUMO' "$BACKUP_LOG" | tail -1)
  if [ -n "$resumo" ]; then
    falhas=$(echo "$resumo" | sed -n 's/.*falhas=\([0-9]*\).*/\1/p')
    mut=$(echo "$resumo" | sed -n 's/.*mutacoes=\([0-9]*\).*/\1/p')
    if [ "${mut:-0}" -gt 0 ]; then
      notify backup_mutacao "Backup detectou ${mut} arquivo(s) ALTERADO(S) com mtime antigo — possível corrupção. Ver $BACKUP_LOG"
    elif [ "${falhas:-0}" -gt 0 ]; then
      notify backup_falha "Backup do bspnode com ${falhas} diretório(s) falhando na sincronia"
    fi
  fi
fi

echo "📊 RESUMO alertas=$alertas"
[ "$alertas" -gt 0 ] && exit 1
exit 0
