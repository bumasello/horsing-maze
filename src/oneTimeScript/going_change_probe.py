#!/usr/bin/env python3
"""MUDANÇA DE PISTA (going) — o mercado precifica a preferência de terreno?

Proposta do usuário: inferir o estado da pista pelo clima e usar a preferência
de terreno do cavalo pra achar back/place favorável.

O que dá pra medir HOJE, sem modelo de clima: temos o going DECLARADO às 04:00
(racecards_hr_enriched.going, capturado pelo pipeline) e o going FINAL
(rpscrape.going, oficial). Onde diferem, a pista mudou durante o dia. A
preferência do cavalo vem do histórico ponto-no-tempo (place rate em pista
mole vs firme, só corridas anteriores).

Duas perguntas, em ordem:
  (A) No BSP (formado na largada, quando a mudança já é conhecida): cavalos
      alinhados com o NOVO going placeiam mais do que o BSP-place implica?
      Se não → o mercado já precifica preferência de terreno; um modelo de
      clima só valeria no preço de MANHÃ.
  (B) No preço de MANHÃ (que NÃO sabia da mudança), com BOG: backar os
      alinhados com hindsight perfeito da mudança dá lucro? É o TETO de um
      modelo de clima perfeito. Se o teto for negativo, clima não salva.

Contaminação: seleção em (B) usa o going final = look-ahead DECLARADO como
teto. (A) é limpo (compara desfecho com preço de liquidação).
"""
import json, re, os, glob, collections, random, statistics
norm = lambda s: re.sub(r"[^a-z0-9]", "", re.sub(r"\([a-z]{2,3}\)", "", (s or "").lower()))
C = 0.065; B = 1000; random.seed(3)
ORD = [("heavy", 0), ("soft", 1), ("yielding", 2), ("good to soft", 2), ("good to yielding", 2.5),
       ("good to firm", 4), ("firm", 5), ("good", 3)]
def going_ord(s):
    s = (s or "").lower().split("(")[0].strip()
    if not s or "standard" in s or "slow" in s or "fast" in s: return None  # AW
    for k, v in ORD:
        if s.startswith(k): return v
    return None
def num(x):
    try: return float(x)
    except (TypeError, ValueError): return None

# ---- Betfair win + place ----
def load(kind):
    d = {}; rs = collections.defaultdict(float)
    for f in glob.glob("/home/maze/dev/betfair_sp_data/*.csv"):
        if ("place" in f.lower()) != (kind == "place"): continue
        for line in open(f, encoding="utf-8", errors="ignore").read().split("\n")[1:]:
            c = line.split(",")
            if len(c) < 17: continue
            try: bsp = float(c[7]); hit = int(float(c[6])) == 1
            except ValueError: continue
            if bsp <= 1: continue
            m = re.search(r"(\d{2})-(\d{2})-(\d{4})", c[3]);
            if not m: continue
            date = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"; race = c[1] + "|" + c[3]
            d[date + "|" + norm(c[5])] = (bsp, hit, race); rs[race] += 1 / bsp
    return d, rs
W, WS = load("win"); P, PS = load("place")
nplaces = collections.Counter(r for (_, hit, r) in P.values() if hit)

# ---- rpscrape: going final + histórico ponto-no-tempo ----
rp = [json.loads(l) for l in open("/tmp/rpscrape.jsonl") if l.strip()]
final_going = {}; hist = collections.defaultdict(list)
for r in rp:
    k = r["race_date"] + "|" + norm(r["horse_name"]); g = going_ord(r.get("going"))
    final_going[k] = g
    p = num(r.get("pos"))
    if g is not None and p is not None: hist[norm(r["horse_name"])].append((r["race_date"], g, p))
for h in hist: hist[h].sort()

def pref(horse, date):
    soft = [p for d, g, p in hist[horse] if d < date and g <= 2]
    fast = [p for d, g, p in hist[horse] if d < date and g >= 3]
    if len(soft) < 3 or len(fast) < 3: return None
    sr = sum(1 for p in soft if p <= 3) / len(soft); fr = sum(1 for p in fast if p <= 3) / len(fast)
    return sr - fr  # >0 gosta de mole; <0 gosta de firme

