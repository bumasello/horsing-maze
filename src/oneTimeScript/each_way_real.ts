// EACH-WAY com odd REAL de casa e P/L REALIZADO — o teste que decide.
//
// Livre de modelo: não há probabilidade estimada em lugar nenhum. Usa
//   • sp_decimal (SP da casa, Supabase) — uma EW "at SP" liquida literalmente por ele
//   • desfecho real de vitória (CSV win) e de colocação (CSV place da Betfair)
//   • termos de EW padrão UK/IRE derivados de nº de vagas + handicap + campo
//
// P/L de 1 unidade win + 1 unidade place (2 unidades no total):
//   perna win:   venceu ? (sp-1) : -1
//   perna place: colocou ? (sp-1)/f : -1
// ROI = P/L total / (2 × n).  IC95 = cluster bootstrap POR CORRIDA.
// Split FIT [<2025-10-01] / HELD [>=2025-10-01]; a leitura é o HELD.
//
// Uso: NO_CRON=1 BSP_DIR=... npx ts-node src/oneTimeScript/each_way_real.ts
import dotenv from "dotenv";
dotenv.config();
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const SCH = process.env.SCH || "hml";
const FROM = process.env.FROM || "2024-01-01";
const TO = process.env.TO || "2026-08-18";
const SPLIT = process.env.SPLIT || "2025-10-01";
const B = Number(process.env.B || 2000);
const C = Number(process.env.COMMISSION || 0.065);
const db = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL as string,
	process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
	{ db: { schema: SCH } },
);

const norm = (s: string) =>
	s
		.toLowerCase()
		.replace(/\([a-z]{2,3}\)/g, "")
		.replace(/[^a-z0-9]/g, "");

// ---------- 1. CSVs Betfair ----------
interface CsvRun {
	bspW: number;
	won: boolean;
	bspP: number;
	placed: boolean;
	raceKey: string;
	field: number;
	places: number;
	hcap: boolean;
	date: string;
	mw: number;
}
function loadCsv(): Map<string, CsvRun> {
	const win = new Map<string, any>(); // date|horse
	const raceOf = new Map<string, string>();
	const raceRows = new Map<string, string[]>();
	const raceMeta = new Map<string, { hcap: boolean }>();
	const plc = new Map<string, { bsp: number; placed: boolean; race: string }>();
	const plcRace = new Map<string, number>();
	for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".csv"))) {
		const isPlace = /place/i.test(f);
		const lines = fs.readFileSync(path.join(DIR, f), "utf8").split("\n");
		for (let i = 1; i < lines.length; i++) {
			const c = lines[i].split(",");
			if (c.length < 17) continue;
			const bsp = +c[7];
			if (!(bsp > 0)) continue;
			const dm = c[3].match(/(\d{2})-(\d{2})-(\d{4})/);
			if (!dm) continue;
			const date = `${dm[3]}-${dm[2]}-${dm[1]}`;
			if (date < FROM || date > TO) continue;
			const race = `${c[1]}|${c[3]}`;
			const key = `${date}|${norm(c[5])}`;
			if (isPlace) {
				plc.set(key, { bsp, placed: +c[6] === 1, race });
				if (+c[6] === 1) plcRace.set(race, (plcRace.get(race) || 0) + 1);
			} else {
				win.set(key, { bsp, won: +c[6] === 1, race, date, mw: +c[9] });
				raceOf.set(key, race);
				if (!raceRows.has(race)) raceRows.set(race, []);
				raceRows.get(race)!.push(key);
				raceMeta.set(race, { hcap: /Hcap/i.test(c[2]) });
			}
		}
	}
	const out = new Map<string, CsvRun>();
	for (const [key, w] of win) {
		const p = plc.get(key);
		if (!p) continue;
		const places = plcRace.get(p.race) || 0;
		if (places < 2 || places > 4) continue;
		out.set(key, {
			bspW: w.bsp,
			won: w.won,
			bspP: p.bsp,
			placed: p.placed,
			raceKey: w.race,
			mw: w.mw,
			field: (raceRows.get(w.race) || []).length,
			places,
			hcap: raceMeta.get(w.race)!.hcap,
			date: w.date,
		});
	}
	return out;
}

