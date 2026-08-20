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

```bash
npm test                # vitest run (37 testes, 5 arquivos — verificado 2026-08-19)
```

Cobertura concentrada no que já quebrou de verdade: `eval/simulator.test.ts`
(odd média enviesada, P/L hardcoded, comissão), `eval/report.test.ts`,
`eval/bootstrap.test.ts` (IC95 que cruza zero vs IC95 que exclui zero — o
critério do staging gate) e `calibration.test.ts`.

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

### 🛑 RESULTADO DECISIVO (2026-08-18) — as features não superam o preço de mercado

Teste de encompassing (`src/oneTimeScript/benter_alpha_probe.ts`): logit condicional por corrida combinando o score do fundamental `baselines/no_market_flat` (67 features, SEM mercado) com a prob implícita do SP. Flat, fit em [581,360) (2.999 corridas), held-out em [360,180) (2.243).

| modelo | alpha | beta | CE fit | CE held-out |
|---|---:|---:|---:|---:|
| M0 só mercado | — | 1,0987 | 1,8444 | 1,8922 |
| M1 só modelo | 1,4478 | — | 1,9475 | 2,0104 |
| M2 ambos | **0,1509** | 1,0204 | 1,8435 | **1,8922** |

- **O modelo sozinho é pior que só ler o preço.** Contra o uniforme (~ln 10 = 2,303 nats), o preço ganha 0,46 nats e o modelo só 0,29.
- **Somar o modelo ao preço rende 0,00094 nats/corrida in-sample e −0,00002 fora da amostra.** Nada, e levemente negativo.
- LR test dá p=0,0175 in-sample — **ignorar**: ganho out-of-sample zero. Efeito de memorização.
- **α cai de 1,4478 para 0,1509** ao competir com o preço: ~90% do que o modelo "sabia" era reconstrução do próprio preço. Confirma o SP-only baseline empatar com 60-74 features.
- **β ≈ 1,10 > 1**: afiar as probabilidades do mercado melhora o ajuste (favorito pra cima, azarão pra baixo) — é o **viés favorito-azarão**. Essa é a explicação dos +0,35pp em [13,20]: **nunca foi mérito do modelo**, é viés de mercado capturável sem ML, exatamente na faixa onde a economia exige ~18% de ROI.

**Consequência:** loss e arquitetura redistribuem capacidade, não criam informação. Isso explica de uma vez por que a cabeça `lose_output` (BCE no alvo invertido, β=0.5), o `layLossAlpha=0.3`, o blend Benter e o baseline `no_market` deram todos em nada — todos atacam *como* usar a informação, quando o problema é que não há informação além do preço.

**NÃO propor nova loss, arquitetura ou feature engineering sobre o mesmo conjunto de features.** O caminho seria informação nova que o mercado não precifica bem.

**✅ LACUNA FECHADA (2026-08-19) — Jump dá o mesmo resultado.** O baseline `baselines/no_market_jump` já existia no bucket (a nota anterior de que "não existe" estava errada), e `benter_alpha_probe.ts` já aceita `GROUP=Jump`. Rodado com fit em [581,360) (1.297 corridas) e held-out em [360,180) (1.446):

| modelo | alpha | beta | CE fit | CE held-out |
|---|---:|---:|---:|---:|
| M0 só mercado | — | 1,1336 | 1,7738 | **1,6946** |
| M1 só modelo | 1,4473 | — | 1,8415 | 1,8122 |
| M2 ambos | **0,4063** | 0,8914 | 1,7656 | 1,6951 |

- **Ganho fora da amostra: −0,00046 nats/corrida, IC95 [−0,0073, +0,0062]** — cruza zero e o ponto é negativo. Somar o modelo ao preço **piora** o held-out (1,6951 vs 1,6946).
- LR test in-sample dá p=4,47e−6 — **ignorar**, mesma assinatura de memorização do Flat: significativo dentro da amostra, nulo fora.
- **α cai de 1,4473 para 0,4063** (~72% do que o modelo "sabia" era reconstrução do preço; no Flat foram ~90%). Jump retém um pouco mais de sinal independente que o Flat, mas ainda assim **nada que sobreviva fora da amostra**.
- ⚠️ As janelas são **in-sample pro fundamental** (o próprio script avisa), o que **infla** a contribuição do modelo. Ele não acrescenta nada nem com essa vantagem — o negativo é conclusivo, mesma lógica do pré-registro #2.

**Consequência: a conclusão vale pros dois grupos.** Não há mais frente aberta de "talvez o Jump seja diferente". O edge residual de 15,9% do Jump sem look-ahead não vem de informação que o modelo tenha além do preço.

### 📐 Calibração da cauda (2026-08-19) — o erro NÃO é excesso de confiança no Flat

`src/oneTimeScript/calibration_plot.ts`. Bins por P(perder) do modelo, banda [13,20], janela [180,0). Não precisa de BSP.

