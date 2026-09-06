# Mapa de métodos de aposta em corrida de cavalos — o que sobra pra nós

Data: 2026-09-06. Levantamento pedido: "analisar cada tipo de aposta existente e
bater com o que a gente tem". Tudo que está marcado como MEDIDO foi calculado
hoje sobre os 1.900 CSVs de win + 1.928 de place da Betfair (312.286 runners,
33.095 corridas, 2024-01 → 2026-08-18) ou vem de medição já registrada no
CLAUDE.md.

---

## 0. O eixo que decide tudo (dois números novos)

Medidos hoje, direto dos CSVs:

| grandeza | valor | fonte |
|---|---:|---|
| overround médio do mercado WIN **no BSP** | **1,0039** (0,39% de margem) | 33.095 corridas |
| overround médio do mercado PLACE no BSP | 1,0011 (0,11%) | `place_mispricing_probe.ts` |
| spread bid-ask **fora** do BSP (odd 4–8, manhã) | **8,7%** (mediana, 4 ticks) | Smarkets, `spread_smarkets.ts` |
| spread bid-ask (odd 13–20, banda de prod) | 19,5% (6 ticks) | idem |

Isso reformula todo o problema do projeto numa frase:

> **No BSP o mercado é praticamente de graça (0,39%) — e é exatamente ali que já
> provamos não ter informação nenhuma. Fora do BSP temos um sinal pequeno mas
> real — e ali o pedágio é 10× a margem do BSP e ~1,6× o próprio sinal.**

Todo método abaixo é julgado por uma pergunta só: **ele quebra esse eixo?** Só
três coisas quebram:

1. **Não transacionar contra um preço de mercado** — apostar contra um preço
   calculado por *fórmula* (termos de each-way, Rule 4, CSF, tote) em vez de por
   um livro de ofertas.
2. **Ser pago pelo spread em vez de pagá-lo** — postar ordem passiva / market
   making, onde o 8,7%–19,5% vira receita.
3. **Renda que não vem de previsão** — promoções, BOG, matched betting.

Qualquer coisa que não caia em 1, 2 ou 3 está pedindo pra bater o preço, e isso
já foi refutado quatro vezes.

---

## 1. Catálogo completo

### A. Mercados de desfecho (exchange)

| # | mercado | como se ganha | status aqui |
|---|---|---|---|
| A1 | **Win** (back/lay) | prever o vencedor melhor que o preço | ⛔ **refutado.** Encompassing: α cai 1,45→0,15 competindo com o preço; ganho fora da amostra −0,00002 nats. Vale pra Flat **e** Jump. |
| A2 | **Place / To Be Placed** | prever colocação melhor que o preço | ⛔ **refutado 2026-08-21.** Simulação honesta −4,4% a −10%, IC95 inteiramente < 0. Até o teto com look-ahead perde. |
| A3 | **Forecast / Exacta, Tricast / Trifecta** | prever a ordem exata dos 2–3 primeiros | ⛔ **morto por herança + economia pior.** Exige a mesma conversão win→conjunta (Harville/Stern) que o A2 provou ser pior que o preço do próprio mercado; e o CSF/tote deduz 15–27% contra 6,5% da exchange. |
| A4 | **Match bets / "to finish ahead of"** | head-to-head entre 2 cavalos | ⛔ mesma conversão do A3, sem liquidez e sem dado histórico nosso. |
| A5 | **Top-2 / Top-4 finish, "without the favourite", insurance** | variantes de colocação | ⛔ herdam A2/A3. |
| A6 | **Winning distance, race time, mercados de jóquei/treinador** | outra variável-alvo | ⛔ não temos dado nenhum e não há preço histórico gratuito. |

### B. Trading (fechar posição, sem exposição ao desfecho)

| # | método | status |
|---|---|---|
| B1 | **Pré-corrida back-to-lay / lay-to-back** (steamer/drifter) | 🟡 **sinal real, custo maior.** Resíduo direcional 57,4% com o baseline sem mercado; excesso bruto do Q5 +5,39%; meia-spread medida 4,35% → consome 81% do bruto. Kill switch disparado. **Único sobrevivente parcial** — ver §3-B. |
| B2 | **Em corrida: back → cashout (DOB)** ← *sua ideia* | ⛔ **MEDIDO HOJE, perde em todos os alvos.** Ver §2. |
| B3 | **Em corrida: lay → back no alongamento (LOB)** | ⛔ **MEDIDO HOJE**, ROI −12% a −28%. |
| B4 | **Scalping / market making passivo** | 🟢 **não testado, e é o único que inverte o sinal do custo.** Ver §3-B. |
| B5 | **Arbitragem entre casas/exchanges** | 🟡 possível medir: já temos coletor de livro do Smarkets rodando (18 dias, 280 mil cotações). Falta uma segunda fonte. Sem modelo, sem previsão. |

### C. Casa de apostas (odd fixa) — edge estrutural, não preditivo

| # | método | status |
|---|---|---|
| C1 | **Each-way contra termos de fórmula** | 🟢 **melhor candidato novo.** Ver §3-A. |
| C2 | **Best Odds Guaranteed (BOG)** | 🟡 opção grátis: você leva `max(preço tomado, SP)`. Casa com o sinal direcional do B1 **sem pagar spread duas vezes** (não precisa fechar posição). Trava: disponibilidade no mercado regulado BR e limitação de conta. |
| C3 | **Rule 4 / não-corredor** | 🟡 quando um cavalo é retirado, a casa aplica dedução tabelada e a exchange reprecifica de verdade. Discrepância mecânica. Exige execução em minutos, não temos infra. |
| C4 | **Matched betting / bônus** | 🟢 **o único +EV garantido de toda a lista**, e não usa modelo nenhum. Renda limitada pelo tamanho da promoção. Não é este projeto, mas é honesto ter na mesa. |

### D. Pools (tote)

| # | método | status |
|---|---|---|
| D1 | **Placepot, Jackpot, Quadpot, Exacta/Trifecta do tote** | ⛔ dedução de 16–27% (contra 6,5%), e o edge dependeria de estimar colocação melhor que o público — que é justamente o que o A2 refutou. Acesso do Brasil ao tote UK improvável. |
| D2 | **Ante-post / futures** | ⛔ sem dado, horizonte longo, risco de não-corredor. |
| D3 | **Spread betting (Sporting Index)** | ⛔ indisponível no BR, sem dado histórico. |

---

## 2. Sua ideia, medida: back na alta → cashout em corrida

A intuição ("o cavalo ganha posições, o preço despenca, você fecha") está certa
sobre a *mecânica* — o preço realmente despenca. A pergunta é se ele despenca com
frequência suficiente pra pagar as vezes em que não despenca.

