#!/usr/bin/env python3
"""Quanto vale a parte de COLOCAÇÃO de uma aposta each-way, por termo.

POR QUE EXISTE
Em 2026-10-04 um leitor perguntou qual é a vantagem ou desvantagem exata de
cada termo de each-way para X corredores. É a pergunta que o artigo sobre a
tabela de each-way deixou aberta: a "promoção" que a casa faz é quase sempre
TROCA — uma vaga a mais, com a fração caindo de 1/4 para 1/5 — e o artigo
disse só que o valor da troca "depende da corrida e da aposta".

O QUE MEDE
Para cada corredor do arquivo profundo, o retorno da parte de colocação de uma
aposta each-way de 1 unidade na odd de largada (SP), sob cada termo:

    paga 1 + (SP - 1) * fração   se o cavalo termina dentro das vagas
    paga 0                       caso contrário

A parte de vitória é idêntica nos dois termos e não entra. A média desse
retorno sobre um grupo de corredores é o que a casa devolve na colocação: 0,85
quer dizer que de cada 1 apostado voltam 0,85.

O QUE NÃO É
  · Não é dica. É o que aconteceu no arquivo, com a amostra de cada célula.
  · A odd é a SP das casas (`dec_odds`), NÃO preço da Betfair. É o que a
    licença deixa publicar, e é o preço a que a aposta each-way é liquidada.
  · O termo é aplicado ao campo que LARGOU (`ran`). A casa fixa o termo pelo
    campo declarado e ajusta quando sai não-corredor; isso não está aqui.
  · Empate em posição de colocação paga inteiro aqui; na prática divide.

RECORTE
Handicaps (`rating_band` preenchida), com o campo nos tamanhos em que a troca
foi OBSERVADA na nossa coleta horária de termos (medido em 2026-10-05):
  · 3 vagas a 1/4 → 4 a 1/5: campos de 13 a 20
  · 4 vagas a 1/4 → 5 a 1/5: campos de 18 a 27

⚠️ O QUE O RECORTE DEIXA DE FORA (achado pelo reprodutor, 2026-10-05)
`rating_band` só vem preenchida quando o handicap tem TETO de rating. Ficam de
fora os handicaps sem teto, que são justamente os de campo grande: os seis
Grand National do arquivo, o handicap grande do Royal Ascot, quase todos os
Grade 3 de Cheltenham, e a maior parte da Irlanda (4.001 de 14.691 corridas têm
banda). Refeito com um indicador alternativo (peso correlacionado com OR), o
resultado não se move: +0,154 e +0,073 contra +0,157 e +0,083. Mas a afirmação
publicável é "handicaps com banda de rating", não "todos os handicaps".
E o arquivo não é censo: tem buracos de meses inteiros.

O intervalo é bootstrap por CORRIDA (cluster), nunca por corredor: os
corredores de uma corrida não são independentes — se um coloca, outro não.

Uso:
    ./ew_terms_value.py                      # arquivo padrão
    ./ew_terms_value.py --arquivo X.csv.gz --b 2000
"""
import argparse
import collections
import csv
import gzip
import os
import random
import sys

PADRAO = os.path.expanduser("~/historico_profundo/rpscrape_results.csv.gz")

# (rótulo, vagas, fração) — os dois lados de cada troca observada.
TROCAS = [
    ("3 a 1/4  vs  4 a 1/5", (3, 1 / 4), (4, 1 / 5), range(13, 21)),
    ("4 a 1/4  vs  5 a 1/5", (4, 1 / 4), (5, 1 / 5), range(18, 28)),
]

# Faixas de SP em odd decimal, com o equivalente fracionário no rótulo.
FAIXAS = [
    (1.0, 3.0, "até 2/1"),
    (3.0, 5.0, "2/1 a 4/1"),
    (5.0, 8.0, "4/1 a 7/1"),
    (8.0, 13.0, "7/1 a 12/1"),
    (13.0, 21.0, "12/1 a 20/1"),
    (21.0, 41.0, "20/1 a 40/1"),
    (41.0, None, "40/1 ou mais"),
]


