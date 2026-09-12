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
#   MARKETS="win place" ./fetch_betfair_bsp.sh 2024-01-01 2026-08-21
# Env:
#   BSP_DIR  (default ./betfair_sp_data)
#   MARKETS  (default "win") — "win", "place" ou "win place". O mercado
#            "place" é o "To Be Placed", mesmo schema e mesma cobertura do win;
#            é a base do probe de mispricing win→place.

set -uo pipefail

BSP_DIR="${BSP_DIR:-$PWD/betfair_sp_data}"
BASE="https://promo.betfair.com/betfairsp/prices"
MARKETS="${MARKETS:-win}"
FIRST_MK="${MARKETS%% *}"
mkdir -p "$BSP_DIR"

# Datas: argumentos, ou do dia seguinte ao arquivo mais recente até hoje.
# A detecção automática se baseia no PRIMEIRO mercado de $MARKETS — win e place
# podem estar em pontos diferentes do backfill.
if [ $# -ge 2 ]; then
  START="$1"; END="$2"
else
  LAST=$(ls "$BSP_DIR" 2>/dev/null \
    | sed -n "s/^dwbfprices\(uk\|ire\)${FIRST_MK}\([0-9]\{2\}\)\([0-9]\{2\}\)\([0-9]\{4\}\)\.csv$/\4-\3-\2/p" \
    | sort | tail -1)
  if [ -z "${LAST:-}" ]; then
    echo "❌ $BSP_DIR sem arquivos de '$FIRST_MK' e nenhum intervalo dado." >&2
    echo "   Use: $0 AAAA-MM-DD AAAA-MM-DD" >&2
    exit 1
  fi
  START=$(date -u -d "$LAST +1 day" +%F)
  # END é HOJE, e isso está certo — não "conserte" para ontem.
  #
  # O nome do arquivo é a data de PUBLICAÇÃO; o conteúdo é a jornada do dia
  # ANTERIOR. Medido em 2026-09-12 sobre seis arquivos (02→01, 03→02, 04→03,
  # 05→04, 10→09, 12→11 de setembro): o deslocamento de um dia é constante.
  # E o arquivo publicado hoje já sai fechado — rebaixado às 17:00 UTC deu md5
  # idêntico ao gravado, cobrindo o card inteiro (13:15 → 18:28). Logo, não há
  # risco de gravar dia parcial, e parar em "ontem" só faria a coleta atrasar
  # dois dias em vez de um.
  END=$(date -u +%F)
  # Já temos a publicação de hoje, que é a última que pode existir. Sem esta
  # guarda o rodapé diário fica com um intervalo invertido no log e uma sonda
  # inútil contra um arquivo que ainda não foi publicado.
  if [ "$(date -u -d "$START" +%s)" -gt "$(date -u -d "$END" +%s)" ]; then
    echo "✅ nada a baixar: em dia até $LAST."
    exit 0
  fi
fi

echo "📂 destino:   $BSP_DIR"
echo "🎯 mercados:  $MARKETS"
echo "📅 intervalo: $START → $END"

# Sonda de geo-bloqueio antes de tentar em massa.
#
# ⚠️ O bloqueio de verdade é um 302 cujo destino é OUTRO HOST
# (promo.betfair.bet.br, que dá NXDOMAIN). Um 302 pra MESMA URL é outra coisa:
# a Cloudflare devolve isso de forma intermitente no edge de Londres, e seguir
# o redirect resolve. Até 2026-09-12 a sonda tratava todo 302 como bloqueio e
# abortava o backfill inteiro por causa de um redirect transitório — foi assim
# que os CSVs ficaram 7 dias atrasados sem ninguém perceber.
probe_url="$BASE/dwbfpricesuk${FIRST_MK}$(date -u -d "$START" +%d%m%Y).csv"
for try in 1 2 3; do
  probe=$(curl -sSL -o /dev/null -w "%{http_code} %{url_effective}" --max-time 30 "$probe_url" 2>&1)
  code="${probe%% *}"
  final="${probe##* }"
  case "$final" in
    *bet.br*)
      echo "❌ BLOQUEADO: redirecionado pra $final"
      echo "   Este host está sendo geo-redirecionado. Rode numa máquina fora do Brasil"
      echo "   (exit node do Tailscale, VPS UK/EU) e tente de novo."
      exit 2 ;;
  esac
  if [ "$code" = "403" ]; then
    echo "❌ BLOQUEADO (HTTP 403 — WAF ou filtro de conteúdo na rede local)."
    exit 2
  fi
  # 404 é legítimo: o dia inicial pode não ter corrida no país da sonda.
  case "$code" in 200|404) break ;; esac
  sleep $((try * 3))
done
echo "✅ acesso OK (HTTP $code na sonda)"
echo

ok=0; skip=0; miss=0; fail=0
d="$START"
while [ "$(date -u -d "$d" +%s)" -le "$(date -u -d "$END" +%s)" ]; do
  ddmmyyyy=$(date -u -d "$d" +%d%m%Y)
  for mk in $MARKETS; do
  for cc in uk ire; do
    f="dwbfprices${cc}${mk}${ddmmyyyy}.csv"
    out="$BSP_DIR/$f"
    if [ -s "$out" ]; then skip=$((skip+1)); continue; fi
    # A Betfair devolve 429 (rate limit) e 302 esporádico sob rajada. Sem
    # retry, ~38% dos arquivos falham. Backoff linear resolve 100% deles.
    # O -L é necessário pro 302 auto-referente da Cloudflare; quem impede
    # seguir redirect pra lixo é a validação de cabeçalho logo abaixo.
    got=0
    for try in 1 2 3 4 5; do
      http=$(curl -sSL -o "$out.part" -w "%{http_code}" --max-time 60 "$BASE/$f" 2>/dev/null)
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
  done
  d=$(date -u -d "$d +1 day" +%F)
done

echo
echo "📊 baixados $ok | já existiam $skip | sem corrida (404) $miss | falhas $fail"
echo "📦 total no diretório: $(ls "$BSP_DIR" | wc -l) arquivos"
[ "$fail" -gt 0 ] && exit 1
exit 0
