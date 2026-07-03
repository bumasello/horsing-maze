# Supabase Database Schema — `hml`

Documentação completa das tabelas, views e índices do schema `hml` (Horse Racing ML).

---

## Sumário

| Tabela                               | Descrição                          | Relações                                                                 |
| ------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------ |
| `horse_stats_enriched`               | Cadastro único de cavalos          | PK referenciada por `horse_results_enriched`                             |
| `horse_results_enriched`             | Histórico de resultados por cavalo | FK → `horse_stats_enriched`                                              |
| `racecards_hr_enriched`              | Corridas (racecards)               | Referenciada por `race_horses_hr_enriched`                               |
| `race_horses_hr_enriched`            | Cavalos inscritos em cada corrida  | FK implícita → `racecards_hr_enriched`; referenciada por `odds_enriched` |
| `odds_enriched`                      | Odds pré-corrida por bookie        | FK → `race_horses_hr_enriched`                                           |
| `training_enriched_horse_features`   | Features de treino com target      | —                                                                        |
| `prediction_enriched_horse_features` | Features de predição sem target    | —                                                                        |
| `lay_betting_picks`                  | Pick principal (1 por corrida)     | —                                                                        |
| `lay_betting_top_picks`              | Top 3 picks por corrida            | —                                                                        |
| `lay_betting_race_results`           | Resultado operacional por corrida  | —                                                                        |
| `model_metrics_history`              | Histórico de métricas de treino    | —                                                                        |
| `racing_api_raw`                     | Respostas brutas da Racing API     | —                                                                        |

### Views

| View                    | Descrição                              |
| ----------------------- | -------------------------------------- |
| `lay_picks_performance` | Performance semanal dos picks por tipo |
| `top_picks_analysis`    | Cruzamento top_picks × pick principal  |

---

## Tabelas Detalhadas

### `horse_stats_enriched`

Cadastro único de cavalos. Cada cavalo tem um `id_horse` exclusivo.

| Coluna         | Tipo          | Nullable | Default | Descrição                          |
| -------------- | ------------- | -------- | ------- | ---------------------------------- |
| `id`           | `bigserial`   | NOT NULL | auto    | PK                                 |
| `horse`        | `text`        | NULL     | —       | Nome do cavalo                     |
| `id_horse`     | `integer`     | NULL     | —       | ID externo (único)                 |
| `result_count` | `integer`     | NOT NULL | `0`     | Contagem de resultados registrados |
| `created_at`   | `timestamptz` | NULL     | `now()` | —                                  |
| `updated_at`   | `timestamptz` | NULL     | `now()` | —                                  |

**Constraints:**

- PK: `id`
- UNIQUE: `id_horse`

---

### `horse_results_enriched`

Histórico de resultados individuais de cada cavalo em corridas passadas.

| Coluna           | Tipo          | Nullable | Default | Descrição                      |
| ---------------- | ------------- | -------- | ------- | ------------------------------ |
| `id`             | `bigserial`   | NOT NULL | auto    | PK                             |
| `stats_id`       | `bigint`      | NULL     | —       | FK → `horse_stats_enriched.id` |
| `date`           | `varchar`     | NULL     | —       | Data da corrida (string)       |
| `position`       | `integer`     | NULL     | —       | Posição final                  |
| `course`         | `text`        | NULL     | —       | Hipódromo                      |
| `distance`       | `text`        | NULL     | —       | Distância (ex: "1m2f")         |
| `class`          | `integer`     | NULL     | —       | Classe da corrida              |
| `weight`         | `text`        | NULL     | —       | Peso carregado                 |
| `starting_price` | `numeric`     | NULL     | —       | SP decimal                     |
| `jockey`         | `text`        | NULL     | —       | Nome do jóquei                 |
| `trainer`        | `text`        | NULL     | —       | Nome do treinador              |
| `or_rating`      | `integer`     | NULL     | —       | Official Rating                |
| `race`           | `text`        | NULL     | —       | Nome/título da corrida         |
| `prize`          | `text`        | NULL     | —       | Premiação                      |
| `created_at`     | `timestamptz` | NULL     | `now()` | —                              |
| `updated_at`     | `timestamptz` | NULL     | `now()` | —                              |

**Constraints:**

- PK: `id`
- UNIQUE: `(stats_id, date, race)`
- FK: `stats_id` → `horse_stats_enriched(id)` ON DELETE CASCADE

