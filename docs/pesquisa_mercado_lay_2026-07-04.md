# Pesquisa: como outros resolveram os problemas do HorsingMaze (2026-07-04)

Pesquisa web robusta cruzando literatura acadêmica, material técnico da Betfair e
relatos de praticantes com os problemas específicos do projeto: teto de val_top1
~30%, lay em odds altas, realismo do backtest (+1495% ROI simulado) e staking.

**TL;DR**: o teto de 30% top-1 é o mercado, não bug — e o pivot pra ROI (já
feito) é o que a literatura faz. Porém, nenhum resultado real documentado
sustenta a escala do nosso ROI simulado, e há quatro custos que o backtest
não pagava na data desta pesquisa: comissão 6,5% da Betfair BR, diferença
estrutural SP→BSP (pior em odds 13–20), liquidez de lay em odds altas, e o
desconto típico de 20–50% entre backtest e produção. A técnica mais validada
que ainda não usamos: blend Benter de 2 estágios (era o Tier 1 #5).

---

## 1. O teto de ~30% top-1: todo mundo bate nele, ninguém "resolve"

A conclusão da Fase 1 (SP-only ≥ modelo com 74 features em ranking top-1) é um
resultado clássico. Praticante do SmarterSig: *"o SP é tão bom como preditor
que o algoritmo de ML ignora todos os outros inputs"*. Estudos com dados da
Betfair confirmam que exchanges são mais eficientes informacionalmente que
bookmakers; o BSP agrega o julgamento de milhares de participantes nos minutos
finais. Benter lucrou num mercado parimutuel de Hong Kong dos anos 80-90;
Teddy Koker (projeto NN+softmax por corrida, muito similar ao nosso) avisa que
os mercados atuais são bem mais eficientes que na "era dourada".

**Implicação**: parar de otimizar val_top1 foi a decisão certa. A métrica que
importa é lucro/calibração de cauda.

## 2. A técnica validada que falta: blend Benter de 2 estágios

O achado mais acionável. **Estágio 1** = modelo fundamental SEM features de
mercado; **estágio 2** = conditional logit pequeno combinando probabilidade
fundamental + log(odds de mercado), ajustado no val set. Estudo citado no
SmarterSig: retorno OOS de **+17,53% (2 estágios) vs +0,96% (1 estágio)** —
mesmos dados, mesmo Kelly.

Por que importa: o mt_b05 mistura mercado e fundamentais no mesmo gradiente, e
a permutation importance (2026-07-01) mostrou dominância de sp_rank/sp_decimal
com 22 features ignoradas. O blend resolve estruturalmente: o mercado não
compete com as features pelo gradiente. **O estágio 1 já existe**: baseline
`no_market` (67 feat, val_top1 28,93%) da Fase 1. Falta só o estágio 2
(regressão pequena). Era o Tier 1 #5, arquivado — desarquivar.

## 3. Lay em odds altas: vento a favor existe, mas é mais fraco no exchange

O viés favorite-longshot (outsiders super-apostados → lay em outsiders +EV) é
real e persistente **em odds de bookmaker (SP)**. Porém, estudos com dados de
exchange mostram que **no BSP o viés praticamente desaparece** ("lay em
drifters ao BSP não oferece valor"; há evidência de viés *reverso* em
exchanges). Parte do edge que o simulador vê usando SP tradicional pode ser
exatamente a parte que não existe no preço em que vamos operar.

Praticantes confirmam que sistemas de lay com strike 96%+ existem e são
operáveis (documentado: 3.000 pts de lucro desde 2021, 194 lays vencedores
seguidos), mas: pouquíssimos vivem disso, o edge vem de filtros disciplinados,
e um lay errado em odd alta apaga muitas vitórias.

## 4. Os quatro custos que o backtest não pagava

**a) Comissão 6,5%.** Taxa base da Betfair Brasil (bet.br) = **6,5% sobre
lucro líquido** (mais alta que os 2–5% internacionais). Com comissão, ganho
por lay vira +9,35 (não +10); na odd média real dos picks (~13), break-even
sobe de 92,31% pra ~92,77%. **Consome ~25–30% do edge de +1,78pp medido no
smoke test do staging gate.** → Corrigido no simulador em 2026-07-04
(COMMISSION_RATE, default 0.065).

**b) SP → BSP é estrutural, não proporcional.** Investigação UK/IRE: bookies
comprimem margem na cauda de outsiders → BSP sistematicamente **maior** que SP
na faixa 10–20+ (nossa faixa). Consequências: liability real por loss maior
que a simulada; cavalos "apostados" com SP ≤ 20 estariam > 20 no BSP (seriam
filtrados → menos apostas). Confirma o TODO dos CSVs de BSP como correção #1
do backtest. Enquanto não vêm: tratar ROI simulado em SP como TETO otimista.

**c) Liquidez/matching de lay em odds 13–20.** Oferecer lay em odd 15 em
corrida de grade baixa não garante contraparte (unmatched/partial match).
Mitigação documentada: **ordens ao BSP com limite** (lay at SP com teto de
odd) — matching garantido pelo pool de fechamento, preço desconhecido até o
off. Desenhar a operação real em torno disso.

