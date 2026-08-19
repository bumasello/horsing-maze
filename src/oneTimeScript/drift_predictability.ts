// O movimento manhã→BSP é previsível SÓ com informação de preço? (DEV-ONLY)
//
// Não usa modelo, features nem banco — só os CSVs da Betfair, que já trazem
// morningwap (odd média ponderada da manhã), bsp, event_id e volume negociado.
//
// Duas medidas de drift, e a distinção importa:
//   • BRUTO      y = ln(bsp / morningwap). Inclui a mudança de overround entre
//                manhã e largada. NÃO é diretamente negociável: se todas as odds
//                alongam junto porque o overround da manhã era maior, não há
//                valor relativo a capturar.
//   • NORMALIZADO d = ln(q_bsp / q_morning), com q = (1/odd) renormalizado na
//                corrida. É soma zero dentro da corrida — puro valor RELATIVO,
//                e é isso que se negocia.
//
// Previsibilidade: estima o drift normalizado médio por decil de odd da manhã
// numa janela (FIT) e aplica em outra disjunta (HELD). 10 parâmetros só, difícil
// de sobreajustar. Mede R² fora da amostra e acerto direcional.
//
// Uso: nvm use 20 && npx ts-node src/oneTimeScript/drift_predictability.ts
// Env: BSP_DIR, SPLIT_DATE (2025-10-01) — corridas antes = FIT, depois = HELD

import fs from "node:fs";
import path from "node:path";

const BSP_DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const SPLIT_DATE = process.env.SPLIT_DATE || "2025-10-01";
const NBINS = 10;

interface Runner {
	morning: number;
	bsp: number;
	won: boolean;
	mVol: number; // volume negociado na manhã (liquidez real)
}
interface Race {
	date: string;
	runners: Runner[];
}

/** Parser de CSV tolerante a campo entre aspas com vírgula dentro. */
function splitCsv(line: string): string[] {
	const out: string[] = [];
	let cur = "";
	let inQ = false;
	for (const ch of line) {
		if (ch === '"') inQ = !inQ;
		else if (ch === "," && !inQ) {
			out.push(cur);
			cur = "";
		} else cur += ch;
	}
	out.push(cur);
	return out;
}

function loadRaces(dir: string): Race[] {
	const byEvent = new Map<string, { date: string; runners: Runner[] }>();
	const files = fs.readdirSync(dir).filter((f) => f.endsWith(".csv"));
	for (const f of files) {
		const text = fs.readFileSync(path.join(dir, f), "utf8");
		const lines = text.split(/\r?\n/);
		if (lines.length < 2) continue;
		const header = splitCsv(lines[0]).map((h) => h.trim().toLowerCase());
		const idx = (name: string) => header.indexOf(name);
		const iEvent = idx("event_id");
		const iDt = idx("event_dt");
		const iWl = idx("win_lose");
		const iBsp = idx("bsp");
		const iMw = idx("morningwap");
		const iMv = idx("morningtradedvol");
		if (iEvent < 0 || iBsp < 0 || iMw < 0) continue;

		for (let i = 1; i < lines.length; i++) {
			if (!lines[i].trim()) continue;
			const c = splitCsv(lines[i]);
			const bsp = Number(c[iBsp]);
			const morning = Number(c[iMw]);
			if (!(bsp > 1) || !(morning > 1)) continue;
			const dt = (c[iDt] ?? "").trim().split(/\s+/)[0];
			const [dd, mm, yyyy] = dt.split("-");
			if (!yyyy) continue;
			const date = `${yyyy}-${mm}-${dd}`;
			const key = `${date}|${c[iEvent]}`;
			if (!byEvent.has(key)) byEvent.set(key, { date, runners: [] });
			byEvent.get(key)!.runners.push({
				morning,
				bsp,
				won: Number(c[iWl]) === 1,
				mVol: iMv >= 0 ? Number(c[iMv]) || 0 : 0,
			});
		}
	}
	return Array.from(byEvent.values()).filter((r) => r.runners.length >= 4);
}

