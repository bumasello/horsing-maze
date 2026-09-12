// DOB (back no BSP → cashout em corrida) CONDICIONADO — probe autocontido.
//
// PERGUNTA: a taxa de acerto incondicional fica 18-23pp abaixo do break-even
// (medido 2026-09-06). Existe alguma CÉLULA de corrida onde ela sobe o
// suficiente pra fechar? A tese é que o preço despenca quem LIDERA cedo, não
// quem vence — e isso é função de distância, tipo de prova, tamanho de campo e
// posição no mercado.
//
// DESENHO ANTI-GARIMPO (o projeto já se enganou 4x com sweep):
//   FIT  [2024-01, 2025-10)  → escolhe as células
//   HELD [2025-10, 2026-08]  → mede as escolhidas, com cluster bootstrap
//                              por corrida. Nada é escolhido no HELD.
//
// Autocontido: lê só os CSVs da Betfair. Não toca Supabase, Mongo nem TF.
// Uso: BSP_DIR=/home/maze/dev/betfair_sp_data npx ts-node src/oneTimeScript/inrunning_dob_probe.ts
// Env: K (0.5), MIN_IPVOL (100), SPLIT (2025-10-01), B (2000), MIN_N_FIT (400)

import fs from "node:fs";
import path from "node:path";

const BSP_DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const K = Number(process.env.K || 0.5);
const MIN_IPVOL = Number(process.env.MIN_IPVOL || 100);
const SPLIT = process.env.SPLIT || "2025-10-01";
const B = Number(process.env.B || 2000);
const MIN_N_FIT = Number(process.env.MIN_N_FIT || 400);
const COMMISSION = Number(process.env.COMMISSION || 0.065);

interface R {
	raceKey: string;
	date: string;
	bsp: number;
	ipmin: number;
	won: boolean;
	field: number;
	rank: number;
	dist: number;
	code: string;
	cls: string;
	ipvol: number;
}

function parseDist(name: string): number {
	// "2m4f Hcap Hrd" -> furlongs; "6f Mdn" -> 6
	const m = name.match(/(?:(\d+)m)?\s*(\d+)?f?/);
	let f = 0;
	const mm = name.match(/(\d+)m/);
	if (mm) f += Number(mm[1]) * 8;
	const ff = name.match(/(\d+)f/);
	if (ff) f += Number(ff[1]);
	return f || Number.NaN;
}
function parseCode(name: string): string {
	if (/Chs/i.test(name)) return "Chase";
	if (/Hrd/i.test(name)) return "Hurdle";
	if (/NHF|INHF/i.test(name)) return "NHF";
	return "Flat";
}
function parseCls(name: string): string {
	if (/Hcap/i.test(name)) return "Hcap";
	if (/Mdn|Nov|Beg|Auct/i.test(name)) return "Mdn/Nov";
	if (/Grp|Listed|Grd/i.test(name)) return "Black";
	return "Outro";
}
function bucketDist(f: number): string {
	if (!Number.isFinite(f)) return "?";
	if (f <= 6) return "a<=6f";
	if (f <= 8) return "b 7-8f";
	if (f <= 12) return "c 9-12f";
	if (f <= 20) return "d 13-20f";
	return "e >20f";
}
function bucketField(n: number): string {
	if (n <= 7) return "F<=7";
	if (n <= 11) return "F8-11";
	if (n <= 15) return "F12-15";
	return "F16+";
}
function bucketRank(r: number): string {
	if (r === 1) return "R1 fav";
	if (r === 2) return "R2";
	if (r <= 4) return "R3-4";
	if (r <= 8) return "R5-8";
	return "R9+";
}

