"""Parsers e normalizadores do CSV do rpscrape → tipos do Postgres.

Decisões importantes:
  * Strings vazias do CSV ('') viram None (Postgres NULL).
  * `pos` cru pode ser '1', '2', 'PU' (pulled up), 'F' (fell), 'BD' (brought
    down), 'UR' (unseated rider), '–' (não correu mesmo aparecendo no card).
    Mantemos `pos_raw` SEMPRE; `pos` (int) só quando o cru é numérico.
  * `ovr_btn` no rpscrape vem como string decimal (ex "5.5") ou vazio. Já é
    parseado pelos próprios scripts do rpscrape — não precisamos parse de
    "neck" / "shd" / "nse" aqui. Mas vamos defensivamente tratar.
  * `horse_name_norm`: lowercase, remove sufixo país, strip pontuação. Esse é
    o campo chave de matching com race_horses_hr_enriched.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

# rpscrape codifica DNF como pos vazio + sufixos no comment.
# Códigos não-numéricos comuns em pos_raw:
_NONNUMERIC_POS = {"PU", "F", "BD", "UR", "REF", "RR", "RO", "SU", "VOI", "DSQ", "NR", "WD", "–", "-", ""}


def to_str_or_none(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def to_int_or_none(value: Any) -> int | None:
    s = to_str_or_none(value)
    if s is None:
        return None
    try:
        return int(s)
    except ValueError:
        return None


def to_real_or_none(value: Any) -> float | None:
    s = to_str_or_none(value)
    if s is None:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_pos(value: Any) -> tuple[int | None, str | None]:
    """Retorna (pos_int, pos_raw_str). pos_int só preenchido se cru é numérico."""
    raw = to_str_or_none(value)
    if raw is None or raw.upper() in _NONNUMERIC_POS:
        return None, raw
    try:
        return int(raw), raw
    except ValueError:
        return None, raw


def normalize_horse_name(name: str | None) -> str:
    """Lowercase, remove sufixo país ('(IRE)', '(GB)', etc), tira pontuação
    e normaliza Unicode (NFKD → drop combining marks). Usado pra matching.

    >>> normalize_horse_name("Socialite (IRE)")
    'socialite'
    >>> normalize_horse_name("A.P. McCoy")
    'ap mccoy'
    >>> normalize_horse_name("Sébastien")
    'sebastien'
    """
    if not name:
        return ""
    # Drop sufixo país
    s = re.sub(r"\s*\([A-Z]{2,3}\)\s*$", "", name)
    # Lowercase + NFKD pra tirar acentos
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    # Tira pontuação, mantém letras/dígitos/espaço
    s = re.sub(r"[^a-z0-9\s]", "", s)
    # Colapsa whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s


# Mapeamento das colunas do CSV (header inteiro do rpscrape com default settings)
# → nome da coluna no Postgres + função de parse.
# Ordem importa: bate com o CSV inteiro pra DictReader.
CSV_TO_DB_FIELDS: list[tuple[str, str, callable]] = [
    # CSV col      DB col            Parser
    ("date",        "race_date",      to_str_or_none),   # ISO date string → DATE cast no SQL
    ("region",      "region",         to_str_or_none),
    ("course",      "course",         to_str_or_none),
    ("course_detail", None,           None),             # ignored
    ("off",         "off_time",       to_str_or_none),
    ("race_name",   None,             None),             # ignored
    ("type",        "race_type",      to_str_or_none),
    ("class",       "race_class",     to_str_or_none),
    ("pattern",     "pattern",        to_str_or_none),
    ("rating_band", "rating_band",    to_str_or_none),
    ("age_band",    "age_band",       to_str_or_none),
    ("sex_rest",    None,             None),             # ignored
    ("dist",        None,             None),             # ignored (uso dist_f/dist_m)
    ("dist_f",      "dist_f",         to_real_or_none),
    ("dist_m",      "dist_m",         to_int_or_none),
    ("going",       "going",          to_str_or_none),
    ("surface",     "surface",        to_str_or_none),
    ("ran",         "ran",            to_int_or_none),
    ("num",         "num",            to_int_or_none),
    ("pos",         "_pos_pair",      parse_pos),        # special: (pos, pos_raw)
    ("draw",        "draw",           to_int_or_none),
    ("ovr_btn",     "ovr_btn",        to_real_or_none),
    ("btn",         "btn",            to_real_or_none),
    ("horse",       "_horse_pair",    None),             # special: (horse_name, horse_name_norm)
    ("age",         "age",            to_int_or_none),
    ("sex",         "sex",            to_str_or_none),
    ("lbs",         "lbs",            to_int_or_none),
    ("hg",          "hg",             to_str_or_none),
    ("time",        None,             None),             # ignored (uso secs)
    ("secs",        "secs",           to_real_or_none),
    ("dec",         "dec_odds",       to_real_or_none),
    ("jockey",      "jockey",         to_str_or_none),
    ("trainer",     "trainer",        to_str_or_none),
    ("prize",       "prize",          to_str_or_none),
    ("or",          "or_rating",      to_int_or_none),
    ("rpr",         "rpr_rating",     to_int_or_none),
    ("ts",          "ts_rating",      to_int_or_none),   # presente só se user_settings.toml: ts=true
    ("sire",        "sire",           to_str_or_none),
    ("dam",         "dam",            to_str_or_none),
    ("damsire",     "damsire",        to_str_or_none),
    ("owner",       "owner",          to_str_or_none),
    ("comment",     "comment",        to_str_or_none),
    # Betfair (só presentes com betfair_data=true)
    ("bsp",         "bsp",            to_real_or_none),
    ("wap",         "wap",            to_real_or_none),
    ("morning_wap", "morning_wap",    to_real_or_none),
    ("pre_min",     "pre_min",        to_real_or_none),
    ("pre_max",     "pre_max",        to_real_or_none),
    ("ip_min",      "ip_min",         to_real_or_none),
    ("ip_max",      "ip_max",         to_real_or_none),
    # morning_vol, pre_vol, ip_vol existem em settings mas não usamos por ora
]


def parse_row(row: dict[str, str]) -> dict[str, Any] | None:
    """Converte uma linha do DictReader → dict pronto pra INSERT.

    Retorna None se a linha não tem campos obrigatórios (date/course/horse).
    """
    out: dict[str, Any] = {}
    for csv_col, db_col, parser in CSV_TO_DB_FIELDS:
        if db_col is None:
            continue
        raw = row.get(csv_col)
        if db_col == "_pos_pair":
            pos_int, pos_raw = parse_pos(raw)
            out["pos"] = pos_int
            out["pos_raw"] = pos_raw
        elif db_col == "_horse_pair":
            horse = to_str_or_none(raw)
            out["horse_name"] = horse
            out["horse_name_norm"] = normalize_horse_name(horse)
        else:
            out[db_col] = parser(raw) if parser else to_str_or_none(raw)

    # Validação mínima — sem race_date/course/horse_name a linha é lixo
    if not out.get("race_date") or not out.get("course") or not out.get("horse_name"):
        return None
    return out