**Flat (v68, TEM curva isotônica):** o modelo é **sub-confiante**, não otimista. Em todo bin a taxa real de derrota é MAIOR que a prevista (+2,4 a +3,9pp): diz 91,25% e a realidade é 95,17%. O erro corre na direção segura pro LAY.

**Jump (v65, 60 features, SEM curva de calibração):** o bin mais confiante (0,96–0,98) prevê 96,62% e entrega **93,06% — erro de −3,56pp, na direção cara**, abaixo do break-even de 94,56%. ⚠️ **n=144, ~1,7 erros-padrão, e é 1 de 8 bins olhados** — é sugestivo, NÃO estabelecido. Não tratar como achado sem janela cega.

**O resultado durável é o Brier:** o **mercado estima P(perder) melhor que o modelo nos dois grupos** (Flat 0,040252 vs 0,041382; Jump 0,051826 vs 0,052137). Consistente com o encompassing test.

⚠️ Os ✅ de break-even na tabela usam `market_odd` (sp_decimal), não BSP. Como o BSP tende a ser mais longo em azarões, o break-even real é mais alto e essas margens encolhem. Não ler a tabela como prova de lucratividade.

**Implicação prática:** recalibrar é transformação monótona — não cria informação (o encompassing já disse que não há). Mas o `IVL = P_model(lose) − P_market(lose)` usa probabilidade ABSOLUTA, então a sub-confiança do Flat enviesa o IVL sistematicamente pra baixo e muda a seleção. É uma mudança testável e barata — e por isso mesmo **exige pré-registro e janela cega**, é exatamente o formato de "melhoria" que já reverteu quatro vezes.

### 🟢 PRIMEIRO SINAL POSITIVO (2026-08-19) — o modelo prevê a DIREÇÃO do movimento do preço

`src/oneTimeScript/analyze_directional_drift.ts`. Hipótese: a divergência entre P(win) do modelo e a prob implícita na odd da manhã prediz pra que lado o mercado vai se mover até a largada.

⚠️ **O critério ">55% de acerto direcional" não serve** — a odd da manhã sozinha, sem modelo nenhum, já acerta 57,55% (`drift_predictability.ts`), porque o drift é monótono no nível de odd. Um sinal a 55% é PIOR que não ter sinal. O teste correto é sobre o **resíduo**: estima-se o drift médio por decil de odd numa janela FIT e testa-se se a divergência prediz o que sobra numa janela HELD disjunta.

Flat, janela [288,38) dias, BSP casado 96,7%, split em 2026-03-07 (HELD é posterior ao corte de treino de 2025-12-22):

| modelo | acerto direcional no resíduo | spread Q5−Q1 | IC95 |
|---|---:|---:|---|
| prod v68 (74 features, **com** `sp_decimal`) | 64,28% | 0,5516 | [0,5295, 0,5731] |
| `no_market_flat` (67 features, **sem** mercado) | **57,38%** | **0,2061** | [0,1801, 0,2313] |

- **~63% do efeito era vazamento.** O modelo de prod usa `sp_decimal`/`sp_implied_prob`/`sp_rank` como FEATURES, isto é, viu o preço de fechamento. Prever manhã→fechamento com ele é circular. Sempre usar o baseline sem mercado nesta pergunta.
- **O que sobra é real e monotônico nos quintis:** quintil 1 (modelo acha o cavalo pior) → resíduo −0,0488; quintil 5 (acha melhor) → +0,1573. IC95 exclui zero com folga.

**Por que isso NÃO contradiz o encompassing test:** são perguntas diferentes. O encompassing diz que o modelo não sabe **quem vence** além do preço. Este diz que ele sabe **pra onde o preço vai andar**. São compatíveis — e é uma tese de *trading*, não de aposta: fecha-se a posição no movimento, sem levar ao desfecho.

**O que falta antes de qualquer decisão:**
1. **Magnitude vs custo.** 0,2061 em log-odds é direção, não lucro. Falta traduzir em movimento de odd e confrontar com spread bid-ask + comissão de 6,5%.
2. **Liquidez.** O volume negociado na manhã tem mediana de £357 (`drift_predictability.ts`) — fino. Sinal sem liquidez não é executável.
3. **Pré-registro.** É hipótese nova, testada uma vez, sem parâmetro varrido — mas a regra do projeto exige janela cega antes de agir.

### 💱 Economia do drift (2026-08-19) — o custo de execução decide, e não temos como medi-lo

`src/oneTimeScript/drift_economics.ts`. Antes de gastar janela cega no pré-registro #3, a pergunta "o sinal cobre o custo?" foi respondida na janela já queimada — legítimo porque não há parâmetro a escolher, é aritmética de custo sobre sinal já medido.

**Fórmula correta de fechar um LAY:** lay em `O_ent` com stake `S`, back em `O_sai` com stake `S × O_ent/O_sai` → lucro travado `P = S × (O_sai − O_ent) / O_sai`. **LAY lucra quando a odd ALONGA.** (Duas armadilhas: sem o divisor, o lucro é superestimado em ~16× na odd 16; e o sinal é o inverso da intuição de "apostar contra".)

