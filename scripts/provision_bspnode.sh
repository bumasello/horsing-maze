#!/usr/bin/env bash
# Reconstrói o bspnode do zero. RODA NA VM NOVA, como o usuário `ubuntu`.
#
# POR QUE EXISTE
# A VM é Oracle Cloud Always Free, e a política de ociosidade permite que a
# Oracle a recupere: os três critérios (CPU p95, rede e memória abaixo de 20%
# por 7 dias) batem hoje. Camada gratuita não dá garantia — esse é o trato.
#
# Este script não evita a perda. Ele converte "desastre" em "uma tarde chata",
# que é a única coisa que se pode comprar de graça. E vale igual se a VM for
# perdida por qualquer outro motivo.
#
# O QUE ELE NÃO FAZ, E POR QUÊ
# Não cria a VM nem autentica no Tailscale: as duas coisas exigem interação no
# painel e credencial de conta. O script PARA e diz o que fazer, em vez de
# fingir que resolveu.
#
# PRÉ-REQUISITOS, na ordem:
#   1. VM nova em uk-london-1, VM.Standard.A1.Flex 1 OCPU / 6 GB, Ubuntu 24.04
#      (dentro da cota Always Free: o teto é 4 OCPU e 24 GB no total)
#   2. Este repositório acessível, ou os scripts copiados para ~/
#   3. O backup do mazeserver alcançável para restaurar dados e credenciais
#
# Uso:
#   ./provision_bspnode.sh              # tudo
#   ./provision_bspnode.sh --checar     # só confere o que falta, não muda nada

set -uo pipefail

CHECAR=0
[ "${1:-}" = "--checar" ] && CHECAR=1

HOME_DIR="${HOME:-/home/ubuntu}"
MAZESERVER="${MAZESERVER:-mazedev@100.123.96.18}"  # IP da tailnet, nunca o de LAN
BACKUP="${BACKUP:-/mnt/dados/backup/bspnode}"

ok()    { printf '  ✅ %s\n' "$*"; }
aviso() { printf '  ⚠️  %s\n' "$*"; }
# ⚠️ DOIS contadores, e a distinção importa. A primeira versão tinha só o
# global, e cada seção imprimia a sua receita de conserto quando ele era > 0 —
# ou seja, uma falha no início fazia TODAS as seções seguintes imprimirem
# instrução mesmo estando verdes. Receita ao lado de ✅ ensina a ignorar a
# receita.
PENDENTE=0        # acumulado, decide o código de saída
PENDENTE_SECAO=0  # da seção corrente, decide se a receita é impressa
falta() { printf '  ❌ %s\n' "$*"; PENDENTE=$((PENDENTE + 1)); PENDENTE_SECAO=$((PENDENTE_SECAO + 1)); }
passo() { printf '\n▸ %s\n' "$*"; PENDENTE_SECAO=0; }

rodar() { [ "$CHECAR" = "1" ] && { echo "     (--checar: pularia)"; return 0; }; "$@"; }

# ─────────────────────────────────────────────────────────── 1. sistema
passo "Pacotes"
FALTAM=""
for p in git curl rsync cron; do
  command -v "${p%%-*}" >/dev/null 2>&1 || dpkg -s "$p" >/dev/null 2>&1 || FALTAM="$FALTAM $p"
done
# ⚠️ venv se testa pela CAPACIDADE, não pelo nome do pacote. A primeira versão
# procurava `python3-venv` e acusava ausência numa máquina onde o venv funciona:
# no Ubuntu 24.04 o pacote chama-se `python3.12-venv`. Testar nome de pacote é
# testar a distribuição; testar `python3 -m venv` é testar o que se precisa.
if ! python3 -m venv --help >/dev/null 2>&1; then
  FALTAM="$FALTAM python3-venv"
fi
if [ -n "$FALTAM" ]; then
  aviso "faltam:$FALTAM"
  rodar sudo apt-get update -qq
  rodar sudo apt-get install -y -qq $FALTAM
else
  ok "todos presentes"
fi
# ⚠️ python3-venv NÃO vem na imagem do Ubuntu 24.04 da Oracle, e o
# pp_ew_collector depende de um venv com Playwright. Descobrir isso no meio de
# uma recuperação custa tempo que ninguém tem.

# ─────────────────────────────────────────────────────────── 2. tailnet
passo "Tailscale"
if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
  ok "na tailnet: $(tailscale status --self --peers=false 2>/dev/null | head -1 | awk '{print $1, $2}')"
