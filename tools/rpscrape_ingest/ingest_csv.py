#!/usr/bin/env python3
"""Ingestor: recebe 1 ou mais CSVs do rpscrape e insere em hml.rpscrape_results.

Estratégia:
  1. Pra cada CSV: parse linha por linha via lib/parsers.py
  2. Acumula rows em batch (10k linhas)
  3. INSERT ... ON CONFLICT (race_date, course, off_time, horse_name_norm)
     DO NOTHING — re-roda sem duplicar.
  4. match_status fica 'pending'; matching FK é feito por script separado.

Uso:
  python ingest_csv.py <csv_path_or_dir> [<csv_path_or_dir> ...]

Variáveis de ambiente esperadas (.env no mesmo dir):
  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD

Saída em stderr:
  - 1 linha por CSV: "ok <path> <n_inserted>/<n_total>"
  - "FAIL <path> <reason>" em caso de erro de parse/db
"""

from __future__ import annotations

import csv
import os
import sys
from pathlib import Path

import psycopg
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent))
from lib.parsers import CSV_TO_DB_FIELDS, parse_row  # noqa: E402

# Coluna nas linhas insertadas (ordem fixa = pgcopy)
DB_COLUMNS = [
    "race_date", "course", "off_time", "horse_name", "horse_name_norm",
    "region", "race_type", "race_class", "pattern", "rating_band", "age_band",
    "dist_f", "dist_m", "going", "surface", "ran",
    "num", "pos", "pos_raw", "draw", "ovr_btn", "btn",
    "age", "sex", "lbs", "hg", "secs", "dec_odds",
    "jockey", "trainer", "prize", "or_rating", "rpr_rating", "ts_rating",
    "sire", "dam", "damsire", "owner", "comment",
    "bsp", "wap", "morning_wap", "pre_min", "pre_max", "ip_min", "ip_max",
    "source_csv",
]

BATCH_SIZE = 10_000


def get_conn():
    load_dotenv(Path(__file__).parent / ".env")
    return psycopg.connect(
        host=os.environ["DB_HOST"],
        port=os.environ.get("DB_PORT", "5432"),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        autocommit=False,
    )


def ingest_one_csv(conn: psycopg.Connection, csv_path: Path) -> tuple[int, int]:
    """Retorna (n_inserted, n_total)."""
    csv_rel = str(csv_path.relative_to(csv_path.parents[1]))  # debug-friendly
    n_total = 0
    batch: list[tuple] = []

    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for raw_row in reader:
            n_total += 1
            parsed = parse_row(raw_row)
            if parsed is None:
                continue
            parsed["source_csv"] = csv_rel
            # Garante todas as colunas — preenche faltantes com None
            tup = tuple(parsed.get(col) for col in DB_COLUMNS)
            batch.append(tup)

    if not batch:
        return 0, n_total

    placeholders = ",".join(["%s"] * len(DB_COLUMNS))
    cols_sql = ",".join(DB_COLUMNS)
    sql = f"""
        INSERT INTO hml.rpscrape_results ({cols_sql})
        VALUES ({placeholders})
        ON CONFLICT (race_date, course, off_time, horse_name_norm)
        DO NOTHING
    """

    n_inserted = 0
    with conn.cursor() as cur:
        # psycopg3 executemany aceita lote grande sem problemas
        for i in range(0, len(batch), BATCH_SIZE):
            chunk = batch[i:i + BATCH_SIZE]
            cur.executemany(sql, chunk)
            n_inserted += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    conn.commit()
    return n_inserted, n_total


def collect_csvs(paths: list[str]) -> list[Path]:
    out: list[Path] = []
    for p in paths:
        path = Path(p).expanduser().resolve()
        if path.is_dir():
            out.extend(sorted(path.rglob("*.csv")))
        elif path.is_file() and path.suffix == ".csv":
            out.append(path)
        else:
            print(f"SKIP not csv/dir: {path}", file=sys.stderr)
    return out


def main():
    if len(sys.argv) < 2:
        print("Usage: ingest_csv.py <csv_or_dir> [<csv_or_dir> ...]", file=sys.stderr)
        sys.exit(2)

    csvs = collect_csvs(sys.argv[1:])
    if not csvs:
        print("no CSV found", file=sys.stderr)
        sys.exit(1)

    conn = get_conn()
    total_inserted = 0
    total_rows = 0
    failed = 0
    try:
        for csv_path in csvs:
            try:
                n_ins, n_tot = ingest_one_csv(conn, csv_path)
                total_inserted += n_ins
                total_rows += n_tot
                print(f"ok {csv_path} {n_ins}/{n_tot}", file=sys.stderr)
            except Exception as e:
                conn.rollback()
                failed += 1
                print(f"FAIL {csv_path} {type(e).__name__}: {e}", file=sys.stderr)
    finally:
        conn.close()
    print(f"--- TOTAL: inserted={total_inserted}, rows_seen={total_rows}, files={len(csvs)}, failed={failed}", file=sys.stderr)
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