**Ticks da Betfair são variáveis e caros em odd alta:** odd 4 → 2,50% do preço; odd 10 → 5,00%; odd 16 → 3,13%; odd 20 → 5,00%.

⚠️ **A primeira medição estava confundida.** O bruto é positivo em TODOS os quintis (+1,85% a +6,77%) porque o livro da manhã tem overround maior e as odds alongam em bloco até o BSP — componente comum, não-negociável. Além disso o quintil de divergência correlaciona com nível de odd (Q5 entra a 5,85, Q1 a 14,05). Corrigido com baseline por decil de odd (Flat, filtro [4,20], 12.402 cavalos):

| quintil | excesso | líq. otimista | líq. base | líq. pessimista |
|---|---:|---:|---:|---:|
| Q1 | −3,34% | −6,55% | −10,21% | −17,09% |
| Q4 | +0,66% | −2,17% | −5,09% | −10,84% |
| **Q5 (tese de LAY)** | **+5,39%** | **+2,82%** | **+0,51%** | **−4,31%** |

Modelos de execução: *otimista* = 1 tick na entrada e saída grátis (ordem "at BSP" casa no BSP por construção, sem cruzar spread — é o mais realista pro desenho manhã→BSP); *base* = 1 tick por ponta; *pessimista* = 2 ticks por ponta.

**A conclusão é o espalhamento, não o ponto:** de −4,31% a +2,82% conforme a hipótese de execução. **A faixa (7,1pp) é maior que o próprio sinal (5,39pp).** A estratégia é decidida por execução, não por previsão.

**E não dá pra resolver com estes dados.** Os CSVs da Betfair **não têm bid-ask**. `ppmax`/`ppmin` são máximo e mínimo NEGOCIADOS ao longo de horas — amplitude mediana de **56,7%** —, não spread instantâneo; usá-los como proxy mataria qualquer estratégia por construção. As colunas são idênticas desde 2024-01 (só mudou a caixa do cabeçalho), então nenhuma janela ajuda: é limitação da fonte, não de cobertura.

**Pré-requisito do pré-registro #3:** medir o spread real com dados de mercado ao vivo (Betfair Exchange API, exige conta + app key). Sem isso, qualquer backtest de trading escolhe implicitamente o próprio veredicto ao escolher o custo.

Outros dados de contexto: volume negociado na manhã (odd 4–20) mediana £787 (p10 £227, p90 £2.799); pré-live total mediana £17.349. Stake de R$10 cabe; o gargalo não é tamanho.

### 🌊 Drift de odd (2026-08-19) — direção sim, magnitude não

`src/oneTimeScript/drift_predictability.ts`, 31.723 corridas dos CSVs, split 2025-10-01. Só preço, sem modelo nem banco.

- Drift normalizado (soma zero na corrida, é o que dá pra negociar) é **monótono no decil de odd**: favorito encurta, azarão alonga (decil 1 −0,017 → decil 10 −0,333). É o viés favorito-azarão de novo.
- **R² fora da amostra: −0,73%** — a odd da manhã prevê o drift PIOR que usar a média. Acerto direcional 57,55%, mas sem magnitude não dá pra dimensionar aposta.
- A banda [13,20] cai nos decis 6–7, drift ≈ −0,11 a −0,14: os cavalos que selecionamos de manhã **alongam** sistematicamente até a largada, ou seja, a responsabilidade real no BSP é maior que a da seleção. É a origem dos 57,7% de picks que saem da banda.

### 🛡️ Hipótese do "Guarda-Costas" — REFUTADA (2026-08-19)

Ideia testada (`src/oneTimeScript/winner_avoidance.ts`): usar o `win_head` como veto — banir do lay qualquer cavalo com P(win) do modelo acima de um limiar, pra manter o vencedor fora da lista de 3. Métrica proposta era "taxa de sobrevivência".

**Esta sonda não precisa de BSP** — compara ranking contra desfecho, não simula aposta. Roda mesmo com os CSVs bloqueados.

⚠️ **A comparação só vale restrita à banda negociável.** Sem restringir, "3 maiores odds" do mercado pega azarão de odd 40-80 (que quase nunca vence) enquanto o `combined_score` puxa pra [13,20] via `odd_range_score`: o mercado ganha por nível de odd, não por skill. Irrestrito o modelo aparece 2× pior (15,44% vs 7,58%) — **número confundido, não usar.** Com os dois lados restritos a [13,20]:

| grupo | corridas | vencedor na lista do MODELO | do MERCADO | diferença | IC95 |
|---|---:|---:|---:|---:|---|
| Flat | 333 | 42 (12,61%) | 42 (12,61%) | **+0,00pp** | [−1,80, +1,80] |
| Jump | 194 | 31 (15,98%) | 34 (17,53%) | −1,55pp | [−4,12, +0,52] |

**Empate exato no Flat.** Dentro do universo onde se aposta, o modelo não evita o vencedor melhor que o preço.

