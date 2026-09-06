#!/usr/bin/env python3
"""REGRAS "HUMANAS" DE HANDICAPPING — codificadas, testadas contra o preço.

A proposta: em vez de o ML prever, codificar a lógica que um apostador usa
(forma, jóquei, treinador, parada, classe, peso, idade) e ver se ela bate o
mercado. O teste correto NÃO é "a regra acerta?" — é "os cavalos marcados
perdem MAIS do que o BSP deles já implica?". Só isso é edge.

PONTO-NO-TEMPO (docs/contaminacao_dados.md): toda feature usa APENAS corridas
anteriores à data da corrida. Jóquei/treinador: contagens acumuladas até o dia
anterior. Nada de rpr/ts/comment (🔴).

Fontes: /tmp/rpscrape.jsonl (2019→2026-07) + CSVs Betfair (BSP + desfecho, 2024→).
"""
import json, os, re, glob, collections, random, statistics, datetime as dt

RP = "/tmp/rpscrape.jsonl"; DIR = "/home/maze/dev/betfair_sp_data"; C = 0.065; B = 1000
norm = lambda s: re.sub(r"[^a-z0-9]", "", re.sub(r"\([a-z]{2,3}\)", "", (s or "").lower()))
def num(x):
    try: return float(x)
    except (TypeError, ValueError): return None

# ---- Betfair: bsp, won, e prob normalizada por corrida ----
bf = {}; racesum = collections.defaultdict(float); raceof = {}
for f in glob.glob(os.path.join(DIR, "*.csv")):
    if "place" in f.lower(): continue
    for line in open(f, encoding="utf-8", errors="ignore").read().split("\n")[1:]:
        c = line.split(",")
        if len(c) < 17: continue
        try: bsp = float(c[7]); won = int(float(c[6])) == 1
        except ValueError: continue
        if bsp <= 1: continue
        m = re.search(r"(\d{2})-(\d{2})-(\d{4})", c[3]);
        if not m: continue
        date = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"; race = c[1] + "|" + c[3]
        k = date + "|" + norm(c[5]); bf[k] = (bsp, won, race); racesum[race] += 1 / bsp
print(f"Betfair: {len(bf)} runners, {len(racesum)} corridas")

# ---- rpscrape: ordenar por data, features ponto-no-tempo ----
rows = [json.loads(l) for l in open(RP) if l.strip()]
for r in rows: r["_d"] = r["race_date"]; r["_h"] = norm(r["horse_name"]); r["_pos"] = num(r.get("pos"))
rows.sort(key=lambda r: (r["_d"], r.get("course") or "", r.get("off_time") or ""))
print(f"rpscrape: {len(rows)} linhas, {rows[0]['_d']} → {rows[-1]['_d']}")

hist = collections.defaultdict(list)      # horse -> [(date, pos, class, ran)]
jk = collections.defaultdict(lambda: [0, 0]); tr = collections.defaultdict(lambda: [0, 0])
feat = []
i = 0
while i < len(rows):
    d = rows[i]["_d"]; j = i
    while j < len(rows) and rows[j]["_d"] == d: j += 1
    day = rows[j - 1:j] and rows[i:j]
    D = dt.date.fromisoformat(d)
    # 1) features do dia usando SÓ o passado
    for r in day:
        h = hist[r["_h"]]
        prior = [x for x in h if x[0] < d]
        n = len(prior); wins = sum(1 for x in prior if x[1] == 1)
        last3 = [x[1] for x in prior[-3:] if x[1]]
        dsl = (D - dt.date.fromisoformat(prior[-1][0])).days if prior else None
        lastcls = prior[-1][2] if prior else None
        cls = num(r.get("race_class")); age = num(r.get("age")); lbs = num(r.get("lbs"))
        jr, jw = jk[r.get("jockey") or ""]; tRr, tw = tr[r.get("trainer") or ""]
        feat.append({
            "key": d + "|" + r["_h"], "date": d, "type": r.get("race_type"), "cls": cls, "age": age, "lbs": lbs,
            "ran": num(r.get("ran")), "n": n, "wins": wins, "last3": last3, "dsl": dsl, "lastcls": lastcls,
            "jsr": (jw / jr) if jr >= 30 else None, "tsr": (tw / tRr) if tRr >= 30 else None,
            "hg": bool(r.get("hg")), "race": (d, r.get("course"), r.get("off_time")),
        })
    # 2) atualiza o passado com o dia
    for r in day:
        hist[r["_h"]].append((d, r["_pos"], num(r.get("race_class")), num(r.get("ran"))))
        if r["_pos"] is not None:
            for dct, key in ((jk, r.get("jockey") or ""), (tr, r.get("trainer") or "")):
                dct[key][0] += 1; dct[key][1] += 1 if r["_pos"] == 1 else 0
    i = j

