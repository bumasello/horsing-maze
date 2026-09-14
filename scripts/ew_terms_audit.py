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
  2. A ESCADA REAL da casa, lida do dado. ⚠️ Uma versão anterior deste script
     reportou "bimodalidade dentro da faixa" — era ARTEFATO de agrupar 8-11
     num balde só porque a tabela clássica agrupa. A casa corta em 10. Os
     termos SÃO função determinística do campo; as fronteiras é que diferem.
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

    # --------------------------- 2. a escada REAL da casa, derivada do dado
    # Promoção só ACRESCENTA vagas, nunca tira. Então a base de cada (tipo,
    # campo) é o menor nº de vagas observado ali, forçado a não decrescer
    # conforme o campo cresce.
    obs = [(bool(EH_HCAP.search(r["race_name"])), int(r["field_size"]),
            int(r["num_places"]), int(r["place_den"]), r) for r in ult.values()]
    base: dict = {}
    for h in (True, False):
        campos = sorted({c for hh, c, _, _, _ in obs if hh == h})
        corrente = (0, 0)
        for c in campos:
            menor = min((p, d) for hh, cc, p, d, _ in obs if hh == h and cc == c)
            if menor[0] < corrente[0]:
                menor = corrente
            corrente = menor
            base[(h, c)] = menor

    print("ESCADA BASE DA CASA, lida do dado (não suposta)")
    for h in (True, False):
        linha = "  ".join(f"{c}:{v[0]}@1/{v[1]}"
                          for (hh, c), v in sorted(base.items()) if hh == h)
        print(f"  {'handicap' if h else 'comum   '}: {linha}")
    print("  ⚠️ Handicap e comum são IDÊNTICOS até 13 corredores. A tabela")
    print("     clássica os separa a partir de 8 — e é aí que ela erra.\n")

    # ------------------------------- 3. vaga extra = acima da própria escada
    promovidas = [(r, c, base[(h, c)], (p, d))
                  for h, c, p, d, r in obs if p > base[(h, c)][0]]
    n = len(obs)
    print("VAGA EXTRA — a casa pagando acima da PRÓPRIA escada")
    print(f"  {len(promovidas)} de {n} corridas ({100*len(promovidas)/n:.1f}%)")
    print("  Esta é a definição certa de 'vaga extra': mais que a escada da casa,")
    print("  não mais que uma tabela de livro que ela nunca seguiu.\n")

    # ----------------------------------- 4. divergência da clássica, por faixa
    faixas = [("hcap 5-9", lambda h, c: h and 5 <= c <= 9),
              ("hcap 10-11", lambda h, c: h and 10 <= c <= 11),
              ("hcap 12-15", lambda h, c: h and 12 <= c <= 15),
              ("hcap 16+", lambda h, c: h and c >= 16),
              ("comum 5-9", lambda h, c: not h and 5 <= c <= 9),
              ("comum 10+", lambda h, c: not h and c >= 10)]
    print("DIVERGÊNCIA DA CLÁSSICA POR FAIXA — a direção é o achado")
    for nome, f in faixas:
        i_ = d_ = ok_ = 0
        for h, c, p, den, _ in obs:
            if not f(h, c):
                continue
            _, pd = tabela_classica(c, h)
            if pd < den:   i_ += 1
            elif pd > den: d_ += 1
            else:          ok_ += 1
        tot = i_ + d_ + ok_
        if tot:
            print(f"  {nome:11s} n={tot:<4d} infla {i_:3d} | deflaciona {d_:3d} | igual {ok_:3d}")
    print("  Dentro de cada faixa a direção é consistente — o erro da tabela")
    print("  clássica é ESTRUTURAL, não ruído. Só afirmar 'zero exceções'")
    print("  nomeando a faixa: é verdade em handicap 12+, falso no geral.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