**O veto não faz nada.** Em [13,20] o modelo concorda com o mercado que são azarões: a P(win) que ele atribui a esses cavalos já está quase sempre abaixo de 0,15. Nos limiares 0,10–0,30 o veto evita **0 reds e custa 0 corridas** — não morde. O único limiar que morde é 0,05, que evita 100% dos reds destruindo 97% das corridas, ou seja, é "não apostar".

**Por que a métrica proposta não serve:** "taxa de sobrevivência" é o complemento da win rate que o eval já reporta, e sozinha é maximizada trivialmente apostando menos. Sem prender o volume de apostas, ela não decide nada.

### 🎯 Meta do projeto (definida 2026-08-12) — SOBREVIVÊNCIA, não ROI

O objetivo **não** é maximizar ROI: é fazer uma banca de **R$200 durar novembro/2026 inteiro, terminando positiva, sem quebrar**. Toda proposta se avalia por *probabilidade de ruína*, max drawdown e tamanho de aposta vs banca — não por ROI/edge médio.

### ❌ ROIs de três dígitos (julho/2026) — REFUTADOS, não usar

O bloco de avaliação de julho reportava ROI de **+1175% a +1495%** (mt_b05 🏆, lean, Prod v66) numa janela de 180d com `sp_decimal`. **Esses números estavam inflados por look-ahead** e foram substituídos pela medição de 2026-08-12. Não são base pra nenhuma decisão. O que sobrou de válido daquele ciclo:

- **Odds source fix (2026-07-01):** `getAverageOdd` (média de snapshots capturados) inflava resultados por incluir momentos em que a odd depois passava de 20. Trocado por `sp_decimal`.
- **P/L fix (2026-07-02):** o simulador usava **odd 20 hardcoded na derrota**. LAY real perde `stake × (odd_real − 1)`. Corrigido via `USE_REAL_ODD_PNL=1` (`src/services/ml/eval/simulator.ts`).
- **`mt_b05` continua sendo o modelo de prod** (multitask β=0.5, 74 features com pace, `horse_probability_model/baselines/multitask_flat`), mas a escolha dele foi feita com a métrica inflada — nunca foi revalidada honestamente.

### ✅ Medição honesta com BSP real (2026-08-12) — a referência atual

Feita com **BSP real da Betfair** (CSVs históricos, join 97,6%) e **sem look-ahead**: seleção pela odd da manhã (quando o pick é gerado), liquidação no BSP.

| modo | ROI/aposta | apostas | WR | break-even | margem |
|---|---:|---:|---:|---:|---:|
| **honesto** (seleção pela odd da manhã → BSP) | **+8,8%** | 1039 | 94,61% | 94,26% | **+0,35pp** |
| antigo sp/sp (base dos ROIs de julho) | +33,3% | — | — | — | — |

**Cluster bootstrap por corrida (B=2000): P/L +918, IC95 [−1418, +3064] — cruza zero.** Flat e Jump separados também cruzam. **O edge do projeto não se distingue de zero.** A diferença entre os dois modos é puro look-ahead: o modo antigo selecionava usando o SP, conhecido só depois da corrida.

Outros achados do mesmo dia:
- Flat perde quase todo o edge sem look-ahead (42,5% → 6,7%); Jump segura (17,6% → 15,9%). O esforço histórico foi quase todo em Flat.
- **Só 25,8% dos picks são apostáveis.** Dos que caem fora da banda [13,20], **57,7% é drift** de odd entre geração (00:00) e largada (razão SP/odd de geração: p10 0,40, mediana 1,12, p90 2,27); só 13,2% é o bug do fallback sem filtro de odd em `selectMainPick`.

### 💀 Risco de ruína — a banda [13,20] é incompatível com R$200

- **Mínimo da Betfair em BRL é R$5 de STAKE** (não de liability; [fonte oficial](https://forum.developer.betfair.com/forum/developer-program/announcements/35967-betfair-exchange-change-of-minimum-stake-multiple-currencies-28th-march-2022), 28/03/2022).
- Na banda [13,20], stake mínimo de R$5 gera **responsabilidade ~R$77 = 38% de uma banca de 200 por aposta**.

Simulação de mês (`sim_month_ruin.ts`):

| política | P(ruína/mês) | P(positivo) | banca final (mediana) | executável? |
|---|---:|---:|---:|---|
| stake fixo 10 (atual) | **75,3%** | 24,4% | 92 | sim |
| stake fixo 5 | 44,3% | 51,9% | 234 | sim (mínimo) |
| stake fixo 2 | 6,2% | 67,9% | 250 | **não** (< R$5) |
| liability 10% da banca | 0,0% | 56,1% | 212 | **não** |
| liability 5% da banca | 0,0% | 61,0% | 211 | **não** |
| liability 2% da banca | 0,0% | 62,3% | 205 | **não** |

**Staking proporcional zeraria a ruína, mas exige stake de R$0,26–0,65 — abaixo do mínimo.** O melhor caso executável é 44,3% de ruína. E mesmo com ruína zero o teto de P(positivo) é ~62%, porque o edge continua não-significativo: **staking resolve sobrevivência, não cria vantagem.**

### 🎲 O rollout 150→490 foi SORTE (2026-08-19) — e a "regra dos 80%" não salva

`src/oneTimeScript/simulate_conservative_entry.ts`. Banca 150, stake 10, seleção pela odd da manhã, liquidação no BSP real, 3.832 corridas (Flat+Jump), janela [288,38).

⚠️ Uma trajetória histórica não distingue sorte de estratégia — é amostra de 1. O script reamostra corridas (cluster bootstrap, B=2000) e reporta a distribuição.

| cenário | mediana final | IC95 | P(ruína) | P(final>490) | **P(PICO>490)** |
|---|---:|---|---:|---:|---:|
| A) atual, cascata [13,20] | 0 | [0, 0] | 99,8% | 0,1% | **29,5%** |
| B) regra 80%, sem filtro | 150 | [150, 150] | 0,0% | 0,0% | 0,0% |
| C) regra 80% + odd [8,16] | 34 | [0, 87] | 35,9% | 2,1% | **26,1%** |

