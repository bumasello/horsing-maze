// O mercado PLACE ("To Be Placed") precifica pior que o mercado WIN? (DEV-ONLY)
//
// TESE. Todo resultado deste projeto diz a mesma coisa: o mercado WIN no BSP é
// eficiente em relação a dados públicos pré-corrida (encompassing test com
// α 1,45→0,15; Brier do mercado melhor que o do modelo nos dois grupos). Então
// pare de tentar bater o preço do WIN. Em vez disso: PEGUE o preço do WIN — o
// melhor estimador disponível — e converta em probabilidade de COLOCAÇÃO melhor
// do que o mercado PLACE converte.
//
// Por que pode funcionar:
//   1. Não exige informação nova. Usa o mercado contra ele mesmo.
//   2. O PLACE é ~5,7x mais fino que o WIN (vol. pré-live £2.536 vs £14.555).
//   3. A conversão win→place é matematicamente chata (Harville e correções).
//      Mercado fino + conversão chata é onde erro de precificação mora.
//   4. Ordem "at BSP" casa no pool de reconciliação: NÃO cruza spread. O custo
//      vira só comissão — foi o spread (4,85% contra bruto de 5,35%) que matou
//      o trading de drift.
//
// ⚠️ ESTA VERSÃO É PARAMETER-FREE NAS ETAPAS A e C0. Harville puro não tem
// parâmetro pra ajustar, então não há como sobreajustar e NENHUMA janela é
// queimada. As etapas B e C ajustam coeficientes e por isso reportam FIT e
// HELD separados — só o HELD conta.
//
// Não toca Supabase, Mongo nem TensorFlow: lê só os CSVs da Betfair.
//
// Uso:
//   BSP_DIR=/home/maze/dev/betfair_sp_data \
//     npx ts-node src/oneTimeScript/place_mispricing_probe.ts

import fs from "node:fs";
import path from "node:path";

const BSP_DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const SPLIT = process.env.SPLIT || "2025-10-01"; // FIT < SPLIT <= HELD
const COMMISSION = Number(process.env.COMMISSION_RATE ?? 0.065);
const BOOT_B = Number(process.env.BOOT_B || 2000);
const MIN_RUNNERS = Number(process.env.MIN_RUNNERS || 4);

// ───────────────────────── carga dos CSVs ─────────────────────────

interface Runner {
	selId: string;
	name: string;
	winBsp: number;
	winMwap: number; // odd média ponderada da MANHÃ no mercado WIN
	placeBsp: number;
	placeMwap: number; // idem no mercado PLACE
	won: number; // win_lose do mercado WIN
	placed: number; // win_lose do mercado PLACE
}
interface Race {
	key: string;
	date: string; // AAAA-MM-DD
	course: string;
	runners: Runner[];
	k: number; // vagas de colocação (contadas no resultado)
}

