#!/usr/bin/env python3
"""TOTE vs EXCHANGE — a única fonte de preço do mapa que nunca foi comparada.

Métodos D1 (tote win/place) e A3 (exacta/forecast) do mapa. D1 foi marcado
"⛔ por economia" (dedução 16-27%) e A3 "⛔ por herança" — nenhum dos dois foi
MEDIDO. Aqui medimos: dividendo real do tote (Sporting Life) contra o BSP
líquido de comissão do mesmo vencedor.

Fontes: ~/tote_data/sl_tote.jsonl (bspnode) + CSVs da Betfair.
Dividendo do tote = retorno por £1 COM stake. Exchange líquido = 1+(BSP-1)(1-c).
Sem seleção nenhuma → sem look-ahead: é comparação de preço de liquidação.
"""
import csv, glob, json, os, re, collections, statistics

DIR = os.environ.get("BSP_DIR", "/home/maze/dev/betfair_sp_data")
JSONL = os.environ.get("TOTE_JSONL", "/home/maze/dev/tote_data/sl_tote.jsonl")
C = float(os.environ.get("COMMISSION_RATE", 0.065))

norm = lambda s: re.sub(r"[^a-z0-9]", "", re.sub(r"\([a-z]{2,3}\)", "", (s or "").lower()))
def money(s):
    m = re.match(r"\s*([\d.]+)", s or "")
    return float(m.group(1)) if m else None

# índice Betfair: (date, course_norm, HH:MM) -> {horse_norm: (bsp, won)}
def load_bf(kind):
    idx = collections.defaultdict(dict)
    for f in glob.glob(os.path.join(DIR, "*.csv")):
        if ("place" in f.lower()) != (kind == "place"): continue
        for line in open(f, encoding="utf-8", errors="ignore").read().split("\n")[1:]:
            c = line.split(",")
            if len(c) < 17: continue
            try: bsp = float(c[7]); wl = int(float(c[6]))
            except ValueError: continue
            m = re.search(r"(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})", c[3])
            if not m: continue
            date = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"; hhmm = f"{m.group(4)}:{m.group(5)}"
            cm = re.match(r"\s*([A-Za-z' .-]+?)\s+\d{1,2}(st|nd|rd|th)\b", c[1])  # "Taunton 30th Dec" -> Taunton
            course = norm(cm.group(1)) if cm else norm(c[1])
            idx[(date, course, hhmm)][norm(c[5])] = (bsp, wl == 1)
    return idx

def main():
    bf_win = load_bf("win"); bf_plc = load_bf("place")
    races = [json.loads(l) for l in open(JSONL) if l.strip()]
    print(f"\n🎰 TOTE vs EXCHANGE — {len(races)} corridas do Sporting Life, comissão {C:.1%}\n")
    def find(idx, r):
        # Sporting Life time é UK local; Betfair EVENT_DT também. Tenta exato e ±1min.
        for delta in (0, 1, -1, 60, -60):
            hh, mm = map(int, r["time"].split(":")); t = hh * 60 + mm + delta
            k = (r["date"], norm(r["course"]), f"{t//60:02d}:{t%60:02d}")
            if k in idx: return idx[k]
        return None
    n_join = 0; rows = []; plc_rows = []; exa_rows = []
    for r in races:
        w = find(bf_win, r)
        if not w: continue
        n_join += 1
        winners = [x for x in r["rides"] if x.get("pos") == 1]
        if len(winners) != 1: continue
        wn = norm(winners[0]["name"]); tw = money(r.get("tote_win"))
        if wn in w and tw:
            bsp, won = w[wn]
            if won: rows.append((bsp, tw, 1 + (bsp - 1) * (1 - C)))
        # place: dividendos na ordem de chegada dos colocados
        p = find(bf_plc, r); pdivs = [money(x) for x in (r.get("place_win") or "").split(",")]
        if p and pdivs:
            placed = sorted([x for x in r["rides"] if x.get("pos") and x["pos"] <= (r.get("n_placed") or 0)], key=lambda x: x["pos"])
            for x, dv in zip(placed, pdivs):
                hn = norm(x["name"])
                if dv and hn in p and p[hn][1]:
                    plc_rows.append((p[hn][0], dv, 1 + (p[hn][0] - 1) * (1 - C)))
        # exacta: dividendo vs Harville pelo BSP
        ex = money(r.get("exacta_win")); sec = [x for x in r["rides"] if x.get("pos") == 2]
        if ex and len(sec) == 1 and wn in w and norm(sec[0]["name"]) in w:
            probs = {h: 1 / b for h, (b, _) in w.items()}; s = sum(probs.values())
            pa = probs[wn] / s; pb = probs[norm(sec[0]["name"])] / s
            fair = 1 / (pa * pb / (1 - pa))
            exa_rows.append((w[wn][0], ex, fair))
    print(f"  corridas casadas com a Betfair: {n_join}/{len(races)} · vencedores com tote+BSP: {len(rows)} · colocados: {len(plc_rows)} · exactas: {len(exa_rows)}\n")

    def report(label, rr, bands):
        print(f"  ── {label} ──")
        print(f"  {'faixa BSP':<12} {'n':>5} {'tote/exch med':>14} {'tote>exch':>10} {'ROI tote':>9} {'ROI exch':>9}")
        for lo, hi in bands:
            g = [x for x in rr if lo <= x[0] < hi]
            if len(g) < 15: print(f"  [{lo},{hi})".ljust(13) + f"{len(g):>5}  (poucos)"); continue
            ratio = statistics.median(t / e for _, t, e in g)
            better = sum(1 for _, t, e in g if t > e) / len(g)
            print(f"  [{lo},{hi})".ljust(13) + f"{len(g):>5} {ratio:>14.3f} {100*better:>9.1f}% {'':>9} {'':>9}")
        # ROI de backar TODO vencedor... não faz sentido; ROI justo = média de (dividendo × p_win) — usamos ratio como régua.
        allr = statistics.median(t / e for _, t, e in rr) if rr else float('nan')
        print(f"  {'TODOS':<12} {len(rr):>5} {allr:>14.3f} {100*sum(1 for _,t,e in rr if t>e)/max(len(rr),1):>9.1f}%\n")
    report("WIN: dividendo do tote vs BSP líquido do VENCEDOR", rows, [(1, 2), (2, 3), (3, 5), (5, 8), (8, 15), (15, 30), (30, 999)])
    report("PLACE: dividendo do tote vs BSP-place líquido do COLOCADO", plc_rows, [(1, 1.5), (1.5, 2), (2, 3), (3, 5), (5, 999)])
    if exa_rows:
        print("  ── EXACTA: dividendo vs preço justo (Harville pelo BSP, sem dedução) ──")
        for lo, hi in [(1, 3), (3, 6), (6, 999)]:
            g = [x for x in exa_rows if lo <= x[0] < hi]
            if len(g) < 15: continue
            print(f"  vencedor BSP [{lo},{hi}): n={len(g):>4} · dividendo/justo mediano {statistics.median(d/f for _,d,f in g):.3f} · dividendo>justo {100*sum(1 for _,d,f in g if d>f)/len(g):.1f}%")
        print(f"  TODOS: n={len(exa_rows)} · dividendo/justo mediano {statistics.median(d/f for _,d,f in exa_rows):.3f}")
        print("  (1,000 = pool sem dedução; ~0,80 = dedução de 20%. Acima de 1 = exacta paga mais que o justo do win.)")
main()