**A resposta:** ~28% das trajetórias PASSAM por 490 em algum momento, mas só ~1-2% TERMINAM lá. O rollout 150→490 não foi improvável — foi o desfecho modal intermediário de um sistema de edge zero com win rate alta: sobe devagar em muitas vitórias pequenas e devolve tudo em poucos reds. **Ter passado por 490 não é evidência de estratégia.**

Outros achados:
- **A é incompatível com banca 150.** A primeira aposta perdida zera a banca (responsabilidade 120–190 em [13,20] contra banca de 150). P(ruína) 99,8%.
- **B é degenerada: 0 apostas em 3.832 corridas.** Com banca 150, 80% = 120, e a responsabilidade em odd ≥13 já é ≥120. **A regra dos 80% e a banda de produção são mutuamente incompatíveis nessa banca** — a regra não gere risco, ela simplesmente proíbe tudo.
- **C não elimina a ruína** (35,9%), que era o critério de aceite. Reduz drawdown e permite 423 apostas, mas a mediana termina em 34 — perde dinheiro mais devagar.
- A regra dos 80% **não é controle de risco**: ela autoriza arriscar até 80% da banca numa aposta. Só barra o que passa disso.

### 🚫 Bandas de odd — nenhuma tem edge demonstrável

Sweep de 14 bandas (`sweep_band_ruin.ts`): **todas com IC95 cruzando zero.** Bandas vizinhas e sobrepostas dão sinal oposto ([1.5,3] +3,70pp vs [2,3] −2,12pp vs [1.8,3.5] −1,21pp) — assinatura de seleção de ruído, não de edge real.

A banda [1.5,3] parecia a saída (responsabilidade baixa + ROI +10%) e **morreu out-of-sample** (`oos_band_low.ts`):

| janela | apostas | WR | break-even | margem | ROI |
|---|---:|---:|---:|---:|---:|
| in-sample [180,0) | 318 | 60,69% | 56,99% | +3,70pp | +10,0% |
| **out-of-sample [360,180)** | 888 | 55,74% | 57,32% | **−1,58pp** | **−0,2%** |

Com 2,8× mais amostra o edge sumiu e inverteu o sinal. **Ambas as janelas [180,0) e [360,180) estão queimadas pra seleção de banda** — qualquer validação futura precisa de janela nunca tocada.

**Confirmado por pré-registro em 2026-08-18** (`docs/pre_registro_banda_media_2026-08-18.md`, rodado por `src/oneTimeScript/test_banda_media.ts`). Duas células de banda média, janela [581,360) — a última nunca tocada — com IC de 97,5% (Bonferroni, 2 hipóteses):

| célula | apostas | WR | break-even | margem | ROI | IC97,5% | veredicto |
|---|---:|---:|---:|---:|---:|---|---|
| LAY [3,5] | 1.917 | 72,77% | 76,07% | **−3,30pp** | −10,56% | [−19,37%, −1,60%] | ❌ **morta** |
| LAY [4,7] | 2.766 | 82,00% | 82,68% | −0,68pp | −1,82% | [−11,19%, +7,29%] | ⚠️ sem edge demonstrável |

- **[3,5] é perda significativa** (IC inteiro < 0), e a janela era **in-sample pro modelo** (anterior ao split de treino 2025-12-22 Flat / 2026-01-29 Jump) — perder com vantagem de treino é conclusivo.
- **[4,7] descarta o edge exigido**: o limite SUPERIOR do IC (+7,29%) fica abaixo dos ~8% que o mapa de viabilidade (`feasibility_map.ts`) exige pra P(sobreviver e terminar positivo) ≥ 80%.

