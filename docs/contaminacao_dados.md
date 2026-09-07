# Mapa de contaminação dos dados — o que pode envenenar uma medição

Criado em 2026-09-06. **Leia isto ANTES de escrever qualquer probe, feature ou
avaliação.**

## Por que existe

Este projeto já reverteu conclusão **cinco vezes**, e em quatro delas a causa foi
a mesma: um campo que só existe DEPOIS da corrida entrou numa decisão que teria
sido tomada ANTES. ROI de +1175% virou +8,8%. Depois virou não-significativo.

O padrão é sempre igual e não é falta de cuidado pontual — é que **o banco não
distingue "o que eu sabia" de "o que aconteceu".** Tudo mora na mesma linha. Este
documento é a distinção que falta.

## A regra

> **Toda medição tem um INSTANTE DE DECISÃO.** Um campo só pode entrar na
> SELEÇÃO se seu valor já estava fixado naquele instante. Campos posteriores
> entram só na LIQUIDAÇÃO (calcular o P/L do que já foi escolhido).

Selecionar com dado do futuro é o pecado. Liquidar com dado do futuro é o certo —
é literalmente o que acontece na vida real.

## Legenda

| tag | significado |
|---|---|
| 🟢 **PRÉ** | fixado antes da corrida. Livre pra seleção. |
| 🟡 **TEMPORAL** | pré-corrida, mas o valor MUDA ao longo do dia ou é atualizado depois. Só é seguro com filtro explícito de carimbo de tempo. |
| 🟠 **DERIVADO** | contaminado por construção — vem de um campo 🔴, ou do próprio preço. |
| 🔴 **PÓS** | só existe depois da largada. **Nunca** na seleção. |

---

## 1. CSVs da Betfair (`/home/maze/dev/betfair_sp_data`, win + place)

| coluna | tag | observação |
|---|---|---|
| `EVENT_ID`, `MENU_HINT`, `EVENT_NAME`, `EVENT_DT` | 🟢 | grade da corrida |
| `SELECTION_ID`, `SELECTION_NAME` | 🟢 | chave de join |
| `WIN_LOSE` | 🔴 | é o alvo |
| `BSP` | 🔴 | formado NA largada. Liquidação: certo. Seleção: foi o erro de julho |
| `PPWAP` | 🔴 | média ponderada de TODO o pré-live, inclui os minutos finais |
| `MORNINGWAP` | 🟡/🔴 | média sobre a janela da manhã. 🟢 só se o instante de decisão for DEPOIS da janela inteira. **🔴 se a decisão é às 04:00 (odds_enriched)** — fabricou uma "arb casa×exchange" de +30% (mapa §13.2) |
| `PPMAX`, `PPMIN` | 🔴 | extremos negociados ao longo de horas. Amplitude mediana **56,7%** — não servem nem como proxy de spread |
| `IPMAX`, `IPMIN` | 🔴 | extremos EM CORRIDA. Só existem no fim |
| `MORNINGTRADEDVOL` | 🟡 | volume da manhã |
| `PPTRADEDVOL` | 🔴 | volume pré-live total, fechado na largada |
| `IPTRADEDVOL` | 🔴 | volume em corrida. Já registrado no mapa: contamina se usado como filtro |

## 2. `hml.race_horses_hr_enriched` (349.230 linhas)

| coluna | tag | observação |
|---|---|---|
| `horse`, `id_horse`, `jockey`, `trainer`, `age`, `weight`, `number`, `draw`, `headgear`, `sex_code`, `sire`, `dam`, `damsire`, `owner`, `form`, `last_ran_days_ago`, `or_rating` | 🟢 | cartão de corrida |
| `non_runner` | 🔴 | **subiu de 🟡 pra 🔴 em 2026-09-06 — ver §10.** É escrito quando a retirada acontece, logo filtrar por ele reconstrói um cartão que você NÃO tinha de manhã. Já produziu um falso positivo |
| `sp`, `sp_decimal` | 🔴 | **o campo mais perigoso do banco.** Só conhecido na largada |
| `position`, `distance_beaten` | 🔴 | desfecho |
| `created_at` | 🟢 | |
| `updated_at` | 🟡 | anda; não serve pra reconstruir estado num instante |

