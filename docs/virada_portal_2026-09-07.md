# A virada: de "vencer o mercado" para "vender o que sabemos" — portal de dados de turfe

Data: 2026-09-07. Contexto: o mapa (`mapa_mercados_2026-09-06.md`) fechou todo
caminho de previsão. O modelo iguala o preço; isso é sentença como aposta e
**ativo como produto** — um estimador de preço justo tão bom quanto o mercado,
mais uma infra de coleta que ninguém pequeno tem.

## 0. A tese em um parágrafo

Racing Post, Sporting Life, At The Races e Oddschecker vendem **cartão + forma +
odds**. Todos grátis, todos enormes. Competir nisso é perder. O que nós temos e
eles não mostram é a **camada de mercado**: como cada cavalo negociou (BSP,
WAP da manhã, drift), qual casa paga vaga extra hoje e com que fração, quanto o
tote pagou contra a exchange, se a pista mudou desde a declaração da manhã, e
um preço justo independente pra comparar com cada casa. É nicho, é o nicho de
quem aposta a sério, e é o que a Oddschecker cobra por afiliação.

## 1. Inventário ranqueado — o que temos, de onde vem, o que vale

Critério: **valor = exclusividade × demanda ÷ risco legal**. "Publicável" = dá
pra mostrar no site sem infringir termos de quem gerou o dado.

### Tier 1 — exclusivo ou raro, demanda real, publicável (é o produto pago)

| ativo | origem | o que mostra | por que pagam |
|---|---|---|---|
| **Termos de each-way por casa, por corrida, hora a hora** (`pp_ew_v1_*`) | coletor PP (bspnode) | vagas, fração, BOG, Rule 4, mudanças ao longo do dia | apostador de EW vive disso; hoje só via Oddschecker/afiliado. Escalar pra mais casas é o mesmo coletor |
| **Vaga extra HOJE** (derivado do anterior) | idem | lista diária "quais corridas pagam 4/5 vagas" | é a promoção mais procurada do turfe UK |
| **Histórico de negociação por cavalo** (BSP, WAP manhã, vol, IPmin/IPmax) | CSVs Betfair 2024→ (2.068 arqs) | "como este cavalo negociou nas últimas 10" | traders de exchange; a Betfair não mostra isso por cavalo |
| **Preço justo do modelo vs cada casa** | modelo ≈ mercado + odds_enriched (5 casas) + PP | "quem paga mais que o justo agora" | é o produto core da Oddschecker |
| **Drift matinal → BSP** e sinal direcional (57% no resíduo) | CSVs + baseline sem mercado | "movimentos de mercado" com histórico | páginas de *steamers/drifters* são as mais lidas |
| **Pista: declarado às 04:00 vs final** + preferência de terreno do cavalo | racecards + rpscrape (derivado) | "mudou a pista hoje; quem gosta" | ninguém publica a MUDANÇA, só o estado |
| **Livro bid/ask + último negócio** (`smarkets_book_v3`) | coletor Smarkets | spread e liquidez por cavalo, por hora | traders; base pra alerta de liquidez |
| **Tote vs exchange** (`sl_tote.jsonl`) | Sporting Life API | "tote pagou 0,94× do BSP neste tipo de corrida" | nicho, mas único |

### Tier 2 — temos, existe grátis em outro lugar, mas com nosso ângulo

| ativo | origem | ângulo nosso |
|---|---|---|
| Cartão de corrida (hoje/amanhã), corredores, jóquei, treinador, OR, peso, draw | HR API + theracingapi free | base obrigatória do site; sem isso não há página |
| **Strike rate ponto-no-tempo** de jóquei/treinador (`human_rules_probe`) | rpscrape derivado | os portais mostram 14 dias; nós mostramos histórico completo sem look-ahead |
| Estilo de corrida (E/EP/MP/H) por cavalo | `comment.converter` (derivado dos comentários) | pace map por corrida — Timeform cobra por isso |
| Estatística de forma por pista/distância/going | rpscrape derivado | agregados nossos, publicáveis |
| Avaliação honesta de estratégias (BSP real, bootstrap) | `eval/`, todos os probes | **conteúdo** — "testamos X com 33 mil corridas": SEO e credibilidade |

### Tier 3 — temos e NÃO podemos publicar como está

| ativo | por quê |
|---|---|
| Comentários in-running do Racing Post (`rpscrape.comment`) | texto autoral do RP; publicar é infração |
| RPR e Topspeed | ratings proprietários do RP |
| Odds cruas da HR RapidAPI redistribuídas | termos comerciais do fornecedor; redistribuição exige plano/licença |
| Features de treino (`training_enriched_*`), picks de lay | sem valor pra terceiro; picks provadamente sem edge — publicar seria vender ilusão |

**Regra:** dado bruto de terceiro não sai; **derivado nosso** (strike rate,
run-style, drift, preferência de terreno, comparação de preço) sai. É o mesmo
princípio da Timeform: eles não mostram o dado do RP, mostram a nota deles.

