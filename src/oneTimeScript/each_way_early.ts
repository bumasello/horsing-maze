// EACH-WAY no PREÇO DE MANHÃ com Best Odds Guaranteed — o steelman.
//
// Um apostador de EW de valor não aposta "at SP": pega o melhor preço matinal
// entre as casas e conta com o BOG (paga o MAIOR entre o preço tomado e o SP).
// Isso é estritamente melhor que o teste "at SP" — se perder AQUI, perde sempre.
//
// Fontes: odds_enriched (5 casas, preço matinal) + sp_decimal (SP) + CSVs
// Betfair (desfecho de vitória e de colocação, nº de vagas).
// P/L realizado, sem modelo. Preço efetivo = max(melhor odd de manhã, SP).
//
// Uso: NO_CRON=1 BSP_DIR=... npx ts-node src/oneTimeScript/each_way_early.ts
import dotenv from "dotenv";
dotenv.config();
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
const DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const FROM = process.env.FROM || "2026-03-16",
	TO = process.env.TO || "2026-08-18";
const B = Number(process.env.B || 2000);
const db = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL as string,
	process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
	{ db: { schema: process.env.SCH || "hml" } },
);
const norm = (s: string) =>
	s
		.toLowerCase()
		.replace(/\([a-z]{2,3}\)/g, "")
		.replace(/[^a-z0-9]/g, "");

interface C {
	won: boolean;
	placed: boolean;
	places: number;
	field: number;
	hcap: boolean;
	raceKey: string;
	date: string;
	mw: number;
	bsp: number;
}
function loadCsv(): Map<string, C> {
	const win = new Map<string, any>(),
		plc = new Map<string, boolean>(),
		plcN = new Map<string, number>();
	const rows = new Map<string, string[]>(),
		meta = new Map<string, boolean>();
	for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".csv"))) {
		const isP = /place/i.test(f);
		for (const line of fs
			.readFileSync(path.join(DIR, f), "utf8")
			.split("\n")
			.slice(1)) {
			const c = line.split(",");
			if (c.length < 17) continue;
			if (!(+c[7] > 0)) continue;
			const dm = c[3].match(/(\d{2})-(\d{2})-(\d{4})/);
			if (!dm) continue;
			const date = `${dm[3]}-${dm[2]}-${dm[1]}`;
			if (date < FROM || date > TO) continue;
			const race = `${c[1]}|${c[3]}`,
				key = `${date}|${norm(c[5])}`;
			if (isP) {
				plc.set(key, +c[6] === 1);
				if (+c[6] === 1) plcN.set(race, (plcN.get(race) || 0) + 1);
			} else {
				win.set(key, { won: +c[6] === 1, race, date, mw: +c[9], bsp: +c[7] });
				if (!rows.has(race)) rows.set(race, []);
				rows.get(race)!.push(key);
				meta.set(race, /Hcap/i.test(c[2]));
			}
		}
	}
	const out = new Map<string, C>();
	for (const [k, w] of win) {
		if (!plc.has(k)) continue;
		const places = plcN.get(w.race) || 0;
		if (places < 2 || places > 4) continue;
		out.set(k, {
			won: w.won,
			placed: plc.get(k)!,
			places,
			field: (rows.get(w.race) || []).length,
			hcap: meta.get(w.race)!,
			raceKey: w.race,
			date: w.date,
			mw: w.mw,
			bsp: w.bsp,
		});
	}
	return out;
}
function termFor(p: number, h: boolean, fd: number) {
	if (p <= 2) return 4;
	if (p === 3) return h && fd >= 12 ? 4 : 5;
	return 4;
}

