// Curva de spread bid-ask MEDIDO, a partir do livro coletado no Smarkets
// (`scripts/smarkets_collector.py` na VM de Londres).
//
// POR QUE EXISTE
//   `drift_economics.ts` mostrou que a tese de trading de drift é decidida
//   pelo custo de execução, não pelo sinal: o líquido do Q5 ia de +2,82% a
//   −4,31% conforme a hipótese de execução, e essa faixa é maior que o próprio
//   sinal (5,39%). Os CSVs de BSP da Betfair NÃO têm bid-ask. Este módulo troca
//   a SUPOSIÇÃO de "1 tick por ponta" pela MEDIÇÃO.
//
// ⚠️ Smarkets tem menos liquidez que a Betfair em corrida UK, logo spread mais
//    largo: é LIMITE SUPERIOR de custo, não estimativa da Betfair.

import fs from "node:fs";
import path from "node:path";

export interface Quote {
	mins: number; // minutos até a largada
	mid: number; // mid em PROBABILIDADE, convertido pra odd
	layExec: number; // odd em que se LAYA agora (cruza o bid)
	backExec: number; // odd em que se BACKA agora (cruza a offer)
	spreadFrac: number; // (lay − back) / mid
	qtyLay: number; // size no melhor lay, em £
	qtyBack: number;
	corrida: string;
	dia: string; // AAAAMMDD, do nome do arquivo
}

// ⚠️ REFEITO 2026-10-06. O filtro já errou DUAS vezes do mesmo jeito: o que a
// lista não previa virava UK/IRE em silêncio. Em 13/09 era o índice do split;
// em 06/10 o `reprodutor` achou que a lista tinha "ger" e os slugs reais usam
// "-de", e que "-ksa" e "-mu" nem estavam nela — 9.308 das 212.373 cotações
// publicadas (117 de 1.089 corridas) eram da Alemanha, da Arábia Saudita e de
// Maurício, com livro quase vazio. A manhã mal mexe; perto da largada a faixa
// 8-13 caía de 6,4% para 4,9%.
//
// Por isso agora são DUAS listas e nenhuma regra por omissão: a pista está em
// UK_IRE, ou tem sufixo de FORA, ou a medição PARA. Pista nova que o Smarkets
// passe a listar não entra em nenhum número sem alguém classificá-la aqui.
//
// As pistas marcadas "vista" apareceram nos dados de 20/08 a 06/10. As outras
// são pistas de UK/IRE ainda não vistas, com o slug presumido: se o Smarkets
// escrever diferente, o erro de "pista desconhecida" avisa.
const UK_IRE = new Set([
	// Grã-Bretanha — vistas
	"ascot",
	"ayr",
	"bangor-on-dee",
	"bath",
	"beverley",
	"brighton",
	"carlisle",
	"cartmel",
	"catterick",
	"chepstow",
	"chester",
	"doncaster",
	"epsom-downs",
	"ffos-las",
	"fontwell",
	"goodwood",
	"hamilton",
	"haydock",
	"hexham",
	"huntingdon",
	"kelso",
	"kempton",
	"leicester",
	"lingfield",
	"market-rasen",
	"musselburgh",
	"newbury",
	"newcastle",
	"newmarket",
	"newton-abbot",
	"nottingham",
	"perth",
	"plumpton",
	"pontefract",
	"redcar",
	"ripon",
	"salisbury",
	"sandown",
	"sedgefield",
	"southwell",
	"stratford",
	"thirsk",
	"uttoxeter",
	"warwick",
	"windsor",
	"wolverhampton",
	"worcester",
	"yarmouth",
	"york",
	// Grã-Bretanha — ainda não vistas (slug presumido)
	"aintree",
	"chelmsford-city",
	"cheltenham",
	"exeter",
	"fakenham",
	"hereford",
	"ludlow",
	"taunton",
	"wetherby",
	"wincanton",
	// Irlanda — vistas
	"ballinrobe",
	"bellewstown",
	"clonmel",
	"cork",
	"curragh",
	"down-royal",
	"downpatrick",
	"dundalk",
	"fairyhouse",
	"galway",
	"gowran-park",
	"kilbeggan",
	"killarney",
	"laytown",
	"leopardstown",
	"listowel",
	"naas",
	"navan",
	"punchestown",
	"roscommon",
	"sligo",
	"wexford",
	// Irlanda — ainda não vistas (slug presumido)
	"limerick",
	"thurles",
	"tipperary",
	"tramore",
]);