const q = (a: number[], p: number) => {
	const s = [...a].sort((x, y) => x - y);
	return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const mean = (a: number[]) =>
	a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

/** Um ponto: drift normalizado + preditor (odd da manhã). */
interface Point {
	logMorning: number;
	driftNorm: number;
	driftRaw: number;
}

function toPoints(races: Race[]): Point[] {
	const pts: Point[] = [];
	for (const r of races) {
		const rawM = r.runners.map((x) => 1 / x.morning);
		const rawB = r.runners.map((x) => 1 / x.bsp);
		const sM = rawM.reduce((a, b) => a + b, 0);
		const sB = rawB.reduce((a, b) => a + b, 0);
		for (let i = 0; i < r.runners.length; i++) {
			const qM = rawM[i] / sM;
			const qB = rawB[i] / sB;
			pts.push({
				logMorning: Math.log(r.runners[i].morning),
				driftNorm: Math.log(qB / qM),
				driftRaw: Math.log(r.runners[i].bsp / r.runners[i].morning),
			});
		}
	}
	return pts;
}

function main(): void {
	console.log("📈 Previsibilidade do drift manhã→BSP (DEV-ONLY, sem modelo)\n");
	const races = loadRaces(BSP_DIR);
	console.log(`📂 ${races.length} corridas com ≥4 participantes`);

	const fit = races.filter((r) => r.date < SPLIT_DATE);
	const held = races.filter((r) => r.date >= SPLIT_DATE);
	console.log(
		`   FIT (< ${SPLIT_DATE}): ${fit.length} corridas | HELD (≥): ${held.length}\n`,
	);

	const pFit = toPoints(fit);
	const pHeld = toPoints(held);

	// ---- 1. drift bruto vs normalizado, sem condicionar em nada
	console.log("═".repeat(72));
	console.log("  1. O drift existe? (todos os participantes, janela HELD)");
	console.log("═".repeat(72));
	const raw = pHeld.map((p) => p.driftRaw);
	const nrm = pHeld.map((p) => p.driftNorm);
	console.log(
		`  BRUTO      ln(bsp/manhã): média ${mean(raw).toFixed(4)}  mediana ${q(raw, 0.5).toFixed(4)}  p10 ${q(raw, 0.1).toFixed(3)}  p90 ${q(raw, 0.9).toFixed(3)}`,
	);
	console.log(
		`             → razão bsp/manhã na mediana: ${Math.exp(q(raw, 0.5)).toFixed(3)}x`,
	);
	console.log(
		`  NORMALIZADO ln(q_bsp/q_manhã): média ${mean(nrm).toFixed(4)}  mediana ${q(nrm, 0.5).toFixed(4)}  p10 ${q(nrm, 0.1).toFixed(3)}  p90 ${q(nrm, 0.9).toFixed(3)}`,
	);
	console.log(
		"  (o normalizado é soma zero na corrida — é o que dá pra negociar)",
	);

	// ---- 2. estrutura por decil de odd da manhã, estimada no FIT
	const sorted = [...pFit].sort((a, b) => a.logMorning - b.logMorning);
	const edges: number[] = [];
	for (let b = 1; b < NBINS; b++)
		edges.push(sorted[Math.floor((b / NBINS) * sorted.length)].logMorning);
	const binOf = (lm: number) => {
		let b = 0;
		while (b < edges.length && lm >= edges[b]) b++;
		return b;
	};
	const binMean: number[] = [];
	for (let b = 0; b < NBINS; b++)
		binMean.push(
			mean(
				pFit.filter((p) => binOf(p.logMorning) === b).map((p) => p.driftNorm),
			),
		);

	console.log(`\n${"═".repeat(72)}`);
	console.log(
		"  2. Drift normalizado médio por decil de odd da manhã (estimado no FIT)",
	);
	console.log("═".repeat(72));
	console.log(
		`  ${"decil".padStart(6)} ${"odd manhã".padStart(14)} ${"drift FIT".padStart(11)} ${"drift HELD".padStart(11)}`,
	);
	for (let b = 0; b < NBINS; b++) {
		const lo = b === 0 ? 1 : Math.exp(edges[b - 1]);
		const hi = b === NBINS - 1 ? Number.POSITIVE_INFINITY : Math.exp(edges[b]);
		const held0 = mean(
			pHeld.filter((p) => binOf(p.logMorning) === b).map((p) => p.driftNorm),
		);
		const range = `${lo.toFixed(1)}–${hi === Number.POSITIVE_INFINITY ? "∞" : hi.toFixed(1)}`;
		console.log(
			`  ${String(b + 1).padStart(6)} ${range.padStart(14)} ${binMean[b].toFixed(4).padStart(11)} ${held0.toFixed(4).padStart(11)}`,
		);
	}

	// ---- 3. previsibilidade fora da amostra
	let ssRes = 0,
		ssTot = 0,
		correct = 0,
		counted = 0;
	const muHeld = mean(pHeld.map((p) => p.driftNorm));
	for (const p of pHeld) {
		const pred = binMean[binOf(p.logMorning)];
		ssRes += (p.driftNorm - pred) ** 2;
		ssTot += (p.driftNorm - muHeld) ** 2;
		if (Math.abs(pred) > 1e-9) {
			counted++;
			if (Math.sign(pred) === Math.sign(p.driftNorm)) correct++;
		}
	}
	const r2 = 1 - ssRes / ssTot;
	console.log(`\n${"═".repeat(72)}`);
	console.log("  3. Previsibilidade FORA da amostra (só com a odd da manhã)");
	console.log("═".repeat(72));
	console.log(`  R² out-of-sample: ${(r2 * 100).toFixed(3)}%`);
	console.log(
		`  acerto direcional: ${((correct / counted) * 100).toFixed(2)}%  (moeda justa = 50%)`,
	);
	console.log(
		`  desvio-padrão do drift normalizado: ${Math.sqrt(ssTot / pHeld.length).toFixed(4)}`,
	);

	// ---- 4. liquidez: dá pra executar?
	const vols = races
		.filter((r) => r.date >= SPLIT_DATE)
		.flatMap((r) => r.runners.map((x) => x.mVol));
	const nz = vols.filter((v) => v > 0);
	console.log(`\n${"═".repeat(72)}`);
	console.log("  4. Liquidez da manhã (morningtradedvol, £ negociados)");
	console.log("═".repeat(72));
	console.log(
		`  participantes com volume > 0: ${nz.length}/${vols.length} (${((nz.length / vols.length) * 100).toFixed(1)}%)`,
	);
	if (nz.length) {
		console.log(
			`  p10 £${q(nz, 0.1).toFixed(0)}  mediana £${q(nz, 0.5).toFixed(0)}  p90 £${q(nz, 0.9).toFixed(0)}`,
		);
	}
	console.log("\n✅ Concluído.");
}

main();