**Síntese por faixa de odd: [3,5] −3,30pp · [4,7] −0,68pp · [13,20] +0,35pp.** O pouco de sinal existente mora em **odd alta**, exatamente onde a economia é hostil ([13,20] exige ~18% de ROI mesmo com banca 2000). Onde a economia é favorável (~8,5%), o modelo é neutro ou negativo. **O sinal mora onde não dá pra lucrar com ele.**

**🚫 Cláusula anti-viés acionada: NÃO testar mais bandas.** A última janela limpa do histórico foi gasta aqui. Bandas queimadas agora: [180,0), [360,180) e [581,360).

**⚠️ Regra de trabalho (ver memória `feedback-metodo-testar-pesquisar-validar`):** este projeto já reverteu conclusão por medição melhor **quatro vezes** (ROI inflado por odd hardcoded; ROI inflado por look-ahead do SP; `heads_avg` significativo offline e negativo ao vivo; sweep de banda desmentido pelo out-of-sample). Nunca aceitar melhora que não sobreviva a bootstrap pareado/cluster por corrida + janela cega. **Não otimizar mais em cima da estratégia atual sem pré-registro** — foi o que gerou todos os falsos positivos.

**Scripts da medição honesta** (untracked em 2026-08-18): `src/oneTimeScript/eval_bsp.ts`, `bootstrap_bsp_vs_zero.ts`, `bootstrap_bsp_flat.ts`, `diag_offrange.ts`, `sim_month_ruin.ts`, `sweep_band_ruin.ts`, `oos_band_low.ts`, `src/services/ml/eval/bsp-lookup.ts`. Rodar com `NO_CRON=1` (guard em `setupCronJob()`, evita escrever no Supabase compartilhado) e `BSP_DIR` apontando pros CSVs da Betfair.

**LAY betting math (user-defined strategy):**
- Bankroll starts at 200, stake fixed at 10 per race, assumed odd = 20 (constant; real odds too volatile).
- Outcome per bet na odd 20: +10 if horse loses, **−190** if horse wins (LAY real: perda = `stake × (odd − 1)`, é o que `simulator.ts` / `eval_bsp.ts:131` fazem).
- Break-even win rate: 190/200 = **95.00%** SEM comissão. Com comissão Betfair BR de 6,5% sobre ganhos (pesquisa 2026-07-04, `docs/pesquisa_mercado_lay_2026-07-04.md`): 190/199.35 = **95.31%** na odd 20. O simulador aplica a comissão por default (`COMMISSION_RATE`, `src/services/ml/eval/simulator.ts`).
- ⚠️ Corrigido 2026-08-18: este doc dizia `200/210 = 95.24%` sem comissão. Errado — supunha perda de −200, resquício da era do **odd 20 hardcoded**. A fórmula geral, que reproduz o 95.31% com comissão, é `p_breakeven = (odd−1) / (odd−1 + 1−c)` (LAY) e `1 / ((odd−1)(1−c) + 1)` (BACK).
- Cascade: try pick #1 first; if `runner_status='non_runner'` OR odd > 20, fall back to #2, then #3; skip race if none eligible.

**Implication for future work:** Do NOT chase val_top1 improvements. O gargalo é o descasamento desta seção: o modelo é **treinado pra rankear o vencedor** e **avaliado por ROI de lay**. Enquanto isso não mudar, cada sweep vai continuar achando edge que não replica. Rotas honestas: (a) validação cega pré-registrada de UMA configuração, com critério de desistência escrito antes; (b) loss orientada a ROI/lay em vez de cross-entropy do vencedor (ver `project_loss_objective_mismatch.md` Options A/B/C).

**✅ Staging gate for cron retraining — IMPLEMENTADO 2026-07-04** (`src/services/ml/staging-gate.ts`). Com `ENABLE_CRON_RETRAIN=1`, o cron roda `trainAllModelsWithGate()`: (1) treina candidato em `baselines/candidate_{flat,jump}` (prod intocado); (2) avalia candidato vs prod nos últimos `GATE_PERIOD_DAYS` (90) com regras de pick 1:1 com prod (funções importadas de `claude-generate-picks.ts`, sp_decimal, P/L com odd real); (3) promove com backup (`baselines/prod_backup_YYYYMMDD_{type}`) se `edge_cand ≥ edge_prod − GATE_EDGE_TOLERANCE_PP` (0.2pp) e apostas ≥ `GATE_MIN_BETS` (30); senão mantém prod e loga rejeição. Decisões salvas em `horse_probability_model/staging_gate_logs/` no bucket. Execução manual: `src/oneTimeScript/run_staging_gate.ts` (suporta `GATE_DRY_RUN=1`, `GATE_SKIP_TRAINING=1`, `GATE_CANDIDATE_LABEL=x` pra testes). ⚠️ Caveat: a janela de eval é in-sample pro candidato — o gate protege contra REGRESSÃO, não é estimativa não-enviesada de ROI. Prevents accidental degradation like v65 (edge +0.06pp) → v66 (edge -0.53pp) observed 2026-07-02.

