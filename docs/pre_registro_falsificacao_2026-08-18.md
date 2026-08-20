# Pré-registro — teste de falsificação em janela cega

**Escrito em 2026-08-18, ANTES de qualquer medição na janela definida abaixo.**
Este documento congela a configuração, a janela, a métrica e o critério de veredicto.
Nada aqui pode ser alterado depois de rodar. Se algo precisar mudar, o teste é
descartado e um novo pré-registro é escrito com nova janela.

## Por que este teste existe (e o que ele NÃO consegue fazer)

O histórico do projeto tem quatro conclusões revertidas por medição melhor: ROI
inflado por odd hardcoded, ROI inflado por look-ahead do SP, `heads_avg`
significativo offline e negativo ao vivo, e o sweep de bandas de odd desmentido
pelo out-of-sample. Todas nasceram de otimizar e medir na mesma janela.

A medição honesta de 2026-08-12 (BSP real, sem look-ahead) deu margem **+0,35pp**
em 1039 apostas, com IC95 do P/L em **[−1418, +3064]** — cruza zero. Para que o
IC95 exclua zero mantendo essa média, o n precisa escalar por (2241/918)² ≈ 6×,
ou seja **~6.200 apostas ≈ 2,9 anos** no volume atual (~5,8 apostas/dia).

**Consequência: provar que a estratégia tem edge é inviável no prazo de novembro.**
Este teste, portanto, **não tenta confirmar** a estratégia. Ele tenta **matá-la**:
verificar se ela é francamente negativa, coisa que uma amostra pequena consegue
detectar. O resultado esperado a priori é "não demonstrável".

## A janela cega

**`race_date` ∈ [2026-07-09, 2026-08-18]** — 41 dias.

Por que esta janela é limpa, em dois sentidos independentes:

1. **O modelo nunca a viu.** Os modelos vivos no bucket
   (`horse_probability_model/claude-ml-model-flat` e `-jump`) foram escritos em
   **2026-07-03** e não foram retreinados desde (verificado nos timestamps do
   storage). Todo dado posterior a 2026-07-03 está fora do treino, fora do split
   de validação e fora de qualquer early stopping.
2. **Nenhuma análise a tocou.** Toda a investigação de 2026-08-12 (eval honesto,
   sweep de 14 bandas, teste out-of-sample, simulações de ruína) rodou no schema
   `hml`, cujas features terminam em **2026-07-08**. O schema `prd` tem dados até
   2026-08-17. O intervalo 07-09 → 08-18 nunca entrou em nenhum sweep.

Janelas queimadas, que **não** podem ser usadas: [180,0) e [360,180) contados de
2026-08-12 — ambas serviram de base pra seleção de banda.

## A configuração — UMA, fixa

| item | valor |
|---|---|
| modelo | prod do bucket, path legado `horse_probability_model/claude-ml-model-{flat,jump}` (namespaces `prd/` e `hml/` estão vazios) |
| schema | `DATA_SCHEMA=prd OUTPUT_SCHEMA=prd` |
| regra de pick | `calculateCombinedScore` / `calculateLayValueIndex` de `claude-generate-picks.ts`, sem alteração — top-3 por combined_score, cascata pick1→2→3 pulando `non_runner` |
| banda de odd | **[13, 20]** (`MIN_ODD_THRESHOLD` / `MAX_ODD_THRESHOLD` atuais, intocados) |
| odd de seleção | `morningwap` do CSV da Betfair (odd da manhã, conhecida pré-corrida) |
| odd de liquidação | **BSP real**; sem BSP, a aposta é **descartada** (não usar fallback `sp_decimal`) |
| stake | 10 (mesma escala da medição de 12/08, pra comparabilidade direta) |
| comissão | 6,5% sobre ganhos (`COMMISSION_RATE` default) |
| grupos | Flat e Jump **agregados** — este é o teste primário |