---

### `racecards_hr_enriched`

Corridas (racecards) — uma linha por corrida.

| Coluna         | Tipo          | Nullable | Default  | Descrição                             |
| -------------- | ------------- | -------- | -------- | ------------------------------------- |
| `id`           | `bigint`      | NOT NULL | sequence | PK                                    |
| `id_race`      | `text`        | NULL     | —        | ID externo da corrida (único)         |
| `course`       | `text`        | NULL     | —        | Hipódromo                             |
| `date`         | `date`        | NULL     | —        | Data da corrida                       |
| `off_time_br`  | `text`        | NULL     | —        | Horário de largada (BR)               |
| `off_time_uk`  | `varchar(5)`  | NULL     | —        | Horário de largada (UK)               |
| `title`        | `text`        | NULL     | —        | Título da corrida                     |
| `distance`     | `text`        | NULL     | —        | Distância                             |
| `age`          | `integer`     | NULL     | —        | Restrição de idade                    |
| `going`        | `text`        | NULL     | —        | Condição do terreno                   |
| `finished`     | `integer`     | NULL     | —        | 1 se finalizada                       |
| `canceled`     | `integer`     | NULL     | —        | 1 se cancelada                        |
| `finish_time`  | `text`        | NULL     | —        | Tempo de chegada                      |
| `prize`        | `text`        | NULL     | —        | Premiação                             |
| `class`        | `integer`     | NULL     | —        | Classe (1-7)                          |
| `race_type`    | `varchar`     | NULL     | —        | Tipo: Flat / Hurdle / Chase / NH Flat |
| `surface`      | `varchar`     | NULL     | —        | Superfície: Turf / AW                 |
| `create_entry` | `boolean`     | NULL     | `false`  | Flag de controle                      |
| `created_at`   | `timestamptz` | NULL     | `now()`  | —                                     |
| `updated_at`   | `timestamptz` | NULL     | `now()`  | —                                     |

**Constraints:**

- PK: `id`
- UNIQUE: `id_race`

**Índices:**

- `idx_racecards_race_type` — filtrado (`race_type IS NOT NULL`)
- `idx_racecards_surface` — filtrado (`surface IS NOT NULL`)

---

### `race_horses_hr_enriched`

Cavalos inscritos em cada corrida. Relaciona cavalo ↔ corrida.

| Coluna              | Tipo          | Nullable | Default  | Descrição                                 |
| ------------------- | ------------- | -------- | -------- | ----------------------------------------- |
| `id`                | `bigint`      | NOT NULL | sequence | PK                                        |
| `racecard_id`       | `bigint`      | NULL     | —        | FK implícita → `racecards_hr_enriched.id` |
| `horse`             | `text`        | NULL     | —        | Nome do cavalo                            |
| `id_horse`          | `integer`     | NULL     | —        | ID externo do cavalo                      |
| `jockey`            | `text`        | NULL     | —        | Jóquei                                    |
| `trainer`           | `text`        | NULL     | —        | Treinador                                 |
| `age`               | `integer`     | NULL     | —        | Idade                                     |
| `weight`            | `text`        | NULL     | —        | Peso                                      |
| `number`            | `integer`     | NULL     | —        | Número na corrida                         |
| `last_ran_days_ago` | `integer`     | NULL     | —        | Dias desde última corrida                 |
| `non_runner`        | `integer`     | NULL     | —        | 1 se non-runner                           |
| `form`              | `text`        | NULL     | —        | String de form (ex: "12305-")             |
| `position`          | `integer`     | NULL     | —        | Posição final (pós-corrida)               |
| `distance_beaten`   | `text`        | NULL     | —        | Distância para o vencedor                 |
| `owner`             | `text`        | NULL     | —        | Proprietário                              |
| `sire`              | `text`        | NULL     | —        | Pai                                       |
| `dam`               | `text`        | NULL     | —        | Mãe                                       |
| `or_rating`         | `integer`     | NULL     | —        | Official Rating                           |
| `sp`                | `text`        | NULL     | —        | SP original (string, ex: "5/2")           |
| `sp_decimal`        | `real`        | NULL     | —        | SP convertido para decimal                |
| `draw`              | `integer`     | NULL     | —        | Posição de draw (gate)                    |
| `headgear`          | `varchar`     | NULL     | —        | Equipamento (viseira, etc.)               |
| `sex_code`          | `varchar`     | NULL     | —        | Código de sexo (M/F/G)                    |
| `damsire`           | `varchar`     | NULL     | —        | Pai da mãe                                |
| `damsire_id`        | `varchar`     | NULL     | —        | ID do pai da mãe                          |
| `created_at`        | `timestamptz` | NULL     | `now()`  | —                                         |
| `updated_at`        | `timestamptz` | NULL     | `now()`  | —                                         |