**✅ Gate LIGADO em 2026-08-20** (`ENABLE_CRON_RETRAIN=1` no `.env` de `HorsingMazePrd`), depois de o pré-registro #1 ter sido executado — não há mais janela cega a preservar. Até então o gate nunca havia rodado e `staging_gate_logs/` estava vazio; o modelo vivo era o **mt_b05 promovido à mão em 2026-07-03**, congelado por ~48 dias.

O gate roda em `GATE_MODE=bootstrap` (default). **Volume por tipo vs `GATE_MIN_BETS=300`, medido em 2026-08-20:**

| modelo | corridas/90d | apostas/90d | consequência |
|---|---:|---:|---|
| Flat | 671 | 545 | passa, julgado pelo bootstrap pareado |
| Jump | 247 | 200 | **rejeita sempre** por amostra insuficiente |

Manter o Jump no retreino foi decisão consciente: ele treina e é descartado. `GATE_TYPES=flat` resolveria, se o custo de CPU incomodar.

**Validação em dry run (2026-08-19, Jump, candidato existente):** o critério ANTIGO teria **promovido** (cand +1,17pp vs prod −0,81pp, dentro da tolerância de 0,2pp). O novo **rejeitou** — diff pareado de ROI +32,76% com IC95 **[−0,65%, +73,41%]**, que cruza zero. É exatamente a promoção-por-ruído que a troca de critério existe pra barrar.

**Deploy (2026-08-20):** `HorsingMazePrd` roda a branch `main`, que estava 22 commits atrás. ⚠️ **A chave SSH do `mazedev` não é aceita pelo GitHub** (`Permission denied (publickey)`), então `git pull` falha no servidor — o deploy foi feito por `git bundle` via SSH. Registrar a chave no GitHub resolveria de vez. ⚠️ **Não rodar `npm ci --omit=dev` lá**: o build acontece no próprio servidor e `tsc` vive nas devDependencies.

**Ressalva sobre o critério do gate, pra quando for ligado:** `edge_cand ≥ edge_prod − 0.2pp` com `GATE_MIN_BETS=30` em 90 dias. 90 dias ≈ 520 apostas, onde o erro-padrão da margem é da ordem de ~1pp — o limiar é ~5× mais fino que a resolução da medição, e 30 apostas está duas ordens de grandeza abaixo das ~6.200 necessárias pra distinguir edge de zero. Entre dois modelos parecidos, a promoção é sorteio. Trocar a comparação pontual pelo bootstrap pareado por corrida (`bootstrap_bsp_vs_zero.ts`) e subir `GATE_MIN_BETS`.

**Topologia dos serviços (mazeserver, systemd, ambos ativos):** `horsingmaze-prd` → `HorsingMazePrd`, `OUTPUT_SCHEMA=prd`, `PORT=3001`. `horsingmaze-hml` → `HorsingMazeHmlManus`, `DISABLE_PIPELINE_CRON=1`, `ENABLE_INTRADAY_ODDS=1`, `PORT=3000`. `DATA_SCHEMA` não é setado em nenhum → default `hml`: **ingestão vive em `hml`, ML escreve em `prd`** (por isso `prd.racecards_hr_enriched` está vazio — é o desenho). As features de `hml` pararem em 2026-07-08 é consequência do `DISABLE_PIPELINE_CRON=1`, não quebra.

**✅ Betfair BSP real na simulação — FEITO 2026-08-12** (`src/services/ml/eval/bsp-lookup.ts`). O eval não usa mais `sp_decimal` de `race_horses_hr_enriched` (SP das casas tradicionais, aproximação): lê **BSP** (Betfair Starting Price) dos CSVs históricos gratuitos, com join de 97,6%. É a odd EXATA que se apostaria em produção. O impacto foi muito maior que o esperado — junto com a remoção do look-ahead, derrubou o ROI de +1175% pra +8,8% não-significativo (ver medição honesta acima).

### 🔒 BLOQUEIO ATIVO (desde 2026-08-18) — CSVs de BSP inacessíveis do Brasil

**Os CSVs de BSP param em 2026-07-12** e não podem ser atualizados. Isso **bloqueia o pré-registro #1** (`docs/pre_registro_falsificacao_2026-08-18.md`), cuja janela cega é [2026-07-09, 2026-08-18]. Faltam ~71 arquivos (uk + ire).

Diagnóstico de 2026-08-18:

1. **Da máquina de dev (WSL):** `promo.betfair.com` é interceptado por **Cisco Umbrella** → **HTTP 403** com redirect pra `block.opendns.com` (bloqueio por categoria: gambling). O erro `unable to get local issuer certificate` era sintoma disso — o certificado é emitido por `Cisco Umbrella Secondary SubCA`, não pela Betfair.
2. **Do `mazeserver` (sem Umbrella):** a requisição passa, mas a Betfair devolve **HTTP 302** pra `promo.betfair.bet.br` (operação regulada brasileira). Esse host dá **NXDOMAIN** em 1.1.1.1 e 8.8.8.8, embora `betfair.bet.br` resolva. O redirect está quebrado.
3. **O 302 atinge todas as datas**, inclusive as já baixadas (testado 01/07, 12/07, 13/07, 01/08). O corte em 2026-07-12 **não é fim de cobertura** — é a data em que o geo-redirect entrou no ar.