async function main() {
	console.log("\n💰 EACH-WAY no preço de MANHÃ com BOG — o steelman\n");
	const csv = loadCsv();
	console.log(`  CSVs na janela [${FROM}, ${TO}]: ${csv.size} runners`);
	// racecards -> data
	const rc: any[] = [];
	for (let p = 0; ; p++) {
		const { data, error } = await db
			.from("racecards_hr_enriched")
			.select("id,date")
			.gte("date", FROM)
			.lte("date", TO)
			.order("id")
			.range(p * 1000, p * 1000 + 999);
		if (error) throw error;
		if (!data?.length) break;
		rc.push(...data);
		if (data.length < 1000) break;
	}
	const dateOf = new Map(rc.map((r: any) => [r.id, r.date]));
	// race_horses -> id, horse, sp
	const rh = new Map<number, { key: string; sp: number; pos: number }>();
	const ids = rc.map((r: any) => r.id);
	for (let i = 0; i < ids.length; i += 150) {
		const ch = ids.slice(i, i + 150);
		for (let off = 0; ; off += 1000) {
			const { data, error } = await db
				.from("race_horses_hr_enriched")
				.select("id,racecard_id,horse,sp_decimal,non_runner,position")
				.in("racecard_id", ch)
				.range(off, off + 999);
			if (error) throw error;
			if (!data?.length) break;
			for (const r of data as any[]) {
				if (r.non_runner) continue;
				const d = dateOf.get(r.racecard_id);
				if (!d) continue;
				rh.set(r.id, {
					key: `${d}|${norm(r.horse)}`,
					sp: r.sp_decimal,
					pos: Number(r.position),
				});
			}
			if (data.length < 1000) break;
		}
	}
	console.log(`  race_horses na janela: ${rh.size}`);
	// odds_enriched -> melhor odd de manhã por race_horse_id
	const best = new Map<number, { odd: number; bookie: string }>();
	const nb = new Map<number, number>();
	for (let p = 0; ; p++) {
		const { data, error } = await db
			.from("odds_enriched")
			.select("race_horse_id,bookie,odd")
			.order("id")
			.range(p * 1000, p * 1000 + 999);
		if (error) throw error;
		if (!data?.length) break;
		for (const r of data as any[]) {
			if (!(r.odd > 1)) continue;
			nb.set(r.race_horse_id, (nb.get(r.race_horse_id) || 0) + 1);
			const cur = best.get(r.race_horse_id);
			if (!cur || r.odd > cur.odd)
				best.set(r.race_horse_id, { odd: r.odd, bookie: r.bookie });
		}
		if (data.length < 1000) break;
	}
	console.log(
		`  odds_enriched: ${best.size} runners com preço de manhã (média de ${([...nb.values()].reduce((a, b) => a + b, 0) / nb.size).toFixed(1)} casas por cavalo)`,
	);

	interface R {
		raceKey: string;
		O: number;
		Oearly: number;
		sp: number;
		won: boolean;
		placed: boolean;
		f: number;
		places: number;
		mw: number;
		bsp: number;
		pos: number;
	}
	const out: R[] = [];
	for (const [rhid, v] of rh) {
		const b = best.get(rhid);
		if (!b) continue;
		const c = csv.get(v.key);
		if (!c) continue;
		const eff = Math.max(b.odd, v.sp > 1 ? v.sp : 0);
		if (!(eff > 1)) continue;
		out.push({
			raceKey: c.raceKey,
			O: eff,
			Oearly: b.odd,
			sp: v.sp,
			won: c.won,
			placed: c.placed,
			f: termFor(c.places, c.hcap, c.field),
			places: c.places,
			mw: c.mw,
			bsp: c.bsp,
			pos: v.pos,
		});
	}
	console.log(
		`  JOIN final (odds manhã × SP × desfecho): ${out.length} runners\n`,
	);
	if (out.length < 500) {
		console.log("  amostra insuficiente");
		return;
	}

	const upl = out.filter((r) => r.O > r.sp).length;
	console.log(
		`  ▸ BOG: preço de manhã > SP em ${((100 * upl) / out.length).toFixed(1)}% dos casos`,
	);
	console.log(
		`    ganho médio do melhor preço sobre o SP: ${(100 * (out.reduce((s, r) => s + r.O / Math.max(r.sp, 1.01), 0) / out.length - 1)).toFixed(2)}%\n`,
	);

	const ew = (rr: R[]) => {
		let s = 0;
		for (const r of rr) {
			s += (r.won ? r.O - 1 : -1) + (r.placed ? (r.O - 1) / r.f : -1);
		}
		return (100 * s) / (2 * rr.length);
	};
	const winOnly = (rr: R[]) => {
		let s = 0;
		for (const r of rr) s += r.won ? r.O - 1 : -1;
		return (100 * s) / rr.length;
	};
	const plcOnly = (rr: R[]) => {
		let s = 0;
		for (const r of rr) s += r.placed ? (r.O - 1) / r.f : -1;
		return (100 * s) / rr.length;
	};
	const boot = (rr: R[], fn: (x: R[]) => number): [number, number] => {
		const m = new Map<string, R[]>();
		for (const r of rr) {
			if (!m.has(r.raceKey)) m.set(r.raceKey, []);
			m.get(r.raceKey)!.push(r);
		}
		const g = [...m.values()],
			o: number[] = [];
		for (let b = 0; b < B; b++) {
			const s: R[] = [];
			for (let i = 0; i < g.length; i++)
				s.push(...g[(Math.random() * g.length) | 0]);
			o.push(fn(s));
		}
		o.sort((a, b2) => a - b2);
		return [o[Math.floor(0.025 * B)], o[Math.floor(0.975 * B)]];
	};

	console.log(
		`  ${"grupo".padEnd(26)} ${"n".padStart(6)} ${"ROI EW".padStart(8)} ${"IC95".padStart(18)} ${"só win".padStart(8)} ${"só place".padStart(9)}`,
	);
	const gs: [string, (r: R) => boolean][] = [
		["TODOS", () => true],
		["2 vagas", (r) => r.places === 2],
		["3 vagas", (r) => r.places === 3],
		["4 vagas (hcap 16+)", (r) => r.places === 4],
		["4 vagas, odd [10,50)", (r) => r.places === 4 && r.O >= 10 && r.O < 50],
		["odd [20,50)", (r) => r.O >= 20 && r.O < 50],
		["odd [50,+)", (r) => r.O >= 50],
	];
	for (const [lab, sel] of gs) {
		const rr = out.filter(sel);
		if (rr.length < 200) {
			console.log(
				`  ${lab.padEnd(26)} ${String(rr.length).padStart(6)}  (amostra insuficiente)`,
			);
			continue;
		}
		const [a, b2] = boot(rr, ew);
		console.log(
			`  ${lab.padEnd(26)} ${String(rr.length).padStart(6)} ${ew(rr).toFixed(2).padStart(7)}% [${a.toFixed(2)}, ${b2.toFixed(2)}]`.padEnd(
				64,
			) +
				` ${winOnly(rr).toFixed(2).padStart(7)}% ${plcOnly(rr).toFixed(2).padStart(8)}%${a > 0 ? " ✅" : ""}`,
		);
	}

	// ===== HEDGE SÓ DA PERNA DE VITÓRIA =====
	// A perna de place é o ativo; a de vitória é o passivo obrigatório. Lança-se
	// lay da perna de vitória na exchange e mantém-se a de place exposta.
	// Lay dimensionado pelo preço CONHECIDO na hora (Oearly); o upgrade do BOG,
	// se vier, é bônus não-hedgeado. Comissão só sobre ganho de lay.
	const CM = 0.065;
	function hedged(r: R, X: number): number {
		if (!(X > 1.01)) return Number.NaN;
		const L = r.Oearly / (X - CM);
		const win = r.won ? r.O - 1 - L * (X - 1) : -1 + L * (1 - CM);
		const plc2 = r.placed ? (r.O - 1) / r.f : -1;
		return (win + plc2) / 2; // por 2 unidades apostadas
	}
	function roiH(rr: R[], which: "mw" | "bsp") {
		let s = 0,
			n = 0;
		for (const r of rr) {
			const v = hedged(r, which === "mw" ? r.mw : r.bsp);
			if (Number.isFinite(v)) {
				s += v;
				n++;
			}
		}
		return n ? (100 * s) / n : Number.NaN;
	}
	function bootH(rr: R[], which: "mw" | "bsp"): [number, number] {
		const m = new Map<string, R[]>();
		for (const r of rr) {
			if (!m.has(r.raceKey)) m.set(r.raceKey, []);
			m.get(r.raceKey)!.push(r);
		}
		const g = [...m.values()],
			o: number[] = [];
		for (let b = 0; b < B; b++) {
			const s: R[] = [];
			for (let i = 0; i < g.length; i++)
				s.push(...g[(Math.random() * g.length) | 0]);
			o.push(roiH(s, which));
		}
		o.sort((a, b2) => a - b2);
		return [o[Math.floor(0.025 * B)], o[Math.floor(0.975 * B)]];
	}

	console.log(`\n  ══ HEDGE DA PERNA DE VITÓRIA (place fica exposta) ══`);
	console.log(
		`  ${"grupo".padEnd(26)} ${"n".padStart(6)} ${"lay @ manhã".padStart(12)} ${"IC95".padStart(18)} ${"lay @ BSP".padStart(11)}`,
	);
	for (const [lab, sel] of gs) {
		const rr = out.filter(sel).filter((r) => r.mw > 1.01 && r.bsp > 1.01);
		if (rr.length < 200) continue;
		const [a, b2] = bootH(rr, "mw");
		console.log(
			`  ${lab.padEnd(26)} ${String(rr.length).padStart(6)} ${roiH(rr, "mw").toFixed(2).padStart(11)}% [${a.toFixed(2)}, ${b2.toFixed(2)}]`.padEnd(
				68,
			) + ` ${roiH(rr, "bsp").toFixed(2).padStart(10)}%${a > 0 ? " ✅" : ""}`,
		);
	}

	// ===== VAGA EXTRA (a promoção onde os profissionais de EW operam) =====
	// A casa paga N+1 ou N+2 vagas nos mesmos termos fracionários. Usa a posição
	// real de chegada (Supabase) pra recalcular a perna de place.
	console.log(
		`\n  ══ PROMOÇÃO DE VAGA EXTRA — EW no preço de manhã com BOG ══`,
	);
	const withPos = out.filter((r) => Number.isFinite(r.pos) && r.pos > 0);
	console.log(
		`  runners com posição de chegada: ${withPos.length} de ${out.length}`,
	);
	const ewK = (rr: R[], extra: number) => {
		let s = 0;
		for (const r of rr) {
			const k = r.places + extra;
			s += (r.won ? r.O - 1 : -1) + (r.pos <= k ? (r.O - 1) / r.f : -1);
		}
		return (100 * s) / (2 * rr.length);
	};
	const bootK = (rr: R[], extra: number): [number, number] => {
		const m = new Map<string, R[]>();
		for (const r of rr) {
			if (!m.has(r.raceKey)) m.set(r.raceKey, []);
			m.get(r.raceKey)!.push(r);
		}
		const g = [...m.values()],
			o: number[] = [];
		for (let b = 0; b < B; b++) {
			const s: R[] = [];
			for (let i = 0; i < g.length; i++)
				s.push(...g[(Math.random() * g.length) | 0]);
			o.push(ewK(s, extra));
		}
		o.sort((a, b2) => a - b2);
		return [o[Math.floor(0.025 * B)], o[Math.floor(0.975 * B)]];
	};
	console.log(
		`  ${"grupo".padEnd(26)} ${"n".padStart(6)} ${"padrão".padStart(9)} ${"+1 vaga".padStart(9)} ${"IC95 (+1)".padStart(18)} ${"+2 vagas".padStart(9)}`,
	);
	for (const [lab, sel] of gs) {
		const rr = withPos.filter(sel);
		if (rr.length < 200) continue;
		const [a, b2] = bootK(rr, 1);
		console.log(
			`  ${lab.padEnd(26)} ${String(rr.length).padStart(6)} ${ewK(rr, 0).toFixed(2).padStart(8)}% ${ewK(rr, 1).toFixed(2).padStart(8)}% [${a.toFixed(2)}, ${b2.toFixed(2)}]`.padEnd(
				70,
			) + ` ${ewK(rr, 2).toFixed(2).padStart(8)}%${a > 0 ? " ✅" : ""}`,
		);
	}
}
main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