function loadAll(): R[] {
	const files = fs
		.readdirSync(BSP_DIR)
		.filter((f) => /win/i.test(f) && !/place/i.test(f) && f.endsWith(".csv"));
	const byRace = new Map<string, any[]>();
	for (const f of files) {
		const txt = fs.readFileSync(path.join(BSP_DIR, f), "utf8");
		const lines = txt.split("\n");
		for (let i = 1; i < lines.length; i++) {
			const c = lines[i].split(",");
			if (c.length < 17) continue;
			const bsp = Number(c[7]);
			const ipmin = Number(c[13]);
			const ipvol = Number(c[16]);
			if (!(bsp > 0) || !(ipmin > 0)) continue;
			const dt = c[3]; // dd-mm-yyyy hh:mm
			const dm = dt.match(/(\d{2})-(\d{2})-(\d{4})/);
			if (!dm) continue;
			const date = `${dm[3]}-${dm[2]}-${dm[1]}`;
			const key = `${c[1]}|${dt}`;
			if (!byRace.has(key)) byRace.set(key, []);
			byRace
				.get(key)!
				.push({
					key,
					date,
					bsp,
					ipmin,
					won: Number(c[6]) === 1,
					name: c[2],
					ipvol,
				});
		}
	}
	const out: R[] = [];
	for (const [key, rs] of byRace) {
		if (rs.length < 4) continue;
		const sorted = [...rs].sort((a, b) => a.bsp - b.bsp);
		const rankOf = new Map<any, number>();
		sorted.forEach((r, i) => rankOf.set(r, i + 1));
		for (const r of rs) {
			out.push({
				raceKey: key,
				date: r.date,
				bsp: r.bsp,
				ipmin: r.ipmin,
				won: r.won,
				field: rs.length,
				rank: rankOf.get(r)!,
				dist: parseDist(r.name),
				code: parseCode(r.name),
				cls: parseCls(r.name),
				ipvol: r.ipvol,
			});
		}
	}
	return out;
}

function pl(r: R, k: number): number {
	const q = Math.max(k * r.bsp, 1.01);
	if (r.ipmin <= q) return (r.bsp / q - 1) * (1 - COMMISSION);
	if (r.won) return (r.bsp - 1) * (1 - COMMISSION);
	return -1;
}

function cellKey(r: R): string {
	return `${r.code}|${bucketDist(r.dist)}|${r.cls}|${bucketField(r.field)}|${bucketRank(r.rank)}`;
}

function stats(rows: R[], k: number) {
	let n = 0,
		hits = 0,
		sum = 0;
	for (const r of rows) {
		n++;
		const q = Math.max(k * r.bsp, 1.01);
		if (r.ipmin <= q) hits++;
		sum += pl(r, k);
	}
	return { n, hitPct: (100 * hits) / n, roi: (100 * sum) / n };
}

function bootstrapROI(rows: R[], k: number): [number, number] {
	const byRace = new Map<string, R[]>();
	for (const r of rows) {
		if (!byRace.has(r.raceKey)) byRace.set(r.raceKey, []);
		byRace.get(r.raceKey)!.push(r);
	}
	const races = [...byRace.values()];
	const out: number[] = [];
	for (let b = 0; b < B; b++) {
		let s = 0,
			n = 0;
		for (let i = 0; i < races.length; i++) {
			const rr = races[(Math.random() * races.length) | 0];
			for (const r of rr) {
				s += pl(r, k);
				n++;
			}
		}
		out.push((100 * s) / n);
	}
	out.sort((a, b) => a - b);
	return [out[Math.floor(0.025 * B)], out[Math.floor(0.975 * B)]];
}

