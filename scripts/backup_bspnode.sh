#!/usr/bin/env bash
# Backup PULL: bspnode (VM de Londres) -> mazeserver /mnt/dados/backup/bspnode
#
# Por que pull e não push: quem guarda a cópia é quem inicia a conexão. Um erro
# de script, um disco cheio ou um comprometimento no bspnode não conseguem
# apagar o backup, porque o bspnode não tem credencial nenhuma para cá.
#
# Por que isto importa mais que qualquer outra tarefa de infra do projeto:
# nenhum destes dados pode ser recoletado. Os CSVs de BSP não são servidos para
# IP brasileiro; o livro do Smarkets e os termos de each-way da Paddy Power são
# fotos instantâneas que não existem em lugar nenhum depois que a hora passa.
# Perder o bspnode hoje é perder o ativo inteiro do projeto.
#
# "Imutável" aqui é o que dá para fazer a custo zero em disco local:
#   - nunca apaga (sem --delete): sumir na origem não some no destino
#   - detecta MUTAÇÃO: arquivo antigo que mudou de hash é sinalizado
# Imutabilidade de verdade (object lock) exige armazenamento em nuvem — quando
# houver orçamento, esta é a terceira cópia que falta.
#
# Uso:
#   ./backup_bspnode.sh              # sincroniza tudo e verifica
#   DIRS="pp_ew_data" ./backup_bspnode.sh
# Env:
#   SRC_HOST (default ubuntu@100.92.130.99 — IP da tailnet, nunca o público:
#            o IP público da Oracle é efêmero e muda se a instância reiniciar)
#   SSH_KEY  (default ~/.ssh/bspnode_backup)
#   DEST     (default /mnt/dados/backup/bspnode)
#
# Saída: 0 tudo certo · 1 falha de sincronia · 2 mutação suspeita detectada

set -uo pipefail

SRC_HOST="${SRC_HOST:-ubuntu@100.92.130.99}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/bspnode_backup}"
DEST="${DEST:-/mnt/dados/backup/bspnode}"
DIRS="${DIRS:-betfair_sp_data smarkets_data pp_ew_data racingapi_data tote_data book_data funding_data logs}"
MANIFEST_DIR="$DEST/.manifest"
LOCK="/tmp/backup_bspnode.lock"

SSH_CMD="ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new"

# Uma execução por vez. Se a anterior travou, esta não empilha.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "⏭  já existe um backup em andamento (lock $LOCK) — saindo."
  exit 0
fi

echo "🗄  backup bspnode → $DEST"
echo "🕐 $(date -u '+%F %T UTC')"
echo

mkdir -p "$DEST" "$MANIFEST_DIR"

# ---------------------------------------------------------------- sincronia
fail=0
for d in $DIRS; do
  mkdir -p "$DEST/$d"
  out=$(rsync -a --partial --timeout=180 --stats \
        -e "$SSH_CMD" "$SRC_HOST:$d/" "$DEST/$d/" 2>&1)
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "  ❌ $d — rsync saiu $rc"
    echo "$out" | tail -3 | sed 's/^/       /'
    fail=$((fail + 1))
    continue
  fi
  novos=$(echo "$out" | sed -n 's/^Number of regular files transferred: *//p' | tr -d ',')
  total=$(ls -1 "$DEST/$d" 2>/dev/null | wc -l)
  printf '  ✅ %-18s %5s arquivos no destino  (%s novos/alterados)\n' \
         "$d" "$total" "${novos:-0}"
done

# ------------------------------------------------------- manifesto e mutação
# Formato, separado por TAB: <sha256> <mtime_epoch> <caminho relativo>.
# Duas passadas sem processo por arquivo (são ~3 mil): os hashes de uma vez via
# xargs, os mtimes de uma vez via -printf, e um join pelo caminho.
NEW="$MANIFEST_DIR/manifest.new"
CUR="$MANIFEST_DIR/manifest.current"
TMP_H=$(mktemp) ; TMP_M=$(mktemp)
trap 'rm -f "$TMP_H" "$TMP_M"' EXIT

( cd "$DEST" || exit 1
  find $DIRS -type f -print0 2>/dev/null | xargs -0 -r sha256sum \
    | sed 's/  /\t/' | sort -t"$(printf '\t')" -k2 > "$TMP_H"
  find $DIRS -type f -printf '%p\t%T@\n' 2>/dev/null \
    | sed 's/\.[0-9]*$//' | sort -t"$(printf '\t')" -k1 > "$TMP_M"
  join -t"$(printf '\t')" -1 2 -2 1 -o 1.1,2.2,0 "$TMP_H" "$TMP_M"
) | sort -t"$(printf '\t')" -k3 > "$NEW"

n_files=$(wc -l < "$NEW")
mutacoes=0
crescendo=0

if [ -s "$CUR" ]; then
  # Um arquivo de dia já fechado NÃO deve mudar nunca mais. Se mudou e o mtime
  # é antigo, é corrupção ou reescrita indevida — e é isso que queremos ver.
  # Se o mtime é recente, é o arquivo do dia ainda crescendo: esperado.
  corte=$(date -u -d '2 days ago' +%s)
  saida=$(join -t"$(printf '\t')" -1 3 -2 3 -o 1.1,2.1,2.2,0 \
            <(sort -t"$(printf '\t')" -k3 "$CUR") \
            <(sort -t"$(printf '\t')" -k3 "$NEW") 2>/dev/null \
          | awk -F'\t' -v corte="$corte" '
              $1 != $2 {
                if ($3 + 0 >= corte) { c++ }
                else { print "  ⚠️  MUTAÇÃO: " $4 " mudou de conteúdo com mtime antigo"; m++ }
              }
              END { printf "__CONTAGEM__\t%d\t%d\n", c + 0, m + 0 }')
  echo "$saida" | grep -v '^__CONTAGEM__' || true
  crescendo=$(echo "$saida" | awk -F'\t' '/^__CONTAGEM__/{print $2}')
  mutacoes=$(echo "$saida" | awk -F'\t' '/^__CONTAGEM__/{print $3}')
fi

mv -f "$NEW" "$CUR"
cp -f "$CUR" "$MANIFEST_DIR/manifest-$(date -u +%Y%m%d).sha256"
# Guarda 30 manifestos diários; o histórico serve para datar uma corrupção.
ls -1t "$MANIFEST_DIR"/manifest-*.sha256 2>/dev/null | tail -n +31 | xargs -r rm -f

# ------------------------------------------------------------------- resumo
n_dirs=$(echo "$DIRS" | wc -w)
tamanho=$(du -sh "$DEST" 2>/dev/null | cut -f1)
echo
echo "📊 RESUMO ok=$((n_dirs - fail)) falhas=$fail arquivos=$n_files tamanho=$tamanho mutacoes=$mutacoes crescendo=$crescendo"

[ "$fail" -gt 0 ] && exit 1
[ "$mutacoes" -gt 0 ] && exit 2
exit 0
