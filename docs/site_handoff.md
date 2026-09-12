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

## 3. As quatro páginas do MVP

Escolhidas por exclusividade × busca, não por facilidade de construir.

| rota | a pergunta que responde | fonte |
|---|---|---|
| `/extra-places` | "Quais corridas pagam vaga extra agora, e com que fração?" | coletor próprio da Paddy Power (`pp_ew_v1_*`) |
| `/horse/[id]` | "Como este cavalo negociou nas últimas 10 corridas?" | ⚠️ **bloqueado pela regra 2** enquanto a fonte for Betfair — ver §6 |
| `/movers` | "O que encurtou e o que alongou hoje?" | Smarkets + odds das casas |
| `/research/[slug]` | "Isto que todo mundo repete é verdade?" | os 80 probes de `src/oneTimeScript/` |

**A página que importa mais no começo é `/research`.** É a única que não depende
de feed pago nem de decisão legal pendente, é a que o Google leva mais tempo
para indexar, e é a que dá credibilidade para todo o resto. Cada probe já tem
número e tamanho de amostra — é o conteúdo mais barato e mais original que
temos.

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