**Temos o dado exato pra responder**: os CSVs trazem `ipmin`/`ipmax` — o menor e
o maior preço **negociado durante a corrida** — com 100% de cobertura nos 312.286
runners. Este projeto nunca tinha olhado essas colunas.

Operação: back de 1 unidade no BSP; se o preço cair até `k × BSP` em corrida,
fecha (green up) e trava `(1/k − 1)` menos comissão; se não cair, o back corre até
o fim.

```
     k          n      hit%  break-even%  lucro/hit       ROI%
  0.50     312286     32.98        51.68      0.935     -36.27
  0.60     312286     40.33        61.60      0.623     -34.45
  0.70     312286     48.49        71.39      0.401     -31.93
  0.80     312286     57.87        81.05      0.234     -28.45
  0.90     312286     67.43        90.59      0.104     -25.43
  0.95     312286     72.17        95.31      0.049     -24.14
```

E o espelho (lay no BSP, back se o preço alongar `m×` em corrida):

```
     m          n      hit%  lucro/hit       ROI%
   1.5     312286     85.09      0.312     -28.30
   2.0     312286     82.34      0.468     -23.56
   3.0     312286     79.08      0.623     -17.78
   5.0     312286     75.19      0.748     -12.25
```

**Leitura:**

- Em **todo** alvo de cashout a taxa real fica **18–23pp abaixo do break-even**, e
  o défice é praticamente constante. Isso é assinatura de mercado eficiente: o
  preço em corrida já embute exatamente o quanto ele costuma andar.
- A medição é um **teto otimista**: `ipmin` é o extremo negociado, e eu suponho
  que sua ordem casaria nele, ignorando delay de aposta (1–8s), fila e risco de
  ficar sem casar. Mesmo com essa vantagem, perde 24–36%. Mesma lógica do teto
  com look-ahead do probe de place: se nem no melhor caso fecha, não fecha.
- **A barra pra sua ideia virar de pé é explícita: uma seleção que suba a taxa de
  acerto em ~19pp.** Nosso sinal direcional pré-corrida move ~5%. Não chega perto.
- Detalhe técnico: na banda [1,3) o `k=0,5` é inalcançável (o alvo cai abaixo da
  odd mínima 1,01), por isso 3.184 vencedores aparecem como "sem hit" — a linha
  agregada não sofre porque essa banda é 5% da amostra.

**Veredicto:** a família "back e dá cashout" está **fechada na versão sem
seleção**. Só reabre com um preditor do *movimento em corrida*, que é uma variável
diferente de tudo que o projeto já modelou — ver §3-C.

---

## 3. O que sobra, ranqueado

### 🥇 A. Each-way contra termos de fórmula (C1)

**A tese.** O probe de place produziu um achado que foi lido como derrota, mas que
é um *ativo*: **o preço do mercado PLACE é o melhor estimador de colocação que
existe** — bate a melhor conversão possível do preço do WIN, fora da amostra, em
309 mil observações. Não conseguimos vencer esse preço. Mas não precisamos: dá pra
**usá-lo como régua** contra um preço que não é de mercado.

A casa de apostas não precifica each-way com um livro. Ela precifica por **regra
fixa**: `1/4 da odd nas 2 primeiras` em campo de 5–7, `1/5 nas 3 primeiras` em 8+,
`1/4 nas 4 primeiras` em handicap de 12+. É uma função-degrau grosseira aplicada
sobre a odd de vitória. Quando o número de vagas ou a distribuição do campo não
casa com o degrau, a perna de place fica **cara ou barata em relação à
probabilidade verdadeira** — e a probabilidade verdadeira é justamente o que o BSP
do place nos dá com 0,11% de margem.

**Por que quebra o eixo do §0.** Não estamos tentando bater um preço formado por
livro de ofertas. Estamos comparando um preço-fórmula com um preço-mercado. É a
categoria 1 do §0.

**Dá pra testar offline, hoje, sem modelo, sem infra nova:**
- `sp_decimal` (SP das casas tradicionais, em `race_horses_hr_enriched`) é
  **exatamente** o objeto certo aqui — não é proxy de nada. Uma aposta EW "at SP"
  liquida literalmente por ele. ⚠️ Isto **não** viola a proibição do CLAUDE.md: a
  proibição é usar `sp_decimal` como substituto do preço da exchange que você
  pegaria; aqui ele é o preço da casa, que é o objeto do teste.
- Probabilidade justa de colocação = `1/BSP_place` (margem 0,11%, dispensa
  de-overround sofisticado).
- Número de vagas `k` sai do próprio CSV de place (contagem de `win_lose=1`).
- EV da EW = `0,5 × [p_win × (SP−1) − (1−p_win)] + 0,5 × [p_place × ((SP−1)/f) − (1−p_place)]`.
- Join win↔place já existe e é 100% por `(menu_hint, event_dt)` + `selection_id`.

**Critério de morte, escrito antes:** se a perna de place não for positiva depois
da margem da casa em nenhuma célula (campo × termo), morre e não se reabre.

**Riscos reais:** (a) a casa limita conta que só aposta EW de valor — é a forma
clássica de morte dessa estratégia; (b) precisa confirmar que algum operador
`bet.br` oferece EW em corrida UK/IRE com esses termos.

### 🥈 B. Entrada passiva / market making (B4 + B1)

**A tese.** Nosso problema nunca foi o sinal, foi atravessar 4,35% de meia-spread.
Mas 8,7% de spread é um número de **dois lados**: quem posta a ordem e espera
*recebe* isso. Medido hoje: **82% dos runners negociaram abaixo da própria média
de preço da manhã** em algum momento pré-corrida — ou seja, ordem passiva casa com
frequência alta.

O sinal direcional do B1 (real, mas pequeno demais pra pagar pedágio) tem
exatamente o tamanho certo pra outra função: **inclinar o inventário** de um
market maker, em vez de disparar uma ordem agressiva.

**O que falta, e é honesto dizer que é caro:** modelar seleção adversa. Você casa
preferencialmente quando o preço vai contra você. Os 18 dias de Smarkets a cada 15
min **não** bastam pra estimar fila e fill — snapshot de 15 minutos não vê a
microestrutura. Antes de qualquer simulação, o coletor precisa cair pra 1 min nos
30 min finais.

**Primeiro passo barato (zero risco, zero janela queimada):** re-rodar
`spread_smarkets.ts` sobre os **18 dias** acumulados em vez do 1 dia original, e
medir a evolução do spread por minuto até a largada. Já muda a força da conclusão
de 2026-08-20, que estava explicitamente marcada como "é 1 dia".

### ⛔ C. DOB condicionado a estilo de corrida — TESTADO E MORTO no mesmo dia

