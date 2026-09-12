// O trading de drift COMPOSTO escala? (DEV-ONLY, não escreve nada)
//
// A pergunta: "sinal hoje, amanhã resultado + sinal de novo — uma hora o juro
// composto não escala?" A resposta depende de qual das duas coisas limita:
//
//   (a) CAPITAL — se o limite for capital, compor resolve: a banca cresce,
//       o stake cresce junto e o lucro é geométrico.
//   (b) LIQUIDEZ — se o limite for o tamanho que o livro absorve, compor NÃO
//       resolve: passado o teto, capital extra fica parado e o lucro vira
//       LINEAR (R$/dia fixo), não exponencial.
//
// Este script mede qual dos dois manda, simulando a composição dia a dia com
// o teto de execução MEDIDO no livro do Smarkets (`smarkets-spread.ts`).
//
// Retorno por trade = EXCESSO sobre pares da mesma faixa de odd (o componente
// comum do drift não é negociável — ver drift_economics.ts), menos o custo de
// cruzar o spread. PONTAS=1 supõe saída "at BSP" grátis; PONTAS=2 cruza também
// na saída.
//
// ⚠️ A janela é a mesma de drift_economics.ts e é PARCIALMENTE IN-SAMPLE pro
//    baseline (corte de treino Flat 2025-12-22). Isso INFLA o retorno.
//
// Uso: NO_CRON=1 PORT=3999 GROUP=Flat BSP_DIR=... SMARKETS_DIR=... \
//      npx ts-node src/oneTimeScript/trade_compound.ts

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { supabase } from "..";
import {
	loadBspLookup,
	lookupBsp,
	normName,
} from "../services/ml/eval/bsp-lookup";
import {
	type HorseRecord,
	loadModelFromPath,
	loadPeriodData,
	predictRace,
} from "../services/ml/eval/harness";
import { COMMISSION_RATE } from "../services/ml/eval/simulator";
import { buildSpreadCurve } from "../services/ml/eval/smarkets-spread";
import { getDataSchema, modelPath } from "../shared/db-config";

const GROUP = (process.env.GROUP || "Flat").trim();
const CFG: Record<string, { mtype: "flat" | "jump"; types: string[] }> = {
	Flat: { mtype: "flat", types: ["Flat"] },
	Jump: { mtype: "jump", types: ["Hurdle", "Chase", "NHF"] },
};
const G = CFG[GROUP];
const DAYS = Number(process.env.DAYS || 250);
const END = Number(process.env.END || 38);
const MIN_ODD = Number(process.env.MIN_ODD || 4);
const MAX_ODD = Number(process.env.MAX_ODD || 20);
const BSP_DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const SMARKETS_DIR = process.env.SMARKETS_DIR || "/home/maze/dev/smarkets_data";
const MODEL_PATH =
	process.env.MODEL_PATH ||
	`horse_probability_model/baselines/no_market_${G.mtype}`;
// capitais iniciais, na MESMA moeda do size do livro (£ no Smarkets)
const CAPS = (process.env.CAPS || "100,500,2000,10000,50000")
	.split(",")
	.map(Number);
const MIN_STAKE = Number(process.env.MIN_STAKE || 2);
const PONTAS = (Number(process.env.PONTAS || 1) === 2 ? 2 : 1) as 1 | 2;
const BOOT_B = Number(process.env.BOOT_B || 2000);
// E se estivéssemos na BETFAIR? Não dá pra medir o livro dela daqui (geo-bloqueio
// + a conta BR não autentica), então em vez de chutar UM número, varre-se a
// razão entre o livro dela e o do Smarkets:
//   SPREAD_MULT = spread da Betfair / spread medido no Smarkets.
//     1.00 = igual ao Smarkets (4 ticks, o que medimos)
//     0.25 = livro de 1 TICK, o mínimo FÍSICO da Betfair — não existe melhor.
//   SIZE_MULT = profundidade da Betfair / profundidade do Smarkets.
const SPREAD_MULTS = (process.env.SPREAD_MULTS || "1,0.6,0.4,0.25")
	.split(",")
	.map(Number);
