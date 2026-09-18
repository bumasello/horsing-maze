#!/usr/bin/env bash
# Exporta o histórico profundo do Supabase para o bspnode. RODA NO MAZESERVER.
#
# POR QUE EXISTE
# O `/horse` precisa de estatística por condição "da carreira inteira, sem
# look-ahead" — o diferencial contra os 14 dias que os portais mostram. Esse
# histórico (2019-04-28 → 2026-07-22, 667 mil linhas) vive só no Supabase, que
# roda no mazeserver, atrás de uma rede doméstica que já caiu.
#
# Decidido em 2026-09-16 (opção C): o dado MIGRA para o bspnode e as features
# passam a ser calculadas lá. É migração, não dependência — depois disto o
# mazeserver volta a ser laboratório descartável, e o caminho crítico do site
# fica numa máquina só.
#
# Não se move o Supabase: 12 containers em 2,8 GB e 1 OCPU no bspnode contra 4
# no mazeserver. A produção não precisa do SERVIÇO, precisa do DADO.
#
# ⛔ O QUE NÃO SAI DAQUI, E POR QUÊ
# `bsp`, `wap`, `morning_wap`, `pre_min`, `pre_max`, `ip_min`, `ip_max` são
# preço derivado da BETFAIR. A regra 2 do handoff proíbe publicá-los, e a
# licença de publicação de odds exige ser afiliado — programa fechado em
# 01/07/2025. O corte acontece AQUI, na origem, e não na hora de montar o JSON:
# lista de permissão na fonte é a defesa do projeto, e confiar no recorte de
# jusante é como o filtro de país do Smarkets nunca ter filtrado nada.
#
# ⚠️ `comment` SAI, mas é texto do Racing Post. Serve para DERIVAR estilo de
# corrida (E/EP/P/S); nunca para publicar literal. Derivado nosso é publicável,
# a obra de terceiro não.
#
# Uso:
#   ./export_historico_profundo.sh              # exporta e envia
#   ./export_historico_profundo.sh --so-local   # exporta, não envia

set -uo pipefail

COMPOSE="${COMPOSE:-/mnt/dados/supabase/docker}"
SAIDA="${SAIDA:-/mnt/dados/export}"
BSP_HOST="${BSP_HOST:-ubuntu@100.92.130.99}"
BSP_KEY="${BSP_KEY:-$HOME/.ssh/bspnode_backup}"
BSP_DEST="${BSP_DEST:-historico_profundo}"
SO_LOCAL=0
[ "${1:-}" = "--so-local" ] && SO_LOCAL=1

# Lista de PERMISSÃO, explícita. Coluna nova na tabela não viaja sozinha.
COLUNAS="race_date, course, off_time, horse_name, horse_name_norm, region,
 race_type, race_class, pattern, rating_band, age_band, dist_f, dist_m, going,
 surface, ran, num, pos, pos_raw, draw, ovr_btn, btn, age, sex, lbs, hg, secs,
 dec_odds, jockey, trainer, prize, or_rating, rpr_rating, ts_rating, sire, dam,
 damsire, owner, comment"

mkdir -p "$SAIDA"
ARQ="$SAIDA/rpscrape_results.csv.gz"

cd "$COMPOSE" || { echo "FATAL: $COMPOSE não existe" >&2; exit 1; }
PW=$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
[ -n "$PW" ] || { echo "FATAL: sem POSTGRES_PASSWORD em $COMPOSE/.env" >&2; exit 1; }

echo "📤 exportando hml.rpscrape_results → $ARQ"
echo "   (sem as colunas de preço da Betfair — ver o cabeçalho deste arquivo)"

SQL="\\copy (select $COLUNAS from hml.rpscrape_results order by race_date, course, off_time) to stdout with (format csv, header true)"

if ! docker exec -i -e PGPASSWORD="$PW" supabase-db \
     psql -U supabase_admin -d postgres -c "$SQL" 2>/tmp/export_err | gzip -6 > "$ARQ.tmp"; then
  echo "FATAL: exportação falhou" >&2
  head -3 /tmp/export_err >&2
  rm -f "$ARQ.tmp"
  exit 1
fi
mv -f "$ARQ.tmp" "$ARQ"

# Contar é a prova. "O comando terminou" não é.
LINHAS=$(zcat "$ARQ" | wc -l)
BYTES=$(stat -c %s "$ARQ")
echo "   ✅ $((LINHAS - 1)) linhas + cabeçalho, $(numfmt --to=iec "$BYTES")"

# Guarda que nenhuma coluna proibida escapou. Barato, e o custo de errar é
# publicar preço da Betfair.
CAB=$(zcat "$ARQ" | head -1)
for proibida in bsp wap morning_wap pre_min pre_max ip_min ip_max; do
  if printf '%s' "$CAB" | tr ',' '\n' | grep -qx "$proibida"; then
    echo "   ❌ coluna proibida '$proibida' no cabeçalho — abortando" >&2
    exit 2
  fi
done
echo "   ✅ nenhuma coluna de preço da Betfair no cabeçalho"

if [ "$SO_LOCAL" = "1" ]; then
  echo "   (--so-local: não enviado)"
  exit 0
fi

echo "🚚 enviando para o bspnode"
ssh -i "$BSP_KEY" -o BatchMode=yes -o ConnectTimeout=20 "$BSP_HOST" "mkdir -p ~/$BSP_DEST" || {
  echo "FATAL: bspnode inalcançável" >&2; exit 1; }
if ! rsync -a --partial --timeout=600 -e "ssh -i $BSP_KEY -o BatchMode=yes" \
     "$ARQ" "$BSP_HOST:$BSP_DEST/"; then
  echo "FATAL: transferência falhou" >&2
  exit 1
fi

# Conferir do outro lado, por hash. "rsync saiu 0" não prova conteúdo.
H_LOCAL=$(sha256sum "$ARQ" | cut -d' ' -f1)
H_REMOTO=$(ssh -i "$BSP_KEY" -o BatchMode=yes "$BSP_HOST" "sha256sum ~/$BSP_DEST/$(basename "$ARQ")" | cut -d' ' -f1)
if [ "$H_LOCAL" = "$H_REMOTO" ]; then
  echo "   ✅ hash confere: ${H_LOCAL:0:16}…"
else
  echo "   ❌ hash DIFERE — local ${H_LOCAL:0:16} remoto ${H_REMOTO:0:16}" >&2
  exit 1
fi
echo "📊 pronto."
