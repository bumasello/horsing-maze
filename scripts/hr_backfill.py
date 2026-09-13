#!/usr/bin/env -S python3 -u
# -u: sem buffer. Com a saida redirecionada pro log do cron, o Python
# bufferiza em bloco e o progresso so aparece no fim — inutil pra
# acompanhar um backfill que leva horas.
"""Backfill do histórico da Horse Racing API (RapidAPI). Roda no bspnode.

Por que existe
--------------
Medido em 2026-09-13: a API serve histórico por data, e o conteúdo BATE com a
realidade — 62 corridas em 15/08 contra 47 uk + 15 ire nos CSVs da Betfair; 36 e
48 em 01 e 02/07 contra exatamente 36 e 48 do rpscrape. Por corredor vêm
`position`, `sp`, `OR`, `distance_beaten`, jóquei, treinador e criação. É
substituta completa do rpscrape, que morreu (upstream removido do GitHub e o
Racing Post trocou o markup).

E o problema que ela resolve não é só o buraco de 23/07 em diante: o pipeline
guarda no Supabase apenas as corridas que passam nos filtros de qualidade do ML
(mínimo de corredores, cobertura de OR/SP), então o banco tem 13–20% do que a
API serve. Filtrar na ingestão é irreversível. Aqui grava-se CRU; filtra-se
depois, na análise.

Cota (medida em 2026-09-13)
---------------------------
50 requisições por chave, reset em 4–8h, 90 chaves no .env. O pipeline noturno
bebe do mesmo poço. Por isso este script usa só a METADE SUPERIOR das chaves
(--key-offset), deixando a inferior intocada para a produção, e para sozinho
quando a reserva acaba — melhor demorar dias do que furar o pipeline.

Custo: ~62 corridas/dia => ~1 chamada de cartão + 62 de detalhe por data.

Formato
-------
Um arquivo por data, JSONL, append-only:
  {"schema","collected_at","kind","date","payload"}
kind = "racecards" (uma linha) ou "race" (uma por corrida).
Data só é considerada completa quando todas as corridas do cartão foram
gravadas; arquivo incompleto é retomado na execução seguinte.

Uso
---
  ./hr_backfill.py --from 2026-07-23 --to 2026-09-12
  ./hr_backfill.py --from 2025-07-01 --to 2026-07-22 --max-calls 800
Credenciais: ~/.hr_keys (uma chave por linha) e ~/.hr_host (o host do RapidAPI).
"""

import argparse
import datetime as dt
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

SCHEMA = "hr_v1"
PAUSA = 1.2  # segundos entre chamadas; a API não documenta limite por segundo
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36"


class Cotas:
    """Rotaciona chaves e para quando a reserva acaba.

    Uma chave é dada como esgotada no primeiro 429 ou quando o cabeçalho
    x-ratelimit-requests-remaining chega a zero. Não há tentativa de adivinhar
    quando ela volta: o script simplesmente encerra e a próxima execução
    reaproveita o que tiver renovado.
    """

    def __init__(self, chaves: list[str]):
        self.chaves = chaves
        self.i = 0
        self.esgotadas: set[int] = set()

    def atual(self) -> str | None:
        while self.i < len(self.chaves):
            if self.i not in self.esgotadas:
                return self.chaves[self.i]
            self.i += 1
        return None

    def marcar_esgotada(self) -> None:
        self.esgotadas.add(self.i)
        self.i += 1

    def restantes(self) -> int:
        return len(self.chaves) - len(self.esgotadas)


