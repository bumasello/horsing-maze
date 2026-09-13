#!/usr/bin/env python3
"""Coletor do tier GRATUITO do theracingapi. Roda no bspnode.

Por que existe
--------------
O tier gratuito só serve "hoje": `?date=` responde 422. Então histórico não se
compra depois — ou se captura no dia, ou não existe. É a mesma natureza do BSP,
do each-way da Paddy Power e do livro do Smarkets, e é a razão de os planos
pagos (Basic £27,99 / Standard £59,99 / Pro £99,99) comprarem sobretudo passado:
acumulando daqui pra frente, o passado sai de graça.

Por que no bspnode e em arquivo
-------------------------------
Já existia captura de `racecards/free` dentro do pipeline Node no mazeserver,
gravando em `hml.racing_api_raw`. Ela cobriu 125 de 160 dias (22% de perda),
nunca arquivou os resultados, e morre junto com o servidor — que ficou 51h fora
em 2026-09-10. Aqui a coleta é um arquivo por dia num nó independente: entra no
backup pull e no watchdog que já existem, e não depende do Supabase estar de pé.

Formato
-------
JSONL, uma linha por captura, append-only:
  {"schema","collected_at","endpoint","http_status","n_items","payload"}
Capturar o cartão VÁRIAS vezes ao dia é de propósito: o cartão muda ao longo do
dia (retirada de corredor), e `docs/contaminacao_dados.md` registra justamente
"não temos histórico do momento da retirada" como lacuna. Cada linha é um
instante; a análise deriva depois. Gravar cru e derivar depois é reversível — o
contrário não é.

Uso
---
  ./racingapi_collector.py --out ~/racingapi_data
  ./racingapi_collector.py --out ~/racingapi_data --endpoints results
Credenciais: RACING_API_USERNAME / RACING_API_PASSWORD no ambiente, ou em
~/.racingapi_creds (duas linhas: usuário e senha).
"""

import argparse
import base64
import datetime as dt
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

SCHEMA = "rapi_v1"
BASE = "https://api.theracingapi.com"

# O tier gratuito aceita 1 requisição por segundo. Ficamos bem abaixo.
PAUSA_ENTRE_CHAMADAS = 2.0

# A Cloudflare do theracingapi bane o User-Agent padrão do urllib
# ("Python-urllib/3.x") com erro 1010 — banimento por assinatura do cliente,
# HTTP 403. Medido em 2026-09-13: do MESMO IP, curl com UA de navegador dá 200 e
# urllib sem UA dá 403. Não é o IP nem a credencial; é só o cabeçalho.
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)

ENDPOINTS = {
    "cards": "/v1/racecards/free",
    "results": "/v1/results/today/free",
    "courses": "/v1/courses",
}
# Chave da lista dentro da resposta, para contar itens sem adivinhar.
CHAVE_LISTA = {"cards": "racecards", "results": "results", "courses": "courses"}


def credenciais() -> tuple[str, str]:
    u = os.getenv("RACING_API_USERNAME")
    p = os.getenv("RACING_API_PASSWORD")
    if u and p:
        return u, p
    arq = pathlib.Path.home() / ".racingapi_creds"
    if arq.exists():
        linhas = [x.strip() for x in arq.read_text().splitlines() if x.strip()]
        if len(linhas) >= 2:
            return linhas[0], linhas[1]
    sys.exit("FATAL: sem credenciais (RACING_API_USERNAME/PASSWORD ou ~/.racingapi_creds)")


def buscar(caminho: str, auth: str, tentativas: int = 4) -> tuple[int, object]:
    """Devolve (status, payload). Faz backoff em 429 e 5xx."""
    req = urllib.request.Request(
        BASE + caminho,
        headers={
            "Authorization": f"Basic {auth}",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    ultimo = 0
    for n in range(1, tentativas + 1):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            ultimo = e.code
            # 401 e 422 são definitivos: repetir não muda nada.
            if e.code in (401, 403, 404, 422):
                try:
                    return e.code, json.loads(e.read().decode())
                except Exception:
                    return e.code, {"detail": "sem corpo"}
        except Exception:
            ultimo = -1
        if n < tentativas:
            time.sleep(n * 4)
    return ultimo, {"detail": f"falhou após {tentativas} tentativas"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(pathlib.Path.home() / "racingapi_data"))
    ap.add_argument(
        "--endpoints",
        default="cards,results",
        help="lista separada por vírgula: cards, results, courses",
    )
    args = ap.parse_args()

    u, p = credenciais()
    auth = base64.b64encode(f"{u}:{p}".encode()).decode()

    destino = pathlib.Path(args.out).expanduser()
    destino.mkdir(parents=True, exist_ok=True)
    agora = dt.datetime.now(dt.timezone.utc)
    arquivo = destino / f"{SCHEMA}_{agora:%Y%m%d}.jsonl"

    escolhidos = [e.strip() for e in args.endpoints.split(",") if e.strip()]
    desconhecidos = [e for e in escolhidos if e not in ENDPOINTS]
    if desconhecidos:
        sys.exit(f"FATAL: endpoint desconhecido: {desconhecidos}")

    print(f"[{agora:%F %T} UTC] coletando {escolhidos} -> {arquivo.name}")
    falhas = 0
    with arquivo.open("a") as fh:
        for i, nome in enumerate(escolhidos):
            if i:
                time.sleep(PAUSA_ENTRE_CHAMADAS)
            status, payload = buscar(ENDPOINTS[nome], auth)
            n = None
            if isinstance(payload, dict):
                lista = payload.get(CHAVE_LISTA[nome])
                if isinstance(lista, list):
                    n = len(lista)
            linha = {
                "schema": SCHEMA,
                "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "endpoint": ENDPOINTS[nome],
                "http_status": status,
                "n_items": n,
                "payload": payload,
            }
            fh.write(json.dumps(linha, ensure_ascii=False) + "\n")
            ok = status == 200
            falhas += 0 if ok else 1
            print(f"  {'OK ' if ok else 'ERR'} {nome:8s} http={status} itens={n}")

    print(f"[resumo] falhas={falhas} arquivo={arquivo} bytes={arquivo.stat().st_size}")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