**Constraints:**

- PK: `id`
- UNIQUE: `(racecard_id, id_horse)`

**Índices:**

- `idx_race_horses_draw` — filtrado (`draw IS NOT NULL`)

---

### `odds_enriched`

Odds pré-corrida por bookie para cada cavalo inscrito.

| Coluna          | Tipo          | Nullable | Default | Descrição                         |
| --------------- | ------------- | -------- | ------- | --------------------------------- |
| `id`            | `bigserial`   | NOT NULL | auto    | PK                                |
| `race_horse_id` | `bigint`      | NULL     | —       | FK → `race_horses_hr_enriched.id` |
| `bookie`        | `text`        | NULL     | —       | Nome da casa de apostas           |
| `odd`           | `numeric`     | NULL     | —       | Odd decimal                       |
| `last_update`   | `timestamptz` | NULL     | —       | Última atualização da odd         |
| `url`           | `text`        | NULL     | —       | URL da aposta                     |
| `created_at`    | `timestamptz` | NULL     | `now()` | —                                 |
| `updated_at`    | `timestamptz` | NULL     | `now()` | —                                 |

**Constraints:**

- PK: `id`
- UNIQUE: `(race_horse_id, bookie, last_update)`
- FK: `race_horse_id` → `race_horses_hr_enriched(id)` ON DELETE CASCADE

**Índices:**

- `idx_odds_enriched_bookie`
- `idx_odds_enriched_race_horse_id`

---

### `training_enriched_horse_features`

Features calculadas para treino do modelo. Cada registro = 1 cavalo em 1 corrida com target definido.

| Coluna          | Tipo           | Nullable | Default | Descrição                        |
| --------------- | -------------- | -------- | ------- | -------------------------------- |
| `id`            | `bigserial`    | NOT NULL | auto    | PK                               |
| `race_horse_id` | `bigint`       | NOT NULL | —       | ID do cavalo na corrida          |
| `race_id`       | `bigint`       | NOT NULL | —       | ID da corrida                    |
| `horse_id`      | `bigint`       | NOT NULL | —       | ID do cavalo                     |
| `features`      | `jsonb`        | NOT NULL | —       | Objeto com 59 features numéricas |
| `target`        | `integer`      | NOT NULL | —       | 0 = não venceu, 1 = venceu       |
| `quality_score` | `numeric(3,2)` | NULL     | —       | Score de qualidade (0.0 a 1.0)   |
| `race_date`     | `date`         | NULL     | —       | Data da corrida                  |
| `race_type`     | `varchar`      | NULL     | —       | Flat / Jump                      |
| `model_version` | `varchar(50)`  | NULL     | —       | Versão do modelo                 |
| `generated_at`  | `timestamptz`  | NULL     | `now()` | —                                |

**Constraints:**

- PK: `id`
- UNIQUE: `(race_horse_id, model_version)`
- CHECK: `target IN (0, 1)`

**Índices:**

- `idx_training_features_race_date` — composto `(race_date, quality_score)`
- `idx_training_generated_at`
- `idx_training_horse_id`
- `idx_training_race_id`
- `idx_training_target`

**Formato do JSONB `features`:**

