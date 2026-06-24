#!/usr/bin/env python3
"""Smoke test do parsers.py rodando contra o CSV real gerado pelo rpscrape.
Não precisa Postgres — só valida normalização e parse de tipos.

Uso:
  python test_parsers.py <csv_path>
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib.parsers import parse_row, normalize_horse_name


def main():
    if len(sys.argv) != 2:
        print("Usage: test_parsers.py <csv_path>", file=sys.stderr)
        sys.exit(2)

    csv_path = Path(sys.argv[1])
    print(f"📥 {csv_path}")
    print()

    n_total = 0
    n_parsed = 0
    n_with_comment = 0
    n_with_ovr_btn = 0
    n_with_rpr = 0
    n_with_secs = 0
    samples: list[dict] = []

    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            n_total += 1
            parsed = parse_row(row)
            if parsed is None:
                continue
            n_parsed += 1
            if parsed.get("comment"):
                n_with_comment += 1
            if parsed.get("ovr_btn") is not None:
                n_with_ovr_btn += 1
            if parsed.get("rpr_rating") is not None:
                n_with_rpr += 1
            if parsed.get("secs") is not None:
                n_with_secs += 1
            if len(samples) < 3:
                samples.append(parsed)

    print(f"Linhas totais (não-header): {n_total}")
    print(f"Linhas parseadas com sucesso: {n_parsed} ({n_parsed/n_total*100:.1f}%)")
    print(f"  com `comment`: {n_with_comment} ({n_with_comment/n_parsed*100:.1f}%)")
    print(f"  com `ovr_btn`: {n_with_ovr_btn} ({n_with_ovr_btn/n_parsed*100:.1f}%)")
    print(f"  com `rpr_rating`: {n_with_rpr} ({n_with_rpr/n_parsed*100:.1f}%)")
    print(f"  com `secs`: {n_with_secs} ({n_with_secs/n_parsed*100:.1f}%)")
    print()

    print("=== Sample 1 — campos relevantes ===")
    s = samples[0]
    keys = ["race_date", "course", "off_time", "horse_name", "horse_name_norm",
            "pos", "pos_raw", "ovr_btn", "btn", "secs", "or_rating", "rpr_rating",
            "ts_rating", "dec_odds", "comment"]
    for k in keys:
        v = s.get(k, "(missing)")
        if isinstance(v, str) and len(v) > 80:
            v = v[:77] + "..."
        print(f"  {k:20} = {v!r}")
    print()

    print("=== Sanity: normalize_horse_name ===")
    tests = [
        ("Socialite (IRE)", "socialite"),
        ("A.P. McCoy", "ap mccoy"),
        ("Sébastien", "sebastien"),
        ("Big H", "big h"),
        ("Don't Tell Mum (GB)", "dont tell mum"),
    ]
    for input_name, expected in tests:
        got = normalize_horse_name(input_name)
        ok = "✅" if got == expected else "❌"
        print(f"  {ok} {input_name!r:30} → {got!r:25} (expected {expected!r})")


if __name__ == "__main__":
    main()
