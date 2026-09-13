# Briefing do site — mazetick.com

**Para quem é este documento:** a sessão que vai CONSTRUIR o site. Ela começa
fria, não enxerga a conversa onde estas decisões foram tomadas, e não deve
precisar. Tudo que ela precisa saber está aqui. Se algo estiver faltando, o
erro é deste documento.

**Divisão de trabalho combinada em 2026-09-12:**
- **Sessão de orquestração** (a que produziu este arquivo): plano, etapas,
  decisões, paredes legais, infra de coleta. Não escreve o site.
- **Sessão de construção**: escreve o site. Lê este documento, executa, e
  devolve o que ficou pronto. Não redecide estratégia — se bater numa decisão
  que não está aqui, para e pergunta.

Última atualização: 2026-09-12.

---

## 1. O que é o mazetick

Portal de dados de corrida de cavalo do Reino Unido e Irlanda. O produto não é
palpite nem previsão: é a **camada de mercado carimbada no tempo** — o que se
sabia a cada hora do dia.

Racing Post, Sporting Life e At The Races publicam cartão, forma e odds, de
graça e melhor que nós. O que ninguém publica é *como aquilo mudou ao longo do
dia*: que termos de each-way a casa anunciava às 10h e às 14h, quanto o livro
estava largo, se a pista mudou desde a declaração das 04h.

**Leitor:** apostador e trader sério de UK/IRE. **O site é em inglês britânico.**
(Os documentos internos, como este, seguem em português.)

## 2. Regras invioláveis

Estas não são preferências. Quebrar qualquer uma destrói o produto ou nos mete
em problema legal.

1. **Não vender nem publicar palpite ("pick"), e não prometer ROI.** Está
   medido que nada que testamos bate o preço de mercado. Vender o contrário
   seria vender ilusão, e a credibilidade do site vem justamente de dizermos
   isso em público.
2. **Não publicar preço derivado da Betfair.** Verificado em 2026-09-12: exibir
   preços deles num site exige a *Odds Publisher Licence*, que exige ser
   afiliado, e o programa de Reino Unido e Irlanda fechou em 01/07/2025. O
   rodapé da própria página de arquivos diz: *"Data on Betfair website(s)
   (including pricing data) is protected by © and database rights. It may not
   be used for any purpose without a licence."* O BSP continua como insumo
   interno de pesquisa; **não vira campo na tela.**
3. **A camada de mercado exibida vem do Smarkets**, cuja API é pública e sem
   autenticação, e que já coletamos.
4. **Todo número na tela carrega o instante em que era verdade.** É o produto.
   Uma tabela sem "as of HH:MM" não é o nosso produto, é o de todo mundo.
5. **Nada de dado inventado, nem de exemplo apresentado como real.** Se a
   página precisa de dado que ainda não temos, ela mostra estado vazio honesto.

## 3. As quatro páginas do MVP — esqueleto de conteúdo

Definido em 2026-09-13. Para cada página: o que aparece, de onde vem cada campo,
e **se podemos publicá-lo**. Essa terceira coluna é a que costuma ser esquecida
e a que dá processo.

### O eixo que decide tudo: campo cru ≠ estatística derivada

| | exemplo | postura |
|---|---|---|
| **campo cru de terceiro** | a odd que a Paddy Power exibe agora, o BSP da Betfair | redistribuição — exige licença ou acordo de afiliado |
| **fato de registro público** | "este cavalo chegou em 3º em Doncaster no dia 15/08" | fato, não obra; publicável |
| **derivado nosso** | "27% de colocação em terreno mole, em 22 corridas, sem look-ahead" | nosso cálculo sobre fato; é o produto |

Quando houver dúvida, **a página se apoia no derivado**. É a mesma escolha da
Timeform: eles não mostram o dado do Racing Post, mostram a nota deles.

---

### `/extra-places` — a página bandeira

**Pergunta:** quais corridas pagam vaga extra agora, e com que fração?

| bloco | campos | fonte | publicável |
|---|---|---|---|
| lista do dia | hora, pista, nome da corrida, nº de corredores | coletor PP + cartão | ✅ |
| termos | vagas oferecidas, fração (1/4, 1/5…), BOG sim/não | coletor PP | ✅ fato sobre promoção pública |
| o que torna "extra" | vagas oferecidas **vs. a regra padrão** para aquele tipo e tamanho de campo | derivado nosso | ✅ |
| histórico do dia | "às 10h eram 3 vagas; às 14h passaram a 4" | coletor PP, carimbado | ✅ **e é o que ninguém publica** |
| preço | odd da casa | coletor PP | ⚠️ segurar até o acordo de afiliado |