**A tese.** A taxa de acerto do §2 é a **média incondicional**. O que faz um preço
despencar em corrida não é vencer — é **liderar cedo**. Front-runner em sprint,
campo pequeno, terreno pesado: o preço colapsa nos primeiros 200m mesmo se o
cavalo morrer no final. Isso é previsível por estilo de corrida, e o projeto já
tem features de *pace* (o v64 com 74 features as inclui).

**E o alvo é uma variável nova.** Até hoje todo modelo do projeto foi treinado
pra prever `finish_position=1`, um alvo que o mercado precifica melhor que nós. O
alvo aqui é `ipmin ≤ k × BSP` — **não existe mercado cotado pra ele**. O único
mecanismo que o precificaria é gente fazendo exatamente esse trade. É o que mais
se aproxima de "informação que o mercado não precifica bem" que o projeto achou.

**Por que fica em terceiro mesmo assim:** a barra é **+19pp de lift**, enorme, e o
défice constante em todos os `k` sugere que o mercado em corrida já corrige isso
rápido. Além disso, executar exige estar no mercado durante a corrida, com delay de
aposta e risco de não casar — nada disso está medido.

**Resultado (rodado no mesmo dia, `inrunning_dob_probe.ts`):** morreu. Ver §6.2.

### Fora do ranking, mas na mesa: matched betting (C4)

É o único item da lista com EV positivo **garantido** e sem depender de previsão. Não é
ciência de dados e não escala além do tamanho das promoções, mas se o objetivo
declarado é "tirar uma grana", omitir seria desonesto.

---

## 4. O que NÃO fazer (herdado + reforçado hoje)

- Nova loss, arquitetura ou feature sobre o mesmo conjunto de features (CLAUDE.md).
- Reabrir conversão win→place / forecast / tricast (A3–A5 herdam a refutação do A2).
- Testar mais bandas de odd — janelas [180,0), [360,180) e [581,360) queimadas.
- DOB/LOB incondicional em qualquer alvo — medido hoje, morto.
- Fallback pra `sp_decimal` como proxy do preço de exchange. (A exceção do §3-A é
  outra coisa: lá ele é o preço da casa, que é o objeto do teste.)

## 5. Advertência de jurisdição

Tudo em §3-A e §3-C pressupõe conta em operador que ofereça corrida UK/IRE. Betfair
e Smarkets aceitam residentes do Brasil; a Betfair BR (`bet.br`) não autentica em
`betfair.com` e a API da Exchange exige conta internacional. EW e BOG são produtos
de casa tradicional, e a disponibilidade deles no mercado regulado brasileiro
**precisa ser confirmada antes** de qualquer trabalho de modelagem — é uma
pergunta de 10 minutos que decide se o §3-A vale a pena.


---

# 6. ATUALIZAÇÃO — testes rodados em 2026-09-06

## 6.1 Bloqueio operacional: mazeserver fora do ar

Durante o inventário do Supabase o `mazeserver` (192.168.1.171) **caiu por
completo** — respondia normalmente e passou a 100% de perda de pacotes.
Discriminado: o roteador da LAN (192.168.1.1) responde de dentro do WSL e o
`.171` não, então **é o host, não a rede local**. Derruba junto: Supabase
(prd + hml), os dois serviços systemd, e o acesso SSH ao `bspnode` (que salta
por ele — o coletor do Smarkets segue rodando na VM da Oracle, só o acesso
daqui é que se perdeu).

**Inventário do Supabase, capturado antes da queda** (schema `hml`):

| tabela | linhas | o que tem de novo pro mapa |
|---|---:|---|
| `race_horses_hr_enriched` | 349.230 | **`sp_decimal`** (SP de casa tradicional), `or_rating`, `draw`, `headgear`, `sire`/`dam`/`damsire` |
| `odds_enriched` | 114.704 | **`bookie`, `odd`, `last_update`, `url`** — preço POR CASA. É o insumo que faltava pro each-way. |
| `racecards_hr_enriched` | 29.206 | `going`, `class`, `surface`, `prize`, `off_time_uk` |
| `prediction_enriched_horse_features` | 43.796 | features + predicted_probability |
| `lay_betting_top_picks` / `_all_eligible` / `_race_results` | 4.539 / 7.025 / 1.271 | histórico de picks |

⚠️ Faltou medir: cobertura temporal e por corrida de `odds_enriched`, quantas
casas distintas, e se `training_enriched_horse_features` existe (deu erro vazio).
**É o primeiro passo quando o servidor voltar.**

## 6.2 DOB condicionado: MORTO, e a lição foi um look-ahead meu

`src/oneTimeScript/inrunning_dob_probe.ts`. Desenho anti-garimpo: FIT
[2024-01, 2025-10) escolhe as células, HELD [2025-10, 2026-08] mede, cluster
bootstrap por corrida. Células = código × distância × classe × campo × rank de odd.

**Primeira rodada pareceu achar ouro** — 3 células replicaram no HELD com IC95
acima de zero, todas da mesma família (Hurdle 13-20f, Mdn/Nov, azarão R9+), com
ROI de +16,7% a +17,9% e, o que mais chamou atenção, *melhores* fora da amostra
que dentro.

**Era look-ahead meu.** O probe filtrava `iptradedvol >= 100`. Essa coluna é o
volume negociado **durante a corrida** — só existe depois dela. Filtrar por ela
seleciona exatamente os cavalos cujo preço se moveu muito em corrida, que é o
desfecho do trade. Refeito com `MIN_IPVOL=0`:

> **0 de 148 células têm ROI positivo, nem mesmo no FIT com garimpo livre.**
> A melhor é −5,50%.

E a autópsia (`dob_deepdive.ts`) mostrou um segundo tiro fatal, independente do
primeiro: naquelas células o BSP mediano é **600 a 790**. Pra fazer green up de
1 unidade num azarão de 790 é preciso lançar ordem de lay com **672× o stake de
liabilidade** (mediana da célula). Com stake mínimo de R$5, são ~R$3.400 parados
por trade. Inexecutável em qualquer banca deste projeto, mesmo se o edge fosse real.

**Marginais limpas (FIT, sem look-ahead, k=0,5, break-even 51,68%):**

| corte | melhor célula | hit% | ROI |
|---|---|---:|---:|
| código | NHF | 38,66 | −25,4% |
| distância | >20f | 37,83 | −27,0% |
| classe | Mdn/Nov | 37,70 | −27,8% |
| campo | ≤7 corredores | 37,33 | −28,4% |
| rank de odd | favorito | 43,44 | −18,4% |

O favorito é o mais próximo do break-even e ainda falta **8,2pp**. Nenhum corte
chega perto.

**Lição registrada:** `iptradedvol`, `ipmax`, `ipmin`, `pptradedvol` são
pós-evento em graus diferentes. `ipmin`/`ipmax` são o **alvo** (ok usar como
label); `iptradedvol` é **contaminação** se usado como filtro de seleção.