```json
{
  "career_win_rate": 0.15,
  "career_place_rate": 0.42,
  "career_avg_position": 4.2,
  "career_position_std": 2.1,
  "career_runs": 20,
  "career_wins": 3,
  "course_win_rate": 0.0,
  "course_runs": 2,
  "distance_band_win_rate": 0.18,
  "going_win_rate": 0.12,
  "class_win_rate": 0.1,
  "form_last3_avg": 3.5,
  "form_last5_avg": 4.1,
  "form_consistency": 0.65,
  "form_is_improving": 1,
  "form_has_problems": 0,
  "form_last_position": 2,
  "form_weighted_avg": 3.8,
  "form_exponential_avg": 3.6,
  "form_wins_in_last5": 1,
  "form_trend_score": 0.7,
  "sp_decimal": 5.5,
  "sp_implied_prob": 0.182,
  "sp_rank": 3,
  "sp_vs_field_avg": 0.85,
  "market_confidence": 0.72,
  "is_favorite": 0,
  "is_outsider": 0,
  "or_rating_imputed": 95,
  "or_rank_in_race": 4,
  "or_percentile_in_race": 0.6,
  "or_diff_to_top": -10,
  "or_advantage_score": 0.4,
  "field_avg_or": 90,
  "field_std_or": 8.5,
  "field_avg_career_wins": 2.1,
  "race_field_size": 12,
  "stronger_opponents_count": 5,
  "is_competitive_race": 1,
  "jockey_win_rate": 0.14,
  "jockey_recent_form": 0.18,
  "jockey_course_win_rate": 0.1,
  "jockey_total_runs": 500,
  "trainer_win_rate": 0.16,
  "trainer_recent_form": 0.2,
  "trainer_course_win_rate": 0.12,
  "jockey_trainer_combo_win_rate": 0.22,
  "race_going_encoded": 3,
  "race_distance_meters": 2400,
  "race_class": 4,
  "days_since_last_run": 21,
  "horse_age": 5,
  "horse_weight_kg": 72.5,
  "recent_avg_position": 3.8,
  "recent_runs_90d": 3,
  "out_of_top3_rate": 0.35,
  "position_volatility": 2.4,
  "beaten_favorite_rate": 0.08,
  "worst_recent_position": 8
}
```

---

### `prediction_enriched_horse_features`

Features calculadas para predição (corridas futuras). Mesma estrutura de features, sem target.

| Coluna                  | Tipo           | Nullable | Default     | Descrição                             |
| ----------------------- | -------------- | -------- | ----------- | ------------------------------------- |
| `id`                    | `bigserial`    | NOT NULL | auto        | PK                                    |
| `race_horse_id`         | `bigint`       | NOT NULL | —           | ID do cavalo na corrida               |
| `race_id`               | `bigint`       | NOT NULL | —           | ID da corrida                         |
| `horse_id`              | `bigint`       | NOT NULL | —           | ID do cavalo                          |
| `features`              | `jsonb`        | NOT NULL | —           | 59 features (mesmo formato do treino) |
| `predicted_probability` | `numeric(5,4)` | NULL     | —           | P(vencer) predita pelo modelo         |
| `lay_recommendation`    | `varchar(20)`  | NULL     | —           | STRONG_LAY / LAY / NEUTRAL / BACK     |
| `quality_score`         | `numeric(3,2)` | NULL     | —           | Score de qualidade                    |
| `race_date`             | `date`         | NOT NULL | —           | Data da corrida                       |
| `model_version`         | `varchar(50)`  | NULL     | —           | Versão do modelo                      |
| `prediction_status`     | `varchar(20)`  | NULL     | `'PENDING'` | PENDING / RESOLVED                    |
| `actual_position`       | `integer`      | NULL     | —           | Posição real (pós-corrida)            |
| `prediction_correct`    | `boolean`      | NULL     | —           | Se a predição foi correta             |
| `generated_at`          | `timestamptz`  | NULL     | `now()`     | —                                     |

**Constraints:**

- PK: `id`
- UNIQUE: `(race_horse_id, model_version)`

**Índices:**

- `idx_prediction_horse_id`
- `idx_prediction_race_date`
- `idx_prediction_race_id`
- `idx_prediction_status`

---

### `lay_betting_picks`

Pick principal selecionado para cada corrida (1 por corrida por model_version).