const SIZE_MULTS = (process.env.SIZE_MULTS || "1,3,10").split(",").map(Number);
const GRID_CAP = Number(process.env.GRID_CAP || 10000);
const BOOT_CAP = Number(process.env.BOOT_CAP || 2000);

interface Trade {
	date: string;
	morning: number;
	bsp: number;
	div: number;
	race: number;
	nb: number; // retorno por unidade de STAKE, líquido de spread, ANTES da comissão
}

async function fetchMap<T extends { id: number }>(
	table: string,
	ids: number[],
	cols: string,
): Promise<Map<number, T>> {
	const out = new Map<number, T>();
	for (let i = 0; i < ids.length; i += 500) {
		const { data, error } = await supabase
			.schema(getDataSchema())
			.from(table)
			.select(cols)
			.in("id", ids.slice(i, i + 500));
		if (error) throw error;
		for (const r of (data ?? []) as unknown as T[]) out.set(r.id, r);
	}
	return out;
}

const mean = (x: number[]) =>
	x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0;

/** Um passe de composição sobre os dias, em ordem cronológica.
 *  Regra de alocação: a responsabilidade do dia é a banca inteira, dividida
 *  igualmente entre os trades do dia; o stake resultante é limitado pelo teto
 *  de liquidez (se ativo) e pelo mínimo da casa. */
function compor(
	dias: Trade[][],
	cap0: number,
	tetoDe: ((odd: number) => number) | null,
): { final: number; trades: number; stakeMedio: number; maxDD: number } {
	let c = cap0;
	let pico = cap0;
	let maxDD = 0;
	let n = 0;
	let somaStake = 0;
	for (const dia of dias) {
		if (!dia.length) continue;
		const orcamento = c / dia.length; // responsabilidade por trade
		// A comissão da Betfair incide sobre o lucro LÍQUIDO POR MERCADO, e
		// mercado = corrida. Trades da mesma corrida se compensam; perdas de uma
		// corrida NÃO abatem o ganho de outra. Aplicar a comissão sobre a média
		// (em vez de por mercado) subestima o custo, porque o retorno por trade
		// tem dispersão alta: E[lucro+] >> |E[lucro]|.
		const porCorrida = new Map<number, number>();
		for (const t of dia) {
			let stake = orcamento / (t.morning - 1);
			if (tetoDe) stake = Math.min(stake, tetoDe(t.morning));
			if (stake < MIN_STAKE) continue;
			n++;
			somaStake += stake;
			porCorrida.set(t.race, (porCorrida.get(t.race) ?? 0) + stake * t.nb);
		}
		let pnl = 0;
		for (const v of porCorrida.values())
			pnl += v > 0 ? v * (1 - COMMISSION_RATE) : v;
		c += pnl;
		if (c > pico) pico = c;
		maxDD = Math.max(maxDD, (pico - c) / pico);
		if (c < MIN_STAKE) return { final: 0, trades: n, stakeMedio: 0, maxDD: 1 };
	}
	return { final: c, trades: n, stakeMedio: n ? somaStake / n : 0, maxDD };
}

