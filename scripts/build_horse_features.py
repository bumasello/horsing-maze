#!/usr/bin/env -S python3 -u
"""Estatística por condição, ponto-no-tempo, para a página /horse. Roda no bspnode.

POR QUE EXISTE
--------------
O diferencial prometido da página é "a carreira inteira, sem look-ahead", contra
os 14 dias que os portais mostram porque é o que o feed deles entrega. Isso
exige duas coisas que só existem aqui: o histórico profundo (2019-04-28 →
2026-07-22, 667 mil linhas, migrado do Supabase em 2026-09-18) emendado com o
`hr_data` (23/07 em diante), e um corte de data que não se possa esquecer.

⚠️ O CORTE É O PRODUTO, E É ONDE O ERRO MORA
Este projeto já reverteu conclusão quatro vezes por look-ahead. A versão
anterior do cálculo equivalente, no pipeline de ML, tinha o corte dentro de um
`if (beforeDate)` — quem esquecesse a data recebia a carreira inteira, incluindo
corridas POSTERIORES à que se está prevendo, e nada avisava. Fechado em
2026-09-16.

Aqui o corte é estrutural: `historico_ate()` recebe a data como argumento
obrigatório e filtra `< data`, e `_provar_corte()` roda a cada execução sobre
uma amostra, abortando se alguma corrida usada for igual ou posterior à corrida
alvo. Prova a cada execução, não promessa escrita no comentário.

O QUE ENTRA NO JSON, E O QUE NÃO
Só DERIVADO: contagens e taxas. A linha de forma corrida a corrida NÃO sai — o
handoff a autoriza "como fato, sob demanda da página, não como despejo em
massa", e ~800 corredores por dia × 6 corridas cada seria despejo. Fica para uma
decisão própria.

Preço da Betfair não existe aqui: as colunas foram cortadas na exportação.

Uso:
  ./build_horse_features.py --dry-run
  ./build_horse_features.py --repo ~/mazetick-data
"""

import argparse
import collections
import csv
import datetime as dt
import glob
import gzip
import json
import os
import pathlib
import re
import sys

SCHEMA = "horses_v1"

# Terreno em faixas grossas. Os dois feeds escrevem diferente ("Good To Soft",
# "good to soft", "Gd-Sft"), e taxa por variante escrita é ruído, não sinal.
FAIXAS_TERRENO = [
    ("firm",  ("hard", "firm")),
    ("good",  ("good", "standard", "fast")),
    ("soft",  ("soft", "yielding", "slow")),
    ("heavy", ("heavy",)),
]


def faixa_terreno(bruto: str) -> str | None:
    if not bruto:
        return None
    t = bruto.lower()
    # A ordem importa: "good to soft" é soft, não good. Do mais pesado para o
    # mais leve, e a primeira que casar vence.
    for nome, chaves in reversed(FAIXAS_TERRENO):
        if any(k in t for k in chaves):
            return nome
    return None


def faixa_distancia(metros: float | None) -> str | None:
    if not metros:
        return None
    f = metros / 201.168  # furlongs
    if f < 7:    return "sprint"      # até 6f
    if f < 9.5:  return "mile"        # 7f a 1m1f
    if f < 13:   return "middle"      # 1m2f a 1m4f
    return "staying"


def normaliza(nome: str) -> str:
    """`Beat Of The Sea (IRE)` e `Youcanbetheone(IRE)` → chave comum.

    O sufixo de país é descartado de propósito: é assim que o `horse_name_norm`
    do rpscrape foi construído, e casar com ele é o que permite emendar as duas
    fontes. ⚠️ Medido em 2026-09-18: 87 de 71.284 nomes (0,12%) aparecem com
    mais de um país, então a colisão existe e é rara. Quem consumir isto
    precisa saber que ela existe.
    """
    if not nome:
        return ""
    base = re.sub(r"\s*\([A-Z]{2,3}\)\s*$", "", nome.strip()).lower()
    base = re.sub(r"[^a-z0-9 ]", "", base)
    return re.sub(r"\s+", " ", base).strip()


