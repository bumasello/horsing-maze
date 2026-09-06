#!/usr/bin/env python3
"""Coletor de TERMOS DE EACH-WAY anunciados pela Paddy Power (UK/IRE).

POR QUE EXISTE
    O único achado positivo do projeto (mapa §7.3: each-way no preço de manhã
    com BOG + vaga extra, +8,77% IC95 [6,61, 11,05]) repousa sobre DOIS chutes:

      1. `termFor()` — a fração (1/4, 1/5) e o número de vagas são uma TABELA
         HARDCODED nos scripts `each_way_*.ts`. Nunca foram medidos.
      2. `PROMO=sat_or_hcap16` — qual corrida tem vaga extra é adivinhado por
         uma regra inventada ("sábado ou handicap 16+").

    Os dois colapsam numa medição só: quando a casa roda vaga extra ela não
    publica "promoção", ela MUDA OS TERMOS ANUNCIADOS daquele mercado. Basta
    registrar os termos anunciados por corrida, todo dia. Vaga extra passa a
    ser um fato observado (vagas anunciadas > padrão), não um chute.

O QUE GRAVA
    Uma linha por corredor, com os termos do mercado repetidos:
      * `num_places`, `place_num`/`place_den` — os TERMOS ANUNCIADOS.
      * `bog` — Best Odds Guaranteed por mercado (o §7.3 supunha BOG universal).
      * `betfair_market_id` + `selection_id` — join EXATO com os CSVs de BSP da
        Betfair (coluna SELECTION_ID). Sem normalizar nome, sem fuzzy match.
        O §7.3 casava por nome e fechava 37%; aqui é chave.
      * `win_odds_dec` e `ew_odds_dec` — preço de vitória e o preço que a casa
        dá pra perna de each-way.

    NÃO derivamos "tem vaga extra" aqui. Isso é análise: depende do tipo de
    corrida e do tamanho do campo, que vêm do lado Betfair. Gravar cru e
    derivar depois é reversível; o contrário não.

COMO FUNCIONA
    Dois endpoints do próprio front da PP, com chave de app pública:
      POST scan-pp…/navigation/facet/v1.0/search  → corridas do dia + winMarketId
      POST smp…/fixedodds/readonly/v1/getMarketPrices → termos + preços

    ⚠️ As duas rotas dão 403 para curl/requests e até para `context.request` do
    Playwright — a proteção olha a impressão digital da conexão, não o header.
    Só passa `fetch()` executado DENTRO da página. Por isso o browser é
    obrigatório mesmo sendo uma API JSON: ele não renderiza nada, só empresta a
    pilha de rede. Não trocar por requests achando que simplifica.

RESSALVAS REGISTRADAS
    * Rodar FORA do Brasil. Vale o mesmo bloqueio do §9 do mapa.
    * Uma casa só. Paddy Power não representa o mercado; representa a Paddy
      Power. Termos e promoções variam entre casas.
    * FILTRAMOS por país (default GB,IE), ao contrário do smarkets_collector.
      Não é economia de disco: os CSVs de BSP da Betfair só cobrem UK/IRE, então
      corrida americana ou japonesa NUNCA poderá ser casada com um desfecho.
      Dado que não junta com resultado não é dado. Reversível: `--countries all`.
    * A janela é `hoje + N dias` (default 1), não "hoje". O facet só devolve o
      que ainda NÃO largou, então às 16h UTC "hoje" traz só card americano. Com
      +1 dia pega-se o card UK inteiro em qualquer horário, e de quebra os
      mercados de amanhã conforme vão sendo precificados.
    * A janela cega começa no dia em que este coletor começa a rodar. Toda
      janela histórica do projeto está queimada — esta é a primeira limpa.
    * Sem nome de cavalo de propósito: `selection_id` é chave exata e o nome
      está no SELECTION_NAME do CSV da Betfair. Menos uma chamada, menos uma
      fonte de erro.

USO
    ./pp_ew_collector.py --out ~/pp_ew_data
    ./pp_ew_collector.py --countries all --days-ahead 2   # sem filtro
"""
import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

AK = "vsd0Rm5ph2sS2uaK"          # chave de app pública do front da PP
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
SCHEMA = "v1"
BATCH = 20                        # marketIds por chamada de getMarketPrices

