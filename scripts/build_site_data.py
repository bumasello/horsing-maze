#!/usr/bin/env -S python3 -u
"""Recorte diário: coleta crua no bspnode -> JSON derivado para o mazetick.com.

POR QUE ESTE SCRIPT EXISTE, E POR QUE ELE RODA AQUI
---------------------------------------------------
O site é estático e construído pela Cloudflare, cuja máquina de build NÃO
alcança o bspnode (tailnet). Então o dado precisa estar publicamente acessível
no momento do build. Este script produz o derivado e o empurra para o
repositório `mazetick-data`, que a construção do site consome.

⚠️ O RECORTE ACONTECE AQUI, E NÃO NO SITE. Os CSVs crus contêm preço da Paddy
Power (`win_odds_dec`, `ew_odds_dec`) e identificador da Betfair
(`betfair_market_id`) — nada disso pode ser publicado. Num site estático, um
JSON gerado no build é acessível por URL: se o corte fosse lá, o arquivo cru já
teria viajado. Ver `docs/plano_ligacao_dados_2026-09-14.md` §4.

A defesa é LISTA DE PERMISSÃO, nunca de exclusão: o JSON é montado campo a
campo. Coluna nova que o coletor passe a produzir nasce fora do arquivo.

A ESCADA DE TERMOS É DERIVADA, NÃO CODIFICADA
---------------------------------------------
"Vaga extra" aqui significa **a casa pagando acima da própria escada dela**, não
acima da tabela clássica de livro — que medimos que ela nunca seguiu (ver
`scripts/ew_terms_audit.py`). A escada é recalculada a cada execução sobre TODOS
os dias acumulados, então ela melhora sozinha conforme a coleta cresce, em vez
de envelhecer congelada no código.

Uso:
  ./build_site_data.py --dry-run          # imprime, não escreve nem empurra
  ./build_site_data.py                    # escreve, commita e empurra
Ambiente:
  MAZETICK_DEPLOY_HOOK  URL do deploy hook da Cloudflare (opcional)
"""

import argparse
import collections
import csv
import datetime as dt
import glob
import json
import os
import pathlib
import re
import subprocess
import sys

SCHEMA_EW = "extra_places_v1"
SCHEMA_MV = "movers_v1"

# Sufixo de pais no slug do Smarkets. Sem sufixo = UK/IRE.
# ⚠️ O caminho e /sport/horse-racing/<pista>/<ano>/... — a pista vem DEPOIS de
# "horse-racing". Ancorar nisso, nunca num indice fixo: a versao em TypeScript
# lia split("/")[4], que e o ANO, e por isso nunca filtrou nada (corrigido em
# 2026-09-13, ver CLAUDE.md).
ESTRANGEIROS = {"aus", "nz", "jpn", "usa", "fra", "rsa", "uae", "can", "hkg",
                "sgp", "swe", "nor", "ger", "ity", "esp", "arg", "chi", "kor",
                "ind", "per"}
BANDAS = [(1.5, 3), (3, 5), (5, 8), (8, 13), (13, 20), (20, 35), (35, 100)]
EH_HCAP = re.compile(r"hcap|nursery", re.I)
PAISES = ("GB", "IE")


def snapshots(diretorio: str):
    """(corrida -> lista de estados distintos, em ordem de coleta) + metadados.

    Só o que a lista de permissão autoriza sai daqui. `win_odds_dec`,
    `ew_odds_dec`, `betfair_market_id`, `win_market_id` e `selection_id` NUNCA
    são lidos para o resultado — nem por engano, porque não há caminho.
    """
    estados = collections.defaultdict(list)
    meta = {}
    arquivos = sorted(glob.glob(os.path.join(diretorio, "pp_ew_v1_*.csv")))
    for arq in arquivos:
        for r in csv.DictReader(open(arq)):
            if r["country_code"] not in PAISES or not r["place_den"]:
                continue
            try:
                estado = {
                    "at": iso(r["collected_at"]),
                    "field_size": int(r["field_size"]),
                    "places": int(r["num_places"]),
                    "fraction": [int(r["place_num"]), int(r["place_den"])],
                    "bog": r["bog"] == "True",
                }
            except ValueError:
                continue
            rid = r["race_id"]
            meta[rid] = {
                "venue": r["venue"],
                "country": r["country_code"],
                "off_utc": iso(r["start_time"]),
                "name": r["race_name"],
                "each_way": r["eachway_available"] == "True",
                "handicap": bool(EH_HCAP.search(r["race_name"])),
            }
            lista = estados[rid]
            chave = (estado["field_size"], estado["places"], tuple(estado["fraction"]))
            if not lista or lista[-1]["_k"] != chave:
                estado["_k"] = chave
                lista.append(estado)
    return estados, meta, arquivos


