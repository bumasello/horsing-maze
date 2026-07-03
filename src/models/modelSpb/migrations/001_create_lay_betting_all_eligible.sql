-- hml.lay_betting_all_eligible — salva TODOS os cavalos elegíveis por corrida,
-- não só os top-3 do combined_score. Habilita análises/estratégias posteriores
-- sem precisar re-rodar predições.
--
-- Exemplos de estratégias que ficam viáveis:
--   - "top-N do dia por combined_score global"
--   - "todos os cavalos com P(lose) >= 96% e IVL >= 0.03"
--   - "análise de picks alternativos que a cascata pulou"
--
-- Diferença dos irmãos:
--   - lay_betting_picks       → SÓ o main pick (cascade winner)
--   - lay_betting_top_picks   → SÓ os top-3
--   - lay_betting_all_eligible → TODO cavalo que passou nos filtros básicos
--                                (não-runner=false e market_odd disponível)

CREATE SCHEMA IF NOT EXISTS hml;

CREATE TABLE IF NOT EXISTS hml.lay_betting_all_eligible (
  id BIGSERIAL PRIMARY KEY,

  -- ─── Chaves ─────────────────────────────────────────────────────────
  racecard_id      BIGINT NOT NULL,
  race_id          BIGINT NOT NULL,
  race_horse_id    BIGINT NOT NULL,
  horse_id         BIGINT NOT NULL,

  -- ─── Denormalizado pra queries rápidas ──────────────────────────────
  race_date        DATE,
  off_time_br      TEXT,
  course           TEXT,
  race_title       TEXT,
  horse_name       TEXT,
  horse_number     INT,

  -- ─── Métricas do modelo ─────────────────────────────────────────────
  predicted_probability   REAL NOT NULL,          -- P(lose) do modelo
  market_odd              REAL,                    -- sp_decimal (fallback: avg histórica)
  ivl_score               REAL,                    -- P(lose modelo) − P(lose mercado)
  combined_score          REAL NOT NULL,           -- 0.4*p + 0.4*IVL + 0.2*odd_range

  -- ─── Ranking dentro da corrida (1 = top pick) ───────────────────────
  pick_rank_in_race       INT NOT NULL,

  -- ─── Classificações ─────────────────────────────────────────────────
  pick_type               TEXT,                    -- VALUE / PROBABILITY / HYBRID
  lay_recommendation      TEXT,                    -- STRONG_LAY / LAY / NEUTRAL / AVOID

  -- ─── Auditoria ──────────────────────────────────────────────────────
  model_version           TEXT NOT NULL,
  generated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (racecard_id, race_horse_id, model_version)
);

-- Índices pras queries mais frequentes
CREATE INDEX IF NOT EXISTS idx_all_eligible_race_date
  ON hml.lay_betting_all_eligible (race_date);

CREATE INDEX IF NOT EXISTS idx_all_eligible_race_id
  ON hml.lay_betting_all_eligible (race_id);

CREATE INDEX IF NOT EXISTS idx_all_eligible_combined_score
  ON hml.lay_betting_all_eligible (race_date, combined_score DESC);

CREATE INDEX IF NOT EXISTS idx_all_eligible_prob
  ON hml.lay_betting_all_eligible (race_date, predicted_probability DESC);

CREATE INDEX IF NOT EXISTS idx_all_eligible_model_version
  ON hml.lay_betting_all_eligible (model_version);

COMMENT ON TABLE hml.lay_betting_all_eligible IS
  'Todos os cavalos elegíveis por corrida (não só top-3). Habilita análises retroativas de estratégias diferentes sem re-rodar predições.';
