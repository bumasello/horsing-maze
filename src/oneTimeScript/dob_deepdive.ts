// Autópsia do achado: Hurdle | 13-20f | Mdn/Nov | R9+ (azarão)
// Checa os assassinos antes de qualquer entusiasmo:
//  1) LIABILIDADE exigida (lay p/ green up = S/k no odd k*B -> liab = S(B - 1/k))
//  2) faixa de BSP executável
//  3) liquidez em corrida
//  4) hipótese AGRUPADA no HELD (as 3 células são a mesma tese)
//  5) sensibilidade a k e estabilidade no tempo
import fs from "node:fs";
import path from "node:path";
const BSP_DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const SPLIT = "2025-10-01";
const C = 0.065;
const B = 2000;
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
function pDist(n: string) {
	let f = 0;
	const m = n.match(/(\d+)m/);
	if (m) f += +m[1] * 8;
	const g = n.match(/(\d+)f/);
	if (g) f += +g[1];
	return f || NaN;
}
function pCode(n: string) {
	return /Chs/i.test(n)
		? "Chase"
		: /Hrd/i.test(n)
			? "Hurdle"
			: /NHF|INHF/i.test(n)
				? "NHF"
				: "Flat";
}
function pCls(n: string) {
	return /Hcap/i.test(n)
		? "Hcap"
		: /Mdn|Nov|Beg|Auct/i.test(n)
			? "Mdn/Nov"
			: /Grp|Listed|Grd/i.test(n)
				? "Black"
				: "Outro";
}
function load(): R[] {
	const files = fs
		.readdirSync(BSP_DIR)
		.filter((f) => /win/i.test(f) && !/place/i.test(f) && f.endsWith(".csv"));
	const byRace = new Map<string, any[]>();
	for (const f of files) {
		const lines = fs.readFileSync(path.join(BSP_DIR, f), "utf8").split("\n");
		for (let i = 1; i < lines.length; i++) {
			const c = lines[i].split(",");
			if (c.length < 17) continue;
			const bsp = +c[7],
				ipmin = +c[13],
				ipvol = +c[16];
			if (!(bsp > 0) || !(ipmin > 0)) continue;
			const dm = c[3].match(/(\d{2})-(\d{2})-(\d{4})/);
			if (!dm) continue;
			const key = `${c[1]}|${c[3]}`;
			if (!byRace.has(key)) byRace.set(key, []);
			byRace
				.get(key)!
				.push({
					key,
					date: `${dm[3]}-${dm[2]}-${dm[1]}`,
					bsp,
					ipmin,
					won: +c[6] === 1,
					name: c[2],
					ipvol,
				});
		}
	}
	const out: R[] = [];
	for (const [key, rs] of byRace) {
		if (rs.length < 4) continue;
		const st = [...rs].sort((a, b) => a.bsp - b.bsp);
		const rk = new Map();
		st.forEach((r, i) => rk.set(r, i + 1));
		for (const r of rs)
			out.push({
				raceKey: key,
				date: r.date,
				bsp: r.bsp,
				ipmin: r.ipmin,
				won: r.won,
				field: rs.length,
				rank: rk.get(r)!,
				dist: pDist(r.name),
				code: pCode(r.name),
				cls: pCls(r.name),
				ipvol: r.ipvol,
			});
	}
	return out;
}
function pl(r: R, k: number) {
	const q = Math.max(k * r.bsp, 1.01);
	if (r.ipmin <= q) return (r.bsp / q - 1) * (1 - C);
	if (r.won) return (r.bsp - 1) * (1 - C);
	return -1;
}
function liab(r: R, k: number) {
	return Math.max(r.bsp - 1 / k, 0);
} // por 1 de stake
function boot(rows: R[], k: number): [number, number] {
	const m = new Map<string, R[]>();
	for (const r of rows) {
		if (!m.has(r.raceKey)) m.set(r.raceKey, []);
		m.get(r.raceKey)!.push(r);
	}
	const rc = [...m.values()];
	const o: number[] = [];
	for (let b = 0; b < B; b++) {
		let s = 0,
			n = 0;
		for (let i = 0; i < rc.length; i++) {
			const g = rc[(Math.random() * rc.length) | 0];
			for (const r of g) {
				s += pl(r, k);
				n++;
			}
		}
		o.push((100 * s) / n);
	}
	o.sort((a, b) => a - b);
	return [o[Math.floor(0.025 * B)], o[Math.floor(0.975 * B)]];
}
function st(rows: R[], k: number) {
	let n = 0,
		h = 0,
		s = 0,
		lb = 0;
	for (const r of rows) {
		n++;
		if (r.ipmin <= Math.max(k * r.bsp, 1.01)) h++;
		s += pl(r, k);
		lb += liab(r, k);
	}
	return { n, hit: (100 * h) / n, roi: (100 * s) / n, liab: lb / n };
}
function q(a: number[], p: number) {
	const s = [...a].sort((x, y) => x - y);
	return s[Math.floor(p * (s.length - 1))];
}