def escada_base(estados, meta) -> dict:
    """(handicap, campo) -> (vagas, denominador) da escada BASE da casa.

    Promoção só acrescenta vagas, nunca tira. Então a base de cada célula é o
    menor nº de vagas já observado ali, forçado a não decrescer conforme o campo
    cresce — senão uma célula com poucos dados fura a monotonicidade.
    """
    vistos = collections.defaultdict(list)
    for rid, lista in estados.items():
        h = meta[rid]["handicap"]
        for e in lista:
            vistos[(h, e["field_size"])].append((e["places"], e["fraction"][1]))
    base = {}
    for h in (True, False):
        corrente = (0, 0)
        for campo in sorted(c for hh, c in vistos if hh == h):
            menor = min(vistos[(h, campo)])
            if menor[0] < corrente[0]:
                menor = corrente
            corrente = menor
            base[(h, campo)] = menor
    return base


def monta(estados, meta, base, agora: dt.datetime) -> dict:
    corridas = []
    for rid, lista in estados.items():
        m = meta[rid]
        atual = lista[-1]
        b_places, b_den = base.get((m["handicap"], atual["field_size"]), (0, 0))
        corridas.append({
            "slug": "%s-%s" % (
                re.sub(r"[^a-z0-9]+", "-", m["venue"].lower()).strip("-"),
                m["off_utc"][11:16].replace(":", "")),
            "venue": m["venue"],
            "country": m["country"],
            "off_utc": m["off_utc"],
            "name": m["name"],
            "handicap": m["handicap"],
            "each_way": m["each_way"],
            "field_size": atual["field_size"],
            "terms": {
                "places": atual["places"],
                "fraction": atual["fraction"],
                "bog": atual["bog"],
            },
            # A escada da própria casa para este campo — a referência honesta.
            "house_standard": {"places": b_places, "fraction": [1, b_den]},
            "extra_place": atual["places"] > b_places,
            "history": [
                {"at": e["at"], "field_size": e["field_size"],
                 "places": e["places"], "fraction": e["fraction"]}
                for e in lista
            ],
        })
    corridas.sort(key=lambda c: (c["off_utc"], c["venue"]))
    return {
        "schema": SCHEMA_EW,
        "generated_at": agora.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Paddy Power public race pages",
        "note": ("'extra_place' compares the bookmaker's offer with the "
                 "bookmaker's own ladder, derived from our collection — not "
                 "with the classic each-way table, which it does not follow."),
        "ladder_days": None,   # preenchido em main()
        "races": corridas,
    }


def _hook_do_arquivo() -> str:
    """URL do deploy hook da Cloudflare, em ~/.mazetick_deploy_hook (0600).

    Segredo fraco — quem tiver consegue disparar builds e queimar a cota, nada
    além disso. Fica em arquivo pelo mesmo motivo das credenciais dos outros
    coletores: não passa por linha de comando nem aparece em `ps`.
    """
    arq = pathlib.Path.home() / ".mazetick_deploy_hook"
    if not arq.exists():
        return ""
    return arq.read_text().strip()


def iso(valor: str) -> str:
    """Normaliza para `AAAA-MM-DDTHH:MM:SSZ`.

    O coletor grava dois formatos: `start_time` vem da API com milissegundos e
    sufixo Z, `collected_at` vem do Python com `+00:00`. Dois formatos no mesmo
    arquivo é bug esperando quem consome — a página compararia strings e erraria
    em silêncio.
    """
    v = valor.strip().replace("+00:00", "Z")
    if "." in v:
        v = v.split(".")[0] + "Z"
    return v


def eh_uk_ire(slug: str) -> bool:
    p = slug.split("/")
    i = p.index("horse-racing") if "horse-racing" in p else 2
    pista = p[i + 1] if i + 1 < len(p) else ""
    j = pista.rfind("-")
    return not (j > 0 and pista[j + 1:] in ESTRANGEIROS)


def pista_do_slug(slug: str) -> str:
    """`/sport/horse-racing/newton-abbot/2026/...` -> `Newton Abbot`.

    O `event_name` do Smarkets e' so o horario ("14:30"), sem o local — a pista
    so existe no slug.
    """
    p = slug.split("/")
    i = p.index("horse-racing") if "horse-racing" in p else 2
    bruto = p[i + 1] if i + 1 < len(p) else ""
    return " ".join(x.capitalize() for x in bruto.split("-"))


def banda_de(odd: float):
    for lo, hi in BANDAS:
        if lo <= odd < hi:
            return (lo, hi)
    return None