## 2. As duas paredes legais (decidem antes de qualquer linha de código)

1. **Fonte do cartão.** Hoje vem de scraping (HR API, rpscrape). Pra um site
   público precisa de feed licenciado: **theracingapi** (já temos conta free;
   os tiers pagos existem pra isso — cartões, corredores, resultados, odds;
   custo na casa de dezenas a ~cem libras/mês, confirmar tabela) ou o feed da
   PA/Racing Post (caro, corporativo). Sem isso o site nasce processável.
2. **Betfair historical data.** Os CSVs são gratuitos pra uso pessoal; exibir
   agregados derivados (BSP de um cavalo, drift) num site com receita precisa
   de leitura dos termos/licença. A Betfair tem programa de dados e afiliados —
   é o caminho: entrar como afiliado dá direito a exibir preços e ganhar por
   conta aberta.

O resto (PP, Smarkets, Sporting Life) é coleta de páginas públicas; publicar
**derivado** (vagas, spread mediano, tote/BSP) é o que Oddschecker e afins
fazem. Risco baixo, não zero.

## 3. Quanto custa colocar no ar

**Dinheiro (mês 1–3):**

| item | custo |
|---|---|
| domínio | ~US$15/ano |
| hospedagem do front (Vercel/Cloudflare Pages) | 0–20 US$/mês |
| API/back: já existe (`mazeserver`, Supabase self-hosted, `bspnode`) | 0 |
| feed licenciado de cartão (theracingapi pago) | ~£30–100/mês — **o único custo que importa** |
| CDN/imagens/e-mail transacional | ~0–10 US$/mês |
| **total** | **~£50–130/mês** até ter receita |

**Tempo (uma pessoa, MVP):** 3–5 semanas.
- Sem. 1: modelo de dados público (views no Supabase, sem expor tabelas
  internas), feed licenciado ligado, páginas *Hoje / Amanhã / Corrida / Cavalo*.
- Sem. 2: camada de mercado — BSP histórico por cavalo, drift, termos de EW e
  vaga extra do dia, mudança de pista.
- Sem. 3: comparador de preço (justo vs casas), páginas de estatística
  (jóquei/treinador/pista), SEO técnico, AdSense.
- Sem. 4–5: conta + assinatura (Stripe), alertas por e-mail (vaga extra, drift),
  exportação CSV/API pra assinante.

Stack: Next.js (o front que o repo não tem ainda), Supabase que já existe,
os cron que já rodam. **80% do trabalho já está feito — é o back.**

## 4. De onde vem o dinheiro, com número honesto

- **AdSense:** nicho de apostas UK rende ~US$3–8 por mil pageviews (RPM). Pra
  cobrir £100/mês precisa de **~25–40 mil pageviews/mês**. Um portal novo de
  turfe demora 6–12 meses de SEO pra chegar lá. ⚠️ Política do AdSense pra
  conteúdo de apostas varia por país: informativo é aceito no UK; confirmar
  antes de contar com isso.
- **"Impulsionar" com anúncio pago NÃO se paga num site AdSense**: você paga
  £0,30–1 por clique pra receber £0,005 por visualização. Tráfego pago só faz
  sentido pra vender assinatura, nunca pra alimentar AdSense.
- **Afiliação de casas de aposta** é o que sustenta a Oddschecker: £50–200 por
  cliente que deposita. Uma página "melhor preço + vaga extra hoje" com link de
  afiliado rende mais em 10 conversões que AdSense em 100 mil views. **É esta a
  receita principal, não o AdSense.** Programas UK aceitam afiliados fora do
  UK via redes (Income Access, etc.); confirmar elegibilidade do Brasil.
- **Assinatura** (£5–15/mês): termos de EW hora a hora, alertas, BSP histórico,
  API. Só depois de ter audiência; 1% de conversão é a régua do setor.

Cenário realista de 12 meses: meses 1–6 custo puro (~£600); meses 6–12 AdSense
cobre a infra; assinatura/afiliado é o que pode virar renda, e depende de
audiência que ainda não existe.

## 5. O que muda no repositório

- O pipeline de ML **para de ser o produto** e vira uma coluna ("preço justo").
- Coletores (PP, Smarkets, tote, BSP) viram **fontes de primeira classe**, com
  retenção e esquema estável — hoje são CSV em `~/` no bspnode.
- Nasce `web/` (Next.js) e um esquema `public_api` no Supabase com views
  somente-leitura.
- `oneTimeScript/` vira conteúdo: cada probe é um artigo ("testamos each-way
  com 182 mil corridas").

## 6. O que NÃO prometer

Não vender picks. Não vender "ROI". Toda a credibilidade do site vem de sermos
os únicos a publicar que **nada do que testamos bate o BSP** — isso é
diferencial editorial, e é verdade.
