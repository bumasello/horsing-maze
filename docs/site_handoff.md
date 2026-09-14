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

Última atualização: 2026-09-13 (construção: §6c).

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
6. **Nunca expor o dado bruto de terceiro — nem como API, nem como arquivo.**
   Confirmado com o theracingapi em 2026-09-14 (`docs/licenca_theracingapi_2026-09-14.md`,
   com a resposta transcrita na íntegra): páginas derivadas e cache em banco
   próprio são permitidos, inclusive sob assinatura paga; **revenda não é**, e
   revenda inclui "expor a sua própria API para terceiros" e "export em massa".
   Vale para o que não parece API: um `.json` público que o site não consome, um
   endpoint "para parceiros", um botão de baixar CSV da tabela.
   ⚠️ **O caso traiçoeiro é o site estático:** se o build gerar um JSON que o
   navegador busca, esse arquivo é publicamente acessível. Contendo **derivado
   nosso**, tudo bem; contendo o payload da API, vira export acidental. Isto
   precisa ser decidido no desenho da ligação `bspnode` → página, não depois.
   A mesma postura vale para a HR API, que é mais restritiva ainda.
7. **Creditar as fontes no rodapé, mesmo sem obrigação.** O theracingapi não
   exige atribuição. Damos assim mesmo: custa uma linha e torna óbvio para
   qualquer um que olhe que publicamos *sobre* o dado, não *o* dado.

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
a fração em **44,5% das corridas, e toda divergência é para cima** (diz 1/4
onde a casa paga 1/5). São 510 corridas em 8 dias, com **zero exceções**. Então a página não deve dizer "vaga extra" apoiada na regra de livro — ela
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
2. **A regra clássica de each-way erra em 44,5% das corridas** — 510 corridas,
   227 divergências, e todas para o lado que infla o retorno. Zero exceções.
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

## 6. Decisões — resolvidas em 2026-09-13

1. **Direção visual e paleta: FECHADA.** Ver `docs/design_tokens.md` — cor,
   tipografia, escala de espaçamento e a regra semântica, todos extraídos da
   direção aprovada. O canvas com as pranchetas fica em
   *Extra Places — Three Directions* (artifact do usuário); os arquivos-fonte
   estão em `design/*.dc.html` e toda alteração re-semeia a partir deles.
   **Não reabrir sem pedido.**
2. **Nome na tela:** `mazetick`, em caixa baixa, em Newsreader. Domínio
   `mazetick.com`.
3. **`/horse/[id]` no MVP: SIM**, redesenhada — ver §3.
4. **Idioma:** inglês britânico. Convenção de slug ainda aberta; decidir na
   construção e registrar aqui.
5. **Catálogo de templates: não existia, foi criado.** São as pranchetas do
   canvas: cabeçalho, tabela densa, cartão de mudança, faixa de tempo, rótulo
   com carimbo de hora, estado vazio.

### A alavanca de densidade

A página tem um estado **Full** e um **Compact** — não são dois layouts, é um com
duas densidades (especificação em `design_tokens.md` §4). Padrão é Full, porque
o Google indexa o estado inicial. A preferência do leitor persiste no navegador
dele, nunca no servidor.

## 6b. Ordem de trabalho sugerida para a construção

Não é ordem de importância, é ordem de dependência e de relógio:

1. **`/research` primeiro.** Não depende de feed pago, de decisão legal pendente
   nem de coletor — só de texto que já existe nas 80 sondas. E é a página cujo
   relógio (indexação) é o único que dinheiro nenhum acelera depois.
2. **Páginas de suporte** (sobre, privacidade, 18+, contato). Uma tarde, e são
   pré-requisito de inscrição em afiliado e AdSense.
3. **`/extra-places`.** A bandeira, mas precisa da tubulação de dados do coletor
   PP até a página. Fazer depois que o site já existir de pé.
4. **`/movers` e `/horse/[id]`** por último — dependem do Smarkets e das stats
   ponto-no-tempo, que exigem o banco canônico da Etapa 2.

## 6c. Decisões tomadas NA CONSTRUÇÃO (2026-09-13)