**Uma única comparação.** Sem sweep de banda, sem seleção de modelo, sem ajuste
de stake, sem escolha de subconjunto. Qualquer corte adicional (Flat separado,
Jump separado) é **descritivo, não decisório**, e está declarado aqui como
secundário justamente pra não virar seleção disfarçada.

## A métrica e o teste

- **Métrica primária:** P/L total na janela, com bootstrap **cluster por corrida**,
  B = 2000, IC95 percentil. Mesmo procedimento de `bootstrap_bsp_vs_zero.ts`.
- **Métrica de apoio:** margem = WR observada − WR de break-even (em pp), e
  número de apostas.

## O critério de veredicto — declarado antes

| condição no IC95 do P/L | veredicto | consequência pra novembro |
|---|---|---|
| **limite superior < 0** | **ESTRATÉGIA MORTA** | não apostar em novembro. Encerrado. |
| **IC95 cruza zero** | **NÃO DEMONSTRÁVEL** | resposta default = não apostar R$200 nessa estratégia; o caminho é banca maior, outro mercado, ou trocar a loss |
| **limite inferior > 0** | **SOBREVIVE** | promissor, **não provado** — a potência aqui é baixa demais pra confirmar. Não autoriza apostar sozinho. |

Cláusula anti-viés: **"não demonstrável" é o resultado esperado e não autoriza
rodar mais nada.** Se o veredicto for "não demonstrável", o próximo passo NÃO é
procurar um corte que passe — é aceitar que R$200 não é banca viável pra esta
estratégia. Um veredicto "sobrevive" também não autoriza apostar, pelo mesmo
motivo de potência.

Registro de expectativa a priori: espero **não demonstrável**, com algo entre 200
e 260 apostas.

## Ressalva de potência, registrada antes de olhar

41 dias a ~5,8 apostas/dia ≈ 240 apostas — cerca de **1/4** da amostra de 12/08 e
**1/26** do necessário pra detectar o edge medido. O IC95 vai ser largo. Isso é
esperado e não é motivo pra estender, cortar ou reprocessar a janela depois de
ver o resultado. A janela pode crescer com o tempo (novos dias entram em `prd`),
mas **cada releitura futura é um novo pré-registro**, não uma continuação desta.

## Pendência de execução — BLOQUEADO (verificado 2026-08-18)

Os CSVs de BSP da Betfair no disco cobrem 2024-01-01 → **2026-07-12** (mesmos
1827 arquivos em `/home/maze/dev/betfair_sp_data` e em
`mazeserver:/home/mazedev/betfair_sp_data`). Faltam ~71 arquivos (uk + ire,
2026-07-13 → 2026-08-17) para cobrir a janela.

**A fonte está inacessível a partir do Brasil.** Diagnóstico feito em 2026-08-18:

1. Da máquina de dev (WSL), `promo.betfair.com` é interceptado por **Cisco
   Umbrella** e devolve **HTTP 403** com redirect pra `block.opendns.com`
   (bloqueio por categoria — gambling). O erro de certificado inicial
   (`unable to get local issuer certificate`) era sintoma disso: o certificado
   apresentado é emitido por `Cisco Umbrella Secondary SubCA`, não pela Betfair.
2. Do `mazeserver` (sem Umbrella), a requisição passa mas a Betfair devolve
   **HTTP 302** redirecionando pra `promo.betfair.bet.br` — o domínio da operação
   regulada brasileira. **Esse host não resolve** (NXDOMAIN em 1.1.1.1 e 8.8.8.8),
   embora `betfair.bet.br` resolva. O redirect está quebrado.
3. O 302 atinge **todas** as datas, inclusive as já baixadas (testado 01/07,
   12/07, 13/07, 01/08). Ou seja, o corte em 2026-07-12 **não é fim de cobertura**
   — é a data em que o geo-redirect entrou no ar e o download parou de funcionar.

