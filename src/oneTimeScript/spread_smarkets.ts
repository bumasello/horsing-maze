// Quanto custa DE VERDADE cruzar o spread? (DEV-ONLY, só lê CSV, não escreve nada)
//
// PRÉ-REQUISITO DO PRÉ-REGISTRO #3. `drift_economics.ts` mostrou que a tese de
// trading de drift é decidida pelo custo de execução e não pelo sinal: o Q5
// rende +5,39% de excesso e o líquido vai de +2,82% a -4,31% conforme a
// hipótese de execução. A faixa (7,1pp) é maior que o próprio sinal. Os CSVs de
// BSP da Betfair NÃO têm bid-ask (ppmax/ppmin são extremos NEGOCIADOS ao longo
// de horas, amplitude mediana de 56,7% — proxy que mataria qualquer estratégia
// por construção), então o número tinha que vir de livro ao vivo.
//
// FONTE: `scripts/smarkets_collector.py` rodando na VM de Londres (bspnode),
// */15 entre 08:00 e 21:00 UTC. Smarkets porque expõe o livro SEM autenticação
// (a conta Betfair BR não autentica em betfair.com).
//
// ⚠️ Smarkets tem MENOS liquidez que a Betfair em corrida UK, logo spread MAIS
// LARGO. É LIMITE SUPERIOR conservador: serve pra MATAR a hipótese barato, não
// pra confirmá-la.
//
// Uso: SMARKETS_DIR=/home/maze/dev/smarkets_data npx ts-node src/oneTimeScript/spread_smarkets.ts

import {
	type Quote,
	loadSmarketsQuotes,
} from "../services/ml/eval/smarkets-spread";

const DIR = process.env.SMARKETS_DIR || "/home/maze/dev/smarkets_data";
// Excesso do quintil 5 (a tese de LAY) medido por drift_economics.ts, em % do
// preço. É contra ISTO que o custo medido aqui é confrontado.
const SIGNAL_Q5 = 5.39;

/** Escada de ticks da Betfair — espelha tickSize() de drift_economics.ts. */
function tickSize(odd: number): number {
	if (odd < 2) return 0.01;
	if (odd < 3) return 0.02;
	if (odd < 4) return 0.05;
	if (odd < 6) return 0.1;
	if (odd < 10) return 0.2;
	if (odd < 20) return 0.5;
	if (odd < 30) return 1;
	if (odd < 50) return 2;
	if (odd < 100) return 5;
	return 10;
}

// O parser dos CSVs (e o filtro UK/IRE) vive em
// `services/ml/eval/smarkets-spread.ts`, compartilhado com drift_economics.ts,
// que usa a mesma medição como curva de custo.
type Cot = Quote & { ticks: number; spreadPct: number };

const q = (a: number[], p: number) => a[Math.floor(p * (a.length - 1))];
const fmt = (n: number, d = 1) => n.toFixed(d);

const BANDAS: [number, number, string][] = [
	[4, 8, "odd 4-8"],
	[8, 13, "odd 8-13"],
	[13, 20, "odd 13-20"],
];
const JANELAS: [number, number, string][] = [
	[240, 360, "manhã (240-360min)"],
	[60, 240, "tarde (60-240)"],
	[-2, 15, "largada (0-15)"],
];