function main() {
	console.log("\n🏇 DOB CONDICIONADO — probe autocontido (só CSVs Betfair)\n");
	const all = loadAll().filter((r) => r.ipvol >= MIN_IPVOL);
	const fit = all.filter((r) => r.date < SPLIT);
	const held = all.filter((r) => r.date >= SPLIT);
	const beHit = 100 / (1 + (1 / K - 1) * (1 - COMMISSION));
	console.log(
		`  k=${K} | break-even hit = ${beHit.toFixed(2)}% | comissão ${COMMISSION}`,
	);
	console.log(
		`  runners com ipvol>=${MIN_IPVOL}: ${all.length} | FIT ${fit.length} | HELD ${held.length}\n`,
	);

	const g = stats(all, K);
	console.log(
		`  INCONDICIONAL (tudo): n=${g.n} hit=${g.hitPct.toFixed(2)}% ROI=${g.roi.toFixed(2)}%\n`,
	);

	// ---- marginais descritivas no FIT ----
	for (const [label, fn] of [
		["CODE", (r: R) => r.code],
		["DIST", (r: R) => bucketDist(r.dist)],
		["CLASSE", (r: R) => r.cls],
		["CAMPO", (r: R) => bucketField(r.field)],
		["RANK", (r: R) => bucketRank(r.rank)],
	] as [string, (r: R) => string][]) {
		const m = new Map<string, R[]>();
		for (const r of fit) {
			const k = fn(r);
			if (!m.has(k)) m.set(k, []);
			m.get(k)!.push(r);
		}
		console.log(`  ── ${label} (FIT) ──`);
		[...m.entries()].sort().forEach(([k, rows]) => {
			const s = stats(rows, K);
			console.log(
				`    ${k.padEnd(12)} n=${String(s.n).padStart(7)}  hit=${s.hitPct.toFixed(2).padStart(6)}%  ROI=${s.roi.toFixed(2).padStart(7)}%`,
			);
		});
		console.log("");
	}

	// ---- células completas: escolhe no FIT, mede no HELD ----
	const cf = new Map<string, R[]>();
	for (const r of fit) {
		const k = cellKey(r);
		if (!cf.has(k)) cf.set(k, []);
		cf.get(k)!.push(r);
	}
	const cand = [...cf.entries()]
		.filter(([, rows]) => rows.length >= MIN_N_FIT)
		.map(([k, rows]) => ({ k, ...stats(rows, K) }))
		.sort((a, b) => b.roi - a.roi);
	console.log(
		`  ── CÉLULAS (n_fit>=${MIN_N_FIT}): ${cand.length} candidatas ──`,
	);
	console.log(
		"  TOP 10 NO FIT (é aqui que o garimpo acontece — não é resultado):",
	);
	cand
		.slice(0, 10)
		.forEach((c) =>
			console.log(
				`    ${c.k.padEnd(46)} n=${String(c.n).padStart(6)} hit=${c.hitPct.toFixed(2)}% ROI=${c.roi.toFixed(2)}%`,
			),
		);

	const ch = new Map<string, R[]>();
	for (const r of held) {
		const k = cellKey(r);
		if (!ch.has(k)) ch.set(k, []);
		ch.get(k)!.push(r);
	}
	console.log("\n  AS MESMAS 10 CÉLULAS NO HELD (este é o resultado):");
	console.log(
		`    ${"célula".padEnd(46)} ${"n".padStart(6)} ${"hit%".padStart(7)} ${"ROI%".padStart(8)}  IC95`,
	);
	for (const c of cand.slice(0, 10)) {
		const rows = ch.get(c.k) || [];
		if (rows.length < 30) {
			console.log(
				`    ${c.k.padEnd(46)} ${String(rows.length).padStart(6)}  (amostra insuficiente no HELD)`,
			);
			continue;
		}
		const s = stats(rows, K);
		const [lo, hi] = bootstrapROI(rows, K);
		const flag = lo > 0 ? " ✅" : "";
		console.log(
			`    ${c.k.padEnd(46)} ${String(s.n).padStart(6)} ${s.hitPct.toFixed(2).padStart(7)} ${s.roi.toFixed(2).padStart(8)}  [${lo.toFixed(2)}, ${hi.toFixed(2)}]${flag}`,
		);
	}

	const best = cand[0];
	console.log(
		`\n  Melhor célula do FIT: ${best.k} → ROI ${best.roi.toFixed(2)}% (in-sample)`,
	);
	const anyPos = cand.filter((c) => c.roi > 0).length;
	console.log(
		`  Células com ROI>0 já NO FIT (com garimpo livre): ${anyPos}/${cand.length}`,
	);
}

main();