// Sufixo de país no fim do slug da pista. Os nove primeiros foram vistos nos
// dados; o resto é o que a lista antiga já trazia.
const FORA = new Set([
	"aus",
	"usa",
	"fra",
	"rsa",
	"jpn",
	"nz",
	"de",
	"ksa",
	"mu",
	"uae",
	"can",
	"hkg",
	"sgp",
	"swe",
	"nor",
	"ger",
	"ity",
	"esp",
	"arg",
	"chi",
	"kor",
	"ind",
	"per",
]);

// ⚠️ CORRIGIDO 2026-09-13. A versão original lia `split("/")[4]`, mas o slug é
// `/sport/horse-racing/<pista>/<ano>/<mm>/<dd>/<hh-mm>` e o split de uma string
// com barra inicial devolve "" em [0] — logo [3] é a pista e [4] é o ANO. Como
// "2026" nunca está em ESTRANGEIROS, o filtro sempre devolvia true e NUNCA
// filtrou nada: 36% das cotações de 2026-08-20 eram de Austrália, EUA e França.
// Consequência: as medições de spread publicadas até aqui (spread_smarkets.ts e
// a curva de custo consumida por drift_economics.ts) estavam infladas por livro
// estrangeiro, mais largo e negociado em horário deslocado.
// Ancorado no segmento seguinte a "horse-racing" para não depender do índice.
export function ehUkIre(slug: string): boolean {
	const partes = slug.split("/");
	const i = partes.indexOf("horse-racing");
	const venue = (i >= 0 ? partes[i + 1] : partes[3]) || "";
	// UK_IRE primeiro: "ffos-las" e "bangor-on-dee" terminam no que parece
	// sufixo, e "warwick" tem homônima australiana que só o sufixo separa.
	if (UK_IRE.has(venue)) return true;
	const j = venue.lastIndexOf("-");
	if (j > 0 && FORA.has(venue.slice(j + 1))) return false;
	throw new Error(
		`pista desconhecida no slug do Smarkets: "${venue}" (${slug}). ` +
			"Classifique-a em UK_IRE ou FORA em smarkets-spread.ts antes de medir.",
	);
}

/** Lê os CSVs do coletor. Aceita os dois esquemas: o v2 nomeia as colunas pela
 *  EXECUÇÃO (`lay_exec_odd`/`back_exec_odd`); o v1 nomeava pelo lado do livro e
 *  com os nomes TROCADOS — `back_odd` do v1 vem dos bids, que é onde se LAYA.
 *  O spread é simétrico, então o v1 segue utilizável desde que lido assim. */
export function loadSmarketsQuotes(
	dir: string,
	// Janela por data do ARQUIVO (AAAAMMDD), inclusiva. Sem ela o número
	// dependia do que havia no diretório no dia em que se rodou — foi assim que
	// a medição de 13/09 ficou sem como ser repetida igual.
	janela: { de?: string; ate?: string } = {},
): {
	quotes: Quote[];
	files: string[];
} {
	const dia = (f: string) => f.match(/(\d{8})\.csv$/)?.[1] ?? "";
	const files = fs
		.readdirSync(dir)
		.filter((f) => f.startsWith("smarkets_book") && f.endsWith(".csv"))
		.filter(
			(f) =>
				(!janela.de || dia(f) >= janela.de) &&
				(!janela.ate || dia(f) <= janela.ate),
		)
		.sort();
	const quotes: Quote[] = [];
	for (const f of files) {
		const linhas = fs
			.readFileSync(path.join(dir, f), "utf-8")
			.trim()
			.split("\n");
		const head = linhas[0].split(",");
		const col = (n: string) => head.indexOf(n);
		const v2 = col("lay_exec_odd") >= 0;
		const iLay = v2 ? col("lay_exec_odd") : col("back_odd");
		const iBack = v2 ? col("back_exec_odd") : col("lay_odd");
		const iQLay = v2 ? col("lay_exec_qty_raw") : col("back_qty_raw");
		const iQBack = v2 ? col("back_exec_qty_raw") : col("lay_qty_raw");
		const iSlug = col("full_slug");
		const iMins = col("mins_to_off");
		const iEv = col("event_id");
		for (const l of linhas.slice(1)) {
			const c = l.split(",");
			if (c.length < head.length) continue;
			if (!ehUkIre(c[iSlug])) continue;
			const layExec = Number(c[iLay]);
			const backExec = Number(c[iBack]);
			// livro cruzado seria arbitragem: ruído instantâneo, não preço.
			if (!(layExec > backExec)) continue;
			const mid = 2 / (1 / layExec + 1 / backExec);
			quotes.push({
				mins: Number(c[iMins]),
				mid,
				layExec,
				backExec,
				spreadFrac: (layExec - backExec) / mid,
				qtyLay: Number(c[iQLay]) / 1e4,
				qtyBack: Number(c[iQBack]) / 1e4,
				corrida: c[iEv],
				dia: dia(f),
			});
		}
	}
	return { quotes, files };
}