## 6.3 Each-way: a estrutura confirma a tese, e agora ela é o candidato único

`src/oneTimeScript/each_way_structure.ts` — autocontido, só CSVs. Join win↔place
em **33.284 corridas / 310.489 runners**.

Ideia: a fração justa `f* = (O_win − 1) / (O_place_justa − 1)`, com
`O_place_justa` vinda do BSP do place (overround 0,11%). Se `f* > f_casa`, a
perna de place da casa **paga a mais**.

**A casa usa fração CONSTANTE; a fração justa CRESCE com a odd.** Esse
descasamento é o mecanismo inteiro:

| odd de vitória | f* 2 vagas | f* 3 vagas | f* 4 vagas |
|---|---:|---:|---:|
| [2,5) | 2,82 | 4,50 | 4,63 |
| [5,10) | 2,95 | 4,52 | 5,13 |
| [10,20) | 3,14 | 4,76 | 5,60 |
| [20,50) | 3,58 | 5,29 | 6,21 |
| [50,+) | 4,78 | 6,94 | 7,42 |

(f_casa = 4 em 2 e 4 vagas, 5 em 3 vagas. Termos usados: 5-7 corr. → 1/4 em 2;
8+ não-handicap → 1/5 em 3; handicap 8-11 → 1/5 em 3; handicap 12-15 → **1/4 em
3**; handicap 16+ → 1/4 em 4.)

**EV total da aposta each-way (win+place), com desconto `h` sobre a odd da
exchange** (`h=1` seria a casa pagando o preço da exchange, impossível; `h≈0,85`
é realista pra azarão):

| grupo | n | h=1,00 | h=0,90 | h=0,85 | h=0,80 | h=0,75 |
|---|---:|---:|---:|---:|---:|---:|
| 2 vagas (5-7 corr.) | 51.134 | −2,48% | −9,57% | −13,11% | −16,66% | −20,21% |
| 3 vagas, não-handicap | 89.775 | **+20,95%** | +10,74% | **+5,64%** | +0,53% | −4,57% |
| 3 vagas, handicap 8-11 | 94.640 | +1,77% | −6,19% | −10,17% | −14,14% | −18,12% |
| 3 vagas, handicap 12+ | 44.392 | +5,16% | −3,81% | −8,30% | −12,78% | −17,26% |
| **4 vagas (handicap 16+)** | 30.548 | **+23,19%** | +12,35% | **+6,93%** | +1,51% | −3,91% |

Por faixa de odd, em `h=0,85`, 4 vagas: [10,20) +0,07% · [20,50) **+6,62%** ·
[50,+) **+22,46%**.

**Leitura honesta:**
- O sinal é **estrutural, não preditivo**. Não estamos tentando adivinhar nada —
  estamos comparando uma tabela fixa da casa com o melhor estimador de colocação
  que existe. É a categoria 1 do §0, a única que quebra o eixo do projeto.
- **A magnitude é grande o bastante pra sobreviver a custo**, ao contrário de tudo
  que veio antes: o haircut de break-even é **0,666** em 4 vagas (a odd da casa
  pode ser 33% pior que a exchange) e **0,812** em 3 vagas não-handicap.
- **Mas `h` é chute.** Todo o resultado depende de quanto a casa paga de verdade, e
  é justamente em azarão que a casa corta mais. **Isto NÃO é um veredicto** — é
  uma medição de estrutura que diz onde vale a pena olhar.

**O teste que fecha, e o que ele precisa:** substituir `h` pela odd real. Duas
fontes, ambas no Supabase e ambas caídas agora:
1. `race_horses_hr_enriched.sp_decimal` — o SP da casa. Uma EW "at SP" liquida
   literalmente por ele. Não é proxy de nada, é o objeto. (A proibição do CLAUDE.md
   é usar `sp_decimal` como substituto do preço de exchange; aqui é outro uso.)
2. `odds_enriched` (114.704 linhas, coluna `bookie`) — preço por casa, que permite
   ver **qual** casa e se dá pra escolher a melhor.

**Critério de morte, escrito antes de rodar:** se, com a odd real da casa, nenhum
grupo (vagas × faixa de odd) tiver EV positivo com IC95 (cluster bootstrap por
corrida) inteiramente acima de zero em janela HELD, morre e não se reabre.

**Riscos que sobrevivem mesmo se o EV der positivo:** (a) a casa limita conta que
só aposta EW de valor em azarão — é a causa clássica de morte dessa estratégia;
(b) precisa confirmar operador `bet.br` que ofereça EW em corrida UK/IRE com esses
termos. **(b) é uma pergunta de 10 minutos e decide se (a) importa.**


---

# 7. EACH-WAY: o veredicto completo (2026-09-06, com Supabase de volta)

Três testes, todos **livres de modelo** — nenhuma probabilidade estimada em lugar
nenhum, só odd real de casa, desfecho real e termos reais.

## 7.1 EW "at SP" — MORTO

`src/oneTimeScript/each_way_real.ts`. 182.885 runners (2024-01 → 2026-08-18),
join CSV↔Supabase de 59%. FIT/HELD em 2025-10-01, cluster bootstrap por corrida.

| grupo (HELD) | n | ROI EW | IC95 | perna place |
|---|---:|---:|---|---:|
| 2 vagas (5-7 corr.) | 4.189 | −22,61% | [−26,08, −18,96] | −24,25% |
| 3 vagas, não-handicap | 12.913 | −29,22% | [−33,95, −23,59] | −18,34% |
| 3 vagas, handicap 8-11 | 19.190 | −18,62% | [−20,62, −16,65] | −16,10% |
| 3 vagas, handicap 12+ | 12.088 | −23,25% | [−25,83, −20,56] | −20,16% |
| 4 vagas (handicap 16+) | 8.234 | −19,15% | [−22,02, −16,06] | −1,22% |

**Todo grupo com IC95 inteiramente abaixo de zero, no FIT e no HELD.**

**E o porquê está no haircut real da casa** — `h = (SP−1)/(BSP−1)`:

| faixa de odd | h mediano |
|---|---:|
| [2,5) | 0,877 |
| [5,10) | 0,821 |
| [10,20) | 0,771 |
| [20,50) | 0,696 |
| [50,+) | **0,469** |

A estrutura do §6.3 estava certa: a fração justa cresce com a odd e a da casa não.
**Mas a casa já sabe disso e corta a odd de vitória exatamente onde o place
sobrepaga.** Meu chute de `h≈0,85` era otimista por quase o dobro em azarão. A
margem é carregada precisamente nos cavalos onde o each-way seria roubo.

## 7.2 EW com hedge na exchange — MORTO

Back EW na casa "at SP" + lay das duas pernas no BSP (comissão 6,5%). Todas as
ordens antes da largada, nenhum preço conhecido na decisão — sem look-ahead.

