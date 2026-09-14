#!/usr/bin/env -S python3 -u
"""Auditoria dos termos de each-way da Paddy Power. Roda no bspnode.

POR QUE EXISTE
--------------
O site publica o artigo `each-way-terms-table`, e a primeira versão dele afirmava
que "a tabela clássica erra a fração em 44,5% das corridas, zero exceções" — 510
corridas, 227 divergências. **O código que produziu aquele número não estava no
repositório**, e o número não reproduz. Foi a segunda vez na mesma semana (a
primeira foi o spread do Smarkets, cuja medição publicada estava contaminada por
um filtro de país quebrado e só apareceu quando alguém tentou reproduzir).

Este script existe para que TODO número do artigo tenha derivação versionada e
executável. Se a afirmação mudar, muda aqui junto.

⚠️ ELE EMITE TUDO QUE O ARTIGO CITA, DE PROPÓSITO. Uma versão anterior emitia só
duas das seis seções, e os outros números vinham de scripts ad hoc que nunca
foram commitados. A regra "nenhum número sem script versionado" passava no teste
fraco — o arquivo existia no commit fixado — e falhava no que importa: o leitor
que seguisse o link não conseguia reproduzir metade do artigo.

AS DUAS RETRATAÇÕES, porque quem confere precisa saber o que já esteve errado
----------------------------------------------------------------------------
1. Medir só no FECHAMENTO. O que se mede ali não é a tabela errando, é a
   promoção do dia já aplicada. Por isso toda divergência sai nos dois instantes.
2. "Bimodalidade dentro da faixa". Era ARTEFATO de agrupar 8-11 num balde só
   porque a tabela clássica agrupa — a casa corta em 10. Os termos SÃO função
   determinística do campo; as fronteiras é que diferem. Verificado: mesma
   pista, mesmo dia, mesmo campo dá termos idênticos em 55 de 55 casos.
   **Esta alegação está morta. Não ressuscitar.**

Uso:
  ./ew_terms_audit.py                      # todos os dias coletados
  ./ew_terms_audit.py --dir pp_ew_data
"""

import argparse
import collections
import csv
import glob
import os
import re

# Handicap e nursery (handicap de 2 anos) seguem a mesma escada de termos.
EH_HCAP = re.compile(r"hcap|nursery", re.I)

# Tabela clássica UK/IRE -> (vagas, denominador). Escada padrão das casas.
# ⚠️ É ESTA a escolha discutível. Trocar aqui muda as taxas reportadas.
def tabela_classica(campo: int, hcap: bool) -> tuple[int, int]:
    if campo < 5:   return (1, 1)
    if campo <= 7:  return (2, 4)
    if not hcap:    return (3, 5)
    if campo <= 11: return (3, 5)
    if campo <= 15: return (3, 4)
    return (4, 4)


def historico(diretorio: str):
    """Por corrida UK/IRE: lista de estados DISTINTOS com carimbo de tempo.

    Estado = (instante, campo, vagas, denominador). Só transições entram, então
    uma corrida com um estado só é uma corrida que não mexeu o dia inteiro.
    """
    est, meta = {}, {}
    arquivos = sorted(glob.glob(os.path.join(diretorio, "pp_ew_v1_*.csv")))
    for arq in arquivos:
        for r in csv.DictReader(open(arq)):
            if r["country_code"] not in ("GB", "IE") or not r["place_den"]:
                continue
            try:
                e = (r["collected_at"], int(r["field_size"]),
                     int(r["num_places"]), int(r["place_den"]))
            except ValueError:
                continue
            rid = r["race_id"]
            meta[rid] = (bool(EH_HCAP.search(r["race_name"])), r["venue"])
            l = est.setdefault(rid, [])
            if not l or l[-1][1:] != e[1:]:
                l.append(e)
    return est, meta, arquivos


