#!/usr/bin/env -S python3 -u
"""Auditoria dos termos de each-way da Paddy Power. Roda no bspnode.

POR QUE EXISTE
--------------
O site publica, no artigo `each-way-terms-table`, que "a tabela clássica erra a
fração em 44,5% das corridas, e toda divergência é para cima" — 510 corridas,
227 divergências, zero exceções. **O código que produziu esse número não estava
no repositório.** É a segunda vez que isso acontece (a primeira foi o spread do
Smarkets, cuja medição publicada estava contaminada por um filtro quebrado e só
apareceu quando alguém tentou reproduzir).

Este script existe para que o número do site tenha derivação versionada e
auditável. Se a afirmação mudar, muda aqui junto.

O QUE ELE MEDE, E A RESSALVA IMPORTANTE
---------------------------------------
Comparar a casa contra "a tabela clássica" exige escolher uma tabela canônica, e
essa escolha é discutível. Por isso o script reporta DUAS coisas:

  1. A divergência contra a tabela abaixo, separando as duas direções. Nunca
     reportar só a taxa: a direção é metade da informação.
  2. **A distribuição dos termos POR FAIXA DE CAMPO**, que não depende de tabela
     nenhuma. Medido em 2026-09-14, é o achado mais forte: a Paddy Power é
     bimodal dentro de cada faixa — em handicap de 8 a 11 corredores paga 3@1/5
     em 45 corridas e 2@1/4 em 22. Ou seja, **os termos não são função do
     tamanho do campo**, e qualquer tabela erra muito por construção.

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

# Tabela clássica UK/IRE -> (vagas, denominador). Fonte: escada padrão das casas.
# ⚠️ É ESTA a escolha discutível. Trocar aqui muda a taxa reportada.
def tabela_classica(campo: int, hcap: bool) -> tuple[int, int]:
    if campo < 5:   return (1, 1)   # só vitória
    if campo <= 7:  return (2, 4)
    if not hcap:    return (3, 5)
    if campo <= 11: return (3, 5)
    if campo <= 15: return (3, 4)
    return (4, 4)


def ultimo_por_corrida(diretorio: str) -> dict:
    """Último snapshot de cada corrida UK/IRE, em todos os arquivos."""
    ult = {}
    arquivos = sorted(glob.glob(os.path.join(diretorio, "pp_ew_v1_*.csv")))
    for f in arquivos:
        for r in csv.DictReader(open(f)):
            if r["country_code"] not in ("GB", "IE"):
                continue
            if not r["place_den"] or not r["field_size"]:
                continue
            ult[r["race_id"]] = r
    return ult, arquivos


def faixa(campo: int) -> str:
    if campo < 5:   return "<5"
    if campo <= 7:  return "5-7"
    if campo <= 11: return "8-11"
    if campo <= 15: return "12-15"
    return "16+"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.expanduser("~/pp_ew_data"))
    args = ap.parse_args()

    ult, arquivos = ultimo_por_corrida(args.dir)
    print(f"{len(arquivos)} arquivo(s) | {len(ult)} corridas UK/IRE distintas\n")

    # ---------------------------------------------- 1. contra a tabela clássica
    infla = deflaciona = igual = 0
    for r in ult.values():
        hcap = bool(EH_HCAP.search(r["race_name"]))
        _, den_padrao = tabela_classica(int(r["field_size"]), hcap)
        den = int(r["place_den"])
        # denominador MENOR = fração MAIOR = mais generoso.
        if den_padrao < den:   infla += 1        # tabela promete mais do que a casa paga
        elif den_padrao > den: deflaciona += 1   # tabela promete menos
        else:                  igual += 1
    n = len(ult)
    print("DIVERGÊNCIA DA FRAÇÃO contra a tabela clássica")
    print(f"  tabela infla      {infla:4d}  ({100*infla/n:.1f}%)  diz 1/4 onde a casa paga 1/5")
    print(f"  tabela deflaciona {deflaciona:4d}  ({100*deflaciona/n:.1f}%)  diz 1/5 onde a casa paga 1/4")
    print(f"  coincide          {igual:4d}  ({100*igual/n:.1f}%)")
    print("  ⚠️ Reportar SEMPRE as duas direções. 'Zero exceções' é afirmação")
    print("     forte e precisa ser lida desta linha, não suposta.\n")

    # ------------------------- 2. o achado que não depende de tabela: bimodalidade
    print("TERMOS OFERECIDOS POR FAIXA DE CAMPO (sem tabela de referência)")
    tab = collections.defaultdict(collections.Counter)
    for r in ult.values():
        chave = ("handicap" if EH_HCAP.search(r["race_name"]) else "comum",
                 faixa(int(r["field_size"])))
        tab[chave]["%s@1/%s" % (r["num_places"], r["place_den"])] += 1
    ordem = ["<5", "5-7", "8-11", "12-15", "16+"]
    for k in sorted(tab, key=lambda x: (x[0], ordem.index(x[1]))):
        total = sum(tab[k].values())
        itens = "  ".join(f"{t}:{c}" for t, c in tab[k].most_common(4))
        print(f"  {k[0]:9s} {k[1]:6s} n={total:<4d} {itens}")
    print("\n  Se uma faixa mostra dois termos com contagens parecidas, os termos")
    print("  NÃO são função do tamanho do campo — e nenhuma tabela pode acertar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
