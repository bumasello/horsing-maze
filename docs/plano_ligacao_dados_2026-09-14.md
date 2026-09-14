# Ligação `bspnode` → página: como o dado coletado vira `/extra-places` e `/movers`

Data: 2026-09-14. Para a **sessão de construção** executar, e para a de
orquestração preparar o lado do `bspnode`. Complementa `docs/site_handoff.md`,
que continua sendo a fonte das regras invioláveis.

**O problema:** o site está no ar com doze páginas, mas todas se leem uma vez.
As duas que trariam alguém de volta amanhã — `/extra-places` e `/movers` — dão
404. Não falta dado: o coletor da Paddy Power roda de hora em hora e o do
Smarkets a cada 15 minutos, ambos há semanas. Falta o caminho entre o `bspnode`
e a página.

---

## 1. A ideia que barateia tudo

A tentação é sincronizar a cadência: o coletor roda de hora em hora, logo o site
precisaria reconstruir de hora em hora. **Não precisa.**

O nosso produto é "o que se sabia a cada hora do dia". Isso é **uma série
temporal dentro da página**, não uma página que se atualiza a cada hora. Uma
página construída ao meio-dia pode mostrar o histórico completo das 06:00 às
12:00, com carimbo em cada ponto. O carimbo mora no dado, não no deploy.

Consequência: **a cadência de build é escolha de frescor, não requisito de
produto.** Começamos baixo e subimos se houver motivo.

## 2. Arquitetura

O site é estático e construído pela Cloudflare a partir do GitHub. **A máquina
de build da Cloudflare não alcança o `bspnode`** — ele vive na tailnet, sem IP
público útil. Então o dado precisa estar publicamente acessível no momento do
build.

```
bspnode  (coleta, já existe)
   │
   │  1. recorte diário: CSV/JSONL cru → JSON DERIVADO
   ▼
bumasello/mazetick-data  (repo público, só dado)
   │
   │  2. deploy hook: POST na URL da Cloudflare
   ▼
Cloudflare Workers Build
   │
   │  3. prebuild baixa o JSON do repo de dados
   ▼
mazetick.com
```

**Por que um repositório separado, e não commitar direto no `mazetick`:** é o
mesmo raciocínio do backup pull — *quem guarda a cópia é quem inicia a conexão*.
Aqui: **quem publica o site não deve ser a máquina que coleta.** Se o `bspnode`
for comprometido, o estrago fica em "publicou dado errado e disparou builds", e
não em "publicou o que quiser em mazetick.com". Custa um repositório a mais e
uns vinte minutos de configuração.

Se isso se mostrar chato demais na prática, a alternativa aceitável é o
`bspnode` commitar num diretório `data/` do próprio repo do site. É mais simples
e tem raio de dano maior. **Preferir a separada.**

## 3. O contrato de dados

É a única parte que as duas sessões precisam combinar. O resto — layout,
componentes, densidade — é decisão da construção.

### `extra-places.json`

```jsonc
{
  "schema": "extra_places_v1",
  "generated_at": "2026-09-14T12:00:11Z",   // obrigatório: a página mostra
  "source": "Paddy Power public race pages",
  "collection_window_utc": ["06:00", "21:00"],
  "races": [
    {
      "slug": "yarmouth-1618",              // derivado de pista+hora, NÃO o id do fornecedor
      "venue": "Yarmouth",
      "country": "GB",
      "off_utc": "2026-09-15T16:18:00Z",
      "name": "5f Hcap",
      "field_size": 9,
      "each_way": true,
      "terms": { "places": 2, "fraction": [1, 4], "bog": false },
      "standard": { "places": 2, "fraction": [1, 5] },  // a regra clássica
      "differs": true,                       // derivado NOSSO — é a manchete da página
      "history": [                           // O PRODUTO
        { "at": "2026-09-14T06:00Z", "places": 2, "fraction": [1,4], "field_size": 9 },
        { "at": "2026-09-14T10:00Z", "places": 3, "fraction": [1,4], "field_size": 11 }
      ]
    }
  ]
}
```

`history` só registra **mudanças**, não uma entrada por coleta — senão o arquivo
incha com repetição. Se nada mudou o dia inteiro, `history` tem um ponto só, e
isso também é informação.