| Coluna                  | Tipo            | Nullable | Default     | Descrição                    |
| ----------------------- | --------------- | -------- | ----------- | ---------------------------- |
| `id`                    | `bigserial`     | NOT NULL | auto        | PK                           |
| `racecard_id`           | `bigint`        | NOT NULL | —           | FK → corrida                 |
| `race_id`               | `bigint`        | NOT NULL | —           | ID da corrida                |
| `race_horse_id`         | `bigint`        | NOT NULL | —           | ID do cavalo na corrida      |
| `horse_id`              | `bigint`        | NOT NULL | —           | ID do cavalo                 |
| `course`                | `varchar(100)`  | NOT NULL | —           | Hipódromo                    |
| `race_date`             | `date`          | NOT NULL | —           | Data                         |
| `off_time_br`           | `varchar(10)`   | NOT NULL | —           | Horário (BR)                 |
| `race_title`            | `varchar(255)`  | NULL     | —           | Título                       |
| `horse_name`            | `varchar(100)`  | NOT NULL | —           | Nome do cavalo               |
| `horse_number`          | `integer`       | NULL     | —           | Número                       |
| `predicted_probability` | `numeric(5,4)`  | NOT NULL | —           | P(vencer)                    |
| `market_odd`            | `numeric(8,2)`  | NULL     | —           | Odd de mercado               |
| `ivl_score`             | `numeric(8,4)`  | NULL     | —           | Índice de Valor de Lay       |
| `pick_type`             | `varchar(20)`   | NOT NULL | —           | VALUE / PROBABILITY / HYBRID |
| `lay_recommendation`    | `varchar(20)`   | NOT NULL | —           | STRONG_LAY / LAY / etc.      |
| `confidence_score`      | `numeric(3,2)`  | NULL     | —           | Confiança (0-1)              |
| `model_version`         | `varchar(50)`   | NOT NULL | —           | Versão                       |
| `bet_placed`            | `boolean`       | NULL     | `false`     | Se aposta foi colocada       |
| `bet_amount`            | `numeric(10,2)` | NULL     | —           | Valor apostado               |
| `bet_odd`               | `numeric(8,2)`  | NULL     | —           | Odd da aposta                |
| `result`                | `varchar(20)`   | NULL     | `'PENDING'` | WON / LOST / VOID / PENDING  |
| `profit_loss`           | `numeric(10,2)` | NULL     | —           | Lucro/prejuízo               |
| `actual_position`       | `integer`       | NULL     | —           | Posição real                 |
| `generated_at`          | `timestamptz`   | NULL     | `now()`     | —                            |

**Constraints:**

- PK: `id`
- UNIQUE: `(racecard_id, model_version)`
- CHECK: `pick_type IN ('VALUE', 'PROBABILITY', 'HYBRID')`

**Índices:**

- `idx_lay_picks_confidence` (DESC)
- `idx_lay_picks_pick_type`
- `idx_lay_picks_race_date`
- `idx_lay_picks_racecard`
- `idx_lay_picks_result`

---

### `lay_betting_top_picks`

Top 3 picks por corrida (3 linhas por corrida por model_version).

| Coluna                  | Tipo           | Nullable | Default | Descrição                    |
| ----------------------- | -------------- | -------- | ------- | ---------------------------- |
| `id`                    | `bigserial`    | NOT NULL | auto    | PK                           |
| `racecard_id`           | `bigint`       | NOT NULL | —       | FK → corrida                 |
| `race_id`               | `bigint`       | NOT NULL | —       | ID da corrida                |
| `race_horse_id`         | `bigint`       | NOT NULL | —       | ID do cavalo na corrida      |
| `horse_id`              | `bigint`       | NOT NULL | —       | ID do cavalo                 |
| `pick_rank`             | `integer`      | NOT NULL | —       | 1, 2 ou 3                    |
| `horse_name`            | `varchar(100)` | NOT NULL | —       | Nome                         |
| `horse_number`          | `integer`      | NULL     | —       | Número                       |
| `predicted_probability` | `numeric(5,4)` | NOT NULL | —       | P(vencer)                    |
| `market_odd`            | `numeric(8,2)` | NULL     | —       | Odd de mercado               |
| `ivl_score`             | `numeric(8,4)` | NULL     | —       | IVL                          |
| `combined_score`        | `numeric(8,4)` | NOT NULL | —       | Score combinado para ranking |
| `pick_type`             | `varchar(20)`  | NOT NULL | —       | VALUE / PROBABILITY / HYBRID |
| `lay_recommendation`    | `varchar(20)`  | NOT NULL | —       | Recomendação                 |
| `selection_reason`      | `text`         | NULL     | —       | Razão da seleção             |
| `score_diff_to_first`   | `numeric(8,4)` | NULL     | —       | Diferença para o pick 1      |
| `model_version`         | `varchar(50)`  | NOT NULL | —       | Versão                       |
| `generated_at`          | `timestamptz`  | NULL     | `now()` | —                            |

**Constraints:**