**d) Desconto backtest→live.** Consenso de trading quant: queda de **20–50%**
entre simulado e real. Sanity check dos data scientists da Betfair: *"POT
consistente de 10% no BSP em thoroughbreds é irreal — use isso pra identificar
erros de cálculo"*. Nosso +1495%/180d com stake fixo é POT ~30%+, e a janela é
in-sample. Planejar banca com fração pequena do simulado. O paper trade
(tabela all_eligible) é o instrumento certo — registrar também o BSP realizado
de cada pick pra medir o gap SP↔BSP com dados próprios.

## 5. Staking

Kelly fracionado (¼ a ½) é o consenso; Kelly cheio assume probabilidades
corretas e produz drawdowns brutais. Para lay, Kelly calcula-se sobre a
**liability**. Nossa simulação mostrou 2 ruínas com banca 200 → banca ≥ 10×
max DD simulado (≥ R$5.700 pelo mt_b05) ou stake proporcional. Beta test com
R$200 tem alta probabilidade de ruína mesmo com edge real.

## 6. Arquitetura: rankers de árvore continuam ganhando

Estudo coreano 2024–25 (9.140 corridas, LambdaRank): CatBoost melhor ranking
(NDCG 0,889), LightGBM/XGBoost melhores em aposta prática. Literatura LTR:
LambdaMART/GBDT ≥ NN em features tabulares densas. Valida a Fase 3 do debug
plan (teacher LightGBM) — sidecar Python (infra rpscrape já existe), benchmark
de 1–2 dias.

## 7. O que NÃO perseguir

Steamers/drifters como sinal: ao BSP, movimento de mercado não é convertível
em estratégia lucrativa ("como prever um drifter? você não prevê"). Usar no
máximo como feature de contexto, nunca como sistema.

---

## Recomendações em ordem de retorno/esforço

1. ✅ **Comissão 6,5% no simulador** (feito 2026-07-04) — refaz conclusões de viabilidade.
2. **BSP CSVs** (TODO existente, confirmado crítico) — até lá, ROI em SP = teto otimista.
3. **Blend Benter 2 estágios** — maior uplift documentado; estágio 1 (`no_market`) já existe. ~2 dias.
4. **Paper trade instrumentado** — BSP realizado + matchability na all_eligible; em 2–4 semanas mede o desconto backtest→real com dados próprios.
5. **Benchmark LightGBM lambdarank** (sidecar Python) — decide se vale destilação.
6. **Banca/staking**: Kelly fracionado sobre liability; banca = max DD simulado pós-comissão ×2–3.

## Fontes

- Betfair Data Scientists — Backtesting wagering models: https://betfair-datascientists.github.io/tutorials/backtestingRatingsTutorial/
- SmarterSig — Two Step Models (Benter): https://markatsmartersig.wordpress.com/2020/05/18/two-step-models-for-horse-racing/
- Teddy Koker — Beating the Odds: https://teddykoker.com/2019/12/beating-the-odds-machine-learning-for-horse-racing/
- Betfair BR — taxa base 6,5%: https://support.betfair.bet.br/app/answers/detail/10526-exchange-qual-e-a-taxa-base-de-mercado
- Betfair BR — cálculo da comissão: https://support.betfair.bet.br/app/answers/detail/2408-betfair-exchange-o-que-e-comissao-e-como-ela-e-calculada/
- On Course Profits — SP vs BSP: https://www.oncourseprofits.com/modelling-the-relationship-between-sp-bsp-and-beyond-a-practical-investigation-using-uk-irish-racing-data/
- Inform Racing — Laying at big prices: https://www.informracing.com/laying-horses-at-big-prices/
- Honest Betting Reviews — Laying for a living: https://www.honestbettingreviews.com/laying-horses-for-a-living/
- LUT — FLB & efficiency win/place UK: https://lutpub.lut.fi/bitstream/10024/166663/3/FAVORITE-LONGSHOT%20BIAS%20AND%20EFFICIENCY%20OF%20WIN%20AND%20PLACE%20BETTING%20MARKETS%20IN%20ENGLISH%20HORSE%20RACING.pdf
- arXiv 2402.02623 — Efficient Market Dynamics (Betfair UK racing): https://arxiv.org/pdf/2402.02623
- Geegeez — Steamers and Drifters pt.3: https://www.geegeez.co.uk/steamers-and-drifters-part-3/
- KCI — LTR horse racing CatBoost/LightGBM 2024-25: https://journal.kci.go.kr/jksci/archive/articleView?artiId=ART003266151
- Matthew Downey — Fractional Kelly: https://matthewdowney.github.io/uncertainty-kelly-criterion-optimal-bet-size.html
- BetAngel forum — Laying at high odds/liquidez: https://forum.betangel.com/viewtopic.php?t=17865
- EBC — Backtest vs live divergence: https://www.ebc.com/forex/backtesting-vs-live-trading-4-reasons-why-your-results-dont-match
