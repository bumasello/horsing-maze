#!/usr/bin/env bash
# Baixa os CSVs de BSP (Betfair Starting Price) que faltam.
#
# ⚠️ RODE ESTE SCRIPT NUMA MÁQUINA FORA DO BRASIL. A partir de IP brasileiro a
# Betfair devolve HTTP 302 pra promo.betfair.bet.br, que não resolve (NXDOMAIN).
# O script detecta isso e aborta com mensagem clara em vez de gravar lixo.
#
# Desenho deliberado: NÃO exige rotear o mazeserver por exit node. Rode aqui,
# na VM de fora, e sincronize os arquivos de volta pela tailnet. O mazeserver
# roda dois serviços de produção; mudar o egresso dele adiciona latência e um
# ponto de falha por 1,8 MB de CSV.
#
# Uso:
#   ./fetch_betfair_bsp.sh                          # do dia seguinte ao último local até hoje
#   ./fetch_betfair_bsp.sh 2026-07-13 2026-08-18    # intervalo explícito
# Env: BSP_DIR (default ./betfair_sp_data)

set -uo pipefail

BSP_DIR="${BSP_DIR:-$PWD/betfair_sp_data}"
BASE="https://promo.betfair.com/betfairsp/prices"
mkdir -p "$BSP_DIR"

# Datas: argumentos, ou do dia seguinte ao arquivo mais recente até hoje.
if [ $# -ge 2 ]; then
  START="$1"; END="$2"
else
  LAST=$(ls "$BSP_DIR" 2>/dev/null \
    | sed -n 's/^dwbfprices\(uk\|ire\)win\([0-9]\{2\}\)\([0-9]\{2\}\)\([0-9]\{4\}\)\.csv$/\4-\3-\2/p' \
    | sort | tail -1)
  if [ -z "${LAST:-}" ]; then
    echo "❌ $BSP_DIR vazio e nenhum intervalo dado. Use: $0 AAAA-MM-DD AAAA-MM-DD" >&2
    exit 1
  fi
  START=$(date -u -d "$LAST +1 day" +%F)
  END=$(date -u +%F)
fi

echo "📂 destino:   $BSP_DIR"
echo "📅 intervalo: $START → $END"

# Sonda de geo-bloqueio antes de tentar em massa.
probe_url="$BASE/dwbfpricesukwin$(date -u -d "$START" +%d%m%Y).csv"
probe=$(curl -sS -o /dev/null -w "%{http_code} %{redirect_url}" --max-time 25 "$probe_url" 2>&1)
code="${probe%% *}"
redir="${probe#* }"
if [ "$code" = "302" ] || [ "$code" = "403" ]; then
  echo "❌ BLOQUEADO (HTTP $code${redir:+ → $redir})."
  echo "   Este host está sendo geo-redirecionado. Rode numa máquina fora do Brasil"
  echo "   (exit node do Tailscale, VPS UK/EU) e tente de novo."
  exit 2
fi
echo "✅ acesso OK (HTTP $code na sonda)"
echo

ok=0; skip=0; miss=0; fail=0
d="$START"
while [ "$(date -u -d "$d" +%s)" -le "$(date -u -d "$END" +%s)" ]; do
  ddmmyyyy=$(date -u -d "$d" +%d%m%Y)
  for cc in uk ire; do
    f="dwbfprices${cc}win${ddmmyyyy}.csv"
    out="$BSP_DIR/$f"
    if [ -s "$out" ]; then skip=$((skip+1)); continue; fi
    # A Betfair devolve 429 (rate limit) e 302 esporádico sob rajada. Sem
    # retry, ~38% dos arquivos falham. Backoff linear resolve 100% deles.
    got=0
    for try in 1 2 3 4 5; do
      http=$(curl -sS -o "$out.part" -w "%{http_code}" --max-time 60 "$BASE/$f" 2>/dev/null)
      if [ "$http" = "200" ] && [ -s "$out.part" ] && head -1 "$out.part" | grep -qi "^event_id,"; then
        mv "$out.part" "$out"; ok=$((ok+1)); got=1
        printf '  ✅ %s (%s)\n' "$f" "$(du -h "$out" | cut -f1)"
        break
      fi
      rm -f "$out.part"
      if [ "$http" = "404" ]; then
        # dia sem corrida naquele país — normal, não é erro
        miss=$((miss+1)); got=1; break
      fi
      sleep $((try * 4))
    done
    if [ "$got" = "0" ]; then
      fail=$((fail+1))
      printf '  ❌ %s (HTTP %s após 5 tentativas)\n' "$f" "$http"
    fi
    sleep 2
  done
  d=$(date -u -d "$d +1 day" +%F)
done

echo
echo "📊 baixados $ok | já existiam $skip | sem corrida (404) $miss | falhas $fail"
echo "📦 total no diretório: $(ls "$BSP_DIR" | wc -l) arquivos"
[ "$fail" -gt 0 ] && exit 1
exit 0