## 3. `hml.racecards_hr_enriched` (29.205)

| coluna | tag | observação |
|---|---|---|
| `id_race`, `course`, `date`, `off_time_br`, `off_time_uk`, `title`, `distance`, `age`, `prize`, `class`, `race_type`, `surface` | 🟢 | |
| `going` | 🟡 | o terreno é reavaliado no dia; o valor gravado tende a ser o final |
| `finished`, `canceled` | 🟡 | flags de status, escritas depois |
| `finish_time` | 🔴 | desfecho |

## 4. `hml.odds_enriched` (114.704) — o preço limpo

| coluna | tag | observação |
|---|---|---|
| `bookie`, `odd`, `url` | 🟢 | |
| `last_update` | 🟢 | **é o que torna a tabela segura** |

**Estado medido em 2026-09-06:** exatamente **1 foto por (cavalo, casa)**,
capturada entre 03:00 e 04:00 UTC. Casas vistas: 888Sport, BoyleSports,
LadBrokes, Unibet, 10Bet.

⚠️ **ARMADILHA LATENTE.** Vários scripts (`each_way_early.ts`,
`each_way_bankroll_sim.ts`, `bog_value_probe.ts`) fazem `max(odd)` sobre TODAS as
linhas, **sem filtro de `last_update`**. Hoje isso é inofensivo porque só existe
uma foto. **No dia em que `ENABLE_INTRADAY_ODDS=1` gravar as capturas de 06:00 e
09:00, esses scripts viram look-ahead em silêncio** — passariam a pegar o melhor
preço do dia inteiro, incluindo depois do instante de decisão. Corrigir
preventivamente: sempre `.lte("last_update", instante_de_decisao)`.

## 5. `hml.rpscrape_results` (662.296 linhas, 53 colunas) — a mina e o campo minado

Fonte mais rica do banco, e a mais perigosa.

| coluna | tag | observação |
|---|---|---|
| `race_date`, `course`, `off_time`, `horse_name`, `horse_name_norm`, `region`, `race_type`, `race_class`, `pattern`, `rating_band`, `age_band`, `dist_f`, `dist_m`, `surface`, `ran`, `num`, `draw`, `age`, `sex`, `lbs`, `hg`, `jockey`, `trainer`, `prize`, `or_rating`, `sire`, `dam`, `damsire`, `owner` | 🟢 | |
| `going` | 🟡 | idem §3 |
| `pos`, `pos_raw`, `ovr_btn`, `btn` | 🔴 | desfecho |
| `secs` | 🔴 | tempo da corrida |
| `dec_odds` | 🔴 | é o SP |
| **`rpr_rating`** | 🔴🔴 | **MEDIDO HOJE: é nota PÓS-corrida** |
| **`ts_rating`** | 🔴🔴 | **idem** |
| **`comment`** | 🔴 | comentário do que aconteceu DURANTE a corrida |
| `bsp`, `wap`, `morning_wap`, `pre_min`, `pre_max`, `ip_min`, `ip_max` | ver §1 | mesmas colunas dos CSVs |
| `race_horse_id`, `match_status`, `match_confidence`, `matched_at`, `source_csv`, `ingested_at` | 🟢 | metadado de join |

### A prova de que RPR e TS são pós-corrida

Média do rating contra a posição de chegada **na mesma corrida** (n=1.000):

| posição | RPR | TS | OR |
|---|---:|---:|---:|
| 1º | 86,3 | 61,8 | 78,2 |
| 2º | 80,2 | 58,4 | 77,3 |
| 3º | 76,0 | 55,8 | 77,3 |
| 4º | 73,4 | 53,0 | 76,4 |
| 5º | 68,9 | 47,9 | 76,3 |
| 6º+ | 57,7 | 40,8 | 74,6 |
| **amplitude** | **28,6** | **21,0** | **3,6** |

