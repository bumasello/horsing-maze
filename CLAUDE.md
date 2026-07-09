# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**HorsingMaze** is a horse racing prediction and lay-betting platform built in TypeScript/Node.js. The application:
- Scrapes and enriches horse racing data from multiple sources (HR, SPB, Racing API)
- Stores data in MongoDB and Supabase
- Generates features and trains machine learning models (TensorFlow.js) to predict race outcomes
- Generates "lay betting" picks (recommending which horses NOT to back)
- Operates via an Express API and scheduled cron jobs

**Primary Use Case**: Automated daily pipeline that fetches race cards, enriches data, trains models, generates predictions, and outputs betting recommendations.

## Build, Run, and Development Commands

### Setup
```bash
npm install              # Install dependencies
npm run build           # Compile TypeScript to dist/
```

### Development
```bash
npm run dev             # Run with nodemon (hot reload on src/ changes)
npm start               # Run production build (with logging to pipeline.log)
```

### Code Quality
```bash
npx biome check src/    # Lint and format check (using Biome v1.9.4)
npx biome format --write src/  # Auto-format code
```

### API Endpoints
The Express server runs on `PORT` (default 3000) with:
- `GET /health` → Health check (returns status, timestamp, uptime)
- `GET /cron-status` → Scheduled job status (returns next scheduled time)
- `GET /api/*` → API routes defined in `src/api/routes.ts`

### Testing

No test suite configured — `npm test` currently fails.

## Architecture & Data Flow

### High-Level Pipeline (4 Stages)

The core pipeline is in `src/pipeline/pipeline.ts` and is triggered either:
1. **Manually** via API: `GET /api/ml/training`, `GET /api/ml/predictions`, `GET /api/ml/lay-picks`
2. **Scheduled**: Node Cron at 00:00 (main pipeline) and 20:00 (Racing API enrichment) — **server LOCAL time** (mazeserver = America/Sao_Paulo, UTC-3; node-cron sem `timezone` usa hora local). Em UTC: 03:00 e 23:00.

**Stage 1: MongoDB Data Update** (`updateMongoDBData()`)
- Updates race cards, racecards from SPB, lay betting results
- Fetches fresh data from external APIs (Horse Racing, Speedboat, Racing API)
- Sources: `src/integrations/mongodb/*` (e.g., `getRaceCard_Hr.ts`, `getRaceDetail_Hr.ts`)

**Stage 2: MongoDB Data Processing** (`processMongoDBData()`)
- Retrieves unfinished race cards and fetches race details
- Fetches horse statistics via batch processing (10 requests/batch, 60s delays between batches)
- Handles API rate-limiting by rotating through 90+ API keys (`src/config/apiKeys.ts`)

**Stage 3: Supabase Data Transfer & Feature Generation** (`transferToSupabase()`)
- Transfers race cards, details, and horse stats from MongoDB → Supabase
- Removes ineligible race cards (insufficient runners, low data quality)
- Enriches race cards with Racing API data (trainer info, jockey stats, etc.)
- **Generates features** for upcoming races:
  - Training features: Historical 7-day window (`generateTrainingFeatures_v4`)
  - Prediction features: Upcoming races only (`generatePredictionFeatures_v4`)
  - Features include: static, competitive, historical, form, market, relationship features
  - Stored in Supabase tables and validated against quality thresholds

**Stage 4: Model Training & Predictions** (`trainAndPredict()`)
- Trains TensorFlow.js models (separate "flat" and "jump" race models)
- Uses **race-level softmax** (conditional logit) architecture:
  - Shared network generates scores for each horse
  - Softmax applied within race (relative probabilities)
  - Custom LAY loss: penalizes when winner is in lay betting picks
- Generates predictions on upcoming races
- Creates lay betting picks with value scoring (implied vs. market odds)

### Data Model Organization

