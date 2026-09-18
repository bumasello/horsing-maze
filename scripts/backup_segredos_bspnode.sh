#!/usr/bin/env bash
# Põe as CREDENCIAIS do bspnode dentro do backup. RODA NO MAZESERVER.
#
# POR QUE EXISTE
# O backup pull (`backup_bspnode.sh`) copia diretórios de DADOS
# (`betfair_sp_data`, `smarkets_data`, `pp_ew_data`…) e não toca nos dotfiles da
# home. Descoberto em 2026-09-18, ao inventariar a VM para escrever o script de
# provisionamento: as cinco credenciais existem SÓ no bspnode.
#
# Se a Oracle recuperar a instância — e a política de ociosidade diz que ela
# pode, com os três critérios batendo hoje —, some junto a lista de 90 chaves da
# RapidAPI, que é de longe a mais cara de reconstruir.
#
# O QUE NÃO ENTRA, DE PROPÓSITO
# A chave SSH de deploy (`~/.ssh/mazetick_data`). Copiar chave privada
# multiplica a exposição, e regenerar custa cinco minutos: gerar par novo no
# bspnode e registrar no repositório de dados. Está no `provision_bspnode.sh`.
#
# Uso:  ./backup_segredos_bspnode.sh
# Saída: 0 tudo certo · 1 falha de cópia · 2 arquivo esperado ausente na origem

set -uo pipefail

SRC_HOST="${SRC_HOST:-ubuntu@100.92.130.99}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/bspnode_backup}"
DEST="${DEST:-/mnt/dados/backup/bspnode/.segredos}"
SSH_CMD="ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new"

# Lista explícita, um por linha. Dotfile novo não entra sozinho: tem de ser
# acrescentado aqui por alguém que saiba o que é e por que precisa sobreviver.
ARQUIVOS=".hr_keys .hr_host .racingapi_creds .mazetick_deploy_hook .mazetick_ntfy_topic"

mkdir -p "$DEST" && chmod 700 "$DEST"
echo "🔑 credenciais do bspnode → $DEST"

faltando=0
falhas=0
for f in $ARQUIVOS; do
  if ! $SSH_CMD "$SRC_HOST" "test -r ~/$f" 2>/dev/null; then
    echo "  ⚠️  $f AUSENTE na origem — a coleta que depende dele já pode estar quebrada"
    faltando=$((faltando + 1))
    continue
  fi
  if $SSH_CMD "$SRC_HOST" "cat ~/$f" > "$DEST/$f.tmp" 2>/dev/null; then
    chmod 600 "$DEST/$f.tmp"
    mv -f "$DEST/$f.tmp" "$DEST/$f"
    printf '  ✅ %-24s %s bytes\n' "$f" "$(wc -c < "$DEST/$f")"
  else
    echo "  ❌ $f — falha na cópia"
    rm -f "$DEST/$f.tmp"
    falhas=$((falhas + 1))
  fi
done

# Arquivo vazio copiado COM SUCESSO é pior que uma falha: parece backup e não é.
# É a mesma família do `grep` que devolve "limpo" sem ter lido nada.
for f in $ARQUIVOS; do
  if [ -f "$DEST/$f" ] && [ ! -s "$DEST/$f" ]; then
    echo "  ❌ $f copiado VAZIO — tratando como falha"
    falhas=$((falhas + 1))
  fi
done

total=$(echo "$ARQUIVOS" | wc -w)
echo "📊 RESUMO esperados=$total ausentes=$faltando falhas=$falhas"
[ "$falhas" -gt 0 ] && exit 1
[ "$faltando" -gt 0 ] && exit 2
exit 0
