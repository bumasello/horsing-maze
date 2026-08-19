#!/usr/bin/env bash
# Prepara a VM de fora do Brasil pra baixar os CSVs de BSP da Betfair.
# Rode NA VM (Oracle Cloud / qualquer host fora do BR), como usuário normal.
#
# Uso:
#   curl -fsSL <url-deste-arquivo> | bash -s -- tskey-auth-XXXXX
#   ou: ./bootstrap_bsp_node.sh tskey-auth-XXXXX
#
# O argumento é a auth key do Tailscale (https://login.tailscale.com/admin/settings/keys).
# Sem argumento, o script instala o tailscale e para, pra você rodar
# `sudo tailscale up --ssh` manualmente e autenticar no navegador.

set -uo pipefail
AUTHKEY="${1:-}"
HOSTNAME_TS="${TS_HOSTNAME:-bspnode}"

echo "════════════════════════════════════════════════════════════"
echo "  1/3  Onde esta máquina está?"
echo "════════════════════════════════════════════════════════════"
geo=$(curl -sS --max-time 15 "http://ip-api.com/line/?fields=query,country,city,isp" 2>/dev/null)
echo "$geo" | sed 's/^/  /'
country=$(echo "$geo" | sed -n '2p')
if [ "$country" = "Brazil" ]; then
  echo
  echo "  ❌ ABORTANDO: esta máquina está no Brasil. A Betfair vai geo-redirecionar."
  echo "     Recrie a VM numa região fora do BR (London / Amsterdam / Frankfurt)."
  exit 2
fi
echo "  ✅ fora do Brasil"

echo
echo "════════════════════════════════════════════════════════════"
echo "  2/3  A Betfair responde daqui?  (o teste que importa)"
echo "════════════════════════════════════════════════════════════"
URL="https://promo.betfair.com/betfairsp/prices/dwbfpricesukwin13072026.csv"
res=$(curl -sS -o /tmp/bsp_probe.csv -w "%{http_code} %{redirect_url}" --max-time 30 "$URL" 2>&1)
code="${res%% *}"; redir="${res#* }"
echo "  HTTP $code ${redir:+→ $redir}"
if [ "$code" != "200" ]; then
  echo "  ❌ FALHOU. Sem acesso direto — não adianta seguir."
  exit 3
fi
head -1 /tmp/bsp_probe.csv | cut -c1-90 | sed 's/^/  cabeçalho: /'
echo "  tamanho: $(du -h /tmp/bsp_probe.csv | cut -f1)"
rm -f /tmp/bsp_probe.csv
echo "  ✅ acesso direto ao BSP funcionando"

echo
echo "════════════════════════════════════════════════════════════"
echo "  3/3  Tailscale"
echo "════════════════════════════════════════════════════════════"
if ! command -v tailscale >/dev/null 2>&1; then
  echo "  instalando..."
  curl -fsSL https://tailscale.com/install.sh | sh || { echo "  ❌ falha na instalação"; exit 4; }
fi
echo "  versão: $(tailscale version | head -1)"

if [ -n "$AUTHKEY" ]; then
  # --ssh habilita Tailscale SSH: acesso por identidade da tailnet, sem
  # distribuir chaves. --hostname fixa o nome pra referência estável.
  sudo tailscale up --ssh --authkey="$AUTHKEY" --hostname="$HOSTNAME_TS" \
    && echo "  ✅ conectado como '$HOSTNAME_TS'" \
    || { echo "  ❌ tailscale up falhou"; exit 5; }
  echo
  tailscale status | head -10
else
  echo
  echo "  ⚠️  sem auth key. Rode agora, e autentique no navegador:"
  echo "      sudo tailscale up --ssh --hostname=$HOSTNAME_TS"
fi

echo
echo "════════════════════════════════════════════════════════════"
echo "  Pronto. Me passe o nome/IP que aparecer no 'tailscale status'."
echo "════════════════════════════════════════════════════════════"
