# Pré-registro #2 — o modelo tem edge em banda média?

**Escrito em 2026-08-18, ANTES de medir desfechos na janela definida abaixo.**
Independente do pré-registro #1 (`pre_registro_falsificacao_2026-08-18.md`), que
segue bloqueado pelo geo-block dos CSVs de BSP.

## De onde veio a hipótese

Do mapa de exigências (`src/oneTimeScript/feasibility_map.ts`, rodado hoje), que
calcula quanto ROI/aposta cada combinação (lado × banda × banca) exigiria pra
P(nunca quebrar E terminar positivo) ≥ 80%. **O mapa não olha desfechos** — usa
só a distribuição de odds e a frequência de apostas do mercado, então a escolha
da banda não é seleção de ruído.

Achados que motivam este teste:

- Banca deixa de importar quando a responsabilidade cai abaixo de ~5% dela.
  Em [3,5], ir de banca 200 pra 2000 muda a exigência de 8,5% pra 8,7% — nada.
- **[13,20] exige ~18% de ROI mesmo com banca 2000.** A banda de produção é
  inviável em qualquer banca, não por falta de dinheiro.
- BACK **não** resolve: em [13,20] exige 33,3% com banca 200, pior que LAY
  (31,3%), porque perder 93,5% de 225 apostas/mês sangra a banca mesmo com
  responsabilidade de R$5.
- O piso de exigência (~8-9%) está nas bandas médias, e lá a variância por
  aposta é ~5× menor — o que torna a medição barata.

## As duas células

| # | lado | banda | banca | ROI exigido (mapa) | apostas/mês | lucro mediano |
|---|---|---|---:|---:|---:|---:|
| A | LAY | [3, 5] | 200 | 8,5% | 250 | R$108 |
| B | LAY | [4, 7] | 300 | ~8% | 360 | R$163 |

Ressalva já registrada: os valores do mapa oscilam ±1pp entre bancas na mesma
banda (ruído de Monte Carlo). A conclusão robusta é "bandas até [4,7] exigem
~8-9%", não a ordenação fina entre elas.

## A janela

**[581, 360) dias atrás** — aproximadamente 2025-01-14 → 2025-08-23.

Por que esta e não outra: o sweep de 14 bandas de 2026-08-12 olhou desfechos em
[3,6], [4,8] e [5,10] dentro de [180,0), e o teste out-of-sample daquele dia usou
[360,180). **As duas janelas estão queimadas.** [581,360) é anterior a tudo que
já foi olhado. Tem ~1.800 apostas na banda A, acima das ~1.300 estimadas como
necessárias pra resolver um ROI de ~9%.

⚠️ Limitação registrada de antemão: esta janela é **anterior ao split temporal do
treino** (2025-12-22 Flat / 2026-01-29 Jump), ou seja, é **in-sample pro modelo**.
Isso enviesa a favor do modelo. Consequência pra leitura: um resultado
**negativo** aqui é conclusivo (nem com vantagem de treino funciona); um
resultado **positivo** é apenas permissivo e exigiria confirmação fora de treino.
Não há janela que seja simultaneamente não-queimada e fora de treino — o
histórico limpo acabou.

## Configuração

Igual ao pré-registro #1 salvo onde indicado: modelo de prod dos paths legados
(congelado em 2026-07-03), regra de pick do `claude-generate-picks.ts` com a
banda parametrizada (mesma `combinedScore` de `sweep_band_ruin.ts`), seleção pela
odd da manhã (`morningwap`), liquidação no **BSP real** com a ordem só casando
dentro da banda, stake R$5, comissão 6,5%, Flat + Jump agregados.

## Métrica, teste e correção

- **Métrica:** ROI por aposta = P/L total / (nº apostas × stake).
- **Teste:** cluster bootstrap por corrida, B = 2000.
- **Correção de múltiplas hipóteses:** duas células testadas → intervalos de
  **97,5%** (Bonferroni), não 95%.

## Veredicto — declarado antes

Para cada célula, comparando o IC97,5% do ROI/aposta contra dois marcos: **zero**
e o **ROI exigido** do mapa.

| condição | veredicto |
|---|---|
| limite superior < 0 | **morta** — o modelo perde dinheiro nessa banda |
| IC inclui 0 | **sem edge demonstrável** — mesmo com vantagem de treino |
| limite inferior > 0, mas IC inclui o exigido | **tem edge, insuficiente ou indeterminado** pra meta |
| limite inferior > ROI exigido | **viável** — única condição que autoriza seguir |

Cláusula anti-viés: se **ambas** derem "sem edge demonstrável", o próximo passo
NÃO é testar mais bandas. Já teríamos gasto a última janela limpa do histórico, e
insistir seria exatamente o sweep que produziu os falsos positivos anteriores.
A conclusão nesse caso é que o modelo atual não serve à estratégia, e o caminho
passa a ser o descasamento treino×objetivo, não ajuste de banda.

Expectativa a priori: espero "sem edge demonstrável" nas duas, dado que o sweep
antigo não achou sinal em banda baixa. Um "viável" seria surpresa e, por ser
in-sample, não bastaria sozinho.

---

## RESULTADO (rodado 2026-08-18, `src/oneTimeScript/test_banda_media.ts`)

4.574 corridas na janela, BSP casado em 99,3% (Flat) e 98,6% (Jump).

| célula | apostas | odd média | WR | break-even | margem | ROI | IC97,5% | veredicto |
|---|---:|---:|---:|---:|---:|---:|---|---|
| LAY [3,5] | 1.917 | 3,97 | 72,77% | 76,07% | **−3,30pp** | −10,56% | [−19,37%, −1,60%] | ❌ **morta** |
| LAY [4,7] | 2.766 | 5,46 | 82,00% | 82,68% | −0,68pp | −1,82% | [−11,19%, +7,29%] | ⚠️ sem edge demonstrável |

**As duas falharam.** Leituras que vão além das categorias pré-registradas:

- **[3,5] é perda significativa**, não indeterminação — o IC inteiro fica abaixo
  de zero. E a janela era in-sample, ou seja, favorecia o modelo. Perder com
  vantagem de treino é conclusivo.
- **[4,7] permite descartar o edge exigido**: o limite SUPERIOR do IC (+7,29%)
  fica abaixo dos 8% necessários. Mesmo o melhor cenário compatível com os dados
  é insuficiente.

**Síntese com o que já se sabia** — margem medida por faixa de odd:

| banda | margem |
|---|---:|
| [3,5] | −3,30pp (significativa) |
| [4,7] | −0,68pp |
| [13,20] | +0,35pp (não-significativa) |

O pouco de sinal que existe está concentrado em **odd alta**, exatamente onde a
economia é hostil (exige ~18% de ROI mesmo com banca infinita). Onde a economia
é favorável (~8,5% exigido), o modelo é neutro ou negativo. **O sinal mora onde
não dá pra lucrar com ele.**

Cláusula anti-viés acionada: **não testar mais bandas.** A última janela limpa do
histórico foi gasta aqui.