`or_rating` é atribuído ANTES e quase não varia com o resultado (3,6 pontos, o
que sobra é só o favorito ganhar mais). RPR e TS variam 8× mais e de forma
perfeitamente monotônica: **são notas da performance naquela corrida.** Um modelo
que veja o RPR da corrida corrente acerta quase tudo e não vale nada.

✅ **O código atual está correto neste ponto.** `pace.features.ts:98` filtra
`new Date(r.race_date).getTime() < cutoff`, com `cutoff = currentRaceDate` —
estrito, exclui a corrida atual e qualquer outra do mesmo dia. **Não mexer nesse
`<`.** Trocar por `<=` seria catastrófico e silencioso.

## 6. Features e picks — contaminados por construção

| tabela / campo | tag | observação |
|---|---|---|
| `training_enriched_horse_features.features` | 🟠 | **contém `sp_decimal`/`sp_implied_prob`/`sp_rank`** (via `market.features.ts`). Qualquer pergunta sobre movimento de preço feita com o modelo de prod é **circular** — foi o que inflou o sinal de drift de 57% pra 64% |
| `.target`, `.finish_position` | 🔴 | |
| `prediction_*.predicted_probability` | 🟠 | saída de um modelo que viu o SP. ⚠️ **6.740 linhas com `model_version='v5.0'` têm P=0,000** — são placeholders de feature sem predição (o orchestrator grava `v5.0` antes de o modelo preencher). Filtrar `model_version != 'v5.0'` em QUALQUER leitura, senão o "top do modelo" vira aleatório (14,7% vs 24,0% real) |
| `.actual_position`, `.prediction_correct` | 🔴 | |
| `lay_betting_*.market_odd` | 🟡 | depende do caminho: `sp_decimal` (🔴) ou última odd de `odds_enriched` (🟢). Conferir caso a caso |
| `lay_betting_*.profit_loss`, `.result`, `.actual_position` | 🔴 | |

**Consequência prática:** para toda pergunta sobre PREÇO, usar o baseline
`baselines/no_market_flat` / `no_market_jump` (67 features, sem mercado), nunca o
modelo de prod.

## 7. Fontes novas (2026-08/09) — seguras por desenho

Ambas gravam carimbo de tempo em cada linha, então são 🟢 **desde que filtradas
por ele**.

| fonte | campo de tempo | armadilha |
|---|---|---|
| `smarkets_book_v2_*.csv` | `collected_at` | v1 tem as pontas com nomes TROCADOS (ver CLAUDE.md) |
| `pp_ew_v1_*.csv` (novo) | `collected_at`, `mins_to_off` | ⚠️ **`num_places` MUDA durante o dia** — a casa adiciona vaga extra em cima da hora. Usar o valor observado no instante de decisão, **nunca** o último do dia. `runner_status` idem |

---

## 8. Como INFERIR quando o campo limpo não existe

Regra pedida: se não vem claro de uma API, reconstruir com o que temos.

| quero | ❌ não use | ✅ use |
|---|---|---|
| preço no instante da decisão | `sp_decimal`, `BSP`, `PPWAP` | melhor `odd` de `odds_enriched` com `last_update <= t` (foto de 03–04 UTC) |
| preço de fechamento (liquidação) | — | `BSP` do CSV. É o correto aqui |
| spread bid-ask | `PPMAX`/`PPMIN` (amplitude mediana 56,7%!) | `smarkets_book_v2_*.csv`, que é livro real carimbado |
| habilidade do cavalo | `rpr_rating`/`ts_rating`/`secs`/`comment` da corrida atual | os mesmos campos das corridas **anteriores** (é o que `pace.features` já faz) |
| campo de corredores confiável | `non_runner` do banco | `runner_status` do coletor PP no instante t, ou contagem no CSV da Betfair |
| termos de each-way | `termFor()` hardcoded (erra 43%) | `num_places`/`place_num`/`place_den` do coletor PP |
| probabilidade de referência | saída do modelo de prod | prob implícita do preço, ou `baselines/no_market_*` |

**E a régua que você mesmo apontou:** o encompassing test mostrou que o modelo
reproduz o preço e nada além. Isso é ruim como alfa, mas é **ótimo como
validação**: se uma reconstrução nossa diverge muito da prob implícita do preço,
a suspeita recai sobre a reconstrução, não sobre o mercado.

