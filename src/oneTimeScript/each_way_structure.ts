// EACH-WAY: a régua estrutural (autocontido, só CSVs Betfair win+place)
//
// TESE: a casa não precifica each-way com livro de ofertas — precifica por
// REGRA FIXA (1/4 em 2 vagas, 1/5 em 3, 1/4 em 4...). O mercado PLACE da
// exchange, por outro lado, é o melhor estimador de colocação que existe
// (probe de 2026-08-21) e tem overround de 0,11%. Dá pra usar um como régua
// do outro.
//
// Este script mede a FRAÇÃO JUSTA f* = (O_win - 1) / (O_place_justa - 1):
// a fração da odd de vitória que pagaria exatamente a probabilidade real de
// colocação. Se f* > f_casa (ex: 5), a perna de place da casa PAGA A MAIS.
//
// ⚠️ Usa a odd da EXCHANGE como se fosse a da casa — isso é OTIMISTA, a casa
// paga menos. Por isso o output principal é o HAIRCUT DE BREAK-EVEN: quanto a
// odd da casa pode ser pior que a exchange antes da perna de place virar
// negativa. Fechar o teste exige odds reais de casa (odds_enriched/sp_decimal).
//
// Uso: BSP_DIR=... npx ts-node src/oneTimeScript/each_way_structure.ts
import fs from "node:fs";
import path from "node:path";
const DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";

interface Run {
	sel: string;
	bspW: number;
	wonW: boolean;
}
const winRaces = new Map<string, Map<string, Run>>();
const plcRaces = new Map<
	string,
	Map<string, { bsp: number; placed: boolean }>
>();
const meta = new Map<string, { name: string; date: string }>();

for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".csv"))) {
	const isPlace = /place/i.test(f);
	const lines = fs.readFileSync(path.join(DIR, f), "utf8").split("\n");
	for (let i = 1; i < lines.length; i++) {
		const c = lines[i].split(",");
		if (c.length < 17) continue;
		const bsp = +c[7];
		if (!(bsp > 0)) continue;
		const key = `${c[1]}|${c[3]}`;
		const sel = c[4];
		const dm = c[3].match(/(\d{2})-(\d{2})-(\d{4})/);
		if (!dm) continue;
		if (isPlace) {
			if (!plcRaces.has(key)) plcRaces.set(key, new Map());
			plcRaces.get(key)!.set(sel, { bsp, placed: +c[6] === 1 });
		} else {
			if (!winRaces.has(key)) winRaces.set(key, new Map());
			winRaces.get(key)!.set(sel, { sel, bspW: bsp, wonW: +c[6] === 1 });
			meta.set(key, { name: c[2], date: `${dm[3]}-${dm[2]}-${dm[1]}` });
		}
	}
}

// termos padrão UK/IRE por nº de vagas e tipo
function termFor(places: number, isHcap: boolean, field: number): number {
	if (places <= 2) return 4; // 5-7 corredores: 1/4, 2 vagas
	if (places === 3) {
		if (isHcap && field >= 12) return 4; // handicap 12-15: 1/4, 3 vagas
		return 5; // demais 8+: 1/5, 3 vagas
	}
	return 4; // handicap 16+: 1/4, 4 vagas
}

interface Row {
	key: string;
	O: number;
	pPlace: number;
	fStar: number;
	fBook: number;
	places: number;
	field: number;
	rank: number;
	hcap: boolean;
}
const rows: Row[] = [];
let joined = 0;
for (const [key, wr] of winRaces) {
	const pr = plcRaces.get(key);
	if (!pr) continue;
	const places = [...pr.values()].filter((p) => p.placed).length;
	if (places < 2 || places > 4) continue;
	joined++;
	const m = meta.get(key)!;
	const hcap = /Hcap/i.test(m.name);
	const field = wr.size;
	const sorted = [...wr.values()].sort((a, b) => a.bspW - b.bspW);
	sorted.forEach((r, idx) => {
		const p = pr.get(r.sel);
		if (!p || !(p.bsp > 0)) return;
		const Opl = p.bsp; // odd justa de colocação (overround 0,11%)
		if (Opl <= 1.01) return;
		const fStar = (r.bspW - 1) / (Opl - 1);
		rows.push({
			key,
			O: r.bspW,
			pPlace: 1 / Opl,
			fStar,
			fBook: termFor(places, hcap, field),
			places,
			field,
			rank: idx + 1,
			hcap,
		});
	});
}

console.log(`\n💰 EACH-WAY — régua estrutural\n`);
console.log(
	`  corridas com win+place casados: ${joined} | runners: ${rows.length}\n`,
);

// EV da perna de place a odds da exchange, e haircut de break-even
function evPlace(r: Row, haircut: number) {
	const O = 1 + (r.O - 1) * haircut; // odd da casa = exchange com desconto
	const Opl = 1 + (O - 1) / r.fBook;
	return r.pPlace * Opl - 1;
}
function beHaircut(r: Row) {
	// resolve pPlace*(1+(1+(O-1)h-1)/f) = 1  ->  h = f*(1/pPlace - 1)/(O-1)
	return (r.fBook * (1 / r.pPlace - 1)) / (r.O - 1);
}