# O extremo dos favoritos, em faixa fina. É o único lugar onde a vaga a mais
# pode deixar de compensar: por cavalo, a troca custa 5% de (SP - 1) quando ele
# coloca dentro das vagas antigas e só rende quando ele chega EXATAMENTE na
# vaga nova — rara para um favorito curto.
FAIXAS_FINAS = [
    (1.0, 2.0, "abaixo de evens"),
    (2.0, 2.5, "evens a 6/4"),
    (2.5, 3.0, "6/4 a 2/1"),
]


def faixa_fina_de(odd):
    for de, ate, rotulo in FAIXAS_FINAS:
        if de <= odd < ate:
            return rotulo
    return None


def faixa_de(odd):
    for de, ate, rotulo in FAIXAS:
        if odd >= de and (ate is None or odd < ate):
            return rotulo
    return None


def retorno(pos, odd, vagas, fracao):
    return 1 + (odd - 1) * fracao if pos is not None and pos <= vagas else 0.0


def carregar(caminho):
    """Corridas de handicap: {chave: [(pos, odd), ...]}, e o que ficou de fora."""
    corridas = collections.defaultdict(list)
    ran = {}
    fora = collections.Counter()
    linhas = 0
    with gzip.open(caminho, "rt") as fh:
        for r in csv.DictReader(fh):
            linhas += 1
            if not (r.get("rating_band") or "").strip():
                fora["não é handicap"] += 1
                continue
            try:
                odd = float(r["dec_odds"])
                n = int(r["ran"])
            except (TypeError, ValueError):
                fora["sem odd ou sem campo"] += 1
                continue
            if odd <= 1:
                fora["odd <= 1"] += 1
                continue
            try:
                pos = int(r["pos"])
            except (TypeError, ValueError):
                pos = None   # PU, F, UR, DSQ…: correu e não colocou
            chave = (r["race_date"], r["course"], r["off_time"])
            corridas[chave].append((pos, odd))
            ran[chave] = n
    return corridas, ran, fora, linhas


def _provar(corridas, ran):
    """Checador que nunca falhou não foi verificado. Três coisas têm de valer,
    senão a conta inteira está medindo outra coisa:
      1. a função de retorno paga o que a regra diz, nos casos de mão;
      2. `ran` bate com o número de linhas da corrida na maioria absoluta;
      3. cada corrida usada tem EXATAMENTE um vencedor.
    """
    casos = [((1, 5.0, 3, 0.25), 2.0), ((3, 5.0, 3, 0.25), 2.0), ((4, 5.0, 3, 0.25), 0.0),
             ((4, 5.0, 4, 0.2), 1.8), ((None, 5.0, 4, 0.2), 0.0), ((2, 11.0, 4, 0.2), 3.0)]
    for args, esperado in casos:
        if abs(retorno(*args) - esperado) > 1e-9:
            sys.exit(f"FATAL: retorno{args} deu {retorno(*args)}, esperado {esperado}.")
    bate = sum(1 for k, v in corridas.items() if len(v) == ran[k])
    if bate < 0.95 * len(corridas):
        sys.exit(f"FATAL: `ran` só bate com as linhas em {bate} de {len(corridas)} "
                 "corridas. O tamanho do campo não é confiável. Abortando.")
    return bate