# ---- manhã ----
rows = []
for l in open("/tmp/morning.jsonl"):
    m = json.loads(l)
    if m["nr"]: continue
    k = m["date"] + "|" + norm(m["horse"])
    ga = going_ord(m["going_am"]); gf = final_going.get(k)
    if ga is None or gf is None: continue
    w = W.get(k); p = P.get(k)
    if not w: continue
    pr = pref(norm(m["horse"]), m["date"])
    rows.append({"k": k, "race": w[2], "d": gf - ga, "pref": pr, "bsp": w[0], "won": w[1],
                 "pm": (1 / w[0]) / WS[w[2]], "pbsp": p[0] if p else None, "placed": p[1] if p else None,
                 "ppm": ((1 / p[0]) / PS[p[2]] * nplaces.get(p[2], 3)) if p else None,
                 "best": m["best"], "sp": m["sp"]})
print(f"runners turf com going 04:00 e final: {len(rows)}")
ch = collections.Counter("amoleceu" if r["d"] <= -1 else ("firmou" if r["d"] >= 1 else "igual") for r in rows)
print(f"mudança de pista 04:00→final: {dict(ch)}")
print(f"com preferência de terreno definida (≥3 corridas em cada lado): {sum(1 for r in rows if r['pref'] is not None)}\n")

def cell(label, sel):
    if len(sel) < 150: print(f"  {label:<46} n={len(sel):>5} (poucos)"); return
    by = collections.defaultdict(list)
    for x in sel: by[x["race"]].append(x)
    G = list(by.values())
    def st(xs):
        n = len(xs)
        pl = [x for x in xs if x["placed"] is not None]
        prate = sum(1 for x in pl if x["placed"]) / max(len(pl), 1); pimpl = sum(x["ppm"] for x in pl) / max(len(pl), 1)
        proi = sum(((x["pbsp"] - 1) * (1 - C) if x["placed"] else -1) for x in pl) / max(len(pl), 1)
        wroi = sum(((x["bsp"] - 1) * (1 - C) if x["won"] else -1) for x in xs) / n
        am = [x for x in xs if x["best"] and x["sp"] and x["sp"] > 1]
        amroi = sum(((max(x["best"], x["sp"]) - 1) if x["won"] else -1) for x in am) / max(len(am), 1)
        return prate, pimpl, proi, wroi, amroi
    prate, pimpl, proi, wroi, amroi = st(sel)
    diffs = []
    for _ in range(B):
        s = [x for _ in range(len(G)) for x in G[random.randrange(len(G))]]
        a, b, *_ = st(s); diffs.append(100 * (a - b))
    diffs.sort(); lo, hi = diffs[int(.025 * B)], diffs[int(.975 * B)]
    tag = "✅" if lo > 0 else ("🔻" if hi < 0 else "~0")
    print(f"  {label:<46} n={len(sel):>5}  placeia {100*prate:5.1f}% vs BSP diz {100*pimpl:5.1f}%  diff {100*(prate-pimpl):+5.2f}pp [{lo:+5.2f},{hi:+5.2f}] {tag}  | ROI place@BSP {100*proi:+6.2f}%  win@BSP {100*wroi:+6.2f}%  win@MANHÃ+BOG {100*amroi:+6.2f}%")

T = 0.15
for lab, cond in [("PISTA AMOLECEU (04:00 → final)", lambda r: r["d"] <= -1), ("PISTA FIRMOU", lambda r: r["d"] >= 1), ("PISTA IGUAL (controle)", lambda r: r["d"] == 0)]:
    base = [r for r in rows if cond(r)]
    print(f"\n══ {lab} — {len(base)} runners ══")
    cell("todos", base)
    cell("gosta de MOLE (pref ≥ +15pp)", [r for r in base if r["pref"] is not None and r["pref"] >= T])
    cell("gosta de FIRME (pref ≤ −15pp)", [r for r in base if r["pref"] is not None and r["pref"] <= -T])
    cell("indiferente (|pref| < 15pp)", [r for r in base if r["pref"] is not None and abs(r["pref"]) < T])
print("\nLeitura: 'gosta de MOLE' em 'AMOLECEU' e 'gosta de FIRME' em 'FIRMOU' são os ALINHADOS com a mudança.")