**Lucro travado médio: −25,72%. Só 1,3% das apostas dariam lucro** — e separá-las
exigiria saber SP e BSP de antemão. Hedgear só a perna de vitória também não
salva: −1,39% contra +0,31% sem hedge. O hedge custa exatamente o que a perna de
vitória perde; troca variância por prejuízo certo.

## 7.3 ✅ EW no preço de MANHÃ com BOG + VAGA EXTRA — ACHADO POSITIVO

`src/oneTimeScript/each_way_early.ts`. Usa `odds_enriched` (5 casas: BoyleSports,
Unibet, 888Sport, LadBrokes, 10Bet; média de 3,6 casas por cavalo), pega o
**melhor preço matinal**, aplica **BOG** (preço efetivo = `max(preço tomado, SP)`)
e usa a **posição real de chegada** pra recalcular a perna de place.
Janela 2026-03-16 → 2026-08-18, 19.832 runners.

O BOG sozinho já vale muito: o preço de manhã supera o SP em **38,1%** dos casos,
e o melhor preço fica **+18,62%** acima do SP em média.

**Nos termos padrão ainda perde** (−9,63% no total; a única célula neutra é
"4 vagas, odd [10,50)" com +0,31% [−6,18, +7,27], que cruza zero e foi vista
depois de olhar várias — não conta como achado).

**Com UMA vaga extra, vira:**

| grupo | n | padrão | **+1 vaga** | IC95 (+1) | +2 vagas |
|---|---:|---:|---:|---|---:|
| TODOS | 19.832 | −9,63% | **+8,77%** | **[6,61, 11,05]** ✅ | +28,80% |
| 3 vagas | 14.944 | −11,18% | +8,19% | [5,81, 10,76] ✅ | +29,11% |
| 4 vagas (hcap 16+) | 4.878 | −4,82% | +10,64% | [5,85, 15,45] ✅ | +27,97% |
| 4 vagas, odd [10,50) | 3.350 | +0,31% | **+16,69%** | [9,97, 23,56] ✅ | +34,05% |
| odd [20,50) | 5.172 | −7,45% | +14,66% | [6,56, 22,85] ✅ | +40,19% |
| odd [50,+) | 2.052 | −50,79% | −21,91% | [−36,68, −6,41] ❌ | +18,42% |

**Estabilidade temporal (duas metades disjuntas):**

| janela | n | +1 vaga | IC95 |
|---|---:|---:|---|
| 2026-03-16 → 2026-05-31 | 9.685 | +9,61% | [6,61, 13,03] ✅ |
| 2026-06-01 → 2026-08-18 | 10.147 | +7,97% | [4,94, 11,01] ✅ |

Replicou nas duas. **Nenhum parâmetro foi ajustado** — "+1 vaga" não é uma célula
garimpada, é a promoção que as casas de fato anunciam.

### Por que isto é diferente de tudo que veio antes

Não estamos prevendo nada. O edge não vem de saber mais que o mercado — vem de a
casa pagar 5 vagas num evento onde o preço justo é de 4. É a **categoria 1 do §0**:
apostar contra um preço de fórmula, não contra um livro de ofertas. É o único
caminho de todo o mapa que não esbarra no teorema "onde o custo é zero não temos
edge, onde temos sinal o custo é maior".

### ⚠️ O que este número NÃO diz

1. **Ele supõe vaga extra em TODA aposta.** As promoções cobrem um subconjunto —
   tipicamente sábados, festivais e handicaps grandes selecionados. O +8,77% é
   **edge por aposta qualificada**; o volume é limitado pela oferta, não pelo
   nosso capital. Dimensionar isso é o próximo passo e não dá pra fazer com os
   dados atuais — exige registrar quais corridas tiveram a oferta.
2. **Limitação de conta é a causa clássica de morte desta estratégia.** Casa
   percebe rápido quem só aposta EW de azarão em corrida com vaga extra.
3. **Disponibilidade no mercado regulado BR não foi verificada.** As 5 casas do
   `odds_enriched` são britânicas. Se nenhum operador `bet.br` oferecer EW em
   corrida UK/IRE com vaga extra, o achado é academicamente válido e
   operacionalmente inútil. **É a pergunta que decide, e é de 10 minutos.**
4. **Cobertura:** `odds_enriched` só existe de 2026-03-16 em diante e o join
   fecha em 19.832 de 53.856 runners da janela (37%). Não descartei viés de
   seleção sobre quais corridas têm preço capturado.
5. **A odd [50,+) é negativa mesmo com vaga extra** (−21,91%). O filtro natural é
   a faixa [10,50), onde o achado é mais forte.

## 7.4 Consequência pro mapa

O ranking do §3 muda:

- **🥇 EW com vaga extra** — deixou de ser hipótese e passou a ter medição
  positiva, replicada, livre de modelo. Bloqueio: disponibilidade e volume, não
  estatística.
- **🥈 Entrada passiva / market making** — inalterado, ainda não testado.
- **⛔ EW "at SP" e EW hedgeada** — mortos, não reabrir.
- **⛔ DOB/LOB, condicionado ou não** — mortos (§6.2).


---

# 8. MAPA CONSOLIDADO — todo método já testado neste projeto

Legenda: ⛔ refutado com medição · 🟡 sinal real mas insuficiente · ✅ positivo ·
⚪ não testado. "Hoje" = 2026-09-06.

## A. Mercados de desfecho (apostar em quem vence / coloca)

| método | como foi testado | resultado | veredicto |
|---|---|---|---|
| **WIN — modelo ML vs preço** | encompassing (logit condicional), Flat e Jump | α cai 1,45→0,15; ganho fora da amostra −0,00002 nats (Flat), −0,00046 (Jump) | ⛔ |
| **WIN — LAY banda [13,20]** (prod) | BSP real, sem look-ahead, cluster bootstrap | +8,8% ROI, margem +0,35pp, IC95 [−1418, +3064] cruza zero | ⛔ |
| **WIN — LAY banda [1.5,3]** | in-sample vs out-of-sample | +10,0% → −0,2%; margem +3,70pp → −1,58pp | ⛔ |
| **WIN — LAY 14 bandas (sweep)** | sweep_band_ruin | todas com IC95 cruzando zero; bandas vizinhas com sinal oposto | ⛔ |
| **WIN — LAY [3,5] e [4,7]** | pré-registro, janela [581,360) nunca tocada, Bonferroni | [3,5] −10,56% IC97,5% inteiro <0; [4,7] teto do IC (+7,29%) abaixo do exigido | ⛔ |
| **WIN — veto "guarda-costas"** | winner_avoidance, restrito à banda negociável | empate exato no Flat (+0,00pp); veto evita 0 reds | ⛔ |
| **PLACE — converter win→place** | Harville + Stern(λ), encompassing + simulação, 309.840 cavalos | ROI −4,4% a −10%, IC95 inteiro <0 em 8 de 10 células; teto com look-ahead também perde | ⛔ |
| **Forecast / Tricast / match bets** | não testado | herdam a conversão refutada + dedução de 15–27% | ⛔ por herança |