def bootstrap(celula, b, semente):
    """IC95 da diferença (B - A) por unidade apostada, reamostrando CORRIDAS."""
    rng = random.Random(semente)
    n_c = len(celula)
    difs = []
    for _ in range(b):
        sa = sb = n = 0.0
        for _ in range(n_c):
            a_, b_, k = celula[rng.randrange(n_c)]
            sa += a_
            sb += b_
            n += k
        difs.append((sb - sa) / n)
    difs.sort()
    return difs[int(0.025 * b)], difs[int(0.975 * b) - 1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arquivo", default=PADRAO)
    ap.add_argument("--b", type=int, default=2000, help="reamostragens do bootstrap")
    ap.add_argument("--semente", type=int, default=20261005)
    args = ap.parse_args()

    corridas, ran, fora, linhas = carregar(args.arquivo)
    bate = _provar(corridas, ran)
    datas = sorted(k[0] for k in corridas)
    print("VALOR DA PARTE DE COLOCAÇÃO POR TERMO DE EACH-WAY")
    print(f"arquivo: {linhas} linhas lidas, {datas[0]} a {datas[-1]}")
    print(f"handicaps com odd: {len(corridas)} corridas, "
          f"{sum(len(v) for v in corridas.values())} corredores")
    print(f"fora: {dict(fora)}")
    print(f"`ran` bate com as linhas em {bate} de {len(corridas)} corridas; "
          "as que não batem ficam fora de tudo abaixo")

    for rotulo, (va, fa), (vb, fb), campos in TROCAS:
        usadas = {k: v for k, v in corridas.items()
                  if ran[k] in campos and len(v) == ran[k]
                  and sum(1 for p, _ in v if p == 1) == 1}
        sem_venc = sum(1 for k, v in corridas.items()
                       if ran[k] in campos and len(v) == ran[k]
                       and sum(1 for p, _ in v if p == 1) != 1)
        print(f"\n{'=' * 78}\n{rotulo}   — campos de {campos[0]} a {campos[-1]}")
        print(f"{len(usadas)} corridas, {sum(len(v) for v in usadas.values())} corredores "
              f"({sem_venc} corridas sem exatamente um vencedor ficaram fora)")
        print(f"A = {va} vagas a 1/{round(1 / fa)}    B = {vb} vagas a 1/{round(1 / fb)}")

        def tabela(titulo, chave_de):
            cel = collections.defaultdict(lambda: collections.defaultdict(lambda: [0.0, 0.0, 0]))
            tot = collections.defaultdict(lambda: [0, 0, 0])   # n, colocou em A, colocou em B
            for k, v in usadas.items():
                for pos, odd in v:
                    g = chave_de(ran[k], odd)
                    if g is None:
                        continue
                    c = cel[g][k]
                    c[0] += retorno(pos, odd, va, fa)
                    c[1] += retorno(pos, odd, vb, fb)
                    c[2] += 1
                    t = tot[g]
                    t[0] += 1
                    t[1] += pos is not None and pos <= va
                    t[2] += pos is not None and pos <= vb
            print(f"\n{titulo}")
            print(f"  {'grupo':14} {'corridas':>8} {'corredores':>10} {'coloca A':>9} {'coloca B':>9} "
                  f"{'vaga nova':>9} {'volta A':>8} {'volta B':>8} {'B - A':>8}   IC95 de B - A")
            for g in ordem(cel):
                lista = [tuple(x) for x in cel[g].values()]
                n = sum(x[2] for x in lista)
                ra = sum(x[0] for x in lista) / n
                rb = sum(x[1] for x in lista) / n
                lo, hi = bootstrap(lista, args.b, args.semente)
                t = tot[g]
                # ⚠️ Poucos cavalos na vaga NOVA, e o intervalo mente. Reamostrar
                # corridas não inventa um evento que não ocorreu: com zero
                # chegadas na vaga extra a diferença é negativa em toda
                # reamostragem, e o IC sai estreito e abaixo de zero por
                # construção — 12 cavalos pareciam provar "A melhor". Achado
                # pelo reprodutor em 2026-10-05.
                na_vaga_nova = t[2] - t[1]
                if na_vaga_nova < 10:
                    veredito = "amostra fina na vaga nova: não diz nada"
                else:
                    veredito = "B melhor" if lo > 0 else "A melhor" if hi < 0 else "não separa"
                print(f"  {str(g):14} {len(lista):8d} {n:10d} {100 * t[1] / t[0]:8.1f}% {100 * t[2] / t[0]:8.1f}% "
                      f"{na_vaga_nova:9d} {ra:8.3f} {rb:8.3f} {rb - ra:+8.3f}   [{lo:+.3f}, {hi:+.3f}]  {veredito}")

        def ordem(cel):
            rot = [r for _, _, r in FAIXAS] + [r for _, _, r in FAIXAS_FINAS]
            return sorted(cel, key=lambda g: (rot.index(g) if g in rot else -1, str(g)) if isinstance(g, str)
                          else (0, g))

        tabela("TODOS OS CORREDORES (o que a casa devolve na colocação)", lambda n, o: "todos")
        tabela("POR FAIXA DE ODD (SP)", lambda n, o: faixa_de(o))
        tabela("FAVORITOS, EM FAIXA FINA", lambda n, o: faixa_fina_de(o))
        tabela("POR TAMANHO DE CAMPO", lambda n, o: n)

    print("\n⚠️ Medição sobre o que aconteceu, não recomendação. SP das casas, termo aplicado"
          "\n   ao campo que largou, empate pago inteiro. Ver o topo do script.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