def metros_de(texto: str | None, furlongs: str | None = None) -> float | None:
    if furlongs:
        try:
            return float(furlongs) * 201.168
        except (TypeError, ValueError):
            pass
    if not texto:
        return None
    m = re.match(r"\s*(\d+)?m?\s*(\d+(?:\.\d+)?)?f?", texto.strip().lower())
    if not m:
        return None
    milhas = float(m.group(1) or 0) if "m" in texto.lower() else 0.0
    furl = float(m.group(2) or 0)
    total = milhas * 1609.34 + furl * 201.168
    return total or None


def inteiro(v) -> int | None:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


# ───────────────────────────────────────────────────── carregar o histórico

def carregar_profundo(caminho: str) -> dict:
    """cavalo → lista de corridas passadas, do arquivo migrado do Supabase."""
    por_cavalo = collections.defaultdict(list)
    with gzip.open(caminho, "rt") as fh:
        for r in csv.DictReader(fh):
            # ⚠️ `dist_m` e NAO `dist_f`. Medido em 2026-09-18: dist_f e' NULO
            # nas 667.266 linhas e dist_m esta preenchido em todas. Ler a coluna
            # errada nao levanta erro — devolve `by_distance: []` para todo
            # cavalo, ou seja, uma pagina dizendo "sem registro por distancia"
            # sobre um dado que existe inteiro.
            metros = inteiro(r.get("dist_m")) or metros_de(None, r.get("dist_f"))
            por_cavalo[normaliza(r["horse_name"])].append({
                "data": r["race_date"],
                "pista": (r.get("course") or "").strip(),
                "terreno": faixa_terreno(r.get("going")),
                "distancia": faixa_distancia(metros),
                "pos": inteiro(r.get("pos")),
                "correram": inteiro(r.get("ran")),
                "jockey": (r.get("jockey") or "").strip(),
                "trainer": (r.get("trainer") or "").strip(),
                "sire": (r.get("sire") or "").strip(),
            })
    return por_cavalo


def carregar_recente(diretorio: str, ate_exclusive: str) -> dict:
    """Idem, do JSONL da HR API. `ate_exclusive` no formato AAAAMMDD."""
    por_cavalo = collections.defaultdict(list)
    for arq in sorted(glob.glob(os.path.join(diretorio, "hr_v1_*.jsonl"))):
        dia = os.path.basename(arq).split("_")[-1][:8]
        if dia >= ate_exclusive:
            continue
        for linha in open(arq):
            try:
                d = json.loads(linha)
            except json.JSONDecodeError:
                continue
            if d.get("kind") != "race":
                continue
            c = d["payload"]
            metros = metros_de(c.get("distance"))
            data = c.get("date") or f"{dia[:4]}-{dia[4:6]}-{dia[6:]}"
            for h in c.get("horses", []):
                if str(h.get("non_runner", "")).lower() in ("true", "1"):
                    continue
                por_cavalo[normaliza(h.get("horse"))].append({
                    "data": data[:10],
                    "pista": (c.get("course") or "").strip(),
                    "terreno": faixa_terreno(c.get("going")),
                    "distancia": faixa_distancia(metros),
                    "pos": inteiro(h.get("position")),
                    "correram": len(c.get("horses", [])),
                    "jockey": (h.get("jockey") or "").strip(),
                    "trainer": (h.get("trainer") or "").strip(),
                    "sire": (h.get("sire") or "").strip(),
                })
    return por_cavalo


# ───────────────────────────────────────────────────────────── o corte

def historico_ate(corridas: list, data_corte: str) -> list:
    """Corridas ESTRITAMENTE anteriores a `data_corte`.

    ⚠️ `data_corte` é obrigatório e não tem default. Foi a opcionalidade que
    produziu look-ahead silencioso na versão em TypeScript deste mesmo cálculo.
    """
    if not data_corte:
        raise ValueError("historico_ate: data_corte é obrigatório — sem ele o "
                         "histórico incluiria a própria corrida e as posteriores")
    return [c for c in corridas if c["data"] < data_corte]


def _provar_corte(amostras: list) -> None:
    """Aborta se alguma corrida usada for igual ou posterior à corrida alvo.

    Roda a cada execução. Um corte que nunca foi verificado não foi verificado.
    """
    for alvo, usadas in amostras:
        for c in usadas:
            if c["data"] >= alvo:
                sys.exit(f"FATAL: look-ahead detectado — corrida de {c['data']} "
                         f"usada para prever corrida de {alvo}. Abortando.")