## B. Trading (fechar posição, sem exposição ao desfecho)

| método | como foi testado | resultado | veredicto |
|---|---|---|---|
| **Pré-corrida: divergência prediz drift** | resíduo por decil de odd, baseline sem mercado, janela HELD | acerto direcional 57,38%, spread Q5−Q1 = 0,2061, IC95 exclui zero | 🟡 **sinal real** |
| **Pré-corrida: economia do drift** | excesso sobre pares da mesma odd + custo | bruto Q5 +5,39%; meia-spread medida 4,35% = **81% do bruto** | ⛔ custo > sinal |
| **Spread real (Smarkets)** | 54 rodadas de cron, 16.569 cotações | odd 4–8 manhã: mediana 8,7% (4 ticks); só 15% do livro tem 2 ticks | — (medição de custo) |
| **Em corrida: back → cashout (DOB)** | **hoje**, `ipmin` de 312.286 runners, k de 0,50 a 0,95 | hit fica **18–23pp abaixo do break-even** em todo alvo; ROI −24% a −36% | ⛔ |
| **Em corrida: lay → back (LOB)** | **hoje**, `ipmax`, m de 1,5 a 5 | ROI −12% a −28% | ⛔ |
| **DOB condicionado (148 células)** | **hoje**, FIT/HELD + cluster bootstrap | **0 células positivas nem no FIT com garimpo livre**; melhor −5,50% | ⛔ |
| **Market making / entrada passiva** | não testado | 82% dos runners negociam abaixo da média da manhã; spread vira receita | ⚪ **único aberto** |
| **Arbitragem entre casas** | não testado | precisa de 2ª fonte de livro ao vivo | ⚪ |

## C. Casa de apostas (odd fixa)

| método | como foi testado | resultado | veredicto |
|---|---|---|---|
| **Each-way "at SP"** | **hoje**, 182.885 runners, sp_decimal real, P/L realizado | −18% a −29%, IC95 inteiro <0 em todo grupo, FIT e HELD | ⛔ |
| **Each-way com hedge na exchange** | **hoje**, lay das 2 pernas no BSP | −25,72% travado; só 1,3% das apostas lucrativas | ⛔ |
| **Each-way, preço de manhã + BOG** | **hoje**, `odds_enriched` (5 casas), 19.832 runners | −9,63% nos termos padrão | ⛔ |
| **Each-way + BOG + 1 VAGA EXTRA** | **hoje**, posição real de chegada, 2 metades disjuntas | **+8,77%, IC95 [6,61, 11,05]**; replicou (+9,61% / +7,97%) | ✅ **mas ver §9** |
| **Rule 4 / não-corredor** | não testado | exige execução em minutos | ⚪ |
| **Matched betting / bônus** | não testado | +EV garantido, não usa modelo | ⚪ |

## D. Pools (tote)

| método | resultado | veredicto |
|---|---|---|
| Placepot / Jackpot / Exacta do tote | dedução 16–27% vs 6,5% da exchange; edge exigiria bater o público em colocação, que o §A refutou | ⛔ por economia |

## E. Trabalho de modelo (não é método de aposta, mas consumiu o projeto)

Loss orientada a LAY (`lay_output`, β=0.5), `layLossAlpha`, blend Benter, baseline
sem mercado, calibração isotônica, multi-task, ListMLE, 74 features com pace:
**todos redistribuem capacidade, nenhum cria informação.** O encompassing test
explica por quê de uma vez.

---

# 9. 🛑 BLOQUEIO DE ACESSO — corrida de cavalos saiu do mercado brasileiro

Pesquisa de 2026-09-06. **O achado do §7.3 é real e é inacessível daqui.**

**O que aconteceu:**

- **bet365:** removeu corridas de cavalos e galgos do Brasil em **01/01/2025**,
  declaradamente por causa da regulamentação brasileira.
- **Betfair Brasil:** removeu o mercado de turfe em **24/09/2025**, do Exchange
  **e** do Sportsbook, sem aviso prévio. O suporte deu respostas contraditórias
  (problema técnico / regulação / remoção permanente).

**Por quê — e é estrutural, não um capricho comercial:** aposta em corrida de
cavalo no Brasil **não está sob a Lei 14.790/2023** (quota fixa, domínios
`.bet.br`, fiscalizada pela SPA/Fazenda). Ela é regida pela **Lei 7.291/1984**,
sob o **MAPA**, e só é lícita "em hipódromos ou nas sedes e dependências de
entidades autorizadas". Ou seja: as licenciadas `.bet.br` **não podem** oferecer
turfe, e por isso todas retiraram o mercado.

**O que sobra legalmente no Brasil:** apostas turfísticas das entidades do
Jockey Club (`apostas.jcb.com.br`, `webturfe.com.br`). São **pari-mutuel** (pool,
odd definida pelo rateio) e sobre **turfe brasileiro**. Isso **não serve** pro
achado: não há odd fixa, não há termos fracionários de each-way, não há BOG e não
há promoção de vaga extra. É outro produto.

**Por que o achado exige justamente o que sumiu:** "vaga extra" é uma **promoção
de casa de apostas** britânica/irlandesa. Exchange não tem — Smarkets e Matchbook
oferecem mercados de win e de place separados, e você monta o each-way na mão;
ninguém roda promoção. A execução clássica (matched betting: back EW na casa com
vaga extra + lay das duas pernas na exchange) exige **conta em casa UK/IRE E conta
em exchange com turfe** — as duas indisponíveis a partir do Brasil.

⚠️ **Sobre usar VPN:** apostar num operador que exclui a sua jurisdição costuma
violar os termos de uso — o desfecho padrão é ganho anulado e conta encerrada na
hora do saque, além de o operador ser não-licenciado no Brasil. Não é um caminho
que valha modelar em cima.

**Consequência para o plano:** o §7.3 continua sendo um achado válido e o único
positivo do projeto. Mas ele é **bloqueado por acesso, não por estatística**.
Antes de investir em registrar quais corridas têm vaga extra (o próximo passo
técnico), a pergunta que decide é: **existe alguma via de acesso legal e estável
a uma casa UK/IRE?** Sem isso, o esforço tem valor de pesquisa, não de receita.

---

# 10. O que o "+8,77%" É — e a simulação diária de banca (2026-09-06)

`src/oneTimeScript/each_way_bankroll_sim.ts`. Mesmo join do §7.3 (odds_enriched
de 5 casas + BOG + posição real de chegada), agora rodado **dia a dia** sobre a
ordem real do calendário, com banca, stake e ruína.

