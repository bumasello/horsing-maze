#!/usr/bin/env python3
"""Coletor de livro de ofertas (bid/ask) de corridas UK/IRE no Smarkets.

POR QUE EXISTE
    A economia do trading de drift é decidida pelo custo de execução, e nem os
    CSVs de BSP da Betfair nem a Racing API têm bid-ask. A API da Betfair exige
    conta internacional (a conta BR não autentica). O Smarkets expõe o livro
    SEM autenticação.

O QUE MEDE
    Para cada cavalo, o melhor back e o melhor lay com tamanhos, carimbados com
    os minutos que faltam pra largada. O spread em função do tempo pra largada
    é o número que falta: queremos o spread ~09:00 (quando entraríamos) e perto
    da largada (quando sairíamos).

RESSALVAS REGISTRADAS
    * Smarkets NÃO é Betfair: liquidez menor em corrida UK, logo spread MAIS
      LARGO. É LIMITE SUPERIOR conservador. Serve pra MATAR a hipótese barato,
      não pra confirmá-la.
    * Preço Smarkets = probabilidade percentual x 100 → odd = 10000 / price.
    * ⚠️ SEMÂNTICA DAS PONTAS — armadilha que já mordeu na v1 deste arquivo.
      `bids` são ordens de COMPRA (back) já postadas: quem CRUZA um bid está
      VENDENDO, ou seja, LAYando. Então o bid é `lay_exec_odd` (a odd em que
      VOCÊ consegue layar AGORA) e a offer é `back_exec_odd`. Como o preço do
      bid é sempre menor que o da offer, sai lay_exec_odd > back_exec_odd —
      o contrário seria arbitragem (backar a 16 e layar a 7,8). A v1 gravava
      `back_odd` a partir dos bids, isto é, com os nomes TROCADOS. Os CSVs v1
      seguem válidos (o spread é simétrico), basta ler os nomes invertidos;
      por isso o arquivo passou a se chamar `smarkets_book_v2_*`.
    * `quantity` vem em unidades de 1/10000 da moeda; gravamos o valor CRU e
      convertemos só na análise, pra não embutir suposição no dado.
    * Rodar FORA do Brasil (Umbrella bloqueia por categoria aqui).
    * NÃO filtramos país na coleta — gravamos `full_slug` e filtramos na
      análise. Filtrar na coleta jogaria fora dado que não dá pra recuperar
      depois; filtrar na análise é reversível.
    * v3 (2026-09-06) acrescenta ÚLTIMO NEGÓCIO e VOLUME. Motivo: o probe de
      market making (`market_making_probe.py`) mostrou que o livro sozinho só
      permite ver a execução ADVERSA (o mid atravessa a sua ordem). A execução
      BENIGNA — alguém cruza por necessidade sem o preço andar — é invisível, e
      é dela que depende o veredicto: precisa de 1,33 a 2,77 benignas por
      adversa pra market making empatar. Com `last_exec_ts` dá pra saber SE
      houve negócio entre duas fotos, e com `last_exec_price` comparado ao livro
      dá pra inferir QUEM CRUZOU. `volume` é do MERCADO (a API não expõe por
      contrato), então serve de intensidade, não de fluxo por cavalo.
    * O livro só é informativo perto da largada e em horário de turfe UK/IRE
      (~11:00-20:00 UTC). Fora disso o spread medido reflete mercado não
      formado, não custo de execução.

USO
    ./smarkets_collector.py --out ~/smarkets_data
"""
import argparse, csv, json, os, sys, time, urllib.request
from datetime import datetime, timezone

API = "https://api.smarkets.com/v3"
UA = {"User-Agent": "horsingmaze-research/1.0"}
SCHEMA = "v3"
COLS = [
    "ts_utc", "event_id", "event_name", "start_dt", "mins_to_off",
    "full_slug", "market_id", "contract_id", "contract_name",
    # bid = ordem de compra alheia; cruzar = VOCÊ LAYA (ver docstring)
    "bid_price_raw", "lay_exec_odd", "lay_exec_qty_raw",
    # offer = ordem de venda alheia; cruzar = VOCÊ BACKA
    "offer_price_raw", "back_exec_odd", "back_exec_qty_raw",
    "mid_odd", "spread_pct",
    "last_exec_price", "last_exec_ts", "market_volume",
    "market_double_stake_volume",
]


def get(url, tries=5):
    """GET com backoff. O 429 do Smarkets é de RAJADA, não de volume: o limite
    nominal é 1200 req/60s e a gente fica bem abaixo, mas ainda assim estoura
    se as chamadas saem coladas. Backoff mais longo no 429 resolve."""
    for t in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 and t < tries - 1:
                time.sleep(5 * (t + 1))
                continue
            if t == tries - 1:
                print(f"  ! {url.split('/v3')[-1][:60]}: {e}", file=sys.stderr)
                return {}
            time.sleep(2 * (t + 1))
        except Exception as e:
            if t == tries - 1:
                print(f"  ! {url.split('/v3')[-1][:60]}: {e}", file=sys.stderr)
                return {}
            time.sleep(2 * (t + 1))
    return {}