# ──────────────────────────────────────────────────────────── as taxas

def taxa(corridas: list) -> dict:
    n = len(corridas)
    if not n:
        return {"runs": 0, "wins": 0, "places": 0, "win_pct": None, "place_pct": None}
    v = sum(1 for c in corridas if c["pos"] == 1)
    p = sum(1 for c in corridas if c["pos"] and c["pos"] <= 3)
    return {"runs": n, "wins": v, "places": p,
            "win_pct": round(100 * v / n, 1), "place_pct": round(100 * p / n, 1)}


def por_chave(corridas: list, chave: str, minimo: int = 2) -> list:
    """Agrupa e descarta grupo pequeno demais para significar algo.

    ⚠️ `minimo` existe porque "100% em terreno pesado" sobre UMA corrida é
    ruído com cara de achado, e é exatamente o tipo de número que um leitor
    usaria para apostar.
    """
    grupos = collections.defaultdict(list)
    for c in corridas:
        if c.get(chave):
            grupos[c[chave]].append(c)
    saida = []
    for k, v in sorted(grupos.items(), key=lambda x: -len(x[1])):
        if len(v) >= minimo:
            saida.append({"key": k, **taxa(v)})
    return saida


# ─────────────────────────────────────────────────────────── montagem

def montar(prof: dict, rec: dict, cartao: list, agora: dt.datetime) -> dict:
    """Um bloco por corredor declarado, com o corte na data da PRÓPRIA corrida."""
    historico = collections.defaultdict(list)
    for fonte in (prof, rec):
        for k, v in fonte.items():
            historico[k].extend(v)

    # Taxas de jóquei e treinador: carreira inteira até o corte. Calculadas uma
    # vez sobre TODAS as corridas, não por cavalo — senão o custo explode.
    corridas_todas = [c for v in historico.values() for c in v]

    cavalos, amostras, estreantes = [], [], 0
    por_jockey = collections.defaultdict(list)
    por_trainer = collections.defaultdict(list)
    por_sire = collections.defaultdict(list)
    for c in corridas_todas:
        if c["jockey"]:  por_jockey[c["jockey"]].append(c)
        if c["trainer"]: por_trainer[c["trainer"]].append(c)
        if c["sire"]:    por_sire[c["sire"]].append(c)

    for corrida in cartao:
        corte = corrida["data"]
        for h in corrida["corredores"]:
            chave = normaliza(h["nome"])
            passadas = historico_ate(historico.get(chave, []), corte)
            if len(amostras) < 40 and passadas:
                amostras.append((corte, passadas[:5]))
            if not passadas:
                estreantes += 1

            bloco = {
                "slug": chave.replace(" ", "-"),
                "name": h["nome"],
                "race": {"venue": corrida["pista"], "off_utc": corrida["off_utc"],
                         "going": faixa_terreno(corrida.get("going")),
                         "distance": faixa_distancia(corrida.get("metros"))},
                "as_of": corte,
                "career": taxa(passadas),
                "by_going": por_chave(passadas, "terreno"),
                "by_course": por_chave(passadas, "pista"),
                "by_distance": por_chave(passadas, "distancia"),
            }
            if h.get("jockey"):
                bloco["jockey"] = {"name": h["jockey"],
                                   **taxa(historico_ate(por_jockey.get(h["jockey"], []), corte))}
            if h.get("trainer"):
                bloco["trainer"] = {"name": h["trainer"],
                                    **taxa(historico_ate(por_trainer.get(h["trainer"], []), corte))}
            if h.get("sire"):
                s = taxa(historico_ate(por_sire.get(h["sire"], []), corte))
                if s["runs"] >= 20:   # linhagem com amostra fina não diz nada
                    bloco["sire"] = {"name": h["sire"], **s}
            cavalos.append(bloco)

    _provar_corte(amostras)

    return {
        "schema": SCHEMA,
        "generated_at": agora.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Historical race results (2019-04-28 onwards)",
        "note": ("Every figure is computed using only races run STRICTLY BEFORE "
                 "the race it describes — the `as_of` date on each horse. "
                 "Groups with fewer than two runs are omitted rather than shown "
                 "as a rate, because a 100% strike rate over one run is noise "
                 "wearing the clothes of a finding."),
        "history_depth": {"from": "2019-04-28", "horses": len(historico)},
        "debutants": estreantes,
        "horses": cavalos,
    }