else
  falta "Tailscale ausente ou não autenticado"
  cat <<'TXT'
     curl -fsSL https://tailscale.com/install.sh | sh
     sudo tailscale up          # abre URL para autenticar no navegador
     ⚠️ No admin console, DESABILITAR key expiry deste nó: o padrão é 180 dias
        e o nó cai da rede sem avisar quando expira.
TXT
fi

# ─────────────────────────────────────────────────────────── 3. venv
passo "Ambiente Python do coletor de each-way"
if [ -x "$HOME_DIR/ewenv/bin/python" ] && "$HOME_DIR/ewenv/bin/python" -c "import playwright" 2>/dev/null; then
  ok "ewenv com playwright"
else
  falta "ewenv ausente ou sem playwright"
  if [ "$CHECAR" = "0" ]; then
    python3 -m venv "$HOME_DIR/ewenv"
    "$HOME_DIR/ewenv/bin/pip" install -q --upgrade pip
    "$HOME_DIR/ewenv/bin/pip" install -q playwright
    "$HOME_DIR/ewenv/bin/playwright" install --with-deps chromium
  fi
fi

# ─────────────────────────────────────────────────────────── 4. credenciais
passo "Credenciais"
CREDS=".hr_keys .hr_host .racingapi_creds .mazetick_deploy_hook .mazetick_ntfy_topic"
for f in $CREDS; do
  if [ -s "$HOME_DIR/$f" ]; then
    ok "$f ($(wc -c < "$HOME_DIR/$f") bytes)"
  else
    falta "$f"
  fi
done
if [ "$PENDENTE_SECAO" -gt 0 ]; then
  cat <<TXT
     Restaurar do backup, que as guarda desde 2026-09-18:
       rsync -a --chmod=600 $MAZESERVER:$BACKUP/.segredos/ $HOME_DIR/
     Se o backup não as tiver, a origem de cada uma:
       .hr_keys / .hr_host ...... do .env do projeto (XRAPIDAPIKEY1..90)
       .racingapi_creds ......... conta do theracingapi (usuário e senha)
       .mazetick_deploy_hook .... painel da Cloudflare, Worker mazetick
       .mazetick_ntfy_topic ..... segredo NTFY_TOPIC do repo mazetick-data
TXT
fi

# ─────────────────────────────────────────────────────────── 5. chave de deploy
passo "Chave de deploy do repositório de dados"
# NÃO vem do backup de propósito: copiar chave privada multiplica exposição, e
# gerar um par novo custa cinco minutos.
# ⚠️ Sem cano, de proposito. `ssh -T` do GitHub SEMPRE sai 1 (nao da shell), e
# com `set -o pipefail` o pipeline inteiro sai 1 mesmo com o grep encontrando a
# autenticacao — a primeira versao acusava "sem acesso" numa maquina que publica
# por essa chave todo dia. Captura primeiro, testa depois.
RESP_SSH=$(ssh -o BatchMode=yes -o ConnectTimeout=10 -T git@github-mazetick-data 2>&1 || true)
if printf '%s' "$RESP_SSH" | grep -q "successfully authenticated"; then
  ok "autentica no GitHub"
else
  falta "sem acesso ao repositório de dados"
  cat <<'TXT'
     ssh-keygen -t ed25519 -N "" -C "bspnode -> mazetick-data" -f ~/.ssh/mazetick_data
     cat >> ~/.ssh/config <<CFG

Host github-mazetick-data
  HostName github.com
  User git
  IdentityFile ~/.ssh/mazetick_data
  IdentitiesOnly yes
CFG
     chmod 600 ~/.ssh/config
     # Registrar a PÚBLICA como deploy key COM ESCRITA em bumasello/mazetick-data:
     cat ~/.ssh/mazetick_data.pub
     git clone git@github-mazetick-data:bumasello/mazetick-data.git ~/mazetick-data
     cd ~/mazetick-data && git config user.name "mazetick bspnode" \
        && git config user.email "bumasello@gmail.com"
TXT
fi

# ─────────────────────────────────────────────────────────── 6. scripts
passo "Scripts de coleta"
SCRIPTS="smarkets_collector.py pp_ew_collector.py racingapi_collector.py hr_backfill.py fetch_betfair_bsp.sh build_site_data.py ew_terms_audit.py"
for s in $SCRIPTS; do
  [ -x "$HOME_DIR/$s" ] && ok "$s" || falta "$s"
done
[ "$PENDENTE_SECAO" -gt 0 ] && echo "     Copiar de scripts/ do repositório horsing-maze e dar chmod +x."