Arquivos existentes: 1827, em `/home/maze/dev/betfair_sp_data` e `mazeserver:/home/mazedev/betfair_sp_data` (idênticos), cobrindo 2024-01-01 → 2026-07-12.

**⛔ Fallback pra `sp_decimal` é PROIBIDO em qualquer veredicto.** Foi exatamente a aproximação que produziu os ROIs inflados de julho. Uso em dev é tolerável se rotulado; alimentar decisão, não.

Saídas possíveis: proxy/VPS fora do BR, Betfair API direta (exige conta + auth, ao contrário dos CSVs), ou provedor terceiro. Sem isso, **nenhuma validação honesta de Lay é executável.**

### 🖥️ Infra de coleta fora do Brasil (2026-08-19/20)

O geo-bloqueio da Betfair atinge **todos** os hosts dela a partir de IP brasileiro (302 → `.bet.br`, que dá NXDOMAIN): `promo.betfair.com` (CSVs de BSP), `api.betfair.com`, `identitysso.betfair.com` e `historicdata.betfair.com`. O `mazeserver` também sai pelo Brasil (191.41.40.89, TIM), então tunelar por ele **não** resolve.

**Solução:** VM Oracle Cloud **Always Free** em `uk-london-1` (VM.Standard.A1.Flex, 1 OCPU/6 GB, Ubuntu 24.04). Nome na tailnet: **`bspnode`**, IP `100.92.130.99`. Acesso daqui: `ssh bspnode` (entrada no `~/.ssh/config`, `ProxyJump mazeserver`).

⚠️ **Usar sempre o IP da tailnet, nunca o público.** O IP público da Oracle é efêmero e muda se a instância for parada/religada.

O que roda lá:
- `scripts/fetch_betfair_bsp.sh` — backfill dos CSVs de BSP. Já trouxe a cobertura até 2026-08-18 (1900 arquivos, sincronizados aqui e no `mazeserver`). ⚠️ A Betfair devolve **429 em rajada**: sem retry com backoff, ~38% dos downloads falham.
- `scripts/smarkets_collector.py` — coletor de **bid-ask** de corrida, cron `*/15 8-21 * * *` UTC. Grava `~/smarkets_data/smarkets_book_AAAAMMDD.csv`.

**Por que Smarkets e não Betfair:** a conta Betfair BR não autentica em `betfair.com`, e a API da Exchange exige conta internacional. O Smarkets expõe o livro de ofertas **sem autenticação** (`api.smarkets.com/v3`, verificado). Smarkets e Matchbook aceitam residentes do Brasil, caso um dia seja preciso executar de verdade.

⚠️ **Smarkets não é Betfair:** liquidez menor em corrida UK, logo spread **mais largo**. É **limite superior conservador** — serve pra MATAR a hipótese de trading barato, não pra confirmá-la.

Preço no Smarkets = probabilidade percentual × 100 → `odd = 10000 / price`.

**Riscos operacionais registrados:** a Oracle recupera instâncias Always Free ociosas por 7 dias (o cron do coletor serve de atividade); e a chave do nó Tailscale expira em 180 dias por padrão, derrubando o nó da rede — desabilitar *key expiry* no admin console.

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
GATE_MODE=bootstrap         # (2026-08-19) critério de promoção:
                            #   "bootstrap" (default) = cluster bootstrap por corrida
                            #     do ROI de LAY, PAREADO candidato vs prod. Promove só se
                            #     IC95_lower(ROI_cand − ROI_prod) > 0 E pnl_cand > pnl_prod.
                            #   "edge_tolerance" = critério legado (diferença pontual de
                            #     edge). Aposentado: 0.2pp é ~5x mais fino que o erro-padrão
                            #     da medição em 90d, então promovia por sorteio.
GATE_BOOTSTRAP_B=1000       # iterações do bootstrap
GATE_PERIOD_DAYS=90         # janela de eval do gate
GATE_EDGE_TOLERANCE_PP=0.2  # só usado em GATE_MODE=edge_tolerance
GATE_MIN_BETS=300           # amostra mínima de apostas simuladas pra promover (era 30;
                            # segue muito abaixo das ~6.200 pra distinguir edge de zero —
                            # serve pra barrar candidato degenerado, não pra confirmar edge)
LAY_LOSS_ALPHA=0.3          # (2026-08-19) peso do LAY loss: L = ListMLE + α * L_lay.
LAY_LOSS_WARMUP=5           # épocas só com ListMLE antes de ativar o LAY loss.
LAY_LOSS_TAU=0.1            # temperatura do softmin do LAY loss (era hardcoded).
                            # Menor = seleção mais dura; maior = mais suave.
                            # ⚠️ Varrer α é otimização sobre a estratégia atual: exige
                            # pré-registro e janela nunca tocada.
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