function main() {
	const { quotes, files } = loadSmarketsQuotes(DIR);
	if (!files.length) {
		console.error(`sem CSV em ${DIR}`);
		process.exit(1);
	}
	const cots: Cot[] = quotes.map((q) => ({
		...q,
		spreadPct: q.spreadFrac * 100,
		ticks: (q.layExec - q.backExec) / tickSize(q.mid),
	}));
	console.log(`\n📖 ${files.length} arquivo(s) em ${DIR}: ${files.join(", ")}`);
	console.log(
		`   ${cots.length} cotações UK/IRE, ${new Set(cots.map((c) => c.corrida)).size} corridas\n`,
	);

	console.log(
		"faixa / janela                 n   corr   sp p25   sp p50     meia    ticks   1 tick %",
	);
	for (const [lo, hi, nb] of BANDAS) {
		for (const [mlo, mhi, nj] of JANELAS) {
			const d = cots.filter(
				(c) => c.mid >= lo && c.mid < hi && c.mins >= mlo && c.mins < mhi,
			);
			const nome = `${nb} | ${nj}`.padEnd(28);
			if (d.length < 20) {
				console.log(`${nome}${String(d.length).padStart(4)}      —`);
				continue;
			}
			const sp = d.map((c) => c.spreadPct).sort((a, b) => a - b);
			const tk = d.map((c) => c.ticks).sort((a, b) => a - b);
			const corr = new Set(d.map((c) => c.corrida)).size;
			const meio = (lo + hi) / 2;
			console.log(
				nome +
					String(d.length).padStart(4) +
					String(corr).padStart(7) +
					fmt(q(sp, 0.25)).padStart(9) +
					fmt(q(sp, 0.5)).padStart(9) +
					fmt(q(sp, 0.5) / 2).padStart(9) +
					fmt(q(tk, 0.5)).padStart(9) +
					fmt((tickSize(meio) / meio) * 100, 2).padStart(11),
			);
		}
		console.log();
	}

	// A célula que decide: Q5 do drift entra com odd mediana 5,85, de manhã.
	const q5 = cots.filter(
		(c) => c.mid >= 4 && c.mid < 8 && c.mins >= 240 && c.mins < 360,
	);
	const sp = q5.map((c) => c.spreadPct).sort((a, b) => a - b);
	const tk = q5.map((c) => c.ticks).sort((a, b) => a - b);
	const ql = q5.map((c) => c.qtyLay).sort((a, b) => a - b);
	console.log(
		`🎯 CÉLULA DECISIVA — odd 4-8 de manhã (Q5 entra a 5,85), n=${q5.length}`,
	);
	console.log(
		`  spread%:  p10 ${fmt(q(sp, 0.1))} | p25 ${fmt(q(sp, 0.25))} | MEDIANA ${fmt(q(sp, 0.5))} | p75 ${fmt(q(sp, 0.75))} | p90 ${fmt(q(sp, 0.9))}`,
	);
	console.log(
		`  ticks:    p10 ${fmt(q(tk, 0.1))} | p25 ${fmt(q(tk, 0.25))} | MEDIANA ${fmt(q(tk, 0.5))} | p75 ${fmt(q(tk, 0.75))} | p90 ${fmt(q(tk, 0.9))}`,
	);
	for (const lim of [2, 3, 4, 6]) {
		const f = (tk.filter((t) => t <= lim).length / tk.length) * 100;
		console.log(`  spread <= ${lim} ticks: ${fmt(f, 0)}% das cotações`);
	}
	console.log(
		`  size no melhor lay: p10 £${fmt(q(ql, 0.1), 0)} | mediana £${fmt(q(ql, 0.5), 0)} | p90 £${fmt(q(ql, 0.9), 0)}`,
	);

	// Confronto com drift_economics.ts. Cruzar o spread custa MEIA spread em
	// relação ao mid; o cenário "otimista" de lá supõe 1 tick por ponta, isto
	// é, um livro de 2 ticks no total.
	const meia = q(sp, 0.5) / 2;
	console.log("\n⚖️  CONFRONTO COM drift_economics.ts");
	console.log(`  sinal Q5 (excesso bruto):        ${fmt(SIGNAL_Q5, 2)}%`);
	console.log(`  meia-spread mediana (= entrada): ${fmt(meia, 2)}%`);
	const kill = meia / SIGNAL_Q5 > 0.8 ? "  ⛔ KILL SWITCH #3 (>80%)" : "";
	console.log(
		`  consumido só pela ENTRADA:       ${fmt((meia / SIGNAL_Q5) * 100, 0)}% do bruto${kill}`,
	);
	console.log(
		`  livro de 2 ticks (premissa "otimista"): ${fmt((tk.filter((t) => t <= 2).length / tk.length) * 100, 0)}% das cotações`,
	);
	console.log(
		"\n  ⚠️ Smarkets é LIMITE SUPERIOR (menos líquido que a Betfair).",
	);
	console.log(
		"     Não prova que a Betfair é assim; prova que a premissa otimista",
		"\n     não pode ser assumida de graça.\n",
	);
}

main();