## 9. Checklist antes de reportar qualquer número

1. Qual é o **instante de decisão**? Escreva antes de rodar.
2. Todo campo da SELEÇÃO é 🟢, ou 🟡 com filtro de tempo explícito?
3. A LIQUIDAÇÃO usa o preço que se conseguiria de verdade (BSP, ou preço de casa)?
4. Cluster bootstrap **por corrida** (cavalos da mesma corrida são dependentes).
5. A janela é cega? As queimadas: `[180,0)`, `[360,180)`, `[581,360)`, e agora
   `[2026-03-16, 2026-08-18]` (odds_enriched / each-way / política de stake).
6. Se o resultado ficou bom, **procure o vazamento antes de comemorar.** Cinco
   por cinco até agora.

---

## 10. ⚠️ CASO TRABALHADO — `non_runner` fabricou uma arbitragem inteira

Vale mais que a tabela, porque mostra a forma que o vazamento assume.

`src/oneTimeScript/bog_value_probe.ts` mediu o overround do livro "melhor preço
entre as casas" na foto das 04:00 UTC. Resultado inicial, aparentemente ótimo:

> 5,11% das corridas com overround < 1 — **arbitragem pura**, lucro travado
> mediano de 8,65%. Não depende de prever nada.

Sobreviveu a duas checagens:
1. **Campo real, não do join.** Recontei os corredores no CSV da Betfair em vez
   de usar os que casaram no join. Taxa não mudou (1.643 vs 1.646 corridas).
2. **Cotação podre de uma casa.** Mediana de melhor/2º-melhor = **1,000**, e
   **68 das 84 arbitragens sobrevivem usando o 2º melhor preço.** Não era uma
   casa com feed velho.

O que entregou foi um número fora do lugar: nas corridas "com arb" o preço da
casa era **1,028× o BSP**, contra **0,680×** nas normais. **Casa não paga acima
da exchange.** Isso não é preço generoso — é livro medido errado.

**A causa:** corridas "com arb" têm **2,98 retiradas por corrida** contra 1,14
nas normais. Você cota N cavalos de manhã; ~3 são retirados; o livro sobre os que
SOBRARAM soma menos que 1 porque a fatia de probabilidade dos retirados sumiu. Na
vida real você teria apostado nos N, e a casa aplica **Rule 4** nos ganhos —
restaurando exatamente a margem que o cálculo tinha apagado.

**O teste decisivo:**

| corridas | com overround < 1 |
|---|---|
| **sem retirada nenhuma (560)** | **0 — 0,00%** |
| com retirada (1.083) | 84 — 7,76% |

**Zero em 560.** Não existe uma única arbitragem genuína entre estas casas na
janela inteira. As 84 eram 100% artefato.

### O que aprender com isto

1. **O vazamento não veio de um campo 🔴 óbvio.** Veio de `non_runner`, que
   parecia metadado inocente de cartão de corrida.
2. **Filtrar um cartão pelo estado FINAL é look-ahead**, mesmo que nenhum preço
   ou resultado seja tocado. Você reconstruiu um universo de apostas que não
   existia no seu instante de decisão.
3. **O sinal foi um número impossível**, não a estatística. IC, bootstrap e
   amostra estavam todos bem. Sempre procure a grandeza que viola uma regra do
   mundo — aqui, "casa não paga mais que a exchange".
4. **Regra geral:** qualquer coluna que descreva *estado que muda até a largada*
   (`non_runner`, `going`, `finished`, `canceled`, `num_places` do coletor PP) é
   🔴 pra seleção, a menos que você tenha o carimbo de QUANDO mudou.

⚠️ **Não temos histórico do momento da retirada.** Enquanto não tivermos, a única
reconstrução honesta de "cartão de manhã" é: **todos os cavalos com preço na foto
das 04:00**, tratando retirada como risco assumido (stake devolvido + Rule 4),
nunca como filtro prévio. O coletor PP grava `runner_status` carimbado e resolve
isso daqui pra frente.
