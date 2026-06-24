-- hml.rpscrape_results — fonte de dados secundária via rpscrape
--
-- Não substitui race_horses_hr_enriched. Enriquece histórico com campos que a
-- Racing API / HR / SPB não trazem (comments-in-running, RPR, Topspeed,
-- ovr_btn, secs, Betfair SP). Linha = 1 cavalo em 1 corrida.
--
-- Match com race_horses_hr_enriched é resolvido em step separado via
-- (race_date, course, off_time, horse_name_norm). FK race_horse_id fica
-- pendente até o match script rodar.

CREATE SCHEMA IF NOT EXISTS hml;

CREATE TABLE IF NOT EXISTS hml.rpscrape_results (
  id BIGSERIAL PRIMARY KEY,

  -- ─── Chaves naturais (matching com race_horses_hr_enriched) ──────────
  race_date       DATE NOT NULL,
  course          TEXT NOT NULL,         -- nome do course (ex "Doncaster")
  off_time        TEXT,                  -- "HH:MM" local UK (string preservada)
  horse_name      TEXT NOT NULL,         -- com sufixo país: "Socialite (IRE)"
  horse_name_norm TEXT NOT NULL,         -- lowercase, sem sufixo país, trim → matching

  -- ─── Race-level (denormalizado pra análise/filtro) ───────────────────
  region      TEXT,                      -- "GB" / "IRE"
  race_type   TEXT,                      -- "Flat" / "Hurdle" / "Chase" / "NHF"
  race_class  TEXT,
  pattern     TEXT,
  rating_band TEXT,
  age_band    TEXT,
  dist_f      REAL,                      -- distância em furlongs
  dist_m      INTEGER,                   -- em metros
  going       TEXT,
  surface     TEXT,
  ran         INTEGER,                   -- field size

  -- ─── Runner-level ────────────────────────────────────────────────────
  num         INTEGER,                   -- racecard number
  pos         INTEGER,                   -- finish position (NULL se DNF/PU/F/U)
  pos_raw     TEXT,                      -- valor cru ("3", "PU", "F", "BD", "UR")
  draw        INTEGER,
  ovr_btn     REAL,                      -- total lengths beaten (parseado)
  btn         REAL,                      -- lengths atrás do anterior
  age         INTEGER,
  sex         TEXT,
  lbs         INTEGER,
  hg          TEXT,                      -- headgear codes
  secs        REAL,                      -- tempo total da corrida em segundos
  dec_odds    NUMERIC(8, 3),             -- decimal odds (SP)
  jockey      TEXT,
  trainer     TEXT,
  prize       TEXT,                      -- string com símbolo de moeda
  or_rating   INTEGER,
  rpr_rating  INTEGER,
  ts_rating   INTEGER,                   -- preenchido quando user_settings.toml: ts=true
  sire        TEXT,
  dam         TEXT,
  damsire     TEXT,
  owner       TEXT,
  comment     TEXT,                      -- texto completo do in-running

  -- ─── Betfair (quando settings.betfair_data=true) ─────────────────────
  bsp         NUMERIC(10, 3),
  wap         NUMERIC(10, 3),
  morning_wap NUMERIC(10, 3),
  pre_min     NUMERIC(10, 3),
  pre_max     NUMERIC(10, 3),
  ip_min      NUMERIC(10, 3),
  ip_max      NUMERIC(10, 3),

  -- ─── Matching com race_horses_hr_enriched ────────────────────────────
  race_horse_id    BIGINT REFERENCES hml.race_horses_hr_enriched(id),
  match_status     TEXT NOT NULL DEFAULT 'pending',
    -- 'pending' (acabou de ser inserido)
    -- 'matched' (FK resolvida, match_confidence ≥ threshold)
    -- 'unmatched' (não achou linha correspondente em race_horses_hr_enriched)
    -- 'ambiguous' (>1 candidato no matching script)
  match_confidence NUMERIC(3, 2),         -- 0.00-1.00 (Jaro-Winkler do nome + bool exact off_time)
  matched_at       TIMESTAMPTZ,

  -- ─── Audit ───────────────────────────────────────────────────────────
  source_csv  TEXT,                       -- path relativo do CSV no servidor (debug)
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT rpscrape_match_status_chk
    CHECK (match_status IN ('pending', 'matched', 'unmatched', 'ambiguous'))
);

-- Unique key natural — evita inserir mesma linha 2× se re-rodar o ingestor
CREATE UNIQUE INDEX IF NOT EXISTS rpscrape_results_natural_key_uidx
  ON hml.rpscrape_results (race_date, course, off_time, horse_name_norm);

-- JOIN com race_horses_hr_enriched já matchados — uso comum no orchestrator
CREATE INDEX IF NOT EXISTS rpscrape_results_race_horse_id_idx
  ON hml.rpscrape_results (race_horse_id)
  WHERE race_horse_id IS NOT NULL;

-- Backlog de matching pendente
CREATE INDEX IF NOT EXISTS rpscrape_results_pending_idx
  ON hml.rpscrape_results (race_date)
  WHERE match_status = 'pending';

-- Pra agregar histórico de um cavalo (pace_recent_5 feature)
CREATE INDEX IF NOT EXISTS rpscrape_results_horse_name_norm_date_idx
  ON hml.rpscrape_results (horse_name_norm, race_date DESC);

COMMENT ON TABLE hml.rpscrape_results IS
  'Resultados de corridas via rpscrape (Racing Post). Fonte SECUNDÁRIA que enriquece histórico com comments-in-running, RPR, Topspeed, ovr_btn, secs, Betfair SP. Match com race_horses_hr_enriched feito por script separado.';
COMMENT ON COLUMN hml.rpscrape_results.horse_name_norm IS
  'Nome lowercase sem sufixo país (ex "(IRE)") e sem caracteres não-ASCII. Usado pra matching.';
COMMENT ON COLUMN hml.rpscrape_results.match_status IS
  'pending → matched/unmatched/ambiguous após rodar match_to_race_horses.py';