A §6.4 mandava decidir a convenção de slug na construção e registrar aqui. Estas
são todas as decisões que a construção fechou, para que a próxima sessão fria
não as reabra.

| decisão | escolha |
|---|---|
| **repo do site** | separado: `/home/maze/dev/node/mazetick`, `main`, sem remote ainda. O `horsing-maze` segue sendo só o laboratório. |
| **stack** | Astro 7, `output: 'static'`. Zero JS de aplicação; o único script próprio é o inline da densidade. |
| **hospedagem** | **Cloudflare Pages**, e a §4 deixava isto em aberto. O plano Hobby da Vercel **proíbe uso comercial** e a lista de exemplos nomeia literalmente *"Affiliate linking is the primary purpose of the site"* e *"the inclusion of advertisements, including but not limited to online advertising platforms like Google AdSense"* — os dois planos de receita do mazetick. Verificado na fonte (`vercel.com/docs/limits/fair-use-guidelines`, atualizada 2026-07-29), não de memória. |
| **slug** | kebab-case, inglês, sem data: `/research/backing-the-favourite`. |
| **analytics** | **Cloudflare Web Analytics**: cookieless, sem fingerprint, sem identificador persistente. Existe porque os critérios de morte do plano são expressos em sessões/mês, e critério que não dá para apurar é decoração. Token em `PUBLIC_CF_BEACON_TOKEN`; o beacon vai explícito no `BaseLayout` em vez de injetado pelo painel, para ser greppável e conferível contra a política. |
| **fontes** | self-hosted (`@fontsource`). Nenhuma requisição ao Google Fonts, nenhum IP de leitor europeu entregue a terceiro por causa de tipografia — e a política de privacidade fica curta e verdadeira. |
| **móvel** | abaixo de 720px a tabela densa **vira lista**, não tabela rolando. Fecha o item em aberto de `design_tokens.md` §5. |
| **canônica** | `build.format: 'file'` faz o pathname sair com `.html`; a canônica é normalizada para bater com o sitemap. Sem isso a página competiria consigo mesma no índice. |

**A regra 4 virou condição de build.** O schema Zod em `src/content.config.ts`
torna `sample`, `window`, `method` e `measured` obrigatórios, mais pelo menos um
item em `limits` ("o que o número NÃO diz"). Um artigo de pesquisa sem amostra
declarada **não compila**. É a regra 4 deixando de ser boa intenção.

### Estado em 2026-09-13

**Os itens 1 e 2 da §6b estão FEITOS.** 13 páginas: `/`, `/research`, os cinco
artigos, `/about`, `/privacy`, `/cookies`, `/responsible-gambling`, `/contact`,
`404`.

Os cinco artigos da §3 estão escritos, com a voz aprovada na revisão do
primeiro: registro de seção de métodos, número antes de adjetivo, amostra
sempre visível, e "o que o número NÃO diz" no corpo. Regra editorial registrada
na revisão: **a abertura com citação folclórica é usada uma vez só** na série,
senão vira fórmula e o registro escorrega para blog.

**Os cinco publicam.** O do spread chegou a ser segurado por estar medido em um
dia só, e a remedição encontrou uma causa diferente e pior: **o filtro UK/IRE
nunca filtrou** (`slug.split("/")[4]` era o ANO, não a pista — 36% das cotações
eram AUS/USA/FRA). Corrigido em `1cf7e69`, com teste de regressão verificado
falhando na versão antiga.

O artigo foi reescrito, não remendado, e **a história ficou melhor do que era**:
deixou de ser "medimos o spread" e passou a ser "agimos sobre um número, o
verificamos, e ele estava errado por um índice de array". O título mudou de
*"the strategy it killed"* para *"Crossing the spread costs 7.1%, and our first
measurement was wrong"*, porque em 65% o kill switch de >80% não dispara: o
custo deixou de ser o que matou a estratégia. Ela segue fechada por outro
motivo — o sinal foi medido em janela queimada —, e o artigo tem seção própria
dizendo que **isto não reabre nada**: remover uma razão de fechar não é uma
razão de abrir.

⚠️ **Sem número de P/L no artigo.** `drift_economics.ts` consome a mesma curva e
herdou a contaminação; os cenários de líquido foram **retirados, não
corrigidos**. Publicar custo corrigido ao lado de lucro não corrigido seria pior
que não publicar.