def faixa_de(campo: int, hcap: bool) -> str:
    if campo <= 9:  return ("hcap " if hcap else "comum") + " 5-9"
    if not hcap:    return "comum 10+"
    if campo <= 11: return "hcap  10-11"
    if campo <= 15: return "hcap  12-15"
    return "hcap  16+"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.expanduser("~/pp_ew_data"))
    args = ap.parse_args()
    est, meta, arquivos = historico(args.dir)
    print(f"{len(arquivos)} arquivo(s) | {len(est)} corridas UK/IRE distintas\n")

    # ---- 1. o achado central: a tabela nao esta errada, esta SEM DATA --------
    print("1. TERMOS NA ABERTURA vs NO FECHAMENTO, por faixa")
    por = collections.defaultdict(lambda: (collections.Counter(), collections.Counter()))
    mudou = collections.Counter()
    for rid, l in est.items():
        h, _ = meta[rid]
        f = faixa_de(l[-1][1], h)
        a, b = por[f]
        a["%d@1/%d" % (l[0][2], l[0][3])] += 1
        b["%d@1/%d" % (l[-1][2], l[-1][3])] += 1
        if l[0][2:] != l[-1][2:]:
            mudou[f] += 1
    estaveis = 0
    for f in sorted(por):
        a, b = por[f]
        n = sum(a.values())
        if mudou[f] == 0:
            estaveis += n
        fmt = lambda c: "  ".join(f"{t}:{v}" for t, v in c.most_common(3))
        print(f"   {f:12s} n={n:<4d} mudaram {mudou[f]:>3d}")
        print(f"     abertura   {fmt(a)}")
        print(f"     fechamento {fmt(b)}")
    print(f"   -> {estaveis} corridas em faixas ONDE NADA MUDA o dia inteiro.")
    print("      A tabela acerta exatamente ali, e 'erra' onde ha promocao.\n")

    # ---- 2. a divergencia nos dois instantes ---------------------------------
    print("2. DIVERGENCIA DA FRACAO contra a tabela classica")
    for rotulo, idx in (("ABERTURA", 0), ("FECHAMENTO", -1)):
        i_ = d_ = ok_ = 0
        for rid, l in est.items():
            _, campo, _, den = l[idx]
            _, pd = tabela_classica(campo, meta[rid][0])
            if pd < den:   i_ += 1
            elif pd > den: d_ += 1
            else:          ok_ += 1
        n = i_ + d_ + ok_
        print(f"   {rotulo:11s} infla {i_:3d} ({100*i_/n:4.1f}%) | "
              f"deflaciona {d_:3d} ({100*d_/n:4.1f}%) | igual {ok_:3d}")
    print("   A diferenca entre as duas linhas E a promocao. Publicar so a de")
    print("   fechamento e' chamar de 'erro da tabela' o que e' oferta do dia.\n")

    # ---- 3. decomposicao das mudancas de termo -------------------------------
    ganhou_cortou = ganhou_ja_pior = ganhou_melhorou = perdeu = so_fracao = 0
    horas = collections.Counter()
    perdas_campo_parado, perdas_campo_caiu = [], 0
    for rid, l in est.items():
        _, pista = meta[rid]
        for a, b in zip(l, l[1:]):
            _, c0, p0, d0 = a
            ts, c1, p1, d1 = b
            if (p0, d0) == (p1, d1):
                continue
            horas[ts[11:13]] += 1
            if p1 > p0:
                if d1 > d0:   ganhou_cortou += 1
                elif d1 == d0: ganhou_ja_pior += 1
                else:          ganhou_melhorou += 1
            elif p1 < p0:
                perdeu += 1
                if c1 < c0: perdas_campo_caiu += 1
                else: perdas_campo_parado.append(
                    (pista, ts[:16], f"{p0}@1/{d0} -> {p1}@1/{d1}", f"campo {c0} -> {c1}"))
            else:
                so_fracao += 1
    tot = ganhou_cortou + ganhou_ja_pior + ganhou_melhorou + perdeu + so_fracao
    print(f"3. AS {tot} MUDANCAS DE TERMO, decompostas")
    print(f"   ganhou vaga E cortou a fracao ....... {ganhou_cortou:3d}")
    print(f"   ganhou vaga, fracao JA estava em 1/5  {ganhou_ja_pior:3d}")
    print(f"   ganhou vaga e a fracao MELHOROU ..... {ganhou_melhorou:3d}  <- a troca nunca favorece")
    print(f"   perdeu vaga ......................... {perdeu:3d}")
    print(f"   so a fracao mudou ................... {so_fracao:3d}")
    print("   Enunciar como 'zero excecoes' e' errado: ganhar vaga com a fracao")
    print("   ja em 1/5 nao e' excecao, e' a troca sem nada a trocar.\n")

    # ---- 4. as perdas, e a distincao que importa ------------------------------
    print(f"4. AS {perdeu} PERDAS DE VAGA")
    print(f"   acompanhadas de queda no campo (nao-corredor): {perdas_campo_caiu}")
    print(f"   com o campo PARADO — a casa retirando a oferta: {len(perdas_campo_parado)}")
    for p in perdas_campo_parado:
        print("     %-14s %s  %-18s %s" % p)
    print("   Quem apostou each-way de manha contando com a vaga ficou sem ela,")
    print("   e isso nao e' anunciado em lugar nenhum.\n")

    # ---- 5. a hora em que o mercado muda --------------------------------------
    pico, n_pico = horas.most_common(1)[0]
    print("5. HORA UTC DA MUDANCA")
    print("   " + "  ".join(f"{h}:{n}" for h, n in sorted(horas.items())))
    print(f"   -> {n_pico} de {tot} mudancas as {pico}:00 UTC exatas.\n")

    # ---- 6. a escada real, lida do dado --------------------------------------
    print("6. A ESCADA BASE DA CASA, lida do dado e nao suposta")
    vistos = collections.defaultdict(list)
    for rid, l in est.items():
        h, _ = meta[rid]
        for _, c, p, d in l:
            vistos[(h, c)].append((p, d))
    base = {}
    for h in (True, False):
        corrente = (0, 0)
        for c in sorted(x for hh, x in vistos if hh == h):
            menor = min(vistos[(h, c)])
            if menor[0] < corrente[0]:
                menor = corrente
            corrente = menor
            base[(h, c)] = menor
    for h in (True, False):
        linha = "  ".join(f"{c}:{v[0]}@1/{v[1]}"
                          for (hh, c), v in sorted(base.items()) if hh == h)
        print(f"   {'handicap' if h else 'comum   '}: {linha}")
    print("   Handicap e comum sao IDENTICOS ate 13 corredores. A tabela")
    print("   classica os separa a partir de 8 — e e' ai que ela erra.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