# ─────────────────────────────────────────────────────────── 7. dados
passo "Dados coletados"
mkdir -p "$HOME_DIR/logs"
for d in betfair_sp_data smarkets_data pp_ew_data racingapi_data hr_data; do
  n=$(/bin/ls -1 "$HOME_DIR/$d" 2>/dev/null | wc -l)
  [ "$n" -gt 0 ] && ok "$d ($n arquivos)" || falta "$d vazio"
done
if [ "$PENDENTE_SECAO" -gt 0 ]; then
cat <<TXT
     Restaurar do backup:
       for d in betfair_sp_data smarkets_data pp_ew_data racingapi_data hr_data; do
         rsync -a $MAZESERVER:$BACKUP/\$d/ $HOME_DIR/\$d/
       done
     ⚠️ Os CSVs de BSP NÃO são servidos para IP brasileiro, e o livro do
        Smarkets e os termos da Paddy Power são fotos que não existem mais
        depois que a hora passa. Restaurar do backup é a ÚNICA via para o
        histórico; daqui para a frente o fetch_betfair_bsp.sh recompõe o BSP.
TXT
fi

# ─────────────────────────────────────────────────────────── 8. cron
passo "Cron"
if crontab -l 2>/dev/null | grep -q smarkets_collector; then
  ok "$(crontab -l 2>/dev/null | grep -cE '^[^#]' ) linhas ativas"
else
  falta "crontab vazio"
  cat <<'TXT'
     crontab - <<'CRON'
*/15 8-21 * * * /home/ubuntu/smarkets_collector.py --out /home/ubuntu/smarkets_data >> /home/ubuntu/logs/smarkets.log 2>&1
0 6-21 * * * /home/ubuntu/ewenv/bin/python /home/ubuntu/pp_ew_collector.py --out /home/ubuntu/pp_ew_data >> /home/ubuntu/logs/pp_ew.log 2>&1
30 2 * * * BSP_DIR=/home/ubuntu/betfair_sp_data MARKETS="win place" /home/ubuntu/fetch_betfair_bsp.sh >> /home/ubuntu/logs/bsp.log 2>&1
0 13 * * * BSP_DIR=/home/ubuntu/betfair_sp_data MARKETS="win place" /home/ubuntu/fetch_betfair_bsp.sh >> /home/ubuntu/logs/bsp.log 2>&1
0 6,9,11,13,15,17,19 * * * /home/ubuntu/racingapi_collector.py --out /home/ubuntu/racingapi_data --endpoints cards >> /home/ubuntu/logs/racingapi.log 2>&1
0 20,22,23 * * * /home/ubuntu/racingapi_collector.py --out /home/ubuntu/racingapi_data --endpoints results >> /home/ubuntu/logs/racingapi.log 2>&1
15 */4 * * * /home/ubuntu/hr_backfill.py --from 2026-07-23 --to $(date -u -d yesterday +\%F) --max-calls 600 >> /home/ubuntu/logs/hr_backfill.log 2>&1
0 7,12,16 * * * /home/ubuntu/build_site_data.py --pp-dir /home/ubuntu/pp_ew_data >> /home/ubuntu/logs/build_site_data.log 2>&1
30 21 * * * /home/ubuntu/build_site_data.py --pp-dir /home/ubuntu/pp_ew_data >> /home/ubuntu/logs/build_site_data.log 2>&1
CRON
TXT
fi

# ─────────────────────────────────────────────────────────── 9. prova
passo "Prova de vida — executar, não ler"
if [ "$CHECAR" = "1" ]; then
  echo "     (--checar: pulado)"
else
  "$HOME_DIR/racingapi_collector.py" --out "$HOME_DIR/racingapi_data" --endpoints courses >/dev/null 2>&1 \
    && ok "theracingapi responde" || falta "theracingapi não respondeu — conferir credencial"
  "$HOME_DIR/build_site_data.py" --pp-dir "$HOME_DIR/pp_ew_data" --dry-run >/dev/null 2>&1 \
    && ok "publicador roda em dry-run" || falta "publicador falhou"
fi

echo
if [ "$PENDENTE" -eq 0 ]; then
  echo "✅ bspnode operacional. Confira no mazeserver que o watchdog volta a ficar verde."
else
  echo "📊 $PENDENTE item(ns) pendente(s) — ver as instruções acima de cada um."
fi
exit $(( PENDENTE > 0 ? 1 : 0 ))
