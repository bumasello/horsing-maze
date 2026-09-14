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

SCHEMA = "extra_places_v1"
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
                    "at": r["collected_at"],
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
                "off_utc": r["start_time"],
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
        "schema": SCHEMA,
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


def executa(cmd, cwd) -> tuple[int, str]:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr).strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pp-dir", default=os.path.expanduser("~/pp_ew_data"))
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

    if args.dry_run:
        print(json.dumps(doc["races"][:2], indent=2, ensure_ascii=False))
        return 0

    destino = pathlib.Path(args.repo)
    if not (destino / ".git").is_dir():
        sys.exit(f"FATAL: {destino} não é um repositório git")
    (destino / "data").mkdir(exist_ok=True)
    alvo = destino / "data" / "extra-places.json"
    alvo.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")

    executa(["git", "add", "data/extra-places.json"], destino)
    rc, saida = executa(
        ["git", "commit", "-m", f"dados: extra-places {agora:%F %H:%M} UTC"], destino)
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
