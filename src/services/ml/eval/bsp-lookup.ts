// Lookup de Betfair SP a partir dos CSVs históricos gratuitos
// (promo.betfair.com/betfairsp/prices). Adquiridos 2026-07-12 — ver
// memory/project_bsp_corpus_acquired.md.
//
// Cada CSV: event_id,menu_hint,event_name,event_dt,selection_id,selection_name,
//   win_lose,bsp,ppwap,morningwap,ppmax,ppmin,ipmax,ipmin,
//   morningtradedvol,pptradedvol,iptradedvol
//
// ⚠️ O NOME DO ARQUIVO não bate com a data das corridas — usar event_dt.
// Join key: data (event_dt) + course (menu_hint) + nome do cavalo (selection_name).

import fs from "node:fs";
import path from "node:path";

export interface BspRow {
	bsp: number; // Betfair Starting Price (odd decimal)
	morningwap: number; // odd média ponderada da manhã (sinal de drift)
	ppmax: number; // máxima pré-corrida
	ppmin: number; // mínima pré-corrida
	winLose: number; // 1 = venceu, 0 = perdeu
	course: string; // course normalizado (do menu_hint) — desempate de colisão
}

// Normaliza nome de cavalo/course pra join tolerante:
// lowercase, remove sufixo de país "(IRE)"/"(GB)"/..., remove tudo que não é alnum.
export function normName(s: string): string {
	return s
		.toLowerCase()
		.replace(/\([a-z]{2,3}\)/g, "") // sufixo de país
		.replace(/[^a-z0-9]/g, "");
}

// menu_hint = "Ffos Las 30th Jun" → course "ffoslas".
// Remove o sufixo de data " <dia>(st|nd|rd|th) <Mês>" e normaliza.
export function courseFromMenuHint(menuHint: string): string {
	const stripped = menuHint.replace(/\s+\d{1,2}(st|nd|rd|th)\s+\w+\s*$/i, "");
	return normName(stripped);
}

// event_dt "30-06-2026 19:39" → { date: "2026-06-30", time: "19:39" }
export function parseEventDt(eventDt: string): { date: string; time: string } {
	const [d, t] = eventDt.trim().split(/\s+/);
	const [dd, mm, yyyy] = d.split("-");
	return { date: `${yyyy}-${mm}-${dd}`, time: t ?? "" };
}

export type BspLookup = Map<string, BspRow>;

// Chave do join: data|cavalo. O course FICA FORA da chave de propósito — o
// menu_hint do Betfair usa nomes de festival ("Royal Ascot", "Cheltenham
// Festival") que não batem com nosso course plano ("Ascot", "Cheltenham"). Um
// cavalo corre no máx 1x/dia, então (data,cavalo) é praticamente único; course
// vira só desempate de colisão (nomes iguais em pistas diferentes no mesmo dia).
export function bspKey(date: string, horse: string): string {
	return `${date}|${horse}`;
}

function num(s: string): number {
	const n = Number(s);
	return Number.isFinite(n) ? n : 0;
}

// "YYYY-MM-DD" +/- offset dias
function shiftDate(date: string, offset: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + offset);
	return d.toISOString().split("T")[0];
}

/**
 * Busca BSP por (data, cavalo) com tolerância de ±1 dia. Alguns meetings têm
 * a data deslocada em 1 (bug de timezone na ingestão — ex: Redcar nosso 06-20
 * = Betfair 06-19). Tenta exato primeiro; offset ∈ {0,-1,+1}. `horse` deve vir
 * já normalizado (normName). Retorna também o offset usado (0 = match exato).
 */
export function lookupBsp(
	lookup: BspLookup,
	date: string,
	horseNorm: string,
): { row: BspRow; offset: number } | undefined {
	for (const off of [0, -1, 1]) {
		const row = lookup.get(
			bspKey(off === 0 ? date : shiftDate(date, off), horseNorm),
		);
		if (row) return { row, offset: off };
	}
	return undefined;
}

/**
 * Carrega todos os CSVs de um diretório e monta o lookup por (data,cavalo).
 * Colisão real (mesmo dia+nome, courses diferentes) → chave marcada ambígua e
 * descartada no match (não chuta). Aceita só linhas com bsp > 0.
 */
export function loadBspLookup(dir: string): {
	lookup: BspLookup;
	files: number;
	rows: number;
	ambiguous: number;
} {
	const lookup: BspLookup = new Map();
	const ambiguousKeys = new Set<string>();
	let files = 0;
	let rows = 0;
	const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".csv"));
	for (const f of entries) {
		const content = fs.readFileSync(path.join(dir, f), "utf8");
		const lines = content.split(/\r?\n/);
		// primeira linha = header
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			const c = line.split(",");
			if (c.length < 8) continue;
			// 0 event_id,1 menu_hint,2 event_name,3 event_dt,4 selection_id,
			// 5 selection_name,6 win_lose,7 bsp,8 ppwap,9 morningwap,10 ppmax,11 ppmin
			const { date } = parseEventDt(c[3]);
			const course = courseFromMenuHint(c[1]);
			const horse = normName(c[5]);
			const bsp = num(c[7]);
			if (bsp <= 0 || !date || !horse) continue;
			const key = bspKey(date, horse);
			const existing = lookup.get(key);
			if (existing && existing.course !== course) {
				// mesmo dia+nome em courses diferentes = ambíguo → descarta
				ambiguousKeys.add(key);
				continue;
			}
			lookup.set(key, {
				bsp,
				morningwap: num(c[9]),
				ppmax: num(c[10]),
				ppmin: num(c[11]),
				winLose: num(c[6]),
				course,
			});
			rows++;
		}
		files++;
	}
	for (const k of ambiguousKeys) lookup.delete(k);
	return { lookup, files, rows, ambiguous: ambiguousKeys.size };
}