def le_smarkets(arq: str):
    """(mins_to_off, mid, nome, spread%) por cotacao UK/IRE. Aceita v1, v2 e v3."""
    with open(arq) as fh:
        rd = csv.DictReader(fh)
        campos = rd.fieldnames or []
        v2 = "lay_exec_odd" in campos
        for r in rd:
            if not eh_uk_ire(r["full_slug"]):
                continue
            try:
                mins = float(r["mins_to_off"])
                if v2 and r.get("mid_odd"):
                    mid = float(r["mid_odd"])
                    lay, back = float(r["lay_exec_odd"]), float(r["back_exec_odd"])
                else:
                    # v1 nomeava as pontas ao contrario: `back_odd` vem dos bids,
                    # que e onde se LAYA. Ver CLAUDE.md.
                    lay, back = float(r["back_odd"]), float(r["lay_odd"])
                    if not lay > back:
                        continue
                    mid = 2 / (1 / lay + 1 / back)
            except Exception:
                continue
            if not (1.5 < mid < 100) or mins < 0:
                continue
            spread = (lay - back) / mid * 100 if lay > back else None
            yield (r["event_id"], r["contract_id"], pista_do_slug(r["full_slug"]),
                   r["contract_name"], r["start_dt"], mins, mid, spread)


def extremos(arquivos):
    """Por (dia, evento, corredor): primeira e ultima cotacao do dia."""
    pri, ult = {}, {}
    for a in arquivos:
        dia = os.path.basename(a).split("_")[-1][:8]
        for ev, ct, evn, nome, dt_, mins, mid, sp in le_smarkets(a):
            k = (dia, ev, ct)
            if k not in pri or mins > pri[k][0]:
                pri[k] = (mins, mid, nome, evn, dt_)
            if k not in ult or mins < ult[k][0]:
                ult[k] = (mins, mid, sp)
    return pri, ult


def linha_de_base(arquivos) -> dict:
    """Distribuicao do movimento por faixa de preco de abertura.

    A mediana e' quase zero em toda faixa — o padrao monotonico forte que
    medimos na Betfair era manha->BSP, e nao aparece na janela do coletor. O que
    muda muito por faixa e' a DISPERSAO: mover 20% num favorito e' noticia, os
    mesmos 20% num azarao de 40 sao rotina. Por isso a referencia publicada e'
    o percentil dentro da faixa, nunca "acima da media".
    """
    pri, ult = extremos(arquivos)
    por = collections.defaultdict(list)
    for k, (m0, o0, _, _, _) in pri.items():
        m1, o1, _ = ult[k]
        # so quem foi visto cedo E perto da largada: senao a janela e' o efeito.
        if m0 < 120 or m1 > 30:
            continue
        b = banda_de(o0)
        if b:
            por[b].append((o1 - o0) / o0 * 100)
    bandas = []
    for lo, hi in BANDAS:
        v = sorted(por.get((lo, hi), []))
        if len(v) < 100:
            continue
        pct = lambda f: round(v[int(f * (len(v) - 1))], 1)
        bandas.append({"from": lo, "to": hi, "n": len(v), "moves": sorted(v),
                       "p5": pct(.05), "p25": pct(.25), "p50": pct(.5),
                       "p75": pct(.75), "p95": pct(.95)})
    return {"days": len(arquivos), "bands": bandas}


def percentil_na_banda(base, odd0: float, mov: float):
    b = banda_de(odd0)
    if not b:
        return None, None
    for d in base["bands"]:
        if (d["from"], d["to"]) == b:
            v = d["moves"]
            i = sum(1 for x in v if x < mov)
            return d, round(100 * i / len(v))
    return None, None


def monta_movers(dir_smk: str, base: dict, agora: dt.datetime) -> dict:
    hoje = agora.strftime("%Y%m%d")
    arq = [a for a in sorted(glob.glob(os.path.join(dir_smk, "smarkets_book_*.csv")))
           if a.endswith(hoje + ".csv")]
    pri, ult = extremos(arq)
    corredores = []
    for k, (m0, o0, nome, pista, dt_) in pri.items():
        m1, o1, sp = ult[k]
        if m0 - m1 < 30:          # janela curta demais para significar algo
            continue
        mov = (o1 - o0) / o0 * 100
        d, pc = percentil_na_banda(base, o0, mov)
        if d is None:
            continue
        off = iso(dt_)
        corredores.append({
            # mesmo slug do extra-places.json: a pagina pode juntar os dois.
            "slug": "%s-%s" % (re.sub(r"[^a-z0-9]+", "-", pista.lower()).strip("-"),
                               off[11:16].replace(":", "")),
            "venue": pista,
            "off_utc": off,
            "runner": nome,
            "first": {"mins_to_off": round(m0), "mid": round(o0, 2)},
            "latest": {"mins_to_off": round(m1), "mid": round(o1, 2),
                       "spread_pct": round(sp, 1) if sp else None},
            "move_pct": round(mov, 1),
            "band": [d["from"], d["to"]],
            "percentile": pc,
            "notable": pc is not None and (pc <= 5 or pc >= 95),
        })
    corredores.sort(key=lambda c: abs(c["percentile"] - 50), reverse=True)
    magra = {"days": base["days"],
             "bands": [{x: b[x] for x in b if x != "moves"} for b in base["bands"]]}
    return {
        "schema": SCHEMA_MV,
        "generated_at": agora.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Smarkets public order book",
        "note": ("'percentile' is where this move sits among all moves we have "
                 "measured for runners opening at a similar price. The median "
                 "move is near zero in every band; what changes with price is "
                 "the spread of outcomes."),
        "baseline": magra,
        "runners": corredores,
    }


