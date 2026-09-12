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
}

// Sufixo de país no slug. Sem sufixo = UK/IRE (newmarket, york, leopardstown).
const ESTRANGEIROS = new Set([
	"aus",
	"nz",
	"jpn",
	"usa",
	"fra",
	"rsa",
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

export function ehUkIre(slug: string): boolean {
	const venue = slug.split("/")[4] || "";
	const i = venue.lastIndexOf("-");
	return !ESTRANGEIROS.has(i > 0 ? venue.slice(i + 1) : "");
}

/** Lê os CSVs do coletor. Aceita os dois esquemas: o v2 nomeia as colunas pela
 *  EXECUÇÃO (`lay_exec_odd`/`back_exec_odd`); o v1 nomeava pelo lado do livro e
 *  com os nomes TROCADOS — `back_odd` do v1 vem dos bids, que é onde se LAYA.
 *  O spread é simétrico, então o v1 segue utilizável desde que lido assim. */
export function loadSmarketsQuotes(dir: string): {
	quotes: Quote[];
	files: string[];
} {
	const files = fs
		.readdirSync(dir)
		.filter((f) => f.startsWith("smarkets_book") && f.endsWith(".csv"))
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