# peso máximo da corrida
mx = collections.defaultdict(float)
for f in feat:
    if f["lbs"]: mx[f["race"]] = max(mx[f["race"]], f["lbs"])

# ---- junta com Betfair e aplica regras ----
data = []
for f in feat:
    b = bf.get(f["key"])
    if not b: continue
    bsp, won, race = b
    pm = (1 / bsp) / racesum[race]
    jump = f["type"] in ("Hurdle", "Chase", "NH Flat")
    flags = {
        "R1 nunca venceu (≥6 corridas)": f["n"] >= 6 and f["wins"] == 0,
        "R2 forma ruim (3 últimas ≥5º)": len(f["last3"]) == 3 and all(p >= 5 for p in f["last3"]),
        "R3 parada longa (>120d)": f["dsl"] is not None and f["dsl"] > 120,
        "R4 sobe de classe": f["cls"] is not None and f["lastcls"] is not None and f["cls"] < f["lastcls"],
        "R5 jóquei fraco (SR<8%)": f["jsr"] is not None and f["jsr"] < 0.08,
        "R6 treinador fraco (SR<8%)": f["tsr"] is not None and f["tsr"] < 0.08,
        "R7 veterano (≥9 flat / ≥11 jump)": f["age"] is not None and f["age"] >= (11 if jump else 9),
        "R8 estreante (0 corridas)": f["n"] == 0,
        "R9 peso máximo da corrida": f["lbs"] is not None and f["lbs"] == mx[f["race"]] and f["ran"] and f["ran"] >= 8,
        "R10 primeira vez com viseira/hg": f["hg"] and f["n"] >= 1,
        "CTRL aleatório 30%": random.random() < 0.30,
    }
    score = sum(1 for k, v in flags.items() if v and k.startswith("R") and k[1:3].strip(" ") not in ("8",))
    data.append({"bsp": bsp, "won": won, "race": race, "pm": pm, "flags": flags, "score": score, "date": f["date"]})
print(f"join rpscrape×Betfair: {len(data)} runners\n")

def evalset(sel, label):
    if len(sel) < 300: print(f"  {label:<40} n={len(sel):>6}  (poucos)"); return
    by = collections.defaultdict(list)
    for x in sel: by[x["race"]].append(x)
    groups = list(by.values())
    def stats(xs):
        n = len(xs); lose = sum(1 for x in xs if not x["won"]) / n
        impl = 1 - sum(x["pm"] for x in xs) / n
        pnl = sum((1 - C) if not x["won"] else -(x["bsp"] - 1) for x in xs) / n
        return lose, impl, pnl
    lose, impl, pnl = stats(sel)
    diffs = []
    for _ in range(B):
        s = [x for _ in range(len(groups)) for x in groups[random.randrange(len(groups))]]
        l, im, _ = stats(s); diffs.append(100 * (l - im))
    diffs.sort(); lo, hi = diffs[int(0.025 * B)], diffs[int(0.975 * B)]
    tag = "✅ edge LAY" if lo > 0 else ("🔻 edge BACK" if hi < 0 else "~0")
    print(f"  {label:<40} n={len(sel):>6}  perde {100*lose:5.1f}%  mercado diz {100*impl:5.1f}%  diff {100*(lose-impl):+5.2f}pp [{lo:+5.2f},{hi:+5.2f}]  lay ROI {100*pnl:+6.2f}%  {tag}")

bands = [("BSP [13,20] (banda de prod)", 13, 20), ("BSP [6,13)", 6, 13), ("BSP [3,6)", 3, 6), ("todas as odds", 1, 9999)]
for bl, lo, hi in bands:
    print(f"\n══ {bl} ══")
    base = [x for x in data if lo <= x["bsp"] < hi]
    evalset(base, "SEM regra (base)")
    for rule in list(data[0]["flags"]):
        evalset([x for x in base if x["flags"][rule]], rule)
    for k in (2, 3, 4):
        evalset([x for x in base if x["score"] >= k], f"score ≥ {k} regras")
