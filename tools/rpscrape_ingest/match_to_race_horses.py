#!/usr/bin/env python3
"""Matcher: resolve hml.rpscrape_results.race_horse_id via
(race_date, course, off_time, horse_name_norm) → race_horses_hr_enriched.id.

Estratégia:
  1. Pega lote de linhas pending (LIMIT N por execução pra não estourar memória)
  2. Pra cada linha, busca candidatos em racecards_hr_enriched + race_horses_hr_enriched
     com mesma data, course, off_time_uk (≈ off do rpscrape)
  3. Score por nome do cavalo (Levenshtein normalizado em SQL via pg_trgm
     OU comparação direta de horse_name_norm pré-computado)
  4. match_confidence = 1.0 se exact match nome+off_time; 0.85+ pra match
     "fuzzy" (nome com 1-2 chars diff por causa de typos/diferenças de
     transliteração)
  5. Atualiza match_status + race_horse_id + match_confidence + matched_at

Uso:
  python match_to_race_horses.py [--limit N] [--since YYYY-MM-DD]

Caveats:
  * race_horses_hr_enriched.horse vem com sufixo país igual ao rpscrape ("Socialite (IRE)").
    Vamos comparar via lower(regexp_replace) inline pra não exigir coluna nova lá.
  * off_time_uk pode estar como "17:40" (string) ou variar formato (depende da
    fonte). Match tenta exato primeiro; fallback ignora off_time se único hit.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg
from dotenv import load_dotenv

DEFAULT_LIMIT = 50_000


# Query principal — pega lote de pending e tenta match com confiança alta.
# Estratégia 1 (alta confiança): match exato em (date, course_lower, off_time, normalized_horse_name)
# Estratégia 2 (média confiança): ignora off_time se nome é único pra (date, course)
SQL_MATCH_EXACT = """
WITH pending AS (
    SELECT id, race_date, course, off_time, horse_name_norm
    FROM hml.rpscrape_results
    WHERE match_status IN ('pending', 'unmatched')
    {since_clause}
    ORDER BY race_date DESC, id
    LIMIT %(limit)s
),
candidates AS (
    SELECT
        p.id AS rps_id,
        rh.id AS race_horse_id,
        -- nome normalizado da race_horses_hr_enriched (mesma regra do parsers.py)
        lower(
            regexp_replace(
                regexp_replace(rh.horse, '\\s*\\([A-Z]{{2,3}}\\)\\s*$', ''),
                '[^a-z0-9\\s]', '', 'gi'
            )
        ) AS rh_horse_norm,
        rc.off_time_uk,
        p.off_time,
        p.horse_name_norm
    FROM pending p
    JOIN hml.racecards_hr_enriched rc
      ON rc.date = p.race_date
     AND lower(regexp_replace(regexp_replace(rc.course, '\\s*\\((?:AW|PF|July|New|Old|Rowley|Hunt|Chase)\\)\\s*$', '', 'i'), '\\s+(Park|Downs|Hill|Common|Heath|Racecourse|Bridge|City)\\s*$', '', 'i'))
       = lower(regexp_replace(regexp_replace(p.course, '\\s*\\((?:AW|PF|July|New|Old|Rowley|Hunt|Chase)\\)\\s*$', '', 'i'), '\\s+(Park|Downs|Hill|Common|Heath|Racecourse|Bridge|City)\\s*$', '', 'i'))
    JOIN hml.race_horses_hr_enriched rh
      ON rh.racecard_id = rc.id
)
UPDATE hml.rpscrape_results r
SET race_horse_id = c.race_horse_id,
    match_status = 'matched',
    match_confidence = 1.00,
    matched_at = now()
FROM candidates c
WHERE r.id = c.rps_id
  AND c.rh_horse_norm = c.horse_name_norm
  AND (c.off_time_uk = c.off_time OR c.off_time IS NULL);