/** "30-06-2026 19:39" → "2026-06-30". */
function isoDate(eventDt: string): string {
	const m = eventDt.trim().match(/^(\d{2})-(\d{2})-(\d{4})/);
	return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/** Lê um CSV da Betfair. O cabeçalho mudou de caixa em 2024 — normaliza. */
function readCsv(file: string): Record<string, string>[] {
	const txt = fs.readFileSync(file, "utf8");
	const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
	if (lines.length < 2) return [];
	const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
	const out: Record<string, string>[] = [];
	for (let i = 1; i < lines.length; i++) {
		const cells = lines[i].split(",");
		if (cells.length < head.length) continue;
		const r: Record<string, string> = {};
		for (let j = 0; j < head.length; j++) r[head[j]] = cells[j];
		out.push(r);
	}
	return out;
}

function loadRaces(): Race[] {
	const files = fs.readdirSync(BSP_DIR);
	const winFiles = files.filter((f) =>
		/^dwbfprices(uk|ire)win\d{8}\.csv$/i.test(f),
	);
	const placeSet = new Set(
		files.filter((f) => /^dwbfprices(uk|ire)place\d{8}\.csv$/i.test(f)),
	);

	// (menu_hint|event_dt) → runners parciais
	const races = new Map<
		string,
		{ date: string; course: string; m: Map<string, Runner> }
	>();
	let winRows = 0;
	let placeRows = 0;
	let pairedFiles = 0;

	for (const wf of winFiles) {
		const pf = wf.replace(/win(\d{8})\.csv$/i, "place$1.csv");
		if (!placeSet.has(pf)) continue; // sem o par, a corrida é inútil aqui
		pairedFiles++;
		for (const r of readCsv(path.join(BSP_DIR, wf))) {
			const key = `${r.menu_hint}|${r.event_dt}`;
			let e = races.get(key);
			if (!e) {
				e = { date: isoDate(r.event_dt), course: r.menu_hint, m: new Map() };
				races.set(key, e);
			}
			e.m.set(r.selection_id, {
				selId: r.selection_id,
				name: r.selection_name,
				winBsp: Number(r.bsp),
				winMwap: Number(r.morningwap),
				placeBsp: 0,
				placeMwap: 0,
				won: Number(r.win_lose),
				placed: -1,
			});
			winRows++;
		}
		for (const r of readCsv(path.join(BSP_DIR, pf))) {
			const key = `${r.menu_hint}|${r.event_dt}`;
			const e = races.get(key);
			if (!e) continue;
			const run = e.m.get(r.selection_id);
			if (!run) continue;
			run.placeBsp = Number(r.bsp);
			run.placeMwap = Number(r.morningwap);
			run.placed = Number(r.win_lose);
			placeRows++;
		}
	}

	const out: Race[] = [];
	for (const [key, e] of races) {
		const runners = Array.from(e.m.values()).filter(
			(x) =>
				Number.isFinite(x.winBsp) &&
				x.winBsp > 1 &&
				Number.isFinite(x.placeBsp) &&
				x.placeBsp > 1 &&
				x.placed >= 0,
		);
		if (runners.length < MIN_RUNNERS) continue;
		const k = runners.reduce((s, x) => s + x.placed, 0);
		// k vem do resultado, mas o NÚMERO DE VAGAS é conhecido antes da corrida —
		// é regra do mercado, não informação futura. Dead heat pode inflar k, por
		// isso o teto. k >= n não tem o que negociar.
		if (k < 2 || k > 4 || k >= runners.length) continue;
		out.push({ key, date: e.date, course: e.course, runners, k });
	}
	console.log(
		`📂 ${BSP_DIR}\n   ${pairedFiles} arquivos win+place pareados | ${winRows} linhas win | ${placeRows} casadas no place`,
	);
	return out.filter((r) => r.date).sort((a, b) => a.date.localeCompare(b.date));
}

// ───────────────────────── Harville ─────────────────────────

/**
 * P(alvo terminar entre os k primeiros) sob o modelo de Harville: a cada
 * posição, o próximo colocado é sorteado entre os que sobraram com
 * probabilidade proporcional à prob. de vitória. Exato, sem parâmetro.
 * Custo O(n^(k-1)) por alvo; k<=4 e n<=40 no pior caso real.
 */
export function harvilleTopK(p: number[], target: number, k: number): number {
	const n = p.length;
	if (k >= n) return 1;
	const alive = new Array<boolean>(n).fill(true);
	const rec = (remaining: number, depth: number): number => {
		let acc = p[target] / remaining;
		if (depth + 1 < k) {
			for (let j = 0; j < n; j++) {
				if (!alive[j] || j === target) continue;
				alive[j] = false;
				acc += (p[j] / remaining) * rec(remaining - p[j], depth + 1);
				alive[j] = true;
			}
		}
		return acc;
	};
	return rec(1, 0);
}

/**
 * Modelo de Stern/Henery: igual ao Harville, mas a partir da SEGUNDA posição a
 * seleção entre os que sobraram é proporcional a p_j^λ em vez de p_j.
 *
 * Existe porque o Harville tem viés conhecido e é exatamente o que a tabela de
 * calibração mostra: superestima a colocação do favorito e subestima a do
 * azarão. λ<1 achata e corrige nessa direção. λ=1 devolve o Harville.
 *
 * ⚠️ λ é UM PARÂMETRO AJUSTADO. Só pode ser ajustado na janela FIT.
 */
export function sternTopK(
	p: number[],
	pl: number[],
	sumL: number,
	target: number,
	k: number,
): number {
	const n = p.length;
	if (k >= n) return 1;
	const alive = new Array<boolean>(n).fill(true);
	const rec = (remP: number, remL: number, depth: number): number => {
		let acc = depth === 0 ? p[target] / remP : pl[target] / remL;
		if (depth + 1 < k) {
			for (let j = 0; j < n; j++) {
				if (!alive[j] || j === target) continue;
				const sj = depth === 0 ? p[j] / remP : pl[j] / remL;
				alive[j] = false;
				acc += sj * rec(remP - p[j], remL - pl[j], depth + 1);
				alive[j] = true;
			}
		}
		return acc;
	};
	return rec(1, sumL, 0);
}

/** Probabilidades de colocação de uma corrida sob Stern(λ), renormalizadas a k.
 *  O modelo de Stern não preserva soma=k sozinho; a renormalização é o que um
 *  praticante faria e mantém a comparação com o mercado no mesmo eixo. */
export function sternRace(pWin: number[], k: number, lambda: number): number[] {
	if (lambda === 1) return pWin.map((_, i) => harvilleTopK(pWin, i, k));
	const pl = pWin.map((x) => x ** lambda);
	const sumL = pl.reduce((a, b) => a + b, 0);
	const raw = pWin.map((_, i) => sternTopK(pWin, pl, sumL, i, k));
	const s = raw.reduce((a, b) => a + b, 0);
	return raw.map((x) => (x / s) * k);
}

// ───────────────────────── estatística ─────────────────────────

const clip = (x: number) => Math.min(1 - 1e-9, Math.max(1e-9, x));
const logit = (x: number) => Math.log(clip(x) / (1 - clip(x)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

/** Regressão logística binária por Newton-IRLS. X inclui o intercepto. */
function logisticFit(X: number[][], y: number[], iters = 60): number[] {
	const d = X[0].length;
	const b = new Array(d).fill(0);
	for (let it = 0; it < iters; it++) {
		const g = new Array(d).fill(0);
		const H = Array.from({ length: d }, () => new Array(d).fill(0));
		for (let i = 0; i < X.length; i++) {
			let z = 0;
			for (let j = 0; j < d; j++) z += b[j] * X[i][j];
			const p = sigmoid(z);
			const w = Math.max(p * (1 - p), 1e-8);
			const r = y[i] - p;
			for (let j = 0; j < d; j++) {
				g[j] += r * X[i][j];
				for (let l = 0; l < d; l++) H[j][l] += w * X[i][j] * X[i][l];
			}
		}
		for (let j = 0; j < d; j++) H[j][j] += 1e-8; // ridge numérico
		const step = solve(H, g);
		if (!step) break;
		let maxd = 0;
		for (let j = 0; j < d; j++) {
			b[j] += step[j];
			maxd = Math.max(maxd, Math.abs(step[j]));
		}
		if (maxd < 1e-10) break;
	}
	return b;
}

/** Eliminação de Gauss com pivotamento parcial. */
function solve(A: number[][], b: number[]): number[] | null {
	const n = b.length;
	const M = A.map((row, i) => [...row, b[i]]);
	for (let c = 0; c < n; c++) {
		let piv = c;
		for (let r = c + 1; r < n; r++)
			if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
		if (Math.abs(M[piv][c]) < 1e-14) return null;
		[M[c], M[piv]] = [M[piv], M[c]];
		for (let r = 0; r < n; r++) {
			if (r === c) continue;
			const f = M[r][c] / M[c][c];
			for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
		}
	}
	const x = new Array<number>(n);
	for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
	return x;
}

const brier = (p: number[], y: number[]) =>
	mean(p.map((x, i) => (x - y[i]) ** 2));
const logloss = (p: number[], y: number[]) =>
	mean(
		p.map(
			(x, i) =>
				-(y[i] * Math.log(clip(x)) + (1 - y[i]) * Math.log(1 - clip(x))),
		),
	);

function pctl(sorted: number[], q: number) {
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

// ───────────────────────── main ─────────────────────────

interface Obs {
	race: number;
	date: string;
	pH: number; // Harville a partir do BSP do WIN
	pS: number; // Stern(λ) — preenchido na Etapa A2
	pM: number; // implícita do mercado PLACE (overround removido)
	// versões de MANHÃ — as únicas conhecidas na hora de mandar a ordem
	pHm: number;
	pSm: number;
	pMm: number;
	temManha: boolean;
	placeBsp: number;
	placed: number;
	winBsp: number;
	k: number;
	n: number;
}

async function main() {
	const races = loadRaces();
	console.log(
		`🐎 ${races.length} corridas com os DOIS mercados | ${races[0]?.date} → ${races[races.length - 1]?.date}\n`,
	);

	const obs: Obs[] = [];
	const raceP: {
		pWin: number[];
		pWinM: number[];
		temManha: boolean;
		k: number;
		i0: number;
	}[] = [];
	const overrounds: number[] = [];
	let ri = 0;
	for (const r of races) {
		const n = r.runners.length;
		// prob. de vitória do mercado WIN, overround removido
		const inv = r.runners.map((x) => 1 / x.winBsp);
		const sw = inv.reduce((s, x) => s + x, 0);
		const pWin = inv.map((x) => x / sw);
		// prob. de colocação do mercado PLACE. A soma TEM que ser k (exatamente k
		// cavalos colocam), então normalizar por k remove o overround do place.
		const invP = r.runners.map((x) => 1 / x.placeBsp);
		const sp = invP.reduce((s, x) => s + x, 0);
		overrounds.push(sp / r.k);
		const pMkt = invP.map((x) => (x / sp) * r.k);

		// ── versão de MANHÃ (sem look-ahead) ──
		// morningwap é a odd média ponderada da manhã: é o que dá pra ver quando
		// a ordem "take SP" é enviada. O BSP só existe depois da largada.
		const temManha = r.runners.every(
			(x) =>
				Number.isFinite(x.winMwap) &&
				x.winMwap > 1 &&
				Number.isFinite(x.placeMwap) &&
				x.placeMwap > 1,
		);
		let pWinM: number[] = [];
		let pMktM: number[] = [];
		if (temManha) {
			const iw = r.runners.map((x) => 1 / x.winMwap);
			const swm = iw.reduce((s2, x) => s2 + x, 0);
			pWinM = iw.map((x) => x / swm);
			const ip = r.runners.map((x) => 1 / x.placeMwap);
			const spm = ip.reduce((s2, x) => s2 + x, 0);
			pMktM = ip.map((x) => (x / spm) * r.k);
		}
		raceP.push({ pWin, pWinM, temManha, k: r.k, i0: obs.length });
		for (let i = 0; i < n; i++) {
			obs.push({
				race: ri,
				date: r.date,
				pH: harvilleTopK(pWin, i, r.k),
				pS: 0,
				pHm: temManha ? harvilleTopK(pWinM, i, r.k) : 0,
				pSm: 0,
				pMm: temManha ? pMktM[i] : 0,
				temManha,
				pM: pMkt[i],
				placeBsp: r.runners[i].placeBsp,
				placed: r.runners[i].placed,
				winBsp: r.runners[i].winBsp,
				k: r.k,
				n,
			});
		}
		ri++;
	}
	const y = obs.map((o) => o.placed);
	console.log(
		`📊 ${obs.length} cavalos | overround do mercado PLACE: mediana ${(
			pctl(
				[...overrounds].sort((a, b) => a - b),
				0.5,
			) *
				100 -
				100
		).toFixed(2)}%\n`,
	);

	// ═══ ETAPA A — Harville puro vs mercado PLACE (SEM PARÂMETRO) ═══
	console.log("═".repeat(72));
	console.log("  ETAPA A — quem estima melhor P(colocar)?  [parameter-free]");
	console.log("═".repeat(72));
	const pH = obs.map((o) => o.pH);
	const pM = obs.map((o) => o.pM);
	console.log(
		`  Brier   Harville(do WIN) ${brier(pH, y).toFixed(6)}   mercado PLACE ${brier(pM, y).toFixed(6)}   → ${brier(pH, y) < brier(pM, y) ? "✅ Harville melhor" : "❌ mercado melhor"}`,
	);
	console.log(
		`  LogLoss Harville(do WIN) ${logloss(pH, y).toFixed(6)}   mercado PLACE ${logloss(pM, y).toFixed(6)}   → ${logloss(pH, y) < logloss(pM, y) ? "✅ Harville melhor" : "❌ mercado melhor"}`,
	);

	// calibração por faixa da estimativa de Harville
	console.log("\n  Calibração (bins pela estimativa de Harville):");
	console.log(
		"    faixa        n    Harville   mercado     REAL    H−real   M−real",
	);
	const bins = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.01];
	for (let b = 0; b < bins.length - 1; b++) {
		const s = obs.filter((o) => o.pH >= bins[b] && o.pH < bins[b + 1]);
		if (s.length < 50) continue;
		const h = mean(s.map((o) => o.pH));
		const m = mean(s.map((o) => o.pM));
		const real = mean(s.map((o) => o.placed));
		const f = (x: number) =>
			`${(x * 100 >= 0 ? "+" : "") + (x * 100).toFixed(2)}pp`;
		console.log(
			`    ${bins[b].toFixed(1)}-${bins[b + 1] > 1 ? "1.0" : bins[b + 1].toFixed(1)} ${String(s.length).padStart(7)}   ${(h * 100).toFixed(2).padStart(6)}%  ${(m * 100).toFixed(2).padStart(6)}%  ${(real * 100).toFixed(2).padStart(6)}%  ${f(h - real).padStart(8)} ${f(m - real).padStart(8)}`,
		);
	}

	// ═══ ETAPA A2 — Stern(λ): a correção padrão do viés do Harville ═══
	// λ é ajustado SÓ na janela FIT. Avaliação no HELD.
	const idxFit = obs
		.map((o, i) => (o.date < SPLIT ? i : -1))
		.filter((i) => i >= 0);
	const idxHeld = obs
		.map((o, i) => (o.date >= SPLIT ? i : -1))
		.filter((i) => i >= 0);
	console.log(`\n${"═".repeat(72)}`);
	console.log("  ETAPA A2 — Stern(λ), λ ajustado só no FIT");
	console.log("═".repeat(72));
	let bestL = 1;
	let bestLL = Number.POSITIVE_INFINITY;
	const scratch = new Array<number>(obs.length).fill(0);
	const fillStern = (lambda: number) => {
		for (const rp of raceP) {
			const ps = sternRace(rp.pWin, rp.k, lambda);
			for (let i = 0; i < ps.length; i++) scratch[rp.i0 + i] = ps[i];
		}
	};
	const fillSternManha = (lambda: number) => {
		for (const rp of raceP) {
			if (!rp.temManha) continue;
			const ps = sternRace(rp.pWinM, rp.k, lambda);
			for (let i = 0; i < ps.length; i++) obs[rp.i0 + i].pSm = ps[i];
		}
	};
	const grid: number[] = [];
	for (let l = 0.5; l <= 1.2001; l += 0.05) grid.push(Number(l.toFixed(2)));
	for (const lambda of grid) {
		fillStern(lambda);
		const ll = logloss(
			idxFit.map((i) => scratch[i]),
			idxFit.map((i) => y[i]),
		);
		if (ll < bestLL) {
			bestLL = ll;
			bestL = lambda;
		}
	}
	fillStern(bestL);
	for (let i = 0; i < obs.length; i++) obs[i].pS = scratch[i];
	fillSternManha(bestL);
	console.log(
		`  λ escolhido no FIT: ${bestL.toFixed(2)}  (λ=1 seria o Harville puro)`,
	);
	const hv = (
		f: (p: number[], yy: number[]) => number,
		sel: number[],
		key: "pH" | "pS" | "pM",
	) =>
		f(
			sel.map((i) => obs[i][key]),
			sel.map((i) => y[i]),
		);
	console.log(
		`  HELD  Brier   Harville ${hv(brier, idxHeld, "pH").toFixed(6)}   Stern(λ) ${hv(brier, idxHeld, "pS").toFixed(6)}   mercado ${hv(brier, idxHeld, "pM").toFixed(6)}`,
	);
	console.log(
		`  HELD  LogLoss Harville ${hv(logloss, idxHeld, "pH").toFixed(6)}   Stern(λ) ${hv(logloss, idxHeld, "pS").toFixed(6)}   mercado ${hv(logloss, idxHeld, "pM").toFixed(6)}`,
	);
	const venceu = hv(brier, idxHeld, "pS") < hv(brier, idxHeld, "pM");
	console.log(
		`  → ${venceu ? "✅ Stern bate o mercado no HELD" : "❌ o mercado continua melhor no HELD"}`,
	);

	// ═══ ETAPA B — encompassing: Harville acrescenta algo ao preço do PLACE? ═══
	console.log(`\n${"═".repeat(72)}`);
	console.log("  ETAPA B — encompassing (FIT/HELD, coeficientes ajustados)");
	console.log("═".repeat(72));
	const fit = obs.filter((o) => o.date < SPLIT);
	const held = obs.filter((o) => o.date >= SPLIT);
	console.log(
		`  FIT  [${fit[0]?.date} → ${SPLIT})  ${fit.length} cavalos\n  HELD [${SPLIT} → ${held[held.length - 1]?.date}]  ${held.length} cavalos\n`,
	);
	const mk = (s: Obs[], cols: ("h" | "m" | "s")[]) =>
		s.map((o) => [
			1,
			...cols.map((c) => logit(c === "h" ? o.pH : c === "s" ? o.pS : o.pM)),
		]);
	const evalModel = (name: string, cols: ("h" | "m" | "s")[]) => {
		const b = logisticFit(
			mk(fit, cols),
			fit.map((o) => o.placed),
		);
		const pred = (s: Obs[]) =>
			mk(s, cols).map((x) =>
				sigmoid(x.reduce((acc, v, j) => acc + v * b[j], 0)),
			);
		const llF = logloss(
			pred(fit),
			fit.map((o) => o.placed),
		);
		const llH = logloss(
			pred(held),
			held.map((o) => o.placed),
		);
		predHeld[name.slice(0, 2)] = pred(held);
		const coef = cols
			.map((c, j) => `${c === "m" ? "β" : "α"}=${b[j + 1].toFixed(4)}`)
			.join(" ");
		console.log(
			`  ${name.padEnd(22)} ${coef.padEnd(24)} logloss FIT ${llF.toFixed(6)}  HELD ${llH.toFixed(6)}`,
		);
		return llH;
	};
	// devolve também as previsões no HELD, pra bootstrapar a DIFERENÇA de logloss
	const predHeld: Record<string, number[]> = {};
	const llM0 = evalModel("M0 só mercado PLACE", ["m"]);
	evalModel("M1 só Harville", ["h"]);
	const llM2 = evalModel("M2 mercado+Harville", ["m", "h"]);
	const llM3 = evalModel("M3 mercado+Stern(λ)", ["m", "s"]);
	const g2 = llM0 - llM2;
	const g3 = llM0 - llM3;
	console.log(
		`\n  ganho sobre o preço, FORA DA AMOSTRA (nats/cavalo):\n    Harville ${g2 >= 0 ? "+" : ""}${g2.toFixed(6)}   Stern(λ) ${g3 >= 0 ? "+" : ""}${g3.toFixed(6)}`,
	);
	// IC do ganho: cluster bootstrap por CORRIDA sobre a DIFERENÇA de logloss
	// ponto a ponto no HELD. Os coeficientes ficam fixos (ajustados no FIT), então
	// o IC é da diferença de ajuste, não da regra de estimação.
	const yH = held.map((o) => o.placed);
	const llPt = (pr: number[]) =>
		pr.map(
			(x, i) =>
				-(yH[i] * Math.log(clip(x)) + (1 - yH[i]) * Math.log(1 - clip(x))),
		);
	const l0 = llPt(predHeld.M0);
	for (const [nome, chave] of [
		["Harville", "M2"],
		["Stern(λ)", "M3"],
	] as const) {
		const d = llPt(predHeld[chave]).map((x, i) => l0[i] - x); // >0 = M0 pior = ganho
		const porCorrida = new Map<number, number[]>();
		held.forEach((o, i) => {
			const g = porCorrida.get(o.race);
			if (g) g.push(d[i]);
			else porCorrida.set(o.race, [d[i]]);
		});
		const grupos = Array.from(porCorrida.values());
		const boot: number[] = [];
		for (let b = 0; b < BOOT_B; b++) {
			let acc = 0;
			let cnt = 0;
			for (let i = 0; i < grupos.length; i++) {
				const g = grupos[Math.floor(Math.random() * grupos.length)];
				for (const x of g) {
					acc += x;
					cnt++;
				}
			}
			boot.push(acc / (cnt || 1));
		}
		boot.sort((a, b) => a - b);
		const lo = pctl(boot, 0.025);
		const hi = pctl(boot, 0.975);
		const e = (x: number) => (x >= 0 ? "+" : "") + x.toExponential(2);
		console.log(
			`  IC95 do ganho (${nome}): ${e(mean(d))}  [${e(lo)}, ${e(hi)}]  ${lo > 0 ? "✅ exclui zero" : hi < 0 ? "❌ NEGATIVO" : "⚠️ cruza zero"}`,
		);
	}
	// escala de referência: quanto o PRÓPRIO PREÇO contribui sobre a taxa-base
	const taxaBase = mean(yH);
	const llBase = mean(
		yH.map((v) => -(v * Math.log(taxaBase) + (1 - v) * Math.log(1 - taxaBase))),
	);
	console.log(
		`  escala: o preço do PLACE ganha ${(llBase - llM0).toFixed(6)} nats sobre a taxa-base (${(taxaBase * 100).toFixed(1)}%).`,
	);
	console.log(
		`  o Harville acrescenta ${(((llM0 - llM2) / (llBase - llM0)) * 100).toFixed(3)}% disso.`,
	);

	// ═══ ETAPA C — dá pra apostar nisso? ═══
	console.log(`\n${"═".repeat(72)}`);
	console.log(
		`  ETAPA C — simulação a BSP do PLACE (comissão ${(COMMISSION * 100).toFixed(1)}%)`,
	);
	console.log("═".repeat(72));
	console.log(
		"  Execução 'at BSP' casa no pool de reconciliação: NÃO cruza spread.",
	);
	console.log(
		"  BACK se estimativa > mercado + m ; LAY se estimativa < mercado − m.\n",
	);

	const pnlBack = (o: Obs) =>
		o.placed ? (o.placeBsp - 1) * (1 - COMMISSION) : -1;
	const pnlLay = (o: Obs) =>
		o.placed ? -(o.placeBsp - 1) : 1 * (1 - COMMISSION);

	const rodar = (
		titulo: string,
		amostra: Obs[],
		est: (o: Obs) => number,
		mkt: (o: Obs) => number,
	) => {
		console.log(`  ── ${titulo} ── (${amostra.length} cavalos elegíveis)`);
		console.log(
			"  margem   n_back   ROI_back    n_lay    ROI_lay     n_tot   ROI_tot   IC95_tot",
		);
		for (const m of [0.02, 0.04, 0.06, 0.08, 0.1]) {
			const backs = amostra.filter((o) => est(o) - mkt(o) > m);
			const lays = amostra.filter((o) => mkt(o) - est(o) > m);
			const all = [
				...backs.map((o) => ({ race: o.race, pnl: pnlBack(o) })),
				...lays.map((o) => ({ race: o.race, pnl: pnlLay(o) })),
			];
			if (all.length < 30) {
				console.log(`  ${m.toFixed(2)}     (amostra < 30)`);
				continue;
			}
			const roi = (a: { pnl: number }[]) => mean(a.map((x) => x.pnl));
			const porCorrida = new Map<number, { pnl: number }[]>();
			for (const a of all) {
				const g = porCorrida.get(a.race);
				if (g) g.push(a);
				else porCorrida.set(a.race, [a]);
			}
			const grupos = Array.from(porCorrida.values());
			const boot: number[] = [];
			for (let b = 0; b < BOOT_B; b++) {
				let acc = 0;
				let cnt = 0;
				for (let i = 0; i < grupos.length; i++) {
					const g = grupos[Math.floor(Math.random() * grupos.length)];
					for (const x of g) {
						acc += x.pnl;
						cnt++;
					}
				}
				boot.push(acc / (cnt || 1));
			}
			boot.sort((a, b) => a - b);
			const lo = pctl(boot, 0.025);
			const hi = pctl(boot, 0.975);
			const f = (x: number) =>
				`${(x * 100 >= 0 ? "+" : "") + (x * 100).toFixed(2)}%`;
			console.log(
				`  ${m.toFixed(2)} ${String(backs.length).padStart(8)} ${f(backs.length ? roi(backs.map((o) => ({ pnl: pnlBack(o) }))) : 0).padStart(10)} ${String(lays.length).padStart(8)} ${f(lays.length ? roi(lays.map((o) => ({ pnl: pnlLay(o) }))) : 0).padStart(10)} ${String(all.length).padStart(9)} ${f(roi(all)).padStart(9)}   [${f(lo)}, ${f(hi)}] ${lo > 0 ? "✅" : hi < 0 ? "❌" : "⚠️"}`,
			);
		}
		console.log("");
	};

	// C1 — HONESTO. Sinal do preço da MANHÃ (win e place), liquidação no BSP do
	// place. É a única versão executável: a ordem "take SP" é enviada antes da
	// largada, quando nenhum BSP existe ainda.
	const heldManha = held.filter((o) => o.temManha);
	rodar(
		"C1 HONESTO — sinal da manhã (Stern λ) → BSP do place",
		heldManha,
		(o) => o.pSm,
		(o) => o.pMm,
	);
	rodar(
		"C1 HONESTO — sinal da manhã (Harville) → BSP do place",
		heldManha,
		(o) => o.pHm,
		(o) => o.pMm,
	);

	// C2 — DIAGNÓSTICO, TEM LOOK-AHEAD. Usa o BSP do WIN, que só é conhecido
	// depois da largada, pra decidir uma aposta liquidada no BSP do place.
	// ⛔ NÃO É BASE PRA DECISÃO. Está aqui só pra medir o teto: se nem com a
	// resposta na mão o sinal aparece, a versão honesta não tem como aparecer.
	console.log(
		"  ⛔ abaixo TEM LOOK-AHEAD (usa BSP do win pra decidir). Teto, não estratégia.",
	);
	rodar(
		"C2 look-ahead — BSP do win (Stern λ) → BSP do place",
		held,
		(o) => o.pS,
		(o) => o.pM,
	);

	console.log(
		"\n  ⚠️ A grade de margens é uma GRADE: escolher a melhor célula é seleção.\n     Ela está aqui pra mostrar o formato do resultado, não pra ser garimpada.",
	);
	console.log("\n✅ Concluído.");
}

if (require.main === module) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}
