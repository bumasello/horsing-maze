#!/usr/bin/env python3
"""BACK no favorito — vitória e colocação. O teste "acertar mais do que errar".

Autocontido: só os CSVs da Betfair (win + place). Sem modelo, sem Supabase.
O modelo de prod reproduz o preço (encompassing test), então "o 1º do modelo"
e "o favorito do mercado" são a mesma seleção — aqui usamos o mercado, que é
o limpo.

SELEÇÃO: menor MORNINGWAP da corrida (preço da manhã — instante de decisão
claro, 🟡 no mapa de contaminação, seguro porque decidimos depois da manhã).
LIQUIDAÇÃO: BSP (ordem "at SP" casa no BSP por construção). Comissão 6,5%.

Também reporto a seleção pelo BSP como TETO rotulado (look-ahead: você não sabe
quem será o favorito de fechamento).
"""
import csv, glob, os, re, random, collections, sys

DIR = os.environ.get("BSP_DIR", "/home/maze/dev/betfair_sp_data")
COMM = float(os.environ.get("COMMISSION_RATE", 0.065))
B = int(os.environ.get("B", 2000))

def load(kind):
    races = collections.defaultdict(list)
    for f in sorted(glob.glob(os.path.join(DIR, "*.csv"))):
        isp = "place" in f.lower()
        if isp != (kind == "place"):
            continue
        with open(f, encoding="utf-8", errors="ignore") as fh:
            for line in fh.read().split("\n")[1:]:
                c = line.split(",")
                if len(c) < 17:
                    continue
                try:
                    bsp = float(c[7]); mw = float(c[9]) if c[9] else 0.0
                    wl = int(float(c[6]))
                except ValueError:
                    continue
                if bsp <= 1.0:
                    continue
                m = re.search(r"(\d{2})-(\d{2})-(\d{4})", c[3])
                if not m:
                    continue
                date = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
                key = (c[1], c[3])
                races[key].append({"sel": c[4], "won": wl == 1, "bsp": bsp,
                                   "mw": mw, "date": date, "name": c[2]})
    return races

def pnl_back(o, won):
    return (o - 1) * (1 - COMM) if won else -1.0

def simulate(races, pick_by, top_n=1, band=None):
    """Retorna lista de (chave_corrida, pnl) — uma aposta por cavalo escolhido."""
    out = []
    for key, rr in races.items():
        cand = [r for r in rr if r[pick_by] > 1.0]
        if len(cand) < max(3, top_n):
            continue
        cand.sort(key=lambda r: r[pick_by])
        for r in cand[:top_n]:
            if band and not (band[0] <= r["bsp"] < band[1]):
                continue
            out.append((key, pnl_back(r["bsp"], r["won"]), r["won"], r["date"]))
    return out

def summarize(label, bets):
    if len(bets) < 300:
        print(f"  {label:<44} n={len(bets):>6}  (amostra insuficiente)")
        return
    by = collections.defaultdict(list)
    for k, p, w, d in bets:
        by[k].append(p)
    groups = list(by.values())
    tot = sum(p for _, p, _, _ in bets)
    wr = sum(1 for _, _, w, _ in bets if w) / len(bets)
    rois = []
    for _ in range(B):
        s = 0.0; n = 0
        for _ in range(len(groups)):
            g = groups[random.randrange(len(groups))]
            s += sum(g); n += len(g)
        rois.append(100 * s / n)
    rois.sort()
    lo, hi = rois[int(0.025 * B)], rois[int(0.975 * B)]
    flag = "✅" if lo > 0 else ("❌" if hi < 0 else "~0")
    print(f"  {label:<44} n={len(bets):>6}  WR {100*wr:5.1f}%  ROI {100*tot/len(bets):+6.2f}%  IC95 [{lo:+6.2f}, {hi:+6.2f}] {flag}")

def main():
    global COMM
    random.seed(7)
    win = load("win"); plc = load("place")
    print(f"\n🏇 BACK NO FAVORITO — vitória e colocação, comissão {COMM:.1%}\n")
    print(f"  corridas win: {len(win)} · place: {len(plc)}")
    cov = sum(1 for rr in win.values() if any(r['mw'] > 1 for r in rr))
    print(f"  corridas com preço de MANHÃ: {cov} ({100*cov/len(win):.0f}%)\n")

    print("  ── VITÓRIA (mercado win) — seleção pelo preço da MANHÃ ──")
    summarize("favorito da manhã", simulate(win, "mw", 1))
    summarize("top-2 da manhã", simulate(win, "mw", 2))
    summarize("favorito da manhã, BSP < 2,0", simulate(win, "mw", 1, (1.0, 2.0)))
    summarize("favorito da manhã, BSP [2,3)", simulate(win, "mw", 1, (2.0, 3.0)))
    summarize("favorito da manhã, BSP [3,5)", simulate(win, "mw", 1, (3.0, 5.0)))
    summarize("favorito da manhã, BSP ≥ 5", simulate(win, "mw", 1, (5.0, 999)))

    print("\n  ── COLOCAÇÃO (mercado place) — seleção pelo preço da MANHÃ do PLACE ──")
    summarize("favorito do place (manhã)", simulate(plc, "mw", 1))
    summarize("top-2 do place (manhã)", simulate(plc, "mw", 2))
    summarize("favorito do place, BSP < 1,5", simulate(plc, "mw", 1, (1.0, 1.5)))
    summarize("favorito do place, BSP [1,5, 2)", simulate(plc, "mw", 1, (1.5, 2.0)))

    print("\n  ── TETO com look-ahead (seleção pelo próprio BSP) — só referência ──")
    summarize("favorito pelo BSP (win)", simulate(win, "bsp", 1))
    summarize("favorito pelo BSP (place)", simulate(plc, "bsp", 1))

    print("\n  ── estabilidade no tempo: favorito da manhã (win) por semestre ──")
    bets = simulate(win, "mw", 1)
    bysem = collections.defaultdict(list)
    for b in bets:
        d = b[3]; sem = d[:4] + ("H1" if d[5:7] <= "06" else "H2")
        bysem[sem].append(b)
    for sem in sorted(bysem):
        summarize(f"  {sem}", bysem[sem])

    print("\n  Sem comissão (COMMISSION_RATE=0) pra ver o viés favorito-azarão puro:")
    COMM = 0.0
    summarize("favorito da manhã (win), SEM comissão", simulate(win, "mw", 1))
    summarize("favorito do place (manhã), SEM comissão", simulate(plc, "mw", 1))

main()