- PK: `id`
- UNIQUE: `(racecard_id, pick_rank, model_version)`
- CHECK: `pick_rank BETWEEN 1 AND 4`
- CHECK: `pick_type IN ('VALUE', 'PROBABILITY', 'HYBRID')`

**Índices:**

- `idx_top_picks_combined_score` (DESC)
- `idx_top_picks_race_horse`
- `idx_top_picks_racecard`
- `idx_top_picks_rank`

---

### `lay_betting_race_results`

Resultado operacional consolidado por corrida. **Fonte da verdade para ROI e Win Rate.**

| Coluna                   | Tipo          | Nullable | Default     | Descrição                        |
| ------------------------ | ------------- | -------- | ----------- | -------------------------------- |
| `id`                     | `serial`      | NOT NULL | auto        | PK                               |
| `racecard_id`            | `integer`     | NOT NULL | —           | FK → corrida                     |
| `race_date`              | `date`        | NULL     | —           | Data                             |
| `course`                 | `varchar`     | NULL     | —           | Hipódromo                        |
| `race_title`             | `varchar`     | NULL     | —           | Título                           |
| `model_version`          | `varchar`     | NULL     | —           | Versão                           |
| `race_result`            | `varchar`     | NULL     | `'PENDING'` | GREEN / RED / VOID / PENDING     |
| `winner_pick_rank`       | `integer`     | NULL     | —           | Rank do pick que venceu (se RED) |
| `winner_horse_name`      | `varchar`     | NULL     | —           | Nome do vencedor                 |
| `winner_position`        | `integer`     | NULL     | —           | Posição do vencedor              |
| `operational_pick_rank`  | `integer`     | NULL     | —           | Pick realmente usado (1, 2 ou 3) |
| `operational_horse_name` | `varchar`     | NULL     | —           | Cavalo do pick operacional       |
| `operational_odd`        | `numeric`     | NULL     | —           | Odd do pick operacional          |
| `operational_is_nr`      | `boolean`     | NULL     | `false`     | Se pick operacional é NR         |
| `stake`                  | `numeric`     | NULL     | `100`       | Stake base                       |
| `profit_loss`            | `numeric`     | NULL     | —           | P&L real                         |
| `pick1_horse`            | `varchar`     | NULL     | —           | Cavalo pick 1                    |
| `pick1_probability`      | `numeric`     | NULL     | —           | Prob pick 1                      |
| `pick1_position`         | `integer`     | NULL     | —           | Posição final pick 1             |
| `pick1_is_nr`            | `boolean`     | NULL     | `false`     | NR pick 1                        |
| `pick2_horse`            | `varchar`     | NULL     | —           | Cavalo pick 2                    |
| `pick2_probability`      | `numeric`     | NULL     | —           | Prob pick 2                      |
| `pick2_position`         | `integer`     | NULL     | —           | Posição final pick 2             |
| `pick2_is_nr`            | `boolean`     | NULL     | `false`     | NR pick 2                        |
| `pick3_horse`            | `varchar`     | NULL     | —           | Cavalo pick 3                    |
| `pick3_probability`      | `numeric`     | NULL     | —           | Prob pick 3                      |
| `pick3_position`         | `integer`     | NULL     | —           | Posição final pick 3             |
| `pick3_is_nr`            | `boolean`     | NULL     | `false`     | NR pick 3                        |
| `generated_at`           | `timestamptz` | NULL     | `now()`     | —                                |
| `resolved_at`            | `timestamptz` | NULL     | —           | Quando foi resolvido             |

**Constraints:**

- PK: `id`
- UNIQUE: `(racecard_id, model_version)`

**Índices:**

- `idx_race_results_date`
- `idx_race_results_result`

---

### `model_metrics_history`

Histórico de métricas de treino de cada versão do modelo.

| Coluna           | Tipo          | Nullable | Default     | Descrição             |
| ---------------- | ------------- | -------- | ----------- | --------------------- |
| `id`             | `bigserial`   | NOT NULL | auto        | PK                    |
| `version`        | `integer`     | NOT NULL | —           | Número da versão      |
| `timestamp`      | `timestamptz` | NOT NULL | —           | Momento do treino     |
| `train_accuracy` | `numeric`     | NULL     | —           | Accuracy no treino    |
| `val_accuracy`   | `numeric`     | NULL     | —           | Accuracy na validação |
| `train_loss`     | `numeric`     | NULL     | —           | Loss no treino        |
| `val_loss`       | `numeric`     | NULL     | —           | Loss na validação     |
| `samples_used`   | `integer`     | NULL     | —           | Amostras usadas       |
| `epochs`         | `integer`     | NULL     | —           | Épocas rodadas        |
| `model_type`     | `varchar`     | NULL     | `'unified'` | unified / flat / jump |
| `created_at`     | `timestamptz` | NULL     | `now()`     | —                     |