Consequência: o teste não pode rodar até que o acesso seja restabelecido. Rodar
com fallback `sp_decimal` continua **proibido por este pré-registro** — foi
exatamente a aproximação que produziu os ROIs inflados.

Nenhum dado de resultado da janela cega foi consultado até aqui, então este
pré-registro segue válido e não precisa ser reescrito quando o acesso voltar.


---

## RESULTADO (rodado 2026-08-19, `src/oneTimeScript/run_preregistro_1.ts`)

Bloqueio resolvido no mesmo dia: VM Oracle Always Free em uk-london-1 (fora do
geo-bloqueio) baixou os 73 CSVs faltantes. Cobertura de BSP agora vai até
2026-08-18, e o join na janela foi **100%** — zero apostas descartadas por falta
de BSP, então o fallback proibido nunca precisou ser cogitado.

### Desvio de configuração, registrado

O pré-registro especificava `DATA_SCHEMA=prd OUTPUT_SCHEMA=prd`. **A parte
`DATA_SCHEMA=prd` estava factualmente errada**: `prd.race_horses_hr_enriched`
não existe. A medição rodou com `DATA_SCHEMA=hml OUTPUT_SCHEMA=prd`.

Por que isso não é grau de liberdade: cada tabela existe em **um único** schema
— `race_horses_hr_enriched` só em `hml` (347.334 linhas), e
`training_enriched_horse_features` da janela cega só em `prd` (4.569 linhas na
janela; `hml` tem zero, para em 2026-07-08). Não havia escolha entre dois
conjuntos de dados, logo não há seleção. É a topologia default já descrita no
CLAUDE.md ("ingestão vive em hml, ML escreve em prd"); o erro estava no
documento, não na execução.

### Números

| recorte | corridas | apostas | reds | odd média | WR | break-even | margem | P/L | ROI/aposta | IC95 do P/L |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| **agregado (primário)** | 320 | 190 | 16 | 16,51 | 91,58% | 94,31% | **−2,73pp** | **−848** | −44,64% | **[−2222, +352]** |
| Flat (descritivo) | 231 | 140 | 11 | 16,46 | 92,14% | 94,30% | −2,15pp | −444 | −31,72% | [−1553, +491] |
| Jump (descritivo) | 89 | 50 | 5 | 16,65 | 90,00% | 94,36% | −4,36pp | −404 | −80,80% | [−1247, +240] |

### Veredicto: ⚠️ NÃO DEMONSTRÁVEL

O IC95 do P/L agregado é **[−2222, +352]** e cruza zero. Pela tabela de critérios
congelada antes da medição, o veredicto é **não demonstrável** — exatamente o
resultado registrado como esperado a priori, e com 190 apostas contra as 200–260
previstas.

**Consequência declarada antes, e mantida: não apostar R$200 nesta estratégia
em novembro.** A cláusula anti-viés está acionada: o próximo passo **não** é
procurar um corte que passe.

### Leitura, sem extrapolar

O ponto estimado piorou em relação à medição de 2026-08-12 (margem +0,35pp →
−2,73pp; ROI +8,8% → −44,6%), e o sinal agora é negativo nos dois grupos. Mas
**o IC95 continua cruzando zero**, então a diferença entre as duas janelas não é
distinguível de ruído — não se pode afirmar "piorou", só que não há evidência de
edge. A potência é a ressalva já registrada: 190 apostas é ~1/32 das ~6.200
necessárias pra resolver um edge desse tamanho.

O que **é** novo e não depende de significância: a estratégia teve 41 dias fora
da amostra do modelo, e não produziu lucro em nenhum recorte. Somado ao
encompassing test (que fechou Flat e Jump) e ao pré-registro #2 (bandas médias
mortas), não sobrou hipótese viva no eixo "apostar no desfecho".

A única frente positiva do projeto continua sendo o **drift direcional** — que é
tese de trading, não de aposta, e tem pré-registro próprio a escrever.