def executa(cmd, cwd) -> tuple[int, str]:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr).strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pp-dir", default=os.path.expanduser("~/pp_ew_data"))
    ap.add_argument("--smk-dir", default=os.path.expanduser("~/smarkets_data"))
    ap.add_argument("--repo", default=os.path.expanduser("~/mazetick-data"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    agora = dt.datetime.now(dt.timezone.utc)
    estados, meta, arquivos = snapshots(args.pp_dir)
    if not arquivos:
        sys.exit(f"FATAL: nenhum CSV em {args.pp_dir}")

    base = escada_base(estados, meta)
    # A página é sobre HOJE e o que vem a seguir; corrida já corrida não entra.
    hoje = agora.strftime("%Y-%m-%d")
    vivos = {rid: l for rid, l in estados.items()
             if meta[rid]["off_utc"][:10] >= hoje}
    doc = monta(vivos, meta, base, agora)
    doc["ladder_days"] = len(arquivos)

    extras = sum(1 for c in doc["races"] if c["extra_place"])
    mudaram = sum(1 for c in doc["races"] if len(c["history"]) > 1)
    print(f"[{agora:%F %T} UTC] {len(arquivos)} dias de escada | "
          f"{len(doc['races'])} corridas | {extras} com vaga extra | "
          f"{mudaram} mudaram de termo")

    # ------------------------------------------------------------- /movers
    # A linha de base EXCLUI hoje: o movimento de hoje nao pode influenciar a
    # referencia contra a qual ele proprio e' julgado.
    hoje_tag = agora.strftime("%Y%m%d")
    anteriores = [a for a in sorted(glob.glob(
        os.path.join(args.smk_dir, "smarkets_book_*.csv")))
        if not a.endswith(hoje_tag + ".csv")]
    mov = None
    if len(anteriores) >= 5:
        base_mv = linha_de_base(anteriores)
        mov = monta_movers(args.smk_dir, base_mv, agora)
        notaveis = sum(1 for c in mov["runners"] if c["notable"])
        print(f"  movers: {len(mov['runners'])} corredores | {notaveis} notaveis "
              f"| base de {base_mv['days']} dias anteriores")
    else:
        print("  movers: dias anteriores insuficientes para linha de base")

    if args.dry_run:
        print(json.dumps(doc["races"][:1], indent=2, ensure_ascii=False))
        if mov:
            print(json.dumps(mov["runners"][:3], indent=2, ensure_ascii=False))
        return 0

    destino = pathlib.Path(args.repo)
    if not (destino / ".git").is_dir():
        sys.exit(f"FATAL: {destino} não é um repositório git")
    (destino / "data").mkdir(exist_ok=True)
    alvo = destino / "data" / "extra-places.json"
    alvo.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")

    if mov:
        (destino / "data" / "movers.json").write_text(
            json.dumps(mov, indent=1, ensure_ascii=False) + "\n")

    executa(["git", "add", "data/"], destino)
    rc, saida = executa(
        ["git", "commit", "-m", f"dados: {agora:%F %H:%M} UTC"], destino)
    if rc != 0 and "nothing to commit" not in saida:
        sys.exit(f"FATAL: commit falhou\n{saida}")
    if "nothing to commit" in saida:
        print("  nada mudou desde a última execução — sem push")
        return 0
    rc, saida = executa(["git", "push", "origin", "HEAD"], destino)
    if rc != 0:
        sys.exit(f"FATAL: push falhou\n{saida}")
    print("  empurrado")

    hook = os.getenv("MAZETICK_DEPLOY_HOOK") or _hook_do_arquivo()
    if hook:
        rc, _ = executa(["curl", "-fsS", "-X", "POST", "-m", "20", hook], destino)
        print("  deploy hook:", "acionado" if rc == 0 else "FALHOU")
    else:
        print("  MAZETICK_DEPLOY_HOOK não definido — build não acionado")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