def collect(outdir):
    now = datetime.now(timezone.utc)
    rows = []
    seen_events = set()

    for state in ("live", "upcoming"):
        evs = get(f"{API}/events/?type=horse_racing_race&state={state}&limit=100").get("events", [])
        for e in evs:
            eid = e["id"]
            if eid in seen_events:
                continue
            seen_events.add(eid)
            start = e.get("start_datetime")
            if not start:
                continue
            try:
                sdt = datetime.fromisoformat(start.replace("Z", "+00:00"))
            except ValueError:
                continue
            mins = (sdt - now).total_seconds() / 60.0
            # janela útil: de 6h antes até a largada. Fora disso o livro não
            # existe (cedo demais) ou já é in-play (tarde demais).
            if not (-2 <= mins <= 360):
                continue

            markets = get(f"{API}/events/{eid}/markets/").get("markets", [])
            win = next((m for m in markets
                        if str(m.get("name", "")).lower().startswith("to win")), None)
            if not win:
                continue
            mid = win["id"]

            names = {}
            for c in get(f"{API}/markets/{mid}/contracts/").get("contracts", []):
                names[str(c["id"])] = c.get("name") or c.get("slug") or ""

            # último negócio por contrato (com carimbo) e volume do mercado
            lep = {}
            for x in get(f"{API}/markets/{mid}/last_executed_prices/").get(
                    "last_executed_prices", {}).get(str(mid), []) or []:
                lep[str(x.get("contract_id"))] = (
                    x.get("last_executed_price"), x.get("timestamp"))
            vols = get(f"{API}/markets/{mid}/volumes/").get("volumes", [])
            mvol = vols[0].get("volume", "") if vols else ""
            mdvol = vols[0].get("double_stake_volume", "") if vols else ""

            quotes = get(f"{API}/markets/{mid}/quotes/")
            for cid, book in quotes.items():
                bids, offers = book.get("bids", []), book.get("offers", [])
                if not bids or not offers:
                    continue
                pb, po = bids[0].get("price", 0), offers[0].get("price", 0)
                if pb <= 0 or po <= 0:
                    continue
                lay_exec, back_exec = 10000.0 / pb, 10000.0 / po
                # mid em PROBABILIDADE (média dos preços), não média das odds:
                # odd é convexa em prob, então a média das odds superestima o
                # meio do livro justamente onde o spread é largo.
                mid_odd = 10000.0 / ((pb + po) / 2.0)
                rows.append({
                    "ts_utc": now.isoformat(timespec="seconds"),
                    "event_id": eid, "event_name": e.get("name", ""),
                    "start_dt": start, "mins_to_off": f"{mins:.1f}",
                    "full_slug": e.get("full_slug", ""),
                    "market_id": mid, "contract_id": cid,
                    "contract_name": names.get(str(cid), ""),
                    "bid_price_raw": pb, "lay_exec_odd": f"{lay_exec:.4f}",
                    "lay_exec_qty_raw": bids[0].get("quantity", 0),
                    "offer_price_raw": po, "back_exec_odd": f"{back_exec:.4f}",
                    "back_exec_qty_raw": offers[0].get("quantity", 0),
                    "mid_odd": f"{mid_odd:.4f}",
                    "spread_pct": f"{(lay_exec - back_exec) / mid_odd * 100:.4f}",
                    "last_exec_price": (lep.get(str(cid)) or ("", ""))[0],
                    "last_exec_ts": (lep.get(str(cid)) or ("", ""))[1],
                    "market_volume": mvol,
                    "market_double_stake_volume": mdvol,
                })
            time.sleep(0.6)  # folga no rate limit (o 429 é de rajada)

    if not rows:
        print(f"{now.isoformat(timespec='seconds')} — 0 linhas (sem corrida na janela)")
        return 0

    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(
        outdir, f"smarkets_book_{SCHEMA}_{now.strftime('%Y%m%d')}.csv")
    new = not os.path.exists(path)
    if not new:
        # Guarda: DictWriter em modo append NÃO revalida o cabeçalho. Se o
        # esquema mudar de novo, as colunas sairiam desalinhadas em silêncio —
        # dado corrompido é pior que dado faltando.
        with open(path, encoding="utf-8") as fh:
            head = fh.readline().strip().split(",")
        if head != COLS:
            print(f"  ! cabeçalho de {os.path.basename(path)} não bate com o "
                  f"esquema {SCHEMA}; não vou anexar", file=sys.stderr)
            return -1
    with open(path, "a", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLS)
        if new:
            w.writeheader()
        w.writerows(rows)
    print(f"{now.isoformat(timespec='seconds')} — {len(rows)} linhas, "
          f"{len(seen_events)} corridas → {os.path.basename(path)}")
    return len(rows)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.expanduser("~/smarkets_data"))
    a = ap.parse_args()
    sys.exit(0 if collect(a.out) >= 0 else 1)