(async () => {
	console.log("\n📈 O trading de drift COMPOSTO escala? (DEV-ONLY)\n");
	console.log(`📋 grupo ${GROUP} | modelo ${MODEL_PATH}`);
	console.log(`📋 janela [${DAYS + END}, ${END}) — parcialmente in-sample`);
	console.log(
		`📋 odd de entrada [${MIN_ODD}, ${MAX_ODD}] | ${PONTAS} ponta(s) de spread\n`,
	);

	const curva = buildSpreadCurve(SMARKETS_DIR);
	console.log(
		`📏 livro MEDIDO (Smarkets, ${curva.files.length} dia(s), ${curva.nQuotes} cotações):`,
	);
	for (const b of curva.bins)
		if (b.n >= 30)
			console.log(
				`     odd ${String(b.lo).padStart(2)}-${String(b.hi).padStart(2)} → spread ${b.medianPct.toFixed(1)}% | size no melhor lay £${b.medianSizeLay.toFixed(0)}`,
			);
	console.log("");

	const { lookup } = loadBspLookup(BSP_DIR);
	await mongoose.connect(process.env.MONGOOSE as string);
	const model = await loadModelFromPath(modelPath(MODEL_PATH), G.mtype);
	const raceMap = await loadPeriodData(G.types, DAYS, END);
	const raceIds = Array.from(raceMap.keys());
	const rhIds: number[] = [];
	for (const hs of raceMap.values())
		for (const h of hs) rhIds.push(h.race_horse_id);
	const racesTbl = await fetchMap<{ id: number; date: string }>(
		"racecards_hr_enriched",
		raceIds,
		"id, date",
	);
	const horsesTbl = await fetchMap<{ id: number; horse: string }>(
		"race_horses_hr_enriched",
		rhIds,
		"id, horse",
	);

	const rows: Trade[] = [];
	for (const [rid, horses] of raceMap) {
		const date = racesTbl.get(rid)?.date;
		if (!date) continue;
		const pLose = predictRace(horses, model);
		const rec: Array<{ i: number; m: number; b: number }> = [];
		for (let i = 0; i < horses.length; i++) {
			const h = horses[i] as HorseRecord;
			if (pLose[i] < 0) continue;
			const name = horsesTbl.get(h.race_horse_id)?.horse;
			if (!name) continue;
			const r = lookupBsp(lookup, date, normName(name))?.row;
			if (!r || !(r.bsp > 1) || !(r.morningwap > 1)) continue;
			rec.push({ i, m: r.morningwap, b: r.bsp });
		}
		if (rec.length < 4) continue;
		const sumM = rec.reduce((a, r) => a + 1 / r.m, 0);
		const sumMl = rec.reduce((a, r) => a + (1 - pLose[r.i]), 0);
		if (sumM <= 0 || sumMl <= 0) continue;
		for (const r of rec) {
			const qM = 1 / r.m / sumM;
			const pMlWin = (1 - pLose[r.i]) / sumMl;
			rows.push({
				date,
				morning: r.m,
				bsp: r.b,
				div: 1 - pMlWin - (1 - qM),
				race: rid,
				nb: 0,
			});
		}
	}
	model.model.dispose();

	const elig = rows.filter((r) => r.morning >= MIN_ODD && r.morning <= MAX_ODD);

	// baseline por decil de odd de entrada: o drift comum não é negociável
	const byOdd = [...elig].sort((a, b) => a.morning - b.morning);
	const dq = Math.floor(byOdd.length / 10);
	const cuts: number[] = [];
	for (let k = 1; k < 10; k++) cuts.push(byOdd[k * dq].morning);
	const decOf = (o: number) => {
		let d = 0;
		while (d < cuts.length && o >= cuts[d]) d++;
		return d;
	};
	const base: number[] = [];
	for (let d = 0; d < 10; d++)
		base.push(
			mean(
				elig
					.filter((r) => decOf(r.morning) === d)
					.map((r) => (r.bsp - r.morning) / r.bsp),
			),
		);

	// Q5 da divergência = a tese de LAY
	const byDiv = [...elig].sort((a, b) => a.div - b.div);
	const q5 = byDiv.slice(4 * Math.floor(byDiv.length / 5));
	// bruto (sem custo) fica guardado; o custo entra por cenário de spread
	const custoDe = (t: Trade, mult: number) =>
		mult *
		(curva.halfSpreadFrac(t.morning) +
			(PONTAS === 2 ? curva.halfSpreadFrac(t.bsp) : 0));
	const aplicarSpread = (mult: number) => {
		for (const t of q5)
			t.nb =
				(t.bsp - t.morning) / t.bsp - base[decOf(t.morning)] - custoDe(t, mult);
	};
	aplicarSpread(1);

	const dias = new Map<string, Trade[]>();
	for (const t of q5) {
		const a = dias.get(t.date);
		if (a) a.push(t);
		else dias.set(t.date, [t]);
	}
	const ordenados = Array.from(dias.keys()).sort();
	const serie = ordenados.map((d) => dias.get(d) as Trade[]);
	const anos = ordenados.length / 250;

	console.log(
		`🐎 ${q5.length} trades do Q5 em ${dias.size} dias (${(q5.length / dias.size).toFixed(1)}/dia)`,
	);
	console.log(
		`   retorno por trade, antes da comissão: ${(mean(q5.map((t) => t.nb)) * 100).toFixed(2)}% do stake`,
	);
	console.log(
		`   odd de entrada média ${mean(q5.map((t) => t.morning)).toFixed(2)} → capital preso por trade = ${(mean(q5.map((t) => t.morning)) - 1).toFixed(2)}x o stake\n`,
	);

	console.log(
		"════════════════════════════════════════════════════════════════════",
	);
	console.log("  COMPOSIÇÃO DIA A DIA — o teto de liquidez muda tudo?");
	console.log(
		"════════════════════════════════════════════════════════════════════",
	);
	console.log(
		`  ${"capital".padStart(8)}  ${"SEM teto (só capital)".padStart(24)}   ${"COM teto medido".padStart(24)}`,
	);
	console.log(
		`  ${"".padStart(8)}  ${"final".padStart(10)}${"×".padStart(7)}${"a.a.".padStart(7)}   ${"final".padStart(10)}${"×".padStart(7)}${"a.a.".padStart(7)}  ${"stake méd".padStart(10)}`,
	);
	for (const c0 of CAPS) {
		const semTeto = compor(serie, c0, null);
		const comTeto = compor(serie, c0, (o) => curva.sizeLay(o));
		const cagr = (f: number) =>
			f > 0 ? `${(((f / c0) ** (1 / anos) - 1) * 100).toFixed(0)}%` : "—";
		console.log(
			`  ${String(c0).padStart(8)}  ${semTeto.final.toFixed(0).padStart(10)}${(semTeto.final / c0).toFixed(2).padStart(7)}${cagr(semTeto.final).padStart(7)}   ${comTeto.final.toFixed(0).padStart(10)}${(comTeto.final / c0).toFixed(2).padStart(7)}${cagr(comTeto.final).padStart(7)}  ${comTeto.stakeMedio.toFixed(0).padStart(10)}`,
		);
	}

	// teto absoluto: com capital infinito, todo trade entra no size máximo
	const tetoDiario = mean(
		serie.map((dia) =>
			dia.reduce((a, t) => {
				const v = curva.sizeLay(t.morning) * t.nb;
				return a + (v > 0 ? v * (1 - COMMISSION_RATE) : v);
			}, 0),
		),
	);
	console.log(
		`\n  🧱 TETO: com capital infinito, o lucro satura em £${tetoDiario.toFixed(2)}/dia`,
	);
	console.log(
		`     (${(q5.length / dias.size).toFixed(1)} trades/dia × size mediano do livro × retorno por trade)`,
	);
	console.log(
		`     = £${(tetoDiario * 250).toFixed(0)}/ano, em valor ABSOLUTO — não escala com capital.`,
	);

	// ===== E SE FOSSE NA BETFAIR? =====
	console.log(
		"\n════════════════════════════════════════════════════════════════════",
	);
	console.log(
		`  SENSIBILIDADE À BETFAIR — retorno a.a. com capital ${GRID_CAP} (teto ativo)`,
	);
	console.log(
		"════════════════════════════════════════════════════════════════════",
	);
	// Reportar em REGIME SATURADO (stake = teto do livro, sempre) evita o
	// artefato de sizing: com "deploy 100% da banca todo dia", aumentar o teto
	// aumenta o drag de volatilidade e o retorno composto chega a CAIR. O que
	// interessa é o par (lucro absoluto, capital que ele exige).
	console.log(
		`  ${"spread".padStart(8)}${"líq/trade".padStart(11)}   ${SIZE_MULTS.map((m) => `size ${m}x`.padStart(19)).join("")}`,
	);
	console.log(
		`  ${"".padStart(19)}   ${SIZE_MULTS.map(() => `${"£/ano".padStart(8)}${"capital".padStart(8)}${"a.a.".padStart(6)}`.padStart(19)).join("")}`,
	);
	for (const sm of SPREAD_MULTS) {
		aplicarSpread(sm);
		const linha = SIZE_MULTS.map((zm) => {
			// lucro diário no regime saturado + responsabilidade exigida (p90 do
			// dia, porque é o pior dia que precisa caber na banca)
			const lucroDia: number[] = [];
			const liabDia: number[] = [];
			for (const dia of serie) {
				const porCorrida = new Map<number, number>();
				let liab = 0;
				for (const t of dia) {
					const stake = curva.sizeLay(t.morning) * zm;
					liab += stake * (t.morning - 1);
					porCorrida.set(t.race, (porCorrida.get(t.race) ?? 0) + stake * t.nb);
				}
				let p = 0;
				for (const v of porCorrida.values())
					p += v > 0 ? v * (1 - COMMISSION_RATE) : v;
				lucroDia.push(p);
				liabDia.push(liab);
			}
			const ano = mean(lucroDia) * 250;
			const ord = [...liabDia].sort((a, b) => a - b);
			const capital = ord[Math.floor(0.9 * (ord.length - 1))];
			const aa = (ano / capital) * 100;
			return `${`${ano.toFixed(0)}`.padStart(8)}${`${capital.toFixed(0)}`.padStart(8)}${`${aa >= 0 ? "+" : ""}${aa.toFixed(0)}%`.padStart(6)}`.padStart(
				19,
			);
		}).join("");
		// líquido por trade nesta hipótese de spread, comissão por mercado
		const porCorrida = new Map<number, number>();
		for (const t of q5)
			porCorrida.set(t.race, (porCorrida.get(t.race) ?? 0) + t.nb);
		let acc = 0;
		for (const v of porCorrida.values())
			acc += v > 0 ? v * (1 - COMMISSION_RATE) : v;
		const liq = (acc / q5.length) * 100;
		console.log(
			`  ${`${sm.toFixed(2)}x`.padStart(8)}${`${liq >= 0 ? "+" : ""}${liq.toFixed(2)}%`.padStart(11)}   ${linha}`,
		);
	}
	console.log(
		"\n  £/ano = lucro no regime saturado (stake sempre no teto do livro).",
	);
	console.log(
		"  capital = responsabilidade do dia p90 — o pior dia tem que caber na banca.",
	);
	console.log(
		"\n  spread 1.00x = o que medimos no Smarkets (4 ticks de mediana).",
	);
	console.log(
		"  spread 0.25x = livro de 1 TICK: o mínimo FÍSICO da Betfair, não há melhor.",
	);
	console.log(
		"  size = profundidade do livro; é ela que define o TETO absoluto de lucro.",
	);

	// bootstrap na configuração realista: com teto, capital de referência
	aplicarSpread(1);
	const tetoBase = (o: number) => curva.sizeLay(o);
	const boot: number[] = [];
	for (let b = 0; b < BOOT_B; b++) {
		const amostra: Trade[][] = [];
		for (let i = 0; i < serie.length; i++)
			amostra.push(serie[Math.floor(Math.random() * serie.length)]);
		boot.push(compor(amostra, BOOT_CAP, tetoBase).final / BOOT_CAP);
	}
	boot.sort((x, y) => x - y);
	console.log(
		`\n  multiplicador em ${anos.toFixed(1)} ano(s), capital ${BOOT_CAP} com teto medido: ponto ${(compor(serie, BOOT_CAP, tetoBase).final / BOOT_CAP).toFixed(2)}x` +
			`  IC95 [${boot[Math.floor(0.025 * BOOT_B)].toFixed(2)}x, ${boot[Math.floor(0.975 * BOOT_B)].toFixed(2)}x]`,
	);
	console.log(
		`  P(terminar abaixo do capital inicial) = ${((boot.filter((x) => x < 1).length / BOOT_B) * 100).toFixed(1)}%`,
	);

	await mongoose.disconnect();
	console.log("\n✅ Concluído.");
})().catch((e) => {
	console.error("❌ Falha:", e);
	process.exit(1);
});