SCAN = ("https://scan-pp.paddypower.com/www/sports/navigation/facet/"
        "v1.0/search?_ak=" + AK)
PRICES = ("https://smp.paddypower.com/www/sports/fixedodds/readonly/v1/"
          "getMarketPrices?priceHistory=0&_ak=" + AK)

# fetch() executado dentro da página — ver RESSALVAS.
JS = """async ([url, body]) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
    credentials: 'include',
  });
  return {status: r.status, text: await r.text()};
}"""

COLS = [
    "collected_at", "mins_to_off",
    "race_id", "venue", "country_code", "start_time", "race_name",
    "win_market_id", "betfair_market_id", "market_status",
    "eachway_available", "num_places", "place_num", "place_den", "bog",
    "rule4_deductions", "field_size",
    "selection_id", "runner_status", "runner_order", "handicap",
    "win_odds_dec", "win_odds_num", "win_odds_den", "ew_odds_dec",
]


def _facet_body(day):
    """day = limite superior de largada (ISO date). Ver RESSALVAS."""
    return {
        "currencyCode": "GBP", "locale": "en_GB",
        "facets": [{"type": "MEETING", "maxValues": 0, "skipValues": 0,
                    "applyNextTo": 0,
                    "next": {"type": "RACE", "maxValues": 0, "skipValues": 0,
                             "applyNextTo": 0}}],
        "filter": {"eventTypeIds": [7], "productTypes": ["SPORTSBOOK"],
                   "marketStartingBefore": day + "T23:59:59.999Z",
                   "contentGroup": {"language": "en", "regionCode": "UK"},
                   "attachments": ["MEETING"], "maxResults": 0,
                   "selectBy": "FIRST_TO_START"}}


def _dec(node):
    """Extrai a odd decimal de trueOdds, tolerando o aninhamento duplo da API."""
    try:
        return node["trueOdds"]["decimalOdds"]["decimalOdds"]
    except (KeyError, TypeError):
        return ""


def _frac(node):
    try:
        f = node["trueOdds"]["fractionalOdds"]
        return f.get("numerator", ""), f.get("denominator", "")
    except (KeyError, TypeError):
        return "", ""


