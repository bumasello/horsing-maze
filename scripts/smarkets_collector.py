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
    * `quantity` vem em unidades de 1/10000 da moeda; gravamos o valor CRU e
      convertemos só na análise, pra não embutir suposição no dado.
    * Rodar FORA do Brasil (Umbrella bloqueia por categoria aqui).
    * NÃO filtramos país na coleta — gravamos `full_slug` e filtramos na
      análise. Filtrar na coleta jogaria fora dado que não dá pra recuperar
      depois; filtrar na análise é reversível.
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
COLS = [
    "ts_utc", "event_id", "event_name", "start_dt", "mins_to_off",
    "full_slug", "market_id", "contract_id", "contract_name",
    "back_price_raw", "back_odd", "back_qty_raw",
    "lay_price_raw", "lay_odd", "lay_qty_raw", "spread_pct",
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

            quotes = get(f"{API}/markets/{mid}/quotes/")
            for cid, book in quotes.items():
                bids, offers = book.get("bids", []), book.get("offers", [])
                if not bids or not offers:
                    continue
                pb, po = bids[0].get("price", 0), offers[0].get("price", 0)
                if pb <= 0 or po <= 0:
                    continue
                ob, ol = 10000.0 / pb, 10000.0 / po
                mid_odd = (ob + ol) / 2.0
                rows.append({
                    "ts_utc": now.isoformat(timespec="seconds"),
                    "event_id": eid, "event_name": e.get("name", ""),
                    "start_dt": start, "mins_to_off": f"{mins:.1f}",
                    "full_slug": e.get("full_slug", ""),
                    "market_id": mid, "contract_id": cid,
                    "contract_name": names.get(str(cid), ""),
                    "back_price_raw": pb, "back_odd": f"{ob:.4f}",
                    "back_qty_raw": bids[0].get("quantity", 0),
                    "lay_price_raw": po, "lay_odd": f"{ol:.4f}",
                    "lay_qty_raw": offers[0].get("quantity", 0),
                    "spread_pct": f"{abs(ob - ol) / mid_odd * 100:.4f}",
                })
            time.sleep(0.6)  # folga no rate limit (o 429 é de rajada)

    if not rows:
        print(f"{now.isoformat(timespec='seconds')} — 0 linhas (sem corrida na janela)")
        return 0

    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, f"smarkets_book_{now.strftime('%Y%m%d')}.csv")
    new = not os.path.exists(path)
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
