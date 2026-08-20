#!/usr/bin/env bash
# Sonda de SPREAD real numa exchange — Smarkets, API pública, SEM conta.
#
# Por que existe: a economia do trading de drift (drift_economics.ts) é decidida
# pelo custo de execução, e os CSVs da Betfair NÃO têm bid-ask. A Betfair API
# exigiria conta internacional (a conta BR não autentica em betfair.com).
# O Smarkets expõe o livro de ofertas SEM autenticação.
#
# ⚠️ RODAR FORA DO BRASIL (a VM de Londres). Daqui o Umbrella bloqueia por
# categoria e a Betfair geo-redireciona.
#
# ⚠️ Smarkets NÃO é Betfair. A liquidez em corrida UK é bem menor, então o
# spread medido aqui é MAIS LARGO que o da Betfair. Serve como LIMITE
# SUPERIOR conservador: se a estratégia fecha no spread do Smarkets, fecha
# na Betfair. Não serve pra afirmar o custo exato na Betfair.
#
# Preço no Smarkets = probabilidade percentual × 100.
#   odd decimal = 10000 / price   (ex: price 1136 → 11,36% → odd 8,80)
#
# Uso: ./smarkets_spread_probe.sh [n_corridas]

set -uo pipefail
N="${1:-10}"
API="https://api.smarkets.com/v3"

evs=$(curl -sS --max-time 30 "$API/events/?type=horse_racing_race&state=live&limit=$N" 2>/dev/null)
count=$(echo "$evs" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('events',[])))" 2>/dev/null || echo 0)
if [ "$count" = "0" ]; then
  echo "sem corrida ao vivo agora; tentando upcoming (spread será largo — mercado não formado)"
  evs=$(curl -sS --max-time 30 "$API/events/?type=horse_racing_race&state=upcoming&limit=$N" 2>/dev/null)
fi

echo "$evs" | python3 -c "
import sys, json, urllib.request

API = '$API'
def get(u):
    try:
        with urllib.request.urlopen(u, timeout=25) as r: return json.load(r)
    except Exception: return {}

evs = json.load(sys.stdin).get('events', [])
print(f'corridas: {len(evs)}\n')
print('  odd back   odd lay   spread%   tamanho back/lay')
rows = []
for e in evs:
    ms = get(f\"{API}/events/{e['id']}/markets/\").get('markets', [])
    win = next((m for m in ms if m.get('name','').lower().startswith('to win')), None)
    if not win: continue
    q = get(f\"{API}/markets/{win['id']}/quotes/\")
    for cid, book in q.items():
        bids, offers = book.get('bids', []), book.get('offers', [])
        if not bids or not offers: continue
        # melhor back = maior prob que alguém aceita = maior price nos bids
        pb, po = bids[0]['price'], offers[0]['price']
        if pb <= 0 or po <= 0: continue
        ob, ol = 10000.0/pb, 10000.0/po
        if not (2 <= ol <= 30): continue
        # spread relativo, em % do preço médio
        mid = (ob + ol) / 2
        sp = abs(ob - ol) / mid * 100
        rows.append((ob, ol, sp, bids[0]['quantity'], offers[0]['quantity']))
rows.sort(key=lambda r: r[2])
for r in rows[:25]:
    print(f'  {r[0]:8.2f}  {r[1]:8.2f}   {r[2]:6.2f}%   {r[3]/10000:.0f}/{r[4]/10000:.0f}')
if rows:
    sps = sorted(r[2] for r in rows)
    print(f'\nspread relativo: mediana {sps[len(sps)//2]:.2f}%  p25 {sps[len(sps)//4]:.2f}%  p75 {sps[3*len(sps)//4]:.2f}%  (n={len(sps)})')
    print('comparar com o custo assumido em drift_economics.ts: 1 tick ~1,7-5% por ponta')
"