```
src/
├── api/                           # Express routes & handlers
│   ├── routes.ts                  # Route definitions
│   └── handlers/                  # Handler functions (ml, data-sync, mongodb)
├── config/
│   └── apiKeys.ts                 # 90+ RapidAPI keys for rotation
├── integrations/
│   └── mongodb/                   # MongoDB queries (getHorseResults, getRaceDetail, etc.)
├── models/                        # Mongoose schemas
│   ├── modelHr/                   # Horse Racing (HR) models
│   ├── modelSpb/                  # Speedboat (SPB) models
│   ├── modelRapi/                 # Racing API models
│   └── modelTle/                  # TLE user models
├── pipeline/
│   └── pipeline.ts                # Core orchestration (4 stages)
├── services/                      # Business logic
│   ├── data-sync/                 # MongoDB ↔ Supabase sync
│   ├── features/                  # Feature generation pipeline
│   │   ├── converters/            # Data parsing (distance, form, SP odds)
│   │   ├── features/              # Feature extractors (static, form, historical, etc.)
│   │   ├── pipeline/              # Feature orchestrator (generates training/prediction sets)
│   │   └── types/                 # TypeScript interfaces
│   ├── ml/                        # TensorFlow.js models & training
│   │   ├── layers/                # Custom layers (attention)
│   │   ├── training_final.ts      # Model training (softmax, LAY loss, LR scheduling)
│   │   ├── claude-*.ts            # Prediction & pick generation
│   │   └── sonnet-claude-training.ts  # Claude API integration
│   └── racing-api/                # Racing API service (enrichment)
├── shared/
│   ├── config.ts                  # Pipeline config (batch sizes, retries, delays)
│   ├── logger.ts                  # Logging & metrics
│   ├── retry.ts                   # Retry logic with exponential backoff
│   ├── types/                     # Shared TypeScript types
│   └── utils/                     # Utilities (cleanNumericValue, processHorsePosition, etc.)
└── index.ts                       # Express app, Mongoose connection
```

### Data Flow Summary

```
External APIs (HR, SPB, Racing API)
    ↓
MongoDB (Raw Data)
    ↓ [Stage 1-2]
MongoDB (Processed + Enriched)
    ↓ [Stage 3]
Supabase (Race Cards, Details, Horse Stats)
    ↓ [Feature Generation]
Supabase (Features Table)
    ↓ [Stage 4]
TensorFlow.js Models (Training)
    ↓
Predictions + Lay Picks
    ↓
Supabase (lay_picks table)
```

### Key Patterns & Conventions

#### Batch Processing
- Configured in `src/shared/config.ts`: batch size, delay between batches, delay between requests
- Implemented in `pipeline.ts` `processBatch()` function
- Used for: fetching race details, horse stats (handles rate limits & memory)

#### Retry Strategy
- Centralized in `src/shared/retry.ts`
- `withRetry()`: Exponential backoff (configurable max retries, initial wait, backoff factor)
- `withSupabaseRetry()`: Handles 502/timeout errors with escalating delays
- Config in `CONFIG` object (`src/shared/config.ts`)

#### Logging & Metrics
- `logger` in `src/shared/logger.ts`: info, warn, error with ISO timestamps
- `metrics` object: `start()`, `end()`, `measure()` for performance tracking
- All pipeline stages logged; durations recorded

#### API Key Rotation
- 90+ RapidAPI keys stored in environment variables
- Rotated in batch processing loops to avoid rate limits
- Filter removes undefined keys: `apiKeys.filter((key): key is string => Boolean(key))`

#### Database Connections
- **Supabase** (`@supabase/supabase-js`): Uses Supabase client exported from `src/index.ts`
- **MongoDB** (`mongoose`): Connected in `src/index.ts` at startup
- Both are global singletons; passed to functions as needed

### Feature Generation Details

Located in `src/services/features/`, organized by concern:

**Feature Types** (in `src/services/features/features/`):
- `static.features.ts`: Age, weight, OR, trainer/jockey ID, course, distance
- `form.features.ts`: Form string parsing, recent wins/places, place% recent races
- `historical.features.ts`: Lifetime statistics (wins, places, strike rate, win%)
- `market.features.ts`: SP odds, bookmaker odds, odds variance
- `competitive.features.ts`: Field strength (avg OR), odds ranking, relative OR
- `relationship.features.ts`: Trainer/jockey/sire correlations with race type

**Converters** (in `src/services/features/converters/`):
- Parse distance (furlongs → meters)
- Parse form strings (first-past-the-post to numeric)
- Parse SP (Starting Price) odds to decimal
- Encode going/ground type
- Clean numeric values

**Pipeline** (in `src/services/features/pipeline/`):
- `feature-orchestrator.ts`: Main orchestrator
  - `generateTrainingFeatures_v4()`: Fetches historical races, validates quality, generates features
  - `generatePredictionFeatures_v4()`: Generates features for upcoming races only
  - Quality thresholds: min runners, min OR/SP coverage, min quality score
- `update_results.ts`: Updates race results & lay betting results after races finish
- `update_race_result.ts`: Syncs race outcomes