def buscar(url: str, host: str, cotas: Cotas) -> tuple[int, object]:
    """Devolve (status, payload), trocando de chave quando a cota acaba."""
    while True:
        chave = cotas.atual()
        if chave is None:
            return -1, {"detail": "sem chaves com cota"}
        req = urllib.request.Request(
            url,
            headers={
                "x-rapidapi-key": chave,
                "x-rapidapi-host": host,
                "User-Agent": USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                restante = r.headers.get("x-ratelimit-requests-remaining")
                if restante is not None and restante.isdigit() and int(restante) <= 1:
                    cotas.marcar_esgotada()
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                cotas.marcar_esgotada()
                continue
            return e.code, {"detail": f"HTTP {e.code}"}
        except Exception as exc:
            return -1, {"detail": str(exc)[:120]}


def dia_concluido(arq: pathlib.Path) -> bool:
    """Marca de conclusão, para não gastar cota reconferindo dia pronto.

    Sem ela, uma execução periódica sobre 52 dias queima 52 chamadas só para
    descobrir que não há nada a fazer.
    """
    if not arq.exists():
        return False
    for linha in arq.open():
        if '"kind": "completo"' in linha or '"kind":"completo"' in linha:
            return True
    return False


def ids_ja_gravados(arq: pathlib.Path) -> set[str]:
    if not arq.exists():
        return set()
    vistos = set()
    for linha in arq.open():
        try:
            d = json.loads(linha)
        except Exception:
            continue
        if d.get("kind") == "race":
            rid = (d.get("payload") or {}).get("id_race")
            if rid:
                vistos.add(str(rid))
    return vistos


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="inicio", required=True)
    ap.add_argument("--to", dest="fim", required=True)
    ap.add_argument("--out", default=str(pathlib.Path.home() / "hr_data"))
    ap.add_argument("--keys", default=str(pathlib.Path.home() / ".hr_keys"))
    ap.add_argument("--host-file", default=str(pathlib.Path.home() / ".hr_host"))
    ap.add_argument(
        "--key-offset",
        type=int,
        default=45,
        help="usa só as chaves a partir deste índice; as anteriores ficam reservadas "
        "para o pipeline noturno, que bebe do mesmo poço",
    )
    ap.add_argument("--max-calls", type=int, default=2000)
    args = ap.parse_args()

    todas = [
        x.strip()
        for x in pathlib.Path(args.keys).expanduser().read_text().splitlines()
        if x.strip()
    ]
    chaves = todas[args.key_offset :]
    host = pathlib.Path(args.host_file).expanduser().read_text().strip()
    if not chaves:
        sys.exit("FATAL: nenhuma chave disponível após o offset")

    destino = pathlib.Path(args.out).expanduser()
    destino.mkdir(parents=True, exist_ok=True)
    cotas = Cotas(chaves)

    d0 = dt.date.fromisoformat(args.inicio)
    d1 = dt.date.fromisoformat(args.fim)
    print(
        f"[{dt.datetime.now(dt.timezone.utc):%F %T} UTC] {d0} → {d1} | "
        f"{len(chaves)} chaves (offset {args.key_offset}) | teto {args.max_calls} chamadas"
    )

    chamadas = 0
    dias_ok = 0
    dia = d0
    while dia <= d1:
        if chamadas >= args.max_calls or cotas.restantes() == 0:
            print(f"  ⏸  parando em {dia}: "
                  f"{'teto de chamadas' if chamadas >= args.max_calls else 'cota esgotada'}")
            break

        arq = destino / f"{SCHEMA}_{dia:%Y%m%d}.jsonl"
        if dia_concluido(arq):
            dia += dt.timedelta(days=1)
            dias_ok += 1
            continue
        vistos = ids_ja_gravados(arq)

        st, cartao = buscar(
            f"https://{host}/racecards?date={dia}", host, cotas
        )
        chamadas += 1
        if st != 200 or not isinstance(cartao, list):
            print(f"  ❌ {dia} cartão http={st}")
            dia += dt.timedelta(days=1)
            continue

        pendentes = [c for c in cartao if str(c.get("id_race")) not in vistos]
        if not pendentes:
            # Já estava inteiro de uma execução anterior que morreu antes de
            # marcar. Marca agora, senão toda rodada futura gasta uma chamada
            # aqui só para redescobrir a mesma coisa.
            with arq.open("a") as fh:
                fh.write(json.dumps({
                    "schema": SCHEMA,
                    "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "kind": "completo", "date": str(dia), "n_corridas": len(cartao),
                }, ensure_ascii=False) + "\n")
            print(f"  ⏭  {dia} já completo ({len(cartao)} corridas) — marcado")
            dia += dt.timedelta(days=1)
            dias_ok += 1
            continue

        with arq.open("a") as fh:
            if not vistos:
                fh.write(json.dumps({
                    "schema": SCHEMA,
                    "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "kind": "racecards", "date": str(dia), "payload": cartao,
                }, ensure_ascii=False) + "\n")

            gravadas = 0
            for corrida in pendentes:
                if chamadas >= args.max_calls or cotas.restantes() == 0:
                    break
                time.sleep(PAUSA)
                st, det = buscar(
                    f"https://{host}/race/{corrida['id_race']}", host, cotas
                )
                chamadas += 1
                if st != 200:
                    continue
                fh.write(json.dumps({
                    "schema": SCHEMA,
                    "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "kind": "race", "date": str(dia), "payload": det,
                }, ensure_ascii=False) + "\n")
                gravadas += 1

        completo = gravadas + len(vistos) >= len(cartao)
        print(f"  {'✅' if completo else '◐ '} {dia}  {gravadas + len(vistos)}/{len(cartao)} corridas"
              f"  (chaves restantes: {cotas.restantes()})")
        if completo:
            with arq.open("a") as fh:
                fh.write(json.dumps({
                    "schema": SCHEMA,
                    "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "kind": "completo", "date": str(dia), "n_corridas": len(cartao),
                }, ensure_ascii=False) + "\n")
            dias_ok += 1
            dia += dt.timedelta(days=1)
        else:
            break  # sem cota: retoma este mesmo dia na próxima execução

    print(f"[resumo] dias completos={dias_ok} chamadas={chamadas} "
          f"chaves com cota={cotas.restantes()}/{len(chaves)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
