# Auditoria do projeto de ML — o que vira produto, o que é redundante, o que se perdeu

Data: 2026-09-13. Motivo: depois de descobrir que a HR API substitui o rpscrape,
a suspeita de que há redundância no projeto de ML — e, principalmente, de que há
coisa valiosa construída que ficou fora do escopo do site.

As duas suspeitas se confirmaram, e apareceu uma perda que ninguém tinha notado.

## 1. O achado principal: o pipeline de features JÁ é ponto-no-tempo

Era a dúvida que decidia tudo, porque estatística derivada só pode virar página
se for calculada sem look-ahead. Verificado no código:

| onde | corte |
|---|---|
| `fetchHistoricalDataForHorses(..., race.date)` | `.lt("date", beforeDate)` |
| `fetchJockeyTrainerStats(supabase, race.date)` | corte na data da corrida |
| histórico do rpscrape | `.lt("race_date", beforeDate)` |
| `pace.features` | `.filter(r => new Date(r.race_date) < cutoff)` |

⚠️ Uma ressalva de código: em `fetchHistoricalDataForHorses` o corte é
condicional (`if (beforeDate)`), então a correção depende de o chamador passar a
data. Hoje os dois chamadores passam. Qualquer chamador novo que esqueça
introduz look-ahead **em silêncio** — vale tornar o parâmetro obrigatório.

**Consequência:** o "strike rate ponto-no-tempo de jóquei/treinador" que o plano
lista como ativo Tier 2 a construir **já existe e roda em produção**. Não é
trabalho novo; é trabalho de expor.

## 2. Ativos prontos que o escopo do site ignorava

Estes saem do pipeline de ML e são publicáveis como derivado nosso:

| ativo | de onde | por que interessa ao leitor |
|---|---|---|
| **Stats por condição** — pista, distância, terreno, por cavalo | `historical.features` | "este cavalo em terreno mole, nesta distância" com histórico completo, sem janela de 14 dias |
| **Jóquei, treinador e a combinação dos dois** | `relationship.features` + `fetchJockeyTrainerStats` | portais mostram 14 dias; temos a carreira inteira, ponto-no-tempo |
| **Dono e linhagem (garanhão/mãe)** | `relationship.features` | ângulo de criação, raro em portal pequeno |
| **Estilo de corrida E/EP/P/S e pace map** | `comment.converter` + `pace.features` | é o que a Timeform cobra — ver a perda no §4 |
| **Conversores** (distância, peso, terreno, forma, odds) | `converters/` | o site precisa deles de qualquer jeito; já existem e têm teste |
| **Máquina de avaliação** — bootstrap por corrida, simulador, harness, report | `services/ml/eval/` | é o motor de credibilidade do `/research` |
| **80 sondas** | `oneTimeScript/` | pauta editorial pronta, com número e amostra |

## 3. Redundante depois da HR API

- Toda a via de ingestão do rpscrape (`dump_rpscrape`, `rpscrape_ingest`). A HR
  API cobre o mesmo terreno e bate com a realidade (62/62, 36/36, 48/48).
- As 662k linhas de `rpscrape_results` **não** são redundantes: são o histórico
  profundo (2019→2026-07) e continuam valendo. O que morreu é o fluxo.

## 4. ⚠️ A perda que ninguém tinha notado: o estilo de corrida congelou

`comment.converter` deriva E/EP/P/S dos **comentários in-running do Racing
Post**. Esses comentários vinham do rpscrape. O rpscrape morreu, e a HR API
**não tem campo de comentário** (verificado: os campos do corredor são horse,
id_horse, jockey, trainer, age, weight, number, last_ran_days_ago, non_runner,
form, position, distance_beaten, owner, sire, dam, OR, sp, odds).

**Portanto o run-style está congelado em 2026-07-06.** Dá para calcular o estilo
histórico de um cavalo que correu até lá; não dá para classificar corrida nova.

É justamente o ativo que o plano descreve como "Timeform cobra por isso". Antes
de contar com pace map no produto, é preciso ou uma fonte de comentário, ou
derivar estilo de outra coisa (posição de passagem, se alguma fonte der), ou
tirar do escopo.

## 5. O que sai do escopo: "preço justo do modelo"