// ---------- 2. Supabase: sp_decimal ----------
async function loadSp(): Promise<Map<string, number>> {
	const out = new Map<string, number>();
	let page = 0;
	const rcIds: { id: number; date: string }[] = [];
	for (;;) {
		const { data, error } = await db
			.from("racecards_hr_enriched")
			.select("id,date")
			.gte("date", FROM)
			.lte("date", TO)
			.order("id")
			.range(page * 1000, page * 1000 + 999);
		if (error) throw error;
		if (!data || !data.length) break;
		rcIds.push(...(data as any[]));
		page++;
		if (data.length < 1000) break;
	}
	console.log(`  Supabase: ${rcIds.length} racecards em [${FROM}, ${TO}]`);
	const dateOf = new Map(rcIds.map((r) => [r.id, r.date]));
	const ids = rcIds.map((r) => r.id);
	for (let i = 0; i < ids.length; i += 150) {
		const chunk = ids.slice(i, i + 150);
		for (let off = 0; ; off += 1000) {
			const { data, error } = await db
				.from("race_horses_hr_enriched")
				.select("racecard_id,horse,sp_decimal,non_runner")
				.in("racecard_id", chunk)
				.range(off, off + 999);
			if (error) throw error;
			if (!data || !data.length) break;
			for (const r of data as any[]) {
				if (r.non_runner) continue;
				if (!(r.sp_decimal > 1)) continue;
				const d = dateOf.get(r.racecard_id);
				if (!d) continue;
				out.set(`${d}|${norm(r.horse)}`, r.sp_decimal);
			}
			if (data.length < 1000) break;
		}
		if (i % 3000 === 0)
			process.stdout.write(`\r  runners carregados: ${out.size}   `);
	}
	console.log(`\r  Supabase: ${out.size} runners com sp_decimal        `);
	return out;
}

// ---------- 3. termos de EW ----------
function termFor(places: number, hcap: boolean, field: number): number {
	if (places <= 2) return 4;
	if (places === 3) return hcap && field >= 12 ? 4 : 5;
	return 4;
}

interface Row {
	raceKey: string;
	date: string;
	sp: number;
	bspW: number;
	bspP: number;
	mw: number;
	won: boolean;
	placed: boolean;
	f: number;
	places: number;
	field: number;
	hcap: boolean;
}
function plWin(r: Row) {
	return r.won ? r.sp - 1 : -1;
}
function plPlace(r: Row) {
	return r.placed ? (r.sp - 1) / r.f : -1;
}
function roiEW(rows: Row[]) {
	let s = 0;
	for (const r of rows) s += plWin(r) + plPlace(r);
	return (100 * s) / (2 * rows.length);
}
function roiPlaceOnly(rows: Row[]) {
	let s = 0;
	for (const r of rows) s += plPlace(r);
	return (100 * s) / rows.length;
}

function boot(rows: Row[], fn: (r: Row[]) => number): [number, number] {
	const m = new Map<string, Row[]>();
	for (const r of rows) {
		if (!m.has(r.raceKey)) m.set(r.raceKey, []);
		m.get(r.raceKey)!.push(r);
	}
	const rc = [...m.values()];
	const o: number[] = [];
	for (let b = 0; b < B; b++) {
		const s: Row[] = [];
		for (let i = 0; i < rc.length; i++)
			s.push(...rc[(Math.random() * rc.length) | 0]);
		o.push(fn(s));
	}
	o.sort((a, b2) => a - b2);
	return [o[Math.floor(0.025 * B)], o[Math.floor(0.975 * B)]];
}