## 10.1 A unidade: é ROI por aposta, não por mês

**+8,77% é ROI por unidade apostada.** Uma aposta each-way são DUAS unidades
(perna de vitória + perna de colocação); o denominador do §7.3 é `2 × n`. Ler:
*pra cada R$100 que passam pela banca, voltam R$108,77*. Não tem tempo dentro
dele — é por aposta, não por mês nem por ano.

**O que transforma isso em retorno no tempo é o GIRO**, e o giro aqui é enorme:

| premissa | apostas/dia | giro/dia (banca 200, stake 5/perna) | lucro esperado/mês |
|---|---:|---:|---:|
| promoção em TODA corrida, aposta em TODO cavalo (o +8,77% literal) | 127,9 | **640% da banca** | R$3.366 |
| promo só sábado ou handicap 16+ | 46,5 | 233% da banca | R$741 |
| ídem + odd [10,50) + máx 2/corrida | 6,6 | 33% da banca | R$227 |

**O motivo de o número parecer absurdo é o giro, não o edge.** Girar 6,4× a banca
por dia a 8,77% dá 56% da banca por dia. É por isso que a pergunta
"mensal ou anual?" não tem resposta sem antes fixar **quantas apostas por dia** —
e é exatamente isso que o §7.3 avisou que não dá pra fixar com os dados atuais.

## 10.2 Onde a significância morre: empilhar filtro

O IC95 do ROI tem que ser recalculado pra CADA universo — não vale herdar o
[6,61, 11,05] da célula "TODOS". Cluster bootstrap por corrida, B=2000:

| universo | n | ROI/unidade | IC95 |
|---|---:|---:|---|
| TODOS (o headline) | 19.832 | +8,77% | [6,61, 11,05] ✅ |
| odd [10,50) | 11.777 | +12,80% | [8,94, 16,86] ✅ |
| odd [10,50), máx 2/corrida | 3.277 | +17,63% | [8,79, 26,85] ✅ |
| **promo = sábado OU hcap 16+** | 6.883 | **+5,31%** | **[1,63, 9,12]** ✅ |
| promo = só handicap 16+ | 3.503 | +3,97% | [−1,30, 9,59] ❌ |
| promo = só sábado | 4.375 | +5,29% | [1,05, 9,78] ✅ |
| **promo + odd [10,50) + máx 2/corrida** | 971 | +11,52% | **[−3,50, 26,61]** ❌ |

- **O filtro de odd e o teto por corrida NÃO quebram nada** — ao contrário, sobem
  o ponto e mantêm o IC fora do zero.
- **Restringir a promoção é o que custa**: o ROI cai de 8,77% para 5,31% e o
  volume cai 3×. Faz sentido — o +8,77% supõe vaga extra onde ela não existe.
- **Empilhar os três zera a amostra** (971) e o IC passa a cruzar zero, ainda que
  o ponto suba pra 11,52%. Ponto alto com IC largo é ruído, não achado.

⚠️ **`PROMO=sat_or_hcap16` é CHUTE.** Ninguém registrou quais corridas de fato
tiveram vaga extra — é o item 1 dos caveats do §7.3, ainda aberto. A regra
"sábado ou handicap 16+" é a aproximação mais defensável que dá pra montar com os
campos existentes, não um fato.

## 10.3 A simulação diária

Config: `PROMO=sat_or_hcap16`, todas as odds, todos os corredores, banca 200,
+1 vaga. Cada aposta consome 2× o stake; nunca se aposta mais do que a banca tem.

**Trajetória histórica (ordem real dos dias), stake fixo 5/perna:**

| mês | dias | apostas | P/L | banca fim |
|---|---:|---:|---:|---:|
| 2026-03 | 4 | 80 | +80 | 280 |
| 2026-04 | 19 | 645 | +689 | 969 |
| 2026-05 | 14 | 768 | +851 | 1.820 |
| 2026-06 | 20 | 1.648 | +1.125 | 2.945 |
| 2026-07 | 14 | 1.109 | +514 | 3.459 |
| 2026-08 | 9 | 693 | **−538** | 2.921 |

4.943 apostas · R$49.430 girados · P/L +2.721 · **ROI realizado 5,50%** ·
banca 200 → 2.921 · pico 3.540 · **max drawdown 77,6%**.

**Bootstrap por DIA (reamostra dias inteiros, preserva a correlação dentro da
corrida e dentro do dia), B=2000:**

| política | mediana final | IC95 | P(ruína) | P(positivo) | max DD mediano |
|---|---:|---|---:|---:|---:|
| stake fixo 5/perna | 2.124 | [1, 5.310] | **6,3%** | 63,4% | 60,3% (p95 99,4%) |
| proporcional 1%/perna | 1.833 | [81, 56.642] | **0,0%** | **76,6%** | 61,8% (p95 83,8%) |

**Leituras:**

1. **O staking proporcional resolve a ruína aqui, e ao contrário do LAY ele é
   executável.** Each-way é BACK: a responsabilidade é o próprio stake, não
   `stake × (odd−1)`. Foi o gargalo que matou a banda [13,20] (§CLAUDE.md) e ele
   não existe neste caminho. Com 1%/perna a ruína vai a zero e P(positivo) sobe
   pra 76,6%.
2. **O drawdown é brutal em qualquer política: ~60% mediano, 84–99% no p95.**
   Isso é consequência direta de apostar azarão — a perna de vitória perde quase
   sempre e o lucro chega em poucos acertos grandes. Quem não aguenta ver a banca
   cair 60% não opera isto.
3. **A trajetória única não é evidência.** O IC95 da banca final vai de 1 a 5.310
   com stake fixo. A config mais filtrada (promo + odd + teto), rodada
   historicamente, **quebrou a banca**: 200 → 3, com 33 apostas. Com n desse
   tamanho, tanto a quebra quanto o 15.711 do cenário irrestrito são ruído.

## 10.4 O que isto NÃO resolve

- **A janela [2026-03-16, 2026-08-18] está agora QUEIMADA** também pra escolha de
  política de stake e de regra de promoção. Qualquer validação futura precisa de
  janela nunca tocada — e `odds_enriched` só começa em 2026-03-16, então **não
  existe janela cega disponível hoje**. Ela só nasce com dado novo.
- **`PROMO=sat_or_hcap16` continua sendo chute** (§10.2). O passo técnico que
  destrava é registrar, ao vivo, quais corridas anunciam vaga extra.
- **O §9 continua valendo:** nada disso é executável do Brasil. A simulação diz
  quanto valeria a estratégia se houvesse acesso — não que haja.

---

# 11. 🔬 FIM DOS CHUTES — coletor de termos reais no ar (2026-09-06)