O plano lista, no Tier 1, "preço justo do modelo vs cada casa" como produto core.
**Recomendo tirar.** O teste de encompassing mostrou que o modelo reproduz o
preço e nada além (α cai de 1,45 para 0,15 competindo com o mercado; ganho fora
da amostra −0,00002 nats). Publicar isso como "preço justo" seria republicar o
preço do mercado com outro nome — sem valor para o leitor e insustentável se
alguém checar.

O que sobra de honesto na mesma prateleira: **comparar as casas entre si** e
contra o preço da exchange. Isso é fato observável, não previsão.

## 6. Ações que esta auditoria gera

1. Tornar `beforeDate` obrigatório em `fetchHistoricalDataForHorses` (§1).
2. Decidir o destino do run-style antes de prometer pace map (§4).
3. Remover "preço justo do modelo" do Tier 1 do plano (§5).
4. Acrescentar ao escopo do site as stats por condição, de jóquei/treinador e de
   linhagem — são ativos prontos, e hoje estão fora das quatro páginas do MVP.

---

# 7. O que passou a fazer sentido agora que o fim mudou

Enquanto o objetivo era apostar, o filtro de toda ideia era "isto prevê o
vencedor?". O que não previa foi descartado — corretamente, para aquele fim.
O filtro agora é outro: **"isto alguém quer ler?"**. E boa parte do que era
inútil para apostar é interessante para o leitor **justamente porque o mercado
já precifica** — a informação é boa, ela só não é lucrativa.

Isto é backlog, não escopo. O MVP continua em quatro páginas. Ranqueado por
valor ÷ custo, com o custo medido em relação ao que já existe.

## 7.1 Barato e alto valor — sai quase de graça do que já temos

| ideia | por que existe agora | de onde sai |
|---|---|---|
| **Calculadoras** — Rule 4, termos de each-way, responsabilidade de LAY, win rate de equilíbrio | são páginas de alta intenção, permanentes e muito linkáveis; a matemática já está escrita e testada, inclusive a fórmula de break-even que o projeto corrigiu (`p = (odd−1)/(odd−1+1−c)`) | `eval/simulator.ts`, `rule4_probe`, coletor PP |
| **As refutações como conteúdo** | eram becos sem saída para apostar; para publicar são o ativo mais defensável que temos. Ninguém publica resultado negativo com 180 mil runners | as 80 sondas |
| **Página de cobertura de dados** | um portal de dados que mostra a própria cobertura (o que tem, de quando, o que falta) constrói confiança de graça | manifestos do backup, coletores |
| **Termos de each-way por casa** — o que a regra clássica erra | medimos que a tabela padrão erra a fração em 44,5% das corridas (510 corridas, zero exceções na direção) | `pp_ew_v1_*` |

## 7.2 Médio custo, e é onde mora a diferenciação

| ideia | por que existe agora |
|---|---|
| **Microestrutura de mercado como página**: quanto o preço anda da manhã à largada por faixa de odd, spread por horário, overround por pista | medimos tudo isso para decidir se dava para negociar. Como leitura, é único: o drift é monotônico no decil de odd, e ninguém publica esse gráfico |
| **Perfis de pista**: viés de raia, distribuição de terreno, tamanho médio de campo, taxa de acerto do favorito por pista e distância | não prevê nada — e é exatamente o tipo de página que um apostador consulta antes de apostar |
| **Curvas de forma de jóquei e treinador ao longo do tempo** | a máquina ponto-no-tempo já existe; falta só plotar |
| **Alerta de vaga extra para o leitor** | construímos alerta (ntfy) para nós; o mesmo mecanismo vira retenção de produto |

## 7.3 O reenquadramento que vale mais que a lista

Enquanto o alvo era lucro, **quinze resultados negativos eram quinze fracassos**.
Com o alvo em publicar, são quinze artigos que ninguém mais tem condição de
escrever — e são a razão pela qual um leitor sério acreditaria no resto do site.

O mesmo vale para a disciplina de contaminação: ela existia para não nos
enganarmos. Publicada, vira o diferencial editorial — somos o portal que diz *o
que se sabia às 10h*, porque fomos obrigados a aprender a diferença.