**Constraints:**

- PK: `id`

---

### `odds_enriched`

Já documentado acima na seção de tabelas detalhadas.

---

### `racing_api_raw`

Cache de respostas brutas da Racing API para auditoria e reprocessamento.

| Coluna          | Tipo          | Nullable | Default | Descrição                |
| --------------- | ------------- | -------- | ------- | ------------------------ |
| `id`            | `serial`      | NOT NULL | auto    | PK                       |
| `endpoint`      | `varchar`     | NOT NULL | —       | Endpoint chamado         |
| `race_date`     | `date`        | NOT NULL | —       | Data consultada          |
| `response_data` | `jsonb`       | NOT NULL | —       | Resposta completa da API |
| `races_count`   | `integer`     | NULL     | `0`     | Corridas no response     |
| `matched_count` | `integer`     | NULL     | `0`     | Corridas matched         |
| `fetched_at`    | `timestamptz` | NULL     | `now()` | —                        |

**Constraints:**

- PK: `id`
- UNIQUE: `(endpoint, race_date)`

**Índices:**

- `idx_racing_api_raw_date`

---

## Views

### `lay_picks_performance`

Agrega performance semanal dos picks resolvidos.

```sql
SELECT
  date_trunc('week', race_date) AS week,
  pick_type,
  count(*) AS total_picks,
  count(CASE WHEN result = 'WON' THEN 1 END) AS won,
  count(CASE WHEN result = 'LOST' THEN 1 END) AS lost,
  round(won / NULLIF(won + lost, 0) * 100, 2) AS win_rate,
  sum(profit_loss) AS total_profit,
  avg(confidence_score) AS avg_confidence,
  avg(ivl_score) AS avg_ivl
FROM hml.lay_betting_picks
WHERE result <> 'PENDING'
GROUP BY week, pick_type
ORDER BY week DESC, pick_type;
```

### `top_picks_analysis`

Cruza top_picks com o pick principal para verificar concordância.

```sql
SELECT
  t.racecard_id, t.pick_rank, t.horse_name,
  t.predicted_probability, t.ivl_score, t.combined_score,
  p.horse_name AS main_pick_horse,
  p.confidence_score AS main_pick_confidence,
  CASE WHEN t.pick_rank = 1 AND t.horse_name = p.horse_name
    THEN 'MATCH' ELSE 'DIFFERENT' END AS match_status
FROM hml.lay_betting_top_picks t
LEFT JOIN hml.lay_betting_picks p
  ON t.racecard_id = p.racecard_id AND t.model_version = p.model_version
ORDER BY t.racecard_id, t.pick_rank;
```

---

## Diagrama de Relações

```
horse_stats_enriched (id_horse)
  └── horse_results_enriched (stats_id → id)

racecards_hr_enriched (id)
  └── race_horses_hr_enriched (racecard_id → id)
        └── odds_enriched (race_horse_id → id)

training_enriched_horse_features (race_horse_id, race_id, horse_id)
prediction_enriched_horse_features (race_horse_id, race_id, horse_id)

lay_betting_picks (racecard_id)
lay_betting_top_picks (racecard_id)
lay_betting_race_results (racecard_id)
```

---

## Regras de Integridade

1. **`horse_results_enriched`** tem CASCADE delete via `stats_id` — deletar um cavalo remove todo seu histórico.
2. **`odds_enriched`** tem CASCADE delete via `race_horse_id` — deletar inscrição remove odds.
3. **`lay_betting_race_results`** é a fonte da verdade para ROI — `lay_betting_picks.result` pode estar desatualizado se non-runners afetaram o pick operacional.
4. **Features JSONB** devem sempre conter exatamente 59 keys numéricas. Valores null são imputados como 0 (exceto `sp_decimal` que invalida o registro).
5. **`quality_score`** threshold para treino: `>= 0.7` (4+ de 5 checks ok).