const BINS: Array<[number, number]> = [
	[1.5, 3],
	[3, 4],
	[4, 6],
	[6, 8],
	[8, 10],
	[10, 13],
	[13, 16],
	[16, 20],
	[20, 30],
];

export interface SpreadCurve {
	/** spread mediano MEDIDO na faixa da odd, como fração do preço. */
	spreadFrac: (odd: number) => number;
	/** metade do spread = custo de cruzar UMA ponta, fração do preço. */
	halfSpreadFrac: (odd: number) => number;
	/** size MEDIANO no melhor lay (£) na faixa da odd — teto de execução por
	 *  trade sem varrer o livro. É o que limita quanto capital o sinal absorve. */
	sizeLay: (odd: number) => number;
	bins: Array<{
		lo: number;
		hi: number;
		n: number;
		medianPct: number;
		medianSizeLay: number;
	}>;
	nQuotes: number;
	files: string[];
}

/** Constrói a curva odd → spread mediano numa janela de tempo pra largada.
 *  Bin com menos de `minN` cotações herda o bin válido mais próximo — um dia
 *  de coleta não enche as pontas da faixa. */
export function buildSpreadCurve(
	dir: string,
	opts: { minsLo?: number; minsHi?: number; minN?: number } = {},
): SpreadCurve {
	const minsLo = opts.minsLo ?? 240;
	const minsHi = opts.minsHi ?? 360;
	const minN = opts.minN ?? 30;
	const { quotes, files } = loadSmarketsQuotes(dir);
	const janela = quotes.filter((q) => q.mins >= minsLo && q.mins < minsHi);
	const bins = BINS.map(([lo, hi]) => {
		const dentro = janela.filter((q) => q.mid >= lo && q.mid < hi);
		const s = dentro.map((q) => q.spreadFrac).sort((a, b) => a - b);
		const sz = dentro.map((q) => q.qtyLay).sort((a, b) => a - b);
		const med = (a: number[]) =>
			a.length ? a[Math.floor(0.5 * (a.length - 1))] : Number.NaN;
		return {
			lo,
			hi,
			n: s.length,
			medianPct: med(s) * 100,
			medianSizeLay: med(sz),
		};
	});
	const validos = bins.filter((b) => b.n >= minN);
	if (!validos.length)
		throw new Error(
			`sem bin com n>=${minN} em ${dir} (janela ${minsLo}-${minsHi}min)`,
		);
	// bin da odd; se não tem amostra suficiente, herda o válido mais próximo.
	const binDe = (odd: number) => {
		const exato = bins.find((b) => odd >= b.lo && odd < b.hi && b.n >= minN);
		if (exato) return exato;
		// herda o bin válido mais próximo em odd
		let melhor = validos[0];
		let dist = Number.POSITIVE_INFINITY;
		for (const b of validos) {
			const centro = (b.lo + b.hi) / 2;
			const d = Math.abs(odd - centro);
			if (d < dist) {
				dist = d;
				melhor = b;
			}
		}
		return melhor;
	};
	const spreadFrac = (odd: number): number => binDe(odd).medianPct / 100;
	return {
		spreadFrac,
		halfSpreadFrac: (odd) => spreadFrac(odd) / 2,
		sizeLay: (odd) => binDe(odd).medianSizeLay,
		bins,
		nQuotes: janela.length,
		files,
	};
}