**O detalhe que vira autoridade:** medimos que a tabela clássica de termos erra
a fração em **43% das corridas, sempre para cima** (diz 1/4 onde a casa paga
1/5). Então a página não deve dizer "vaga extra" apoiada na regra de livro — ela
mostra **o que a casa anuncia**, e usa a regra só como comparação, dizendo isso.

**Estado vazio honesto:** fora de 06–21 UTC, ou sem corrida UK/IRE, a página diz
a hora da última coleta e quando volta. Nunca inventa.

---

### `/horse/[id]` — forma e condição

**Pergunta:** como este cavalo vai *nesta* pista, *nesta* distância, *neste* terreno?

Redesenhada em 13/09. Era histórico de negociação da Betfair; a licença fechou
esse caminho. O que entrou no lugar é melhor, porque é nosso.

| bloco | campos | fonte | publicável |
|---|---|---|---|
| identificação | nome, idade, sexo, garanhão, mãe, treinador, dono | HR API | ✅ fato de registro |
| linha de forma | data, pista, distância, terreno, classe, corredores, posição, SP, OR | HR API | ✅ como fato, sob demanda da página — **não** como despejo em massa |
| **por condição** | corridas, vitórias, colocações e taxa por terreno / pista / distância | `historical.features` | ✅ derivado, ponto-no-tempo |
| **jóquei e treinador** | taxa do jóquei, do treinador e da dupla, carreira inteira | `relationship.features` | ✅ derivado |
| **linhagem** | desempenho da progênie do garanhão nas mesmas condições | `relationship.features` | ✅ derivado |

**O diferencial em uma frase:** os portais mostram janela de 14 dias porque é o
que o feed deles entrega. Nós mostramos **a carreira inteira, sem look-ahead** —
e dizemos a data de corte em cada número.

⛔ **Fora:** pace map / estilo de corrida. Congelou em 06/07 quando o rpscrape
morreu, porque depende dos comentários do Racing Post e a HR API não os tem.

---

### `/movers` — quem encurtou e quem alongou

**Pergunta:** o que se moveu hoje — e isso significa alguma coisa?

| bloco | campos | fonte | publicável |
|---|---|---|---|
| tabela do dia | cavalo, corrida, preço da manhã, preço agora, variação | livro do Smarkets | ✅ API pública, sem autenticação |
| liquidez | spread e volume no momento | Smarkets | ✅ |
| **contexto** | se aquele movimento é grande **para aquela faixa de odd** | derivado nosso | ✅ |

**Aqui mora a única vantagem real da página.** Todo portal lista drifters. Nós
medimos a linha de base: o drift é **monotônico no decil de odd** — favorito
encurta, azarão alonga, sempre. Então "alongou 30%" num azarão é rotina, e a
mesma variação num favorito é notícia. Sem a linha de base, uma lista de movers
é ruído bonito.

---

### `/research` — a razão para acreditar no resto

**Pergunta:** isto que todo mundo repete é verdade?

Fonte: as 80 sondas. Publicável integralmente — é medição nossa.

Cinco primeiros artigos, escolhidos por interesse × força do número:

1. **Apostar no favorito acerta 33% e perde dinheiro** — 33.508 corridas. Mostra
   por que taxa de acerto não é lucro.
2. **A regra clássica de each-way erra em 43% das corridas** — e sempre para o
   lado que infla o retorno.
3. **O tote paga menos que a exchange nos três produtos** — 0,94 / 0,85 / 0,81.
4. **Dez regras de handicapping contra 180 mil runners** — cada uma já está no
   preço, com erro de meio ponto percentual.
5. **Quanto custa atravessar o spread** — a medição que matou nossa própria
   estratégia de trading.

**A postura editorial:** publicamos resultado negativo com amostra grande. É
conteúdo que ninguém no nicho tem, e é o motivo pelo qual um leitor sério
acreditaria nas outras páginas.

---

### Páginas de suporte (obrigatórias, não opcionais)

Sobre, política de privacidade, aviso de cookies, **18+ com link de jogo
responsável**, contato. São exigência de análise de afiliado e do AdSense, e
condição para ser levado a sério. Custam uma tarde.

### Fora do MVP, no backlog (ver `docs/auditoria_ml_2026-09-13.md` §7)

