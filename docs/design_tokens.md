# Tokens de design — mazetick

Extraídos da direção aprovada em 2026-09-13 (canvas *Extra Places — Three
Directions*, prancheta "Proposta"). Os valores abaixo são os que estão no
desenho, **racionalizados**: onde a maquete tinha três cinzas quase iguais, o
token colapsa para um e a nota diz o que foi colapsado.

**Como usar:** a sessão de construção implementa estes tokens como variáveis CSS
em `:root` e nunca escreve cor, tamanho ou espaçamento literal num componente.

---

## 1. Cor

Um acento só. Tudo o mais é neutro de tom frio-esverdeado — escolhido para não
brigar com o verde e para não parecer papel amarelado.

```css
:root {
  --ground:       #FCFBF8;  /* fundo da página */
  --panel:        #F3F5F0;  /* cartão de "mudou hoje" — único preenchimento */
  --ink:          #171A19;  /* texto principal, régua pesada de seção */
  --ink-muted:    #4B534C;  /* texto de apoio, coluna de tipo de corrida */
  --ink-faint:    #7C867F;  /* rótulos, unidades, carimbo de hora */
  --ink-ghost:    #ADB3A9;  /* valor antigo riscado (4 → 5) */
  --rule:         #EAEBE3;  /* linha entre linhas de tabela */
  --rule-med:     #E3E4DC;  /* divisor de seção, borda de controle */
  --accent:       #1F5E4B;  /* verde: "melhor que o padrão" */
  --accent-hover: #14402F;
}
```

**Colapsados:** `#DDDED6` (borda do toggle) e `#C6C8BE` (tique inativo da linha
do tempo) viram `--rule-med`; `#9AA298` vira `--ink-faint`. A diferença não
sobrevive a uma tela real.

### A regra semântica, que vale mais que os hex

| significado | cor |
|---|---|
| **melhor que o padrão** (mais vagas, upgrade hoje) | `--accent` |
| **igual ao padrão** | `--ink-faint` — nunca cinza "apagado", só discreto |
| valor **anterior** numa mudança | `--ink-ghost` + `line-through` |

⚠️ **Verde não quer dizer "aposte aqui".** Quer dizer "difere do padrão para
cima". A página não recomenda nada — ver regra 1 do `site_handoff.md`.

## 2. Tipografia

Três famílias, três funções. Nenhuma é Inter, Roboto ou Arial.

| papel | família | onde |
|---|---|---|
| display | **Newsreader** 400/500 | manchete, numerais grandes, marca |
| corpo | **Archivo** 400/500/600 | texto, tabela, cartões |
| mono | **IBM Plex Mono** 400/500 | carimbo de hora, rótulo em caixa alta, qualquer número que precise alinhar |

```css
--font-display: "Newsreader", Georgia, serif;
--font-body:    "Archivo", system-ui, sans-serif;
--font-mono:    "IBM Plex Mono", ui-monospace, monospace;
```

### Escala

A maquete tinha 16 tamanhos; abaixo estão os 9 que sobrevivem. Onde arredondei,
a nota diz de quanto.

| token | px | uso |
|---|---:|---|
| `--fs-display-xl` | 52 | numeral da barra lateral (53 corridas, 7 upgrades) |
| `--fs-display-l` | 46 | manchete |
| `--fs-numeral` | 34 | valor novo numa mudança |
| `--fs-numeral-old` | 30 | valor antigo, riscado |
| `--fs-display-s` | 26 | numeral do cabeçalho compacto (era 21 na marca — unificado) |
| `--fs-lead` | 16.5 | parágrafo de abertura |
| `--fs-body` | 14.5 | tabela em modo Full |
| `--fs-body-dense` | 13.5 | tabela em modo Compact |
| `--fs-caption` | 12.5 | nota de rodapé, rótulo de coluna |
| `--fs-label` | 10.5 | mono em caixa alta, `letter-spacing: .11em` |

**Regra sem exceção:** todo número que aparece em coluna usa
`font-variant-numeric: tabular-nums`. Sem isso a tabela treme.

## 3. Espaçamento

Observados: 5, 6, 9, 10, 12, 14, 16, 18, 20, 22, 24, 34, 42, 44. Racionalizados
para uma escala de 4 com dois valores fora dela, deliberadamente:

```css
--sp-1: 4px;   --sp-2: 8px;   --sp-3: 12px;  --sp-4: 16px;
--sp-5: 20px;  --sp-6: 24px;  --sp-8: 32px;  --sp-11: 44px;
--page-x: 56px;                /* respiro lateral da página */
--row-y: 13px;                 /* altura de linha em Full  — fora da escala de propósito */
--row-y-dense: 7px;            /* altura de linha em Compact */
```

`--row-y` fica fora da escala porque altura de linha de tabela é ajustada ao
olho, não ao grid: 12px aperta, 16px espalha.

**Raio e sombra:** `2px` no toggle e **nada mais**. Sem sombra em lugar nenhum.
O único preenchimento é `--panel` nos cartões. Se um elemento precisa de borda,
sombra e raio para se separar do fundo, ele está no lugar errado.

## 4. A alavanca de densidade

Não são dois layouts — é um, com dois estados. O que muda:

| | Full | Compact |
|---|---|---|
| cabeçalho | manchete + parágrafo + 3 cartões | uma linha com contagem + faixa de tempo |
| altura de linha | `--row-y` (13px) | `--row-y-dense` (7px) |
| corpo da tabela | `--fs-body` | `--fs-body-dense` |
| linhas visíveis | 6 | todas |

**Padrão é Full.** O Google indexa o estado inicial, e é ele que o visitante de
primeira viagem vê; a alavanca serve quem volta. A escolha do leitor persiste no
navegador dele (nunca no servidor — é preferência, não dado).

## 5. Em aberto

- **Tema escuro.** A direção "Terminal" mostrou que funciona, e a preferência foi
  pelo claro. Os tokens acima estão nomeados por função justamente para permitir
  um segundo conjunto depois; não há valores escuros definidos ainda.
- **Escala móvel.** As pranchetas são de 1180px. A tabela vai precisar de decisão
  própria no telefone — provavelmente virar lista, não tabela rolando.