const all = load();
const TESE = (r: R) =>
	r.code === "Hurdle" &&
	r.dist >= 13 &&
	r.dist <= 20 &&
	r.cls === "Mdn/Nov" &&
	r.rank >= 9;
const held = all.filter((r) => r.date >= SPLIT),
	fit = all.filter((r) => r.date < SPLIT);

console.log("\n🔬 AUTÓPSIA — Hurdle | 13-20f | Mdn/Nov | R9+\n");
for (const [lab, rows] of [
	["FIT", fit.filter(TESE)],
	["HELD", held.filter(TESE)],
] as [string, R[]][]) {
	const s = st(rows, 0.5);
	const bs = rows.map((r) => r.bsp);
	const iv = rows.map((r) => r.ipvol);
	console.log(
		`  ${lab}: n=${s.n} hit=${s.hit.toFixed(2)}% ROI=${s.roi.toFixed(2)}%`,
	);
	console.log(
		`     BSP   p10=${q(bs, 0.1).toFixed(0)} med=${q(bs, 0.5).toFixed(0)} p90=${q(bs, 0.9).toFixed(0)} max=${Math.max(...bs).toFixed(0)}`,
	);
	console.log(
		`     ipvol p10=£${q(iv, 0.1).toFixed(0)} med=£${q(iv, 0.5).toFixed(0)} p90=£${q(iv, 0.9).toFixed(0)}`,
	);
	console.log(
		`     LIABILIDADE média por 1 de stake: ${s.liab.toFixed(1)}×  (p90=${q(
			rows.map((r) => liab(r, 0.5)),
			0.9,
		).toFixed(0)}×)\n`,
	);
}
const h = held.filter(TESE);
const [lo, hi] = boot(h, 0.5);
console.log(
	`  ▸ HIPÓTESE AGRUPADA no HELD: n=${h.length} ROI=${st(h, 0.5).roi.toFixed(2)}% IC95=[${lo.toFixed(2)}, ${hi.toFixed(2)}]`,
);
console.log(
	`    Bonferroni p/ 145 células testadas → precisa de IC de 99.97%. Aproximação: IC95 do agrupado é otimista.\n`,
);

console.log("  ▸ POR FAIXA DE BSP (o teste de executabilidade) — HELD:");
console.log(
	`    ${"faixa".padEnd(12)} ${"n".padStart(5)} ${"hit%".padStart(7)} ${"ROI%".padStart(8)} ${"liab×".padStart(7)}  IC95`,
);
for (const [lab, lo2, hi2] of [
	["[1,20)", 1, 20],
	["[20,50)", 20, 50],
	["[50,100)", 50, 100],
	["[100,+)", 100, 1e9],
] as [string, number, number][]) {
	const rows = h.filter((r) => r.bsp >= lo2 && r.bsp < hi2);
	if (rows.length < 25) {
		console.log(
			`    ${lab.padEnd(12)} ${String(rows.length).padStart(5)}  (amostra insuficiente)`,
		);
		continue;
	}
	const s = st(rows, 0.5);
	const [a, b2] = boot(rows, 0.5);
	console.log(
		`    ${lab.padEnd(12)} ${String(s.n).padStart(5)} ${s.hit.toFixed(2).padStart(7)} ${s.roi.toFixed(2).padStart(8)} ${s.liab.toFixed(1).padStart(7)}  [${a.toFixed(1)}, ${b2.toFixed(1)}]${a > 0 ? " ✅" : ""}`,
	);
}
console.log("\n  ▸ SENSIBILIDADE A k (HELD, tese agrupada):");
for (const k of [0.4, 0.5, 0.6, 0.7, 0.8]) {
	const s = st(h, k);
	const be = 100 / (1 + (1 / k - 1) * (1 - C));
	console.log(
		`    k=${k}  hit=${s.hit.toFixed(2)}% (be ${be.toFixed(2)}%)  ROI=${s.roi.toFixed(2)}%  liab=${s.liab.toFixed(1)}×`,
	);
}
console.log("\n  ▸ ESTABILIDADE (tese agrupada, por semestre):");
const per = new Map<string, R[]>();
for (const r of all.filter(TESE)) {
	const k = r.date.slice(0, 4) + (r.date.slice(5, 7) <= "06" ? "-H1" : "-H2");
	if (!per.has(k)) per.set(k, []);
	per.get(k)!.push(r);
}
[...per.entries()].sort().forEach(([k, rows]) => {
	const s = st(rows, 0.5);
	console.log(
		`    ${k}  n=${String(s.n).padStart(4)}  hit=${s.hit.toFixed(2)}%  ROI=${s.roi.toFixed(2)}%`,
	);
});