def collect(outdir, days_ahead=1, countries=("GB", "IE")):
    now = datetime.now(timezone.utc)
    day = (now + timedelta(days=days_ahead)).strftime("%Y-%m-%d")
    rows = []

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_context(user_agent=UA, locale="en-GB").new_page()
        page.goto("https://www.paddypower.com/horse-racing", timeout=60000,
                  wait_until="domcontentloaded")
        page.wait_for_timeout(5000)

        res = page.evaluate(JS, [SCAN, _facet_body(day)])
        if res["status"] != 200:
            print(f"  ! facet search devolveu {res['status']}", file=sys.stderr)
            browser.close()
            return -1
        races = (json.loads(res["text"]).get("attachments") or {}).get("races") or {}
        if not races:
            print(f"{now.isoformat(timespec='seconds')} — 0 corridas no facet")
            browser.close()
            return 0

        # winMarketId -> metadados da corrida
        meta = {}
        skipped = 0
        for rid, r in races.items():
            mid = r.get("winMarketId")
            if not mid:
                continue
            if countries and r.get("countryCode") not in countries:
                skipped += 1
                continue
            meta[str(mid)] = (rid, r)

        mids = list(meta)
        for i in range(0, len(mids), BATCH):
            chunk = mids[i:i + BATCH]
            res = page.evaluate(JS, [PRICES, {"marketIds": chunk}])
            if res["status"] != 200:
                print(f"  ! getMarketPrices {res['status']} no lote {i//BATCH}",
                      file=sys.stderr)
                continue
            for m in json.loads(res["text"]):
                rid, r = meta.get(str(m.get("marketId")), (None, {}))
                if rid is None:
                    continue
                runners = m.get("runnerDetails") or []
                active = [x for x in runners
                          if x.get("runnerStatus") == "ACTIVE"]
                pf = m.get("placeFraction") or {}
                start = r.get("startTime") or ""
                mins = ""
                if start:
                    try:
                        st = datetime.fromisoformat(start.replace("Z", "+00:00"))
                        mins = int((st - now).total_seconds() // 60)
                    except ValueError:
                        pass
                base = {
                    "collected_at": now.isoformat(timespec="seconds"),
                    "mins_to_off": mins,
                    "race_id": rid,
                    "venue": r.get("venue", ""),
                    "country_code": r.get("countryCode", ""),
                    "start_time": start,
                    "race_name": r.get("winMarketName", ""),
                    "win_market_id": m.get("marketId", ""),
                    "betfair_market_id": m.get("linkedMarketId", ""),
                    "market_status": m.get("marketStatus", ""),
                    "eachway_available": m.get("eachwayAvailable", ""),
                    "num_places": m.get("numberOfPlaces", ""),
                    "place_num": pf.get("numerator", ""),
                    "place_den": pf.get("denominator", ""),
                    "bog": m.get("guaranteedPriceAvailable", ""),
                    "rule4_deductions": json.dumps(
                        m.get("rule4Deductions") or [], separators=(",", ":")),
                    "field_size": len(active),
                }
                for x in runners:
                    wn, wd = _frac(x.get("winRunnerOdds") or {})
                    rows.append(dict(base, **{
                        "selection_id": x.get("selectionId", ""),
                        "runner_status": x.get("runnerStatus", ""),
                        "runner_order": x.get("runnerOrder", ""),
                        "handicap": x.get("handicap", ""),
                        "win_odds_dec": _dec(x.get("winRunnerOdds") or {}),
                        "win_odds_num": wn,
                        "win_odds_den": wd,
                        "ew_odds_dec": _dec(x.get("eachwayRunnerOdds") or {}),
                    }))
            time.sleep(1.0)   # folga; a proteção da PP reage a rajada
        # hub de promoções (C4): grava o JSON do GraphQL do dia, 1 arquivo/dia.
        # Não é parseado aqui — é registro bruto pra saber QUAIS promoções de
        # turfe existiam em cada dia (extra place, money back, etc.).
        try:
            hub = {}
            page.on("response", lambda r: hub.__setitem__("json", r.text())
                    if "bff-gql" in r.url and r.request.method == "POST" else None)
            page.goto("https://www.paddypower.com/promotions", timeout=60000,
                      wait_until="networkidle")
            page.wait_for_timeout(4000)
            if hub.get("json"):
                hp = os.path.join(outdir, f"pp_promohub_{now.strftime('%Y%m%d')}.json")
                if not os.path.exists(hp):
                    open(hp, "w").write(hub["json"])
        except Exception as e:  # promo hub é acessório; não derruba a coleta
            print(f"  ! promo hub: {e}", file=sys.stderr)
        browser.close()

    if not rows:
        print(f"{now.isoformat(timespec='seconds')} — 0 linhas")
        return 0

    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir,
                        f"pp_ew_{SCHEMA}_{now.strftime('%Y%m%d')}.csv")
    new = not os.path.exists(path)
    if not new:
        # Mesma guarda do smarkets_collector: DictWriter em append não revalida
        # o cabeçalho, e coluna desalinhada em silêncio é pior que dado faltando.
        with open(path, encoding="utf-8") as fh:
            if fh.readline().strip().split(",") != COLS:
                print(f"  ! cabeçalho de {os.path.basename(path)} não bate com "
                      f"o esquema {SCHEMA}; não vou anexar", file=sys.stderr)
                return -1
    with open(path, "a", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLS)
        if new:
            w.writeheader()
        w.writerows(rows)

    nraces = len({r["race_id"] for r in rows})
    print(f"{now.isoformat(timespec='seconds')} — {len(rows)} linhas, "
          f"{nraces} corridas (janela até {day}, {skipped} fora do filtro de "
          f"país) → {os.path.basename(path)}")
    return len(rows)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.expanduser("~/pp_ew_data"))
    ap.add_argument("--days-ahead", type=int, default=1)
    ap.add_argument("--countries", default="GB,IE",
                    help="lista separada por vírgula, ou 'all'")
    a = ap.parse_args()
    cc = () if a.countries.lower() == "all" else tuple(
        x.strip().upper() for x in a.countries.split(",") if x.strip())
    sys.exit(0 if collect(a.out, a.days_ahead, cc) >= 0 else 1)
