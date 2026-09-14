# theracingapi — o que podemos fazer com o dado, e com que respaldo

Data: 2026-09-14. Este documento existe como **prova**, não como resumo.
O suporte do theracingapi respondeu por e-mail a cinco perguntas que a
sessão de orquestração enviou em 2026-09-13. Eles dizem explicitamente que
**não fazem acordo individual** e que **o ToS é o texto definitivo**. Então
a resposta deles não é contrato — é interpretação. E como o ToS é silencioso
em quase tudo que perguntamos, **este e-mail é a única evidência que temos
sobre os pontos silenciosos.** Por isso está transcrito na íntegra.

## 1. A resposta, verbatim

> Hi Bruno,
>
> Thanks for getting in touch, and for the detail on what you're building. In
> response to your questions:
>
> 1. Yes. There's no restriction tied to how the site is funded, so display
> advertising and bookmaker affiliate links are both fine. The restriction that
> applies across all plans is that bookmakers and sportsbooks themselves are
> prohibited from using the service; linking out to one from your site doesn't
> make you one.
>
> 2. A paid subscription to pages that combine our data with your own derived
> statistics (strike rates, market movement analysis, etc.) is permitted and
> wouldn't count as resale. The line is about what your subscribers receive:
> they're reading your product, not receiving our data as a feed. Resale means
> re-serving our returned values themselves, for example as your own API or a
> bulk export.
>
> 3. Yes, storing API responses in your own database and serving pages from that
> cache rather than calling the API on every pageview is permitted.
>
> 4. We don't have a formal attribution requirement, but a credit line or link
> back is always appreciated if you'd like to include one.
>
> 5. Correct, exposing your own API to third parties so they can pull the
> underlying data through you would count as resale and would not be permitted
> use.
>
> Our Terms of Service are the definitive text:
> https://www.theracingapi.com/terms-of-service
>
> We don't enter into individual licence agreements with users and it's your
> responsibility to ensure your intended use complies with any laws or licensing
> requirements applicable in your jurisdiction or industry.
>
> Anything else, just let us know
>
> Kind regards

## 2. O que o ToS realmente diz (lido em 2026-09-14)

O contrato é curto e traz **duas** proibições duras:

> "The resale of data acquired directly from use of The Racing API service
> without permission is forbidden."

> "The Racing API service is not permitted for use in any commercial or
> operational capacity by betting operators and sportsbooks."

Mais uma cláusula de rescisão: eles podem bloquear a conta por falta de
pagamento ou por descumprimento das regras de uso.

**Sobre cache em banco próprio, páginas derivadas, assinatura paga, atribuição
e propriedade intelectual do dado, o ToS é SILENCIOSO.**

## 3. A conferência — o e-mail contradiz o contrato?

Não. Mas a distinção importa:

| pergunta | o ToS diz? | o e-mail diz | natureza da garantia |
|---|---|---|---|
| 1. anúncio + afiliado | **sim**, pela negativa (proíbe *betting operators*, não quem linka) | liberado | **ancorada no contrato** |
| 2. assinatura sobre páginas derivadas | silente | liberado, "não é revenda" | só o e-mail |
| 3. cache em banco próprio | silente | liberado | só o e-mail |
| 4. atribuição | silente | não exigida | só o e-mail |
| 5. expor API própria | **sim** — é revenda | proibido | **ancorada no contrato** |

As duas respostas que mais importam para o produto (2 e 3) apoiam-se em
silêncio contratual. Isso não as torna frágeis — o ToS proíbe *revenda*, e nem
cache nem página derivada são revenda —, mas significa que **se um dia houver
divergência, este e-mail é o que temos.** Guardar. Se o ToS mudar, reconferir.

Uma nuance que vale registrar: o ToS proíbe revenda **"without permission"**.
Não é vedação absoluta — é vedação sem autorização. Irrelevante hoje (não
queremos revender), relevante se algum dia houver proposta de parceria.

Outra: o ToS ser silencioso sobre propriedade intelectual **não** significa que
não exista direito sobre a base. O *sui generis database right* de UK/UE existe
por lei, independente de contrato. Na prática não muda nada para nós, porque a
nossa postura já é a segura — publicamos **estatística derivada**, não despejo
de dado cru. É exatamente a mesma linha que adotamos com a HR API.

## 4. O que isto libera

1. **O modelo do coletor está limpo.** `scripts/racingapi_collector.py` guarda
   JSONL cru no `bspnode` e o site serviria páginas a partir daí, sem chamar a
   API por pageview. É literalmente o desenho descrito na pergunta 3, e foi
   liberado.
2. **As duas vias de receita estão abertas**: anúncio e afiliado agora, e
   **assinatura paga sobre páginas derivadas** depois. Essa era a dúvida sobre
   o projeto financiar as próprias melhorias — está respondida, e pela via mais
   valiosa: a assinatura não depende de programa de afiliado de terceiro, que
   foi justamente o que fechou do lado da Betfair.
3. **A atribuição é opcional — e vamos dar mesmo assim.** Custa uma linha no
   rodapé e torna óbvio, para qualquer um que olhe, que estamos publicando
   sobre o dado e não revendendo o dado. É seguro barato.

## 5. O que isto PROÍBE, para sempre

⛔ **Nunca expor API pública, feed, export em massa ou download do dado bruto.**
Está no ToS **e** confirmado no e-mail. Vale inclusive para coisas que não
parecem API: um `.json` público que o site não consome, um endpoint "para
parceiros", um botão de "baixar CSV desta tabela".

A fronteira é a da resposta 2, e é boa: **o leitor recebe o nosso produto, não
o dado deles.**

⚠️ Cuidado com um caso que parece inocente: se o site for estático e o build
gerar um JSON que o navegador busca, esse JSON é publicamente acessível.
Enquanto ele contiver **derivado nosso**, tudo bem. Se contiver o payload da
API, vira export em massa acidental. **Decidir isso no desenho da ligação
`bspnode` → página**, não depois.

## 6. O que continua em aberto, e não é com eles

> "it's your responsibility to ensure your intended use complies with any laws
> or licensing requirements applicable in your jurisdiction or industry."

Isso é eles se recusando, corretamente, a opinar sobre lei de publicidade. Fica
como portão separado, **a resolver antes de ligar link de afiliado**, não agora:
publicidade de aposta dirigida ao Reino Unido cai sob o CAP Code e a ASA, com
regras próprias sobre apelo a menores, mensagem de jogo responsável e conteúdo
promocional. O site já nasceu com `/responsible-gambling`, o que ajuda — mas
isso foi instinto, não conformidade verificada.

Enquanto a monetização não ligar, não há exposição.