### Machine Learning Model Architecture

Located in `src/services/ml/`, uses TensorFlow.js (`@tensorflow/tfjs-node`):

**Model Architecture** (`training_final.ts`):
- **Type**: Race-level softmax (conditional logit model)
- **Input**: 3D tensor `[num_races, max_horses, n_features]` with padding
- **Network**: Shared dense layers → horse scores within race
- **Loss**: Categorical cross-entropy (winner = ground truth)
- **Custom LAY Loss**: Penalizes when predicted winner is in lay betting picks
- **Learning Rate Scheduling**: ReduceLROnPlateau (manual implementation)
- **Models**: Separate "flat" and "jump" models per race type
- **Max Horses**: 30 (covers most races; Grand National ~40 is exception)

**Prediction** (`claude-prediction-model.ts`):
- Loads trained models from Supabase bucket `modelos-tfjs-publicos`
- Generates P(win) for each horse
- Validates predictions (probability distribution within race)

**Pick Generation** (`claude-generate-picks.ts`):
- **Lay Betting Logic**: Recommend horses to LAY (bet AGAINST winning). Strategy = lay the 3 horses most likely to LOSE per race; cascade in production (try pick #1; if disqualified/scratch/odds out of range, fall back to #2, then #3).
- `claude-prediction-model.ts` stores `predicted_probability = 1 - P(win)` = P(lose). Pick generator ranks by descending `predicted_probability`.
- Top-3 ranking uses `combined_score = 0.4 * P(lose) + 0.4 * IVL_score + 0.2 * odd_range_score`, where:
  - `IVL = P_model(lose) - P_market(lose)` (positive = model thinks horse less likely to win than market does → value for lay)
  - `odd_range_score` peaks for odds in 6–15, tapers off outside, zero outside [MIN_ODD, MAX_ODD]
- Filters: odds in [MIN_ODD_THRESHOLD, MAX_ODD_THRESHOLD], gap rule between picks (`MIN_PROBABILITY_GAP`)
- Stores in Supabase `lay_picks` table with recommendation confidence

### ⚠️ Strategy / Training Objective Mismatch (KNOWN, ongoing investigation)

The model is **trained** to rank the WINNER (softmax + categorical CE + Top-K ListMLE, target=horse with finish_position=1). The **strategy** bets AGAINST the 3 horses with highest P(lose)=1−P(win) per race. These are different tasks reusing the same network:

- Top-1 accuracy measures favorite identification (top of distribution).
- LAY ROI depends on right-tail discrimination (which horses are ≥95.24% certain to lose).

**Empirical confirmation (2026-06-27):** SP-only baseline (1 feature = `sp_implied_prob`) achieves val_top1 = 30.23% Flat, matching/beating v53 (60 features, 29.6%) and v64 (74 features + pace, 29.78%). Implies ~30% is the Bayes error of top-1 with pre-race info AND that val_top1 is a misaligned proxy for the real task. See `~/.claude/.../memory/project_loss_objective_mismatch.md` and `project_debug_plan_val_top1.md` for full context.

**ROI evaluation (2026-07-01 to 2026-07-03) — MULTIPLE ITERATIONS:**

Ran `eval_roi_offline` extensively. Two key discoveries changed everything:

1. **Odds source fix (2026-07-01):** Old code used `getAverageOdd` (average of captured odds), which inflated results by including snapshots when odd was later >20 (unbettable). Switched to `sp_decimal` (real starting price). ROI dropped ~500pp initially.

2. **P/L calculation fix (2026-07-02, user-spotted):** Simulator was using **hardcoded odd=20 for loss calculation** (`-R$200 per loss`). In real Betfair LAY, loss = `-stake × (odd_real - 1)`, average ~R$130 per loss. Corrected via `USE_REAL_ODD_PNL=1` env var in `src/services/ml/eval/simulator.ts`.

**Impact of the P/L fix:** ROI jumped from +65% (hardcoded) to **+1175%** (real math) for Prod v66 on the same 180d window. **All previous "marginal agent" conclusions were artifacts of the hardcoded loss.**

**Final ranking (180d, MIN_ODD ≥ 13, sp_decimal, USE_REAL_ODD_PNL=1):**

| Model | Features | ROI | Bank 200→ | Max DD |
|---|---:|---:|---:|---:|
| Prod v66 | 60 | +1175% | 2550 | 720 |
| lean | 34 | +1435% | 3070 | 590 |
| **mt_b05** (multitask β=0.5) | 74 | **+1495%** 🏆 | **3190** | **570** |
| mt_b02 (multitask β=0.2) | 74 | +1200% | 2600 | 510 |
| mt_b10 (multitask β=1.0) | 74 | +1190% | 2580 | 660 |

**Recommended prod model: `mt_b05`** (multitask β=0.5, 74 features including pace). Path: `horse_probability_model/baselines/multitask_flat`.

**Recommended next steps (in order):**
1. Promote mt_b05 to prod (replace `claude-ml-model-flat`).
2. Fix `getAverageOdd` → `sp_decimal` in `claude-generate-picks.ts`.
3. Adjust constants: `MIN_ODD_THRESHOLD` 4→13, `MAX_ODD_THRESHOLD` 34→20.
4. Implement staging gate on cron retraining (see TODO below).
5. Download Betfair BSP CSVs and swap `sp_decimal` for `BSP` — final precision.

**Loss sequence analysis:** Max consecutive losses in 906 bets = 2. 77% of days positive. Max daily loss = R$280. No catastrophic streaks — earlier "high volatility" concern was artifact of hardcoded math.

**LAY betting math (user-defined strategy):**
- Bankroll starts at 200, stake fixed at 10 per race, assumed odd = 20 (constant; real odds too volatile).
- Outcome per bet: +10 if horse loses, −200 if horse wins.
- Break-even win rate: 200/210 = **95.24%** SEM comissão. Com comissão Betfair BR de 6,5% sobre ganhos (pesquisa 2026-07-04, `docs/pesquisa_mercado_lay_2026-07-04.md`): 190/199.35 = **95.31%** na odd 20. O simulador aplica a comissão por default (`COMMISSION_RATE`, `src/services/ml/eval/simulator.ts`).
- Cascade: try pick #1 first; if `runner_status='non_runner'` OR odd > 20, fall back to #2, then #3; skip race if none eligible.

**Implication for future work:** Do NOT chase val_top1 improvements. Before changing the loss to ROI-first, run `eval_roi_offline` (Phase 6 of debug plan) to measure actual ROI of v53/v64/SP-only with current pick generator. If positive, the model is already serving the real task; stop tuning. If negative, pivot to ROI-first loss (raise `layLossAlpha`, or change target/output topology — see `project_loss_objective_mismatch.md` Options A/B/C).

**✅ Staging gate for cron retraining — IMPLEMENTADO 2026-07-04** (`src/services/ml/staging-gate.ts`). Com `ENABLE_CRON_RETRAIN=1`, o cron roda `trainAllModelsWithGate()`: (1) treina candidato em `baselines/candidate_{flat,jump}` (prod intocado); (2) avalia candidato vs prod nos últimos `GATE_PERIOD_DAYS` (90) com regras de pick 1:1 com prod (funções importadas de `claude-generate-picks.ts`, sp_decimal, P/L com odd real); (3) promove com backup (`baselines/prod_backup_YYYYMMDD_{type}`) se `edge_cand ≥ edge_prod − GATE_EDGE_TOLERANCE_PP` (0.2pp) e apostas ≥ `GATE_MIN_BETS` (30); senão mantém prod e loga rejeição. Decisões salvas em `horse_probability_model/staging_gate_logs/` no bucket. Execução manual: `src/oneTimeScript/run_staging_gate.ts` (suporta `GATE_DRY_RUN=1`, `GATE_SKIP_TRAINING=1`, `GATE_CANDIDATE_LABEL=x` pra testes). ⚠️ Caveat: a janela de eval é in-sample pro candidato — o gate protege contra REGRESSÃO, não é estimativa não-enviesada de ROI. Prevents accidental degradation like v65 (edge +0.06pp) → v66 (edge -0.53pp) observed 2026-07-02.

**TODO (high priority): Betfair SP CSV → BSP real na simulação.** Hoje o eval usa `sp_decimal` de `race_horses_hr_enriched` (SP oficial das casas tradicionais). Isso é aproximação — não é a odd Betfair Exchange. Substituir por **BSP** (Betfair Starting Price) dos CSVs históricos gratuitos (sem auth, disponível desde 2008; ver `reference_data_providers.md`). Pipeline: baixar CSVs → populate `hml.betfair_sp_history` → simulator lê BSP em vez de sp_decimal. Reflete odd EXATA que se apostaria em produção. Provavelmente vai reduzir levemente o ROI simulado (BSP tende a ser maior que SP em outsiders) mas é o número mais próximo do real.

### Environment Variables Required

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=<supabase_url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase_anon_key>

# MongoDB
MONGOOSE=<mongodb_connection_string>

# Racing API
XRAPIDAPIHOST=<host>
XRAPIDAPIKEY1 through XRAPIDAPIKEY90=<api_keys>

# Server
PORT=3000 (default)

# Pipeline / ML behavior (added 2026-07-04)
ENABLE_CRON_RETRAIN=1   # opt-in: cron diário retreina VIA STAGING GATE (candidato → eval ROI
                        # 90d vs prod → promove só se não regredir; ver staging-gate.ts).
                        # Default (unset) = cron só gera predições/picks com o modelo em prod.
GATE_PERIOD_DAYS=90         # janela de eval do gate
GATE_EDGE_TOLERANCE_PP=0.2  # candidato pode ser até X pp pior e ainda promover
GATE_MIN_BETS=30            # amostra mínima de apostas simuladas pra promover
COMMISSION_RATE=0.065       # comissão Betfair BR sobre ganhos no simulador/gate
                            # (default 6.5%; =0 desativa pra comparar com evals antigos)
ENABLE_INTRADAY_ODDS=1      # opt-in (2026-07-08): captura intraday de odds às 06:00 e
                            # 09:00 local — resposta ao drift de 35% geração→SP.
                            # EM TESTE EM DEV — não ativar em prod sem alguns dias de teste.
MULTITASK_MODE=0        # opt-out: desativa cabeça multi-task (single-head legado).
                        # Default (unset) = multi-task ATIVO (arquitetura do mt_b05/v68-flat).
                        # ATENÇÃO: multi-task NÃO desvia mais o save pra baselines/ —
                        # treino sem EXPERIMENT_LABEL/BASELINE_MODE salva no PATH DE PROD.
```

## Common Development Tasks

### Adding a New Feature to the Pipeline
1. Create extraction function in `src/services/features/features/<feature_type>.ts`
2. Export from `src/services/features/features/index.ts`
3. Add to feature orchestrator `src/services/features/pipeline/feature-orchestrator.ts`
4. Include in model configuration (`ModelConfig.features` array)
5. Retrain models to use new feature

### Modifying Model Architecture
- Core model in `src/services/ml/training_final.ts`
- Update input/output shapes, loss functions, or layer configuration
- Custom layers in `src/services/ml/layers/` (e.g., attention.ts)
- Increment model version in config to avoid loading incompatible weights

### Debugging Pipeline Failures
- Check `pipeline.log` (created by `npm start`)
- Metrics logged with duration: timing bottlenecks visible in logs
- Enable detailed logging by modifying `logger.ts` for specific stages
- Batch processing logs indicate which race/horse caused failure
- Retry logic logs all attempts + final error if exhausted

### Adding New API Endpoints
1. Create handler in `src/api/handlers/<feature>.handler.ts`
2. Export handler function
3. Add route in `src/api/routes.ts` with HTTP method + path
4. Handler receives `(req: Request, res: Response, next: NextFunction)`
5. Error handling via `next(error)` → centralized error handler in `src/index.ts`

## TypeScript & Configuration

- **Target**: ES2016 (CommonJS modules)
- **Strict Mode**: Enabled
- **Output**: `dist/` folder
- **Root Dirs**: `src/`
- **Linter**: Biome (`.biomejs/biome` v1.9.4)
  - Check: `npx biome check src/`
  - Format: `npx biome format --write src/`

## Important Gotchas & Design Decisions

1. **Portuguese Comments**: Most code comments are in Portuguese (PT-BR); maintain consistency
2. **Memory Management**: `npm start` uses `--expose-gc --max-old-space-size=4096` to manage large feature arrays
3. **Batch Processing Delays**: Intentional 60s delays between batches to prevent API rate limits and memory overload
4. **Model Storage**: Models serialized to Supabase public bucket; large files (~20MB+)
5. **Softmax Architecture**: Within-race softmax ensures P(win) sums to 1 across horses in same race; do NOT interpret as global probability
6. **Lay Betting Semantics**: Picks are horses to LAY (not back); model trained on winner but picks output non-winners
7. **Feature Quality**: Races/horses filtered if <50% OR coverage or <70% SP coverage; prevents low-confidence predictions
8. **Timezone**: Pipeline scheduled in UTC; convert to local time if needed (see `getNextScheduledTime()` in `index.ts`)