`differs` é a comparação com a tabela clássica, que medimos errar em **44,5% das
corridas, sempre para cima** (510 corridas, zero exceções). A página mostra o
que a casa anuncia e usa a regra só como referência — nunca o contrário.

### `movers.json`

```jsonc
{
  "schema": "movers_v1",
  "generated_at": "2026-09-14T12:00:11Z",
  "source": "Smarkets public order book",
  "runners": [
    {
      "slug": "ascot-1435",
      "venue": "Ascot",
      "off_utc": "2026-09-14T14:35:00Z",
      "runner": "Nome do Cavalo",
      "first": { "at": "2026-09-14T08:00Z", "mid": 6.2 },
      "latest": { "at": "2026-09-14T12:00Z", "mid": 4.8, "spread_pct": 5.4 },
      "move_pct": -22.6,       // movimento bruto
      "baseline_pct": -8.1,    // movimento TÍPICO para aquele decil de odd
      "excess_pct": -14.5,     // o que sobra — é o único número que significa algo
      "notable": true,
      "history": [ { "at": "...", "mid": 6.2, "spread_pct": 6.1 } ]
    }
  ]
}
```

**`baseline_pct` é a página inteira.** Todo portal lista drifters; o drift é
monotônico no decil de odd (favorito encurta, azarão alonga, sempre), então
"alongou 30%" num azarão é rotina e a mesma variação num favorito é notícia. Sem
a linha de base, a lista é ruído bonito. A linha de base sai da nossa medição de
26 dias, e deve ser recalculada periodicamente, não fixada no código.

## 4. O que NUNCA entra nesses arquivos

Esta seção é a que dá processo se for ignorada. Os CSVs crus contêm **mais do que
podemos publicar**, e o recorte é onde isso se corta.

| coluna do `pp_ew_v1` | sai na página? | por quê |
|---|---|---|
| `win_odds_dec`, `win_odds_num/den`, `ew_odds_dec` | ⛔ **não** | preço da Paddy Power — segurado até haver acordo de afiliado (`site_handoff.md` §3) |
| `betfair_market_id` | ⛔ **não** | identificador da Betfair; a regra 2 é ampla e não há motivo de publicar |
| `win_market_id`, `selection_id` | ⛔ **não** | chave de fornecedor; serve para juntar internamente, não para exibir |
| `venue`, `country_code`, `start_time`, `race_name`, `field_size` | ✅ sim | fato de registro público |
| `num_places`, `place_num/den`, `bog`, `eachway_available` | ✅ sim | fato sobre promoção pública |
| `rule4_deductions` | ✅ sim | fato publicado pela casa |

Do Smarkets pode sair preço: a API é pública e sem autenticação, e a regra 3 do
handoff já a elegeu como a camada de mercado exibível.

Do theracingapi: **só derivado**, nunca o payload. Confirmado por escrito em
2026-09-14 (`docs/licenca_theracingapi_2026-09-14.md`): cache e páginas derivadas
são permitidos, **export em massa é revenda**.

⚠️ **A armadilha específica deste desenho:** num site estático, um JSON gerado no
build é publicamente acessível por URL. Contendo derivado nosso, tudo bem.
Contendo payload de fornecedor, vira export em massa sem ninguém ter decidido
isso. **É por isso que o recorte acontece no `bspnode`, antes de sair de lá** — e
não no site, onde o arquivo cru já teria viajado.

## 5. O produtor, no `bspnode`

Um script novo, `scripts/build_site_data.py`, no mesmo estilo dos coletores:
autocontido, sem dependência do Supabase, falha ruidosamente.

O que faz, por execução:
1. Lê os CSVs **de hoje** de `pp_ew_data/` e `smarkets_data/`.
2. Deriva os dois JSON acima, **descartando as colunas proibidas por lista de
   permissão explícita** — nunca por lista de exclusão. Coluna nova que apareça
   no coletor entra bloqueada por padrão.