`scripts/pp_ew_collector.py`, rodando no `bspnode` (cron horário, 06–21 UTC).
**A janela cega do projeto começa em 2026-09-06.** Todas as anteriores estão
queimadas, e `odds_enriched` só existe desde 2026-03-16 — não havia nenhuma
janela limpa disponível. Agora há, e ela só cresce.

## 11.1 Os chutes eram DOIS, e colapsam num só

1. `PROMO=sat_or_hcap16` (§10.2) — qual corrida tem vaga extra.
2. **`termFor()`** — a fração da perna de place. É uma **tabela hardcoded** nos
   três scripts `each_way_*.ts`. Nunca foi medida.

Colapsam porque **a casa não publica "promoção": ela muda os termos anunciados
do mercado.** Registrar os termos anunciados por corrida, todo dia, transforma
"tem vaga extra" de chute em fato observado, e mede a fração de quebra.

## 11.2 Onde os termos NÃO estão (verificado, não suposto)

| fonte | resultado |
|---|---|
| API HR (`horse-racing.p.rapidapi.com`) | chamei a resposta crua: **nenhum campo de each-way**. O schema do Mongo não descarta nada — não vem mesmo |
| theracingapi | só temos o tier **free**; `/racecards/pro` e `/standard` dão **401** |
| Sporting Life (API pública, responde 200) | tem `number_of_placed_rides`, mas é **vagas do tote**, não termos de casa |
| `odds_enriched.url` | **links de afiliado** genéricos, não apontam pra corrida |
| ~20 sites sondados do IP de Londres | Oddschecker, Timeform, BoyleSports, William Hill, gg.co.uk: **403** (Cloudflare). Betfair Sportsbook 403. At The Races 503 |

## 11.3 A fonte: API do próprio front da Paddy Power

Dois endpoints, chave de app pública `_ak=vsd0Rm5ph2sS2uaK`:

```
POST scan-pp…/navigation/facet/v1.0/search    → corridas do dia + winMarketId
POST smp…/fixedodds/readonly/v1/getMarketPrices → termos + preços
```

O mercado devolve exatamente o que faltava:

```
numberOfPlaces: 4                            ← vagas ANUNCIADAS
placeFraction: {numerator:1, denominator:5}  ← fração REAL
guaranteedPriceAvailable: true               ← BOG, por mercado
rule4Deductions: []                          ← método C3 do §1, de graça
linkedMarketId: "1.262018634"                ← mercado na Betfair Exchange
runnerDetails[].selectionId                  ← SELECTION_ID da Betfair
```

**O join com os CSVs de BSP é EXATO** (`selection_id`), não por nome
normalizado. O §7.3 casava por nome e fechava 37% dos runners; aqui é chave
primária. `betfair_market_id` veio preenchido em **37/37** corridas.

⚠️ **As duas rotas dão 403 pra `curl`, pra `requests` E pro `context.request` do
Playwright** — a proteção olha a impressão digital da conexão, não o header. Só
passa `fetch()` executado DENTRO da página. Por isso o coletor abre um browser
mesmo sendo uma API JSON: ele não renderiza nada, só empresta a pilha de rede.
**Não trocar por `requests` achando que simplifica.**

## 11.4 Primeira coleta — e o `termFor()` já caiu

37 corridas UK/IRE, 490 linhas, 2026-09-06 16:03 UTC.

**a) BOG confirmado:** `guaranteedPriceAvailable = true` em **37/37**. A
premissa de BOG universal do §7.3 se sustenta na Paddy Power UK/IRE.

**b) Vaga extra é comum e NÃO é sábado:** 10 de 37 corridas (27%) anunciam mais
vagas que a regra padrão. Hoje é domingo. A regra `sat_or_hcap16` do §10 estava
errada nas duas pontas — não é sábado, e pega handicap bem abaixo de 16
corredores (Wolverhampton 1m1f Hcap, 15 corredores, 4 vagas; Galway 2m7f Hcap
Chs, 13 corredores, 4 vagas).

**c) ⛔ `termFor()` erra a fração em 43% das corridas, sempre pra cima:**

| vagas | hcap | campo≥12 | `termFor()` diz | PP anuncia | corridas |
|---:|---|---|---|---|---:|
| 4 | sim | sim | 1/4 | **1/5** | 6 |
| 5 | sim | sim | 1/4 | **1/5** | 3 |
| 4 | não | sim | 1/4 | **1/5** | 2 |
| 3 | sim | sim | 1/4 | **1/5** | 2 |
| 1 | sim | não | 1/4 | 1/1 (só vitória) | 3 |

Bate em 21/37 (57%). **Toda discrepância é `termFor()` dizendo 1/4 onde a casa
paga 1/5** — e 1/5 rende **20% menos** na perna de place. O erro está inteiro na
direção que **infla** o resultado.

O ramo culpado é `p === 3 → h && fd >= 12 ? 4 : 5`: a regra "handicap grande
paga 1/4 em 3 vagas" não é o que a Paddy Power pratica. Ela paga 1/5 em tudo que
tem 3 ou mais vagas.

**Consequência: o +8,77% do §7.3 e todos os números do §10 estão medidos com a
perna de place superestimada em ~43% das corridas.** Não dá pra dizer ainda
quanto isso come — 37 corridas de um dia não são estimativa —, mas o sinal do
viés é conhecido e é contra nós. **Nenhum número de each-way deste projeto deve
ser citado como válido até ser refeito com termos reais.**

## 11.5 O que o coletor grava

Uma linha por corredor, termos do mercado repetidos. Colunas em
`scripts/pp_ew_collector.py:COLS`. Saída:
`bspnode:~/pp_ew_data/pp_ew_v1_AAAAMMDD.csv`, cron `0 6-21 * * *` UTC.

**Não derivamos "tem vaga extra" na coleta** — depende de tipo de corrida e
tamanho de campo, que vêm do lado Betfair. Grava cru, deriva na análise: é
reversível, o contrário não.

Filtro `--countries GB,IE` (default) é desvio consciente da convenção do
`smarkets_collector` de não filtrar na coleta. Motivo: os CSVs de BSP só cobrem
UK/IRE, então corrida americana nunca poderá ser casada com um desfecho. Dado
que não junta com resultado não é dado. Reversível com `--countries all`.

## 11.6 O que ainda é chute

- **Uma casa só.** Paddy Power não representa o mercado; representa a Paddy
  Power. Termos e promoções variam entre casas — e as outras 5 do
  `odds_enriched` estão atrás de Cloudflare.
- **O histórico continua sem termos.** Este coletor não conserta 2026-03→08; ele
  constrói dado novo daqui pra frente. Refazer o §7.3 com termos reais exige
  esperar acumular corridas.
- **§9 continua valendo:** nada disso é executável do Brasil. A pergunta de
  acesso segue aberta e é ortogonal à coleta.