⚠️ **E uma terceira, cometida no próprio título do artigo sobre molduras
enganosas:** ele saiu como *"Crossing the spread costs 7.1%"*. 7,1% é a
**largura** do book; cruzar custa **meia** spread — 3,53% —, e é o 3,53% que
produz os 65%. Com 7,1% no título, a conta contra o sinal bruto de 5,39% daria
132% de custo, quase o que a versão contaminada dizia. **O número estava certo e
a moldura mentia** — exatamente o que o artigo denuncia. Corrigido para
*"Crossing the spread costs 3.5%"*, com a distinção largura-vs-custo explícita
no corpo e nos cabeçalhos das tabelas.

Duas lições que valem além do artigo, e a segunda é minha:

1. **A falha que se sabe nomear não é automaticamente a falha que se tem.** O
   instinto de segurar por "um dia não é amostra" estava certo e o diagnóstico
   estava errado. Publicar com mais dias não teria consertado o número.
2. **O sintoma estava no rascunho, apresentado como achado.** O texto dizia
   "note that the book does not tighten through the day" — e livro não alarga
   até a largada. Era o artefato de misturar três continentes, anunciado pela
   própria tabela. Achar algo surpreendente não é descobrir algo: a primeira
   pergunta é se o instrumento está quebrado.

Os números dos cinco foram conferidos contra as fontes um a um — 33.508, 510,
343, 179.990 e agora 212.373.

O veredicto de cada artigo descreve o destino da **afirmação testada**, não a
qualidade do achado: "Refuted" / "Held up" / "Inconclusive". Os cinco são
Refuted — é a postura editorial da §3 funcionando.

### ⚙️ Verificação virou código — e as duas regras que a governam

`scripts/verify.mjs` roda dentro do `npm run build` e **falha com exit 1**.
Nove checagens: regra 2 (sem Betfair/BSP no HTML), espaçamento em volta de `<a>`
inline, `data-density` inicial, `lang`, canônica sem `.html`, canônicas ⊆
sitemap, links internos, sem script externo além do beacon, sem literal de cor.

**Regra 1 — toda checagem varre TODAS as páginas geradas, nunca uma amostra e
nunca uma região.** Nasceu de um bug que a lista manual não pegava: o compilador
do Astro apara a quebra de linha antes de uma tag inline em vez de virar espaço,
e o rodapé renderizava "fromBeGambleAwareandGamCare" nas 9 páginas. A lista
checava "links do rodapé: nenhum 404" e passava, porque os `href` estavam
certos — o que quebrou foi o texto ao redor deles. E a inspeção do artigo varreu
só o `<main>`, deixando o rodapé fora do escopo. **Escopo de verificação é onde
este projeto mais escorrega.**

**Regra 2 — um verificador que nunca falhou não foi verificado.** Toda checagem
nova tem de ser testada contra a regressão que a motivou: quebrar de propósito,
ver o build falhar, restaurar, ver passar. Feito para o bug de espaçamento e
para a checagem 10, e inclui conferir que o código de saída propaga — um script
que imprime "FALHOU" e devolve 0 é decoração.

**Onde a verificação olha, conferido e não suposto:** 9 das 10 checagens leem
`dist/`. Só a **9** lê `src/`, e deve continuar lendo — ela vigia a *intenção*
("nenhum componente escreve cor literal"), que é uma afirmação sobre o fonte.
Afirmação sobre a PÁGINA (cor, espaçamento, link, meta, rota) pertence ao
artefato; **fonte é intenção, `dist/` é o que o leitor recebe.**

A checagem **10** cobre o artefato servido e varre **HTML e bundle CSS**, com a
lista de cores permitidas derivada de `tokens.css`. Ela nasceu do realce de
sintaxe do Astro, que injetava `background-color:#24292e` direto no HTML — onde
a 9 não tinha como ver (o realce foi desligado; os blocos de código aqui são
caminhos e comandos). E foi ampliada para o CSS porque cor também entra pelo
bundle, por `<style>` de componente, dependência ou integração, onde nem a 9 nem
uma checagem só de HTML a veriam.