3. Escreve em `~/mazetick-data/`, faz `git commit` e `git push`.
4. Dispara o deploy hook da Cloudflare com um `curl -X POST`.
5. Sai com código diferente de zero se qualquer etapa falhar — o watchdog que já
   existe no `mazeserver` (`check_collectors.sh`) ganha uma checagem para isso.

## 6. Cadência e orçamento

Medido em 2026-09-14: a Cloudflare dá **3.000 minutos de build por mês** no plano
gratuito, 1 build simultâneo, timeout de 20 minutos.

Proposta inicial: **quatro builds por dia**, em UTC —

| hora | o que muda |
|---|---|
| 07:00 | cartão do dia já publicado, primeiros termos de each-way |
| 12:00 | meio da tarde de corrida em UK/IRE |
| 16:00 | pico do dia |
| 21:30 | fechamento: o histórico completo do dia |

São 120 builds/mês. Se cada um levar 2 minutos, isso consome **8% da cota**. Há
folga enorme para subir para de hora em hora (480/mês ≈ 32%) se o frescor se
mostrar insuficiente. **Começar baixo e medir o tempo real de build antes de
subir** — é barato descobrir, e caro descobrir tarde.

O limite de 1 build simultâneo importa: com quatro por dia não há fila, com um a
cada 15 minutos haveria.

## 7. Estados vazios, e a honestidade que eles carregam

Regra 5 do handoff: nada inventado, e estado vazio honesto. Aqui isso tem três
casos distintos, e **confundi-los é o erro fácil**:

1. **Não há corrida UK/IRE hoje.** A página diz isso, e diz quando volta.
2. **Há corrida, mas ainda não coletamos** (antes das 06:00 UTC). A página diz a
   hora da última coleta e a da próxima.
3. **O dado está velho porque a coleta quebrou.** ⚠️ Este é o perigoso: ele se
   *parece* com o caso 1 e mente para o leitor. **A página deve mostrar sempre a
   idade do dado**, derivada de `generated_at`, e degradar visivelmente quando
   passar de algumas horas. Não basta o watchdog nos avisar; o leitor precisa
   poder ver que está olhando algo velho.

Isso não é defensivo — é o produto. Um portal cuja tese é "todo número carrega o
instante em que era verdade" não pode ser o portal que mostra dado de ontem como
se fosse de agora.

## 8. Verificação

As dez checagens do `verify.mjs` cobrem o site. Esta fase acrescenta duas, e
ambas valem pela regra 2 do próprio verificador: **provar que disparam.**

- **Checagem 13 — nenhuma coluna proibida no JSON publicado.** Procura por
  `win_odds`, `ew_odds`, `betfair`, `selection_id`, `market_id` em qualquer JSON
  de dados. Testar injetando um campo de preço e vendo o build falhar.
- **Checagem 14 — todo JSON tem `generated_at` e ele parseia como data.** Sem
  isso a página não tem como mostrar idade, e a regra 4 do handoff cai em
  silêncio.

## 9. Ordem de trabalho

**Lado da orquestração (esta sessão):**
1. Criar `bumasello/mazetick-data`, público.
2. Gerar chave de deploy com escrita só nesse repositório e instalar no `bspnode`.
3. Escrever `scripts/build_site_data.py` e o cron.
4. Acrescentar a checagem de frescor ao `check_collectors.sh`.

**Lado da construção:**
5. Consumir os dois JSON no build (prebuild que baixa do repo de dados).
6. Construir `/extra-places` e `/movers` sobre o contrato da §3.
7. Checagens 13 e 14, testadas pela regra 2.
8. Os três estados vazios da §7, com a idade do dado sempre visível.

**Do Bruno:** criar o deploy hook no painel da Cloudflare e me passar a URL — ela
é um segredo de acionamento, então vai por variável de ambiente no `bspnode`, não
para o repositório.

## 10. Fora desta fase, de propósito

- **`/horse/[id]`** — depende das estatísticas por condição do pipeline de ML e
  do histórico do theracingapi. É a terceira página e a mais cara; vem depois.
- **Alerta de vaga extra para o leitor** — o mecanismo existe (ntfy), mas retenção
  sem audiência é otimização prematura.
- **Assinatura paga** — liberada juridicamente em 2026-09-14, mas não se cobra por
  duas páginas que nasceram hoje.