def ler_cartao(dir_rapi: str, dia: str) -> list:
    """Corridas UK/IRE declaradas HOJE, do coletor do theracingapi.

    ⚠️ NÃO vem do `hr_data`: o backfill da HR API vai até ONTEM, porque o
    endpoint dela é por data passada. O cartão do dia corrente só existe no
    tier gratuito do theracingapi, que serve exclusivamente "hoje" — é a razão
    de aquele coletor existir.

    ⚠️ E ele traz FRANÇA: medido em 2026-09-18, 16 das 64 corridas do dia eram
    `region: FR`. O escopo do produto é Reino Unido e Irlanda; deixar a França
    entrar seria a mesma falha do filtro de país do Smarkets, que nunca filtrou
    nada e contaminou uma medição publicada por três semanas.
    """
    arq = os.path.join(dir_rapi, f"rapi_v1_{dia}.jsonl")
    if not os.path.exists(arq):
        return []
    ultimo = None
    for linha in open(arq):
        try:
            d = json.loads(linha)
        except json.JSONDecodeError:
            continue
        if d.get("endpoint", "").endswith("racecards/free") and d.get("http_status") == 200:
            ultimo = d   # a captura mais recente do dia é a que vale
    if not ultimo:
        return []

    corridas = []
    for c in (ultimo["payload"].get("racecards") or []):
        if c.get("region") not in ("GB", "IRE", "IE"):
            continue
        corredores = [{"nome": h.get("horse"),
                       "jockey": (h.get("jockey") or "").strip(),
                       "trainer": (h.get("trainer") or "").strip(),
                       "sire": (h.get("sire") or "").strip()}
                      for h in (c.get("runners") or []) if h.get("horse")]
        if not corredores:
            continue
        corridas.append({
            "data": (c.get("date") or "")[:10],
            "pista": (c.get("course") or "").strip(),
            "off_utc": c.get("off_dt") or c.get("date"),
            "going": c.get("going"),
            "metros": metros_de(None, c.get("distance_f")),
            "corredores": corredores,
        })
    return corridas


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profundo", default=os.path.expanduser("~/historico_profundo/rpscrape_results.csv.gz"))
    ap.add_argument("--hr-dir", default=os.path.expanduser("~/hr_data"))
    ap.add_argument("--rapi-dir", default=os.path.expanduser("~/racingapi_data"))
    ap.add_argument("--repo", default=os.path.expanduser("~/mazetick-data"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    agora = dt.datetime.now(dt.timezone.utc)
    dia = agora.strftime("%Y%m%d")

    cartao = ler_cartao(args.rapi_dir, dia)
    if not cartao:
        print(f"[{agora:%F %T} UTC] sem cartão para {dia} — nada a fazer")
        return 0

    print(f"[{agora:%F %T} UTC] carregando histórico…")
    prof = carregar_profundo(args.profundo)
    rec = carregar_recente(args.hr_dir, dia)
    print(f"  profundo {len(prof)} cavalos | recente {len(rec)} | cartão {len(cartao)} corridas")

    doc = montar(prof, rec, cartao, agora)
    n = len(doc["horses"])
    com = sum(1 for h in doc["horses"] if h["career"]["runs"] > 0)
    print(f"  {n} corredores | {com} com histórico ({100*com/n:.0f}%) | "
          f"{doc['debutants']} estreantes")
    print("  ✅ corte ponto-no-tempo provado na amostra")

    if args.dry_run:
        exemplo = next((h for h in doc["horses"] if h["career"]["runs"] > 5), doc["horses"][0])
        print(json.dumps(exemplo, indent=1, ensure_ascii=False)[:1400])
        return 0

    destino = pathlib.Path(args.repo) / "data"
    destino.mkdir(parents=True, exist_ok=True)
    alvo = destino / "horses.json"
    alvo.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    print(f"  escrito {alvo} ({alvo.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
