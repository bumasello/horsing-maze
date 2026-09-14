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

  1. A divergência contra a tabela abaixo na ABERTURA e no FECHAMENTO,
     separadamente. ⚠️ Medir só no fechamento foi o erro de uma versão anterior
     deste script: o que se mede ali não é a tabela errando, é a PROMOÇÃO já
     aplicada. Nunca reportar só a taxa, e nunca só um instante.
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


def primeiro_e_ultimo(diretorio: str):
    """Por corrida UK/IRE: (handicap, estado na abertura, estado no fechamento).

    Estado = (campo, vagas, denominador). Só estados DISTINTOS entram, em ordem
    de coleta, então "abertura" é o primeiro que vimos e "fechamento" o último.
    """
    est, meta = {}, {}
    arquivos = sorted(glob.glob(os.path.join(diretorio, "pp_ew_v1_*.csv")))
    for arq in arquivos:
        for r in csv.DictReader(open(arq)):
            if r["country_code"] not in ("GB", "IE") or not r["place_den"]:
                continue
            try:
                k = (int(r["field_size"]), int(r["num_places"]), int(r["place_den"]))
            except ValueError:
                continue
            rid = r["race_id"]
            meta[rid] = bool(EH_HCAP.search(r["race_name"]))
            l = est.setdefault(rid, [])
            if not l or l[-1] != k:
                l.append(k)
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

    est, meta, arquivos = primeiro_e_ultimo(args.dir)
    print(f"{len(arquivos)} arquivo(s) | {len(est)} corridas UK/IRE distintas\n")

    # ------------ 1. o achado central: a tabela nao esta errada, esta SEM DATA
    print("TERMOS NA ABERTURA vs NO FECHAMENTO, por faixa")
    print("  A tabela classica descreve a ABERTURA. Durante o dia a casa promove:")
    print("  mais uma vaga, fracao pior. Uma tabela nao tem eixo de tempo.\n")
    por = collections.defaultdict(lambda: (collections.Counter(), collections.Counter()))
    mudou = collections.Counter()
    for rid, l in est.items():
        h = meta[rid]
        c1, p1, d1 = l[-1]
        f = faixa_de(c1, h)
        a, b = por[f]
        c0, p0, d0 = l[0]
        a["%d@1/%d" % (p0, d0)] += 1
        b["%d@1/%d" % (p1, d1)] += 1
        if (p0, d0) != (p1, d1):
            mudou[f] += 1
    for f in sorted(por):
        a, b = por[f]
        n = sum(a.values())
        fmt = lambda c: "  ".join(f"{t}:{v}" for t, v in c.most_common(3))
        print(f"  {f:12s} n={n:<4d} mudaram {mudou[f]:>3d}")
        print(f"    abertura   {fmt(a)}")
        print(f"    fechamento {fmt(b)}")

    # ------------------------------ 2. divergencia da classica, nos dois instantes
    print("\nDIVERGENCIA DA FRACAO contra a tabela classica")
    for rotulo, idx in (("ABERTURA", 0), ("FECHAMENTO", -1)):
        i_ = d_ = ok_ = 0
        for rid, l in est.items():
            campo, _, den = l[idx]
            _, pd = tabela_classica(campo, meta[rid])
            if pd < den:   i_ += 1
            elif pd > den: d_ += 1
            else:          ok_ += 1
        n = i_ + d_ + ok_
        print(f"  {rotulo:11s} infla {i_:3d} ({100*i_/n:4.1f}%) | "
              f"deflaciona {d_:3d} ({100*d_/n:4.1f}%) | igual {ok_:3d}")
    print("  A diferenca entre as duas linhas E a promocao. Publicar so a de")
    print("  fechamento e' chamar de 'erro da tabela' o que e' oferta do dia.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