Esta é a regra que o projeto aprendeu **errando três vezes em dois dias**, e vale
muito além do site: é a mesma disciplina do pré-registro, aplicada a código em
vez de a medição.

**Pendente de aval do dono** (envolve contas dele, não foi executado): criar o
repo no GitHub, ligar o Cloudflare Pages, apontar o domínio, e gerar o token do
Web Analytics. Passos no `README.md` do repo novo.

**Não verificado:** layout e densidade no navegador. O Chromium do Playwright
exige `libasound2` e o sudo pede senha; nenhum pacote de sistema foi instalado.
A verificação estrutural passa inteira, mas o visual continua por conferir.

**Próximo passo da §6b: item 3, `/extra-places`** — precisa da tubulação do
coletor PP até a página, e é a primeira vez que a arquitetura por instantâneo
sai do papel.

✅ **Lacuna fechada no mesmo dia.** Os requisitos de SEO e os critérios de morte
tinham chegado por conversa e não estavam em arquivo nenhum — uma sessão de
construção fria não os encontraria, e não encontrou. Entraram na §3 e na §9
enquanto esta entrega era escrita. Os três estão implementados: sitemap diário,
canônica absoluta normalizada e JSON-LD; e o analytics cookieless existe
justamente para que os critérios da §9 sejam apuráveis.

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

## 8. SEO técnico — requisito de fundação, não de polimento

Acrescentado em 2026-09-13 depois que a sessão de construção apontou a falta.
Este parágrafo existia numa versão anterior da §3 e **foi apagado por engano**
na reescrita do esqueleto de conteúdo; a sessão de construção o reconstruiu de
memória da orquestração, o que não deveria ter sido necessário.

Entra junto com as páginas, porque é agora que custa barato:

- **Sitemap** gerado no build, `changefreq: daily`, e `robots.txt` apontando
  para ele.
- **Canônica absoluta**, derivada da configuração do site — **nunca** da URL da
  requisição. O domínio de pré-visualização da hospedagem geraria canônica
  própria e competiria com a produção no índice.
- **Dados estruturados** (JSON-LD): `WebSite` e `Organization` no layout base;
  `Article` nos artigos, com as datas vindas **do mesmo frontmatter** que
  alimenta o bloco de método na tela — uma fonte só, para marcação e página não
  poderem discordar.
- **`lang="en-GB"`**.
- **URLs que sobrevivem ao arquivamento**: a corrida de ontem continua valendo
  como página. Slug sem data, `kebab-case`, em inglês.

## 9. Critérios de morte — escritos antes, porque depois a gente racionaliza

Também acrescentado em 2026-09-13. Viviam só no documento de plano (um artifact),
fora do repositório — uma sessão fria não os encontraria.

Este projeto já reverteu conclusão cinco vezes, sempre porque um número bom não
foi questionado a tempo. A mesma disciplina vale para o produto; a diferença é
que aqui o autoengano custa meses.

| momento | se acontecer isto | então |
|---|---|---|
| 90 dias no ar | menos de 3.000 sessões orgânicas/mês | o SEO não pegou. Parar de construir e investigar |
| 120 dias no ar | mais de 5.000 cliques e zero conversão de afiliado | o formato não converte; assinatura e anúncio não salvam funil que não fecha |
| 6 meses | custo > receita sem tráfego crescendo | encerrar a parte paga, manter o que roda de graça |
| qualquer momento | alguém pedir "vende os picks" | não. Não temos edge, sabemos que não temos, e vender isso queima a única coisa que nos diferencia |

**Consequência prática, e é o que obriga a ter analytics:** dois destes critérios
são medidos em sessões e cliques. Sem medição, eles não são apuráveis — e
critério que não se apura é decoração.

### Regra de gatilho para gastar

Nenhum tier pago sai do bolso antes de a receita cobri-lo:

- **theracingapi Basic** (~R$196/mês): só depois de **dois meses seguidos com
  receita ≥ R$400**.
- **theracingapi Standard** (~R$420/mês): só depois de **dois meses seguidos com
  ≥ R$1.200**, e só se a página de comparação existir.