async function main() {
	console.log(
		"\n💰 EACH-WAY com odd REAL de casa — P/L realizado, sem modelo\n",
	);
	const csv = loadCsv();
	console.log(`  CSVs: ${csv.size} runners com win+place casados`);
	const sp = await loadSp();
	const rows: Row[] = [];
	for (const [key, c] of csv) {
		const s = sp.get(key);
		if (!s) continue;
		rows.push({
			raceKey: c.raceKey,
			date: c.date,
			sp: s,
			bspW: c.bspW,
			bspP: c.bspP,
			mw: c.mw,
			won: c.won,
			placed: c.placed,
			f: termFor(c.places, c.hcap, c.field),
			places: c.places,
			field: c.field,
			hcap: c.hcap,
		});
	}
	console.log(
		`  JOIN final: ${rows.length} runners (${((100 * rows.length) / csv.size).toFixed(1)}% dos CSVs)\n`,
	);

	const hc = rows.map((r) => (r.sp - 1) / (r.bspW - 1)).sort((a, b) => a - b);
	console.log(`  ▸ HAIRCUT REAL da casa vs exchange, h=(SP-1)/(BSP-1):`);
	console.log(
		`    p10=${hc[Math.floor(0.1 * hc.length)].toFixed(3)}  mediana=${hc[Math.floor(0.5 * hc.length)].toFixed(3)}  p90=${hc[Math.floor(0.9 * hc.length)].toFixed(3)}`,
	);
	for (const [lab, lo, hi] of [
		["[2,5)", 2, 5],
		["[5,10)", 5, 10],
		["[10,20)", 10, 20],
		["[20,50)", 20, 50],
		["[50,+)", 50, 1e9],
	] as [string, number, number][]) {
		const g = rows
			.filter((r) => r.bspW >= lo && r.bspW < hi)
			.map((r) => (r.sp - 1) / (r.bspW - 1))
			.sort((a, b) => a - b);
		if (g.length < 100) continue;
		console.log(
			`      odd ${lab.padEnd(9)} n=${String(g.length).padStart(6)}  h_mediano=${g[Math.floor(0.5 * g.length)].toFixed(3)}`,
		);
	}

	const fit = rows.filter((r) => r.date < SPLIT),
		held = rows.filter((r) => r.date >= SPLIT);
	console.log(`\n  FIT ${fit.length} | HELD ${held.length}\n`);
	const groups: [string, (r: Row) => boolean][] = [
		["2 vagas (5-7 corr.)", (r) => r.places === 2],
		["3 vagas, não-handicap", (r) => r.places === 3 && !r.hcap],
		["3 vagas, handicap 8-11", (r) => r.places === 3 && r.hcap && r.field < 12],
		["3 vagas, handicap 12+", (r) => r.places === 3 && r.hcap && r.field >= 12],
		["4 vagas (handicap 16+)", (r) => r.places === 4],
	];
	for (const [lab, win] of [
		["FIT", fit],
		["HELD", held],
	] as [string, Row[]][]) {
		console.log(
			`  ── ${lab} — ROI da EACH-WAY completa (e da perna de place isolada) ──`,
		);
		console.log(
			`    ${"grupo".padEnd(24)} ${"n".padStart(7)} ${"ROI EW".padStart(8)} ${"IC95 EW".padStart(18)} ${"ROI place".padStart(10)} ${"IC95 place".padStart(18)}`,
		);
		for (const [g, sel] of groups) {
			const rr = win.filter(sel);
			if (rr.length < 200) {
				console.log(
					`    ${g.padEnd(24)} ${String(rr.length).padStart(7)}  (amostra insuficiente)`,
				);
				continue;
			}
			const [a, b2] = boot(rr, roiEW);
			const [c2, d2] = boot(rr, roiPlaceOnly);
			const fl = a > 0 ? " ✅" : "";
			console.log(
				`    ${g.padEnd(24)} ${String(rr.length).padStart(7)} ${roiEW(rr).toFixed(2).padStart(7)}% [${a.toFixed(2)}, ${b2.toFixed(2)}]`.padEnd(
					76,
				) +
					` ${roiPlaceOnly(rr).toFixed(2).padStart(9)}% [${c2.toFixed(2)}, ${d2.toFixed(2)}]${fl}`,
			);
		}
		console.log("");
	}
	console.log(
		`  ── HELD, por faixa de odd × nº de vagas (ROI da EW completa) ──`,
	);
	console.log(
		`    ${"odd (SP)".padEnd(12)} ${"2 vagas".padStart(14)} ${"3 vagas".padStart(14)} ${"4 vagas".padStart(14)}`,
	);
	for (const [lab, lo, hi] of [
		["[2,5)", 2, 5],
		["[5,10)", 5, 10],
		["[10,20)", 10, 20],
		["[20,50)", 20, 50],
		["[50,+)", 50, 1e9],
	] as [string, number, number][]) {
		const cells = [2, 3, 4].map((pl) => {
			const g = held.filter((r) => r.places === pl && r.sp >= lo && r.sp < hi);
			if (g.length < 200) return "      —       ";
			return `${roiEW(g).toFixed(1)}% (${g.length})`.padStart(14);
		});
		console.log(`    ${lab.padEnd(12)} ${cells.join(" ")}`);
	}
	runArb(rows);

	// ===== EW COM HEDGE NA EXCHANGE (a versão profissional) =====
	// back EW na casa "at SP" + lay das duas pernas na exchange "at BSP".
	// Todas as 4 ordens são enviadas ANTES da largada; nenhum preço é conhecido na
	// hora de decidir. Logo NÃO há look-ahead — desde que a SELEÇÃO use só o que se
	// sabe de manhã (nº de vagas, campo, handicap, odd da manhã).
	// Lay com comissão c: neutralizar back de 1 na odd O contra exchange na odd X
	//   → stake L = O/(X-c), resultado travado = O(1-c)/(X-c) - 1.
	function arbLeg(O: number, X: number) {
		return X > C ? (O * (1 - C)) / (X - C) - 1 : Number.NaN;
	}
	function arbEW(r: Row) {
		const oPl = 1 + (r.sp - 1) / r.f;
		const a = arbLeg(r.sp, r.bspW),
			b = arbLeg(oPl, r.bspP);
		return Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : Number.NaN;
	}
	function runArb(rows: Row[]) {
		console.log(
			`\n  ══ EW COM HEDGE NA EXCHANGE (lay das 2 pernas no BSP, comissão ${C}) ══`,
		);
		console.log(
			`     Travado por aposta, sem exposição ao desfecho. Seleção só por dados de manhã.`,
		);
		const held2 = rows.filter((r) => r.date >= SPLIT);
		const mwBands: [string, number, number][] = [
			["[2,5)", 2, 5],
			["[5,10)", 5, 10],
			["[10,20)", 10, 20],
			["[20,50)", 20, 50],
			["[50,+)", 50, 1e9],
		];
		console.log(
			`     ${"grupo".padEnd(24)} ${"faixa odd manhã".padEnd(10)} ${"n".padStart(7)} ${"lucro travado".padStart(14)}`,
		);
		for (const [lab, sel] of groups) {
			for (const [bl, lo, hi] of mwBands) {
				const g = held2.filter(
					(r) => sel(r) && r.mw >= lo && r.mw < hi && Number.isFinite(arbEW(r)),
				);
				if (g.length < 200) continue;
				const m = g.reduce((s, r) => s + arbEW(r), 0) / g.length;
				const pos = g.filter((r) => arbEW(r) > 0).length;
				console.log(
					`     ${lab.padEnd(24)} ${bl.padEnd(10)} ${String(g.length).padStart(7)} ${(100 * m).toFixed(2).padStart(13)}%   (${((100 * pos) / g.length).toFixed(1)}% das apostas dão lucro)`,
				);
			}
		}
		const all = held2.filter((r) => Number.isFinite(arbEW(r)));
		const m = all.reduce((s, r) => s + arbEW(r), 0) / all.length;
		console.log(
			`\n     TOTAL HELD: n=${all.length}  lucro travado médio ${(100 * m).toFixed(2)}%  |  ${((100 * all.filter((r) => arbEW(r) > 0).length) / all.length).toFixed(1)}% das apostas seriam lucrativas`,
		);
		const best = [...all].sort((a, b) => arbEW(b) - arbEW(a)).slice(0, 5);
		console.log(
			`     melhor caso observado: ${(100 * arbEW(best[0])).toFixed(1)}% (SP ${best[0].sp}, BSP_win ${best[0].bspW.toFixed(1)}, BSP_place ${best[0].bspP.toFixed(2)}, ${best[0].places} vagas)`,
		);
	}
}
main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