const bands: [string, (r: Row) => boolean][] = [
	["2 vagas (5-7 corr.)", (r) => r.places === 2],
	["3 vagas, n/hcap", (r) => r.places === 3 && !r.hcap],
	["3 vagas, hcap 8-11", (r) => r.places === 3 && r.hcap && r.field < 12],
	["3 vagas, hcap 12+", (r) => r.places === 3 && r.hcap && r.field >= 12],
	["4 vagas (hcap 16+)", (r) => r.places === 4],
];
console.log(
	`  ${"grupo".padEnd(22)} ${"n".padStart(7)} ${"f* med".padStart(7)} ${"f_casa".padStart(7)} ${"EV place @1.0".padStart(14)} ${"h break-even".padStart(13)}`,
);
for (const [lab, sel] of bands) {
	const g = rows.filter(sel);
	if (!g.length) continue;
	const fs_ = g.map((r) => r.fStar).sort((a, b) => a - b);
	const ev = g.reduce((s, r) => s + evPlace(r, 1), 0) / g.length;
	const bh = g.map(beHaircut).sort((a, b) => a - b);
	console.log(
		`  ${lab.padEnd(22)} ${String(g.length).padStart(7)} ${fs_[Math.floor(fs_.length / 2)].toFixed(2).padStart(7)} ${String(g[0].fBook).padStart(7)} ${(100 * ev).toFixed(2).padStart(13)}% ${bh[Math.floor(bh.length / 2)].toFixed(3).padStart(13)}`,
	);
}

console.log(
	`\n  ── EV da perna de PLACE por faixa de odd e nº de vagas (odds da exchange) ──`,
);
console.log(
	`  ${"odd win".padEnd(12)} ${"2 vagas".padStart(10)} ${"3 vagas".padStart(10)} ${"4 vagas".padStart(10)}`,
);
const obands: [string, number, number][] = [
	["[2,5)", 2, 5],
	["[5,10)", 5, 10],
	["[10,20)", 10, 20],
	["[20,50)", 20, 50],
	["[50,+)", 50, 1e9],
];
for (const [lab, lo, hi] of obands) {
	const cells = [2, 3, 4].map((pl) => {
		const g = rows.filter((r) => r.places === pl && r.O >= lo && r.O < hi);
		if (g.length < 200) return "     —    ";
		const ev = g.reduce((s, r) => s + evPlace(r, 1), 0) / g.length;
		return `${(100 * ev).toFixed(2)}% (${g.length > 9999 ? Math.round(g.length / 1000) + "k" : g.length})`.padStart(
			10,
		);
	});
	console.log(`  ${lab.padEnd(12)} ${cells.join(" ")}`);
}

console.log(`\n  ── FRAÇÃO JUSTA f* por faixa de odd (mediana) ──`);
console.log(
	`  Se f* > f_casa a perna de place paga a mais. f_casa = 4 (2 e 4 vagas), 5 (3 vagas).`,
);
console.log(
	`  ${"odd win".padEnd(12)} ${"2 vagas".padStart(9)} ${"3 vagas".padStart(9)} ${"4 vagas".padStart(9)}`,
);
for (const [lab, lo, hi] of obands) {
	const cells = [2, 3, 4].map((pl) => {
		const g = rows
			.filter((r) => r.places === pl && r.O >= lo && r.O < hi)
			.map((r) => r.fStar)
			.sort((a, b) => a - b);
		if (g.length < 200) return "    —    ";
		return g[Math.floor(g.length / 2)].toFixed(2).padStart(9);
	});
	console.log(`  ${lab.padEnd(12)} ${cells.join(" ")}`);
}

function evWin(r: Row, h: number) {
	const O = 1 + (r.O - 1) * h;
	return (1 / r.O) * O - 1;
}
function evEW(r: Row, h: number) {
	return (evWin(r, h) + evPlace(r, h)) / 2;
}
console.log(
	`\n  ── EV TOTAL da aposta EACH-WAY (win+place) vs haircut da casa ──`,
);
console.log(
	`  haircut h: odd da casa = 1 + (odd_exchange - 1) * h. h=1 seria a casa pagando`,
);
console.log(
	`  exatamente o preço da exchange (impossível); h~0.8-0.9 é realista em azarão.`,
);
console.log(
	`  ${"grupo".padEnd(22)} ${"n".padStart(7)} ${"h=1.00".padStart(9)} ${"h=0.90".padStart(9)} ${"h=0.85".padStart(9)} ${"h=0.80".padStart(9)} ${"h=0.75".padStart(9)}`,
);
for (const [lab, sel] of bands) {
	const g = rows.filter(sel);
	if (!g.length) continue;
	const cells = [1, 0.9, 0.85, 0.8, 0.75].map((h) =>
		`${((100 * g.reduce((s, r) => s + evEW(r, h), 0)) / g.length).toFixed(2)}%`.padStart(
			9,
		),
	);
	console.log(
		`  ${lab.padEnd(22)} ${String(g.length).padStart(7)} ${cells.join(" ")}`,
	);
}
console.log(`\n  ── EV TOTAL por faixa de odd (h=0.85), por nº de vagas ──`);
console.log(
	`  ${"odd win".padEnd(12)} ${"2 vagas".padStart(11)} ${"3 vagas".padStart(11)} ${"4 vagas".padStart(11)}`,
);
for (const [lab, lo, hi] of obands) {
	const cells = [2, 3, 4].map((pl) => {
		const g = rows.filter((r) => r.places === pl && r.O >= lo && r.O < hi);
		if (g.length < 200) return "     —     ";
		return `${((100 * g.reduce((s, r) => s + evEW(r, 0.85), 0)) / g.length).toFixed(2)}%`.padStart(
			11,
		);
	});
	console.log(`  ${lab.padEnd(12)} ${cells.join(" ")}`);
}
