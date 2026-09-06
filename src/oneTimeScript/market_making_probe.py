#!/usr/bin/env python3
"""MARKET MAKING passivo — método B4 do mapa (§1), o último ⚪ não testado.

A TESE
    Todo método anterior PAGA a spread (4-8% no toque, medido). O market maker
    RECEBE. Se o spread vira receita em vez de pedágio, o eixo que matou o
    projeto se inverte.

O QUE MATA A TESE, SE MATAR
    SELEÇÃO ADVERSA. Uma ordem passiva só executa quando o preço vem até ela —
    ou seja, quando o mercado se move CONTRA você. Você ganha meia-spread na
    entrada e perde o quanto o preço andou. A pergunta é qual dos dois é maior.

    Prior ruim: o mapa já mediu que o drift é MONOTÔNICO no nível de odd
    (favorito encurta, azarão alonga). Movimento com tendência, não ruído, é o
    pior cenário possível pra quem faz mercado — você é atropelado do lado que
    executa e nunca executa do lado bom.

DESENHO
    Livro do Smarkets a cada 15 min. Em t posto duas ordens passivas a uma
    profundidade `f` da meia-spread (f=1.0 = no toque; f=0.25 = quase no mid).
    Em t+15 o mid andou: executa o lado para o qual ele andou (e só ele — o mid
    não pode subir e descer no mesmo intervalo). Marco a posição contra o mid
    novo.

    EV_back = B/M1 - 1        (backei em B, justo virou M1)
    EV_lay  = 1 - L/M1        (layei em L, justo virou M1)

CONTAMINAÇÃO (docs/contaminacao_dados.md)
    Tudo carimbado por `ts_utc` e só olha para a frente: 🟢. Nenhum campo
    pós-corrida entra. Não usa desfecho — é P/L de marcação a mercado, que é o
    que um MM realmente realiza ao zerar posição.

RESSALVA
    Smarkets é MENOS líquido que a Betfair, logo spread MAIOR. Isso é
    conservador PRA CIMA aqui: favorece a tese. Se perder no Smarkets, perde
    mais ainda na Betfair.
"""
import csv, glob, math, os, sys, collections, statistics

DIR = os.environ.get("SMK_DIR", "/home/maze/dev/smarkets_data")
UK = ("-gbr", "-ire", "/gbr", "/ire", "-uk", "ascot", "york")  # fallback textual
MINS_LO, MINS_HI = float(os.environ.get("MINS_LO", 5)), float(os.environ.get("MINS_HI", 360))
ODD_LO, ODD_HI = float(os.environ.get("ODD_LO", 1.5)), float(os.environ.get("ODD_HI", 30))

def load():
    rows = []
    for f in sorted(glob.glob(os.path.join(DIR, "smarkets_book_v2_*.csv"))):
        with open(f, encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                try:
                    mid = float(r["mid_odd"]); le = float(r["lay_exec_odd"])
                    be = float(r["back_exec_odd"]); mo = float(r["mins_to_off"])
                except (ValueError, TypeError, KeyError):
                    continue
                if not (le > be > 1.0 and mid > 1.0):
                    continue
                rows.append((r["full_slug"], r["contract_id"], r["ts_utc"], mo,
                             le, be, mid))
    return rows

def main():
    rows = load()
    print(f"\n🏦 MARKET MAKING PASSIVO — livro do Smarkets\n")
    print(f"  cotações carregadas: {len(rows)}")
    regions = collections.Counter(s.split("/")[3] if len(s.split("/")) > 3 else "?"
                                 for s, *_ in rows)
    print(f"  regiões (top 8): {regions.most_common(8)}")

    # filtro de região: mantém só slugs de UK/IRE
    def is_uk(slug):
        seg = slug.split("/")
        loc = seg[3] if len(seg) > 3 else ""
        return not any(x in loc for x in ("-rsa", "-usa", "-aus", "-fra", "-ger",
                                          "-jpn", "-hkg", "-uae", "-sgp", "-swe",
                                          "-nzl", "-chl", "-arg", "-per", "-uru"))
    rows = [r for r in rows if is_uk(r[0])]
    print(f"  após filtro UK/IRE: {len(rows)}")

    series = collections.defaultdict(list)
    for slug, cid, ts, mo, le, be, mid in rows:
        series[(slug, cid)].append((ts, mo, le, be, mid))
    for k in series:
        series[k].sort()
    print(f"  séries (corrida × cavalo): {len(series)}\n")

    depths = [1.0, 0.75, 0.5, 0.25]
    print(f"  {'profund.':<10} {'execuções':>10} {'taxa':>8} "
          f"{'meia-spread':>12} {'movimento':>11} {'LÍQUIDO':>10}")
    print(f"  {'-'*10} {'-'*10} {'-'*8} {'-'*12} {'-'*11} {'-'*10}")

    for f in depths:
        fills = 0
        pairs = 0
        edge_sum = 0.0     # meia-spread capturada na entrada (se nada andasse)
        ev_sum = 0.0       # EV real, marcado contra o mid novo
        for key, ser in series.items():
            for i in range(len(ser) - 1):
                ts0, mo0, le0, be0, m0 = ser[i]
                ts1, mo1, le1, be1, m1 = ser[i + 1]
                if not (MINS_HI >= mo0 >= MINS_LO):
                    continue
                if not (ODD_LO <= m0 <= ODD_HI):
                    continue
                dt = mo0 - mo1
                if not (8 <= dt <= 25):     # intervalo de ~15 min
                    continue
                pairs += 1
                # em probabilidade: pLe < pMid < pBe  (odd maior = prob menor)
                p0, p1 = 1 / m0, 1 / m1
                pB_touch, pL_touch = 1 / le0, 1 / be0
                # posto a uma fração f da distância do mid até o toque
                pB = p0 - f * (p0 - pB_touch)   # meu back (prob menor = odd maior)
                pL = p0 + f * (pL_touch - p0)   # meu lay
                B, L = 1 / pB, 1 / pL
                if p1 < pB:                      # odd subiu: meu BACK executa
                    fills += 1
                    edge_sum += B / m0 - 1
                    ev_sum += B / m1 - 1
                elif p1 > pL:                    # odd caiu: meu LAY executa
                    fills += 1
                    edge_sum += 1 - L / m0
                    ev_sum += 1 - L / m1
        if not fills:
            print(f"  {f:<10.2f} {0:>10} {'—':>8}")
            continue
        print(f"  {f:<10.2f} {fills:>10} {100*fills/max(pairs,1):>7.2f}% "
              f"{100*edge_sum/fills:>11.2f}% {100*(ev_sum-edge_sum)/fills:>10.2f}% "
              f"{100*ev_sum/fills:>9.2f}%")

    print(f"\n  pares (t, t+15min) avaliados: {pairs}")
    print("\n  meia-spread = o que você ganharia se o preço NÃO andasse.")
    print("  movimento   = o que a seleção adversa tira.")
    print("  LÍQUIDO     = o resultado real por execução, antes de comissão.")

main()