Calculadoras (Rule 4, each-way, responsabilidade de LAY), perfis de pista,
curvas de forma de jóquei e treinador, microestrutura de mercado, página de
cobertura de dados, alerta de vaga extra por e-mail.

## 4. Restrições técnicas

- **Domínio:** `mazetick.com`, comprado em 2026-09-12, WHOIS privado, 2FA e
  renovação automática ligados. O `.co.uk` fica para novembro.
- **Orçamento até novembro: zero.** Hospedagem em tier gratuito (Cloudflare
  Pages ou Vercel). O site pode ficar no ar sem custo nenhum.
- **Feed licenciado de cartão só em novembro.** `theracingapi`: Free (temos),
  Basic £27,99, Standard £59,99 (odds de 20+ casas), Pro £99,99 (histórico de
  variação de odd). Enquanto isso, o cartão completo **não** pode ser publicado
  — construir contra o tier gratuito e as nossas próprias coletas.
- **Arquitetura de publicação por instantâneo**, nunca consulta ao vivo ao
  banco do laboratório. O site serve o último snapshot; se o `mazeserver` cair,
  o site continua de pé. Isto não é detalhe de performance, é o desenho.
- **Nada de segredo no repositório do site.** Chaves e tokens só em variável de
  ambiente do host.

## 5. O que a sessão de construção NÃO deve fazer

- Não mexer em `src/pipeline/`, `src/services/ml/` nem nos coletores. São o
  laboratório e a coleta; o site não depende deles em tempo real.
- Não consultar o Supabase do `mazeserver` a partir do site.
- Não redecidir estratégia de produto, monetização ou fonte de dados. Se
  aparecer uma decisão que não está neste documento, **parar e perguntar.**
- Não publicar nada que viole a §2.

## 6. Decisões ainda em aberto (para 2026-09-13)

Marcadas como abertas de propósito. Não presuma nenhuma delas.

1. **Direção visual e paleta.** Recomendação de sequência: primeiro o
   esqueleto de conteúdo de cada página (o que aparece, o que o leitor faz),
   **depois** o visual derivado desse conteúdo. Escolher paleta antes de saber
   o que a página mostra produz decoração; as nossas páginas são densas —
   tabelas, carimbo de hora, variação de preço — e o visual tem de servir isso.
2. **Nome do produto na tela.** "mazetick" é o domínio; falta decidir se é
   também a marca exibida, e qual é a linha de apoio.
3. **`/horse/[id]` no MVP?** Depende da regra 2. Ou sai do MVP, ou é
   reconstruída só com Smarkets e coleta própria.
4. **Estrutura de URL e idioma.** Confirmado inglês; falta a convenção de slug.
5. **Catálogo de templates.** O usuário mencionou um catálogo próprio de
   templates. **A sessão de orquestração não o conhece** — precisa ser
   apresentado antes de qualquer decisão de layout.

## 7. Estado da infra em 2026-09-12

Tudo isto já funciona e está verificado. A sessão de construção não precisa
tocar em nada disso, mas deve saber que existe.

| o quê | onde | quando |
|---|---|---|
| termos de each-way (Paddy Power) | `bspnode:~/pp_ew_data` | de hora em hora, 06–21 UTC |
| livro bid-ask (Smarkets) | `bspnode:~/smarkets_data` | a cada 15 min, 08–21 UTC |
| BSP + volume (Betfair) | `bspnode:~/betfair_sp_data` | diário, 02:30 UTC |
| tote (Sporting Life) | `bspnode:~/tote_data` | manual |
| backup verificado | `mazeserver:/mnt/dados/backup/bspnode` | diário, 03:30 local |
| watchdog com alerta | `mazeserver`, ntfy.sh | de hora em hora |

O `bspnode` é uma VM gratuita da Oracle em Londres. A coleta roda de lá porque
a Betfair bloqueia IP brasileiro. **Nenhum destes dados pode ser recoletado** —
é por isso que o backup existe e é verificado por manifesto sha256.

## 8. Contexto que explica as regras

Se a sessão de construção quiser entender *por que* as regras da §2 existem:

- `docs/virada_portal_2026-09-07.md` — a tese do produto e o inventário de ativos
- `docs/mapa_mercados_2026-09-06.md` — por que apostar foi abandonado
- `docs/contaminacao_dados.md` — a disciplina de carimbo de tempo, que aqui
  deixa de ser regra de medição e vira especificação de esquema
- `CLAUDE.md` — infra, esquemas, e o histórico de medições