"""

# Estratégia 2: nome único por (date, course) — match mesmo se off_time diverge
# (cobre casos de mudança de horário, formato H:MM vs HH:MM, etc.)
SQL_MATCH_BY_NAME_UNIQUE = """
WITH pending AS (
    SELECT id, race_date, course, horse_name_norm
    FROM hml.rpscrape_results
    WHERE match_status IN ('pending', 'unmatched')
    {since_clause}
    ORDER BY race_date DESC, id
    LIMIT %(limit)s
),
candidates AS (
    SELECT
        p.id AS rps_id,
        rh.id AS race_horse_id,
        lower(
            regexp_replace(
                regexp_replace(rh.horse, '\\s*\\([A-Z]{{2,3}}\\)\\s*$', ''),
                '[^a-z0-9\\s]', '', 'gi'
            )
        ) AS rh_horse_norm,
        p.horse_name_norm
    FROM pending p
    JOIN hml.racecards_hr_enriched rc
      ON rc.date = p.race_date
     AND lower(regexp_replace(regexp_replace(rc.course, '\\s*\\((?:AW|PF|July|New|Old|Rowley|Hunt|Chase)\\)\\s*$', '', 'i'), '\\s+(Park|Downs|Hill|Common|Heath|Racecourse|Bridge|City)\\s*$', '', 'i'))
       = lower(regexp_replace(regexp_replace(p.course, '\\s*\\((?:AW|PF|July|New|Old|Rowley|Hunt|Chase)\\)\\s*$', '', 'i'), '\\s+(Park|Downs|Hill|Common|Heath|Racecourse|Bridge|City)\\s*$', '', 'i'))
    JOIN hml.race_horses_hr_enriched rh
      ON rh.racecard_id = rc.id
),
unique_matches AS (
    SELECT rps_id, MIN(race_horse_id) AS race_horse_id, COUNT(*) AS n
    FROM candidates
    WHERE rh_horse_norm = horse_name_norm
    GROUP BY rps_id
)
UPDATE hml.rpscrape_results r
SET race_horse_id = u.race_horse_id,
    match_status = 'matched',
    match_confidence = 0.90,  -- ligeiramente menor: confiança via unicidade em vez de off_time
    matched_at = now()
FROM unique_matches u
WHERE r.id = u.rps_id
  AND u.n = 1
  AND r.match_status IN ('pending', 'unmatched');
"""

# Marca como unmatched o que sobrou — limita a varredura ao mesmo lote
SQL_MARK_UNMATCHED = """
WITH still_pending AS (
    SELECT id FROM hml.rpscrape_results
    WHERE match_status IN ('pending', 'unmatched')
    {since_clause}
    ORDER BY race_date DESC, id
    LIMIT %(limit)s
)
UPDATE hml.rpscrape_results r
SET match_status = 'unmatched',
    matched_at = now()
FROM still_pending sp
WHERE r.id = sp.id;
"""


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


def run(limit: int, since: str | None):
    conn = get_conn()
    params = {"limit": limit}
    since_clause = ""
    if since:
        since_clause = "AND race_date >= %(since)s"
        params["since"] = since

    with conn.cursor() as cur:
        cur.execute(SQL_MATCH_EXACT.format(since_clause=since_clause), params)
        n_exact = cur.rowcount
        cur.execute(SQL_MATCH_BY_NAME_UNIQUE.format(since_clause=since_clause), params)
        n_unique = cur.rowcount
        cur.execute(SQL_MARK_UNMATCHED.format(since_clause=since_clause), params)
        n_unmatched = cur.rowcount

        # Estatísticas
        where = "WHERE 1=1"
        if since:
            where += f" AND race_date >= '{since}'"
        cur.execute(f"""
            SELECT match_status, COUNT(*)
            FROM hml.rpscrape_results
            {where}
            GROUP BY match_status
            ORDER BY 1
        """)
        stats = dict(cur.fetchall())

    conn.commit()
    conn.close()

    print(f"matched (exact, conf=1.00): {n_exact}", file=sys.stderr)
    print(f"matched (name-unique, conf=0.90): {n_unique}", file=sys.stderr)
    print(f"marked unmatched: {n_unmatched}", file=sys.stderr)
    print(f"--- distribution {('since '+since) if since else 'overall'}: {stats}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT,
                    help=f"Max pending rows per batch (default {DEFAULT_LIMIT})")
    ap.add_argument("--since", help="Apenas linhas com race_date >= YYYY-MM-DD")
    args = ap.parse_args()
    run(args.limit, args.since)


if __name__ == "__main__":
    main()
