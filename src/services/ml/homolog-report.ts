// Relatório diário de homologação: picks × resultados reais.
// Substitui a checagem manual — roda após o enriquecimento das 20:00 (cron)
// e salva JSON em homolog_reports/ no bucket, além de logar o resumo.
//
// Semântica de position (race_horses_hr_enriched):
//   null/undefined → sem resultado ainda
//   99             → placeholder "não processado" (descoberto 2026-07-06)
//   0              → non-runner
//   1              → LAY LOSS (cavalo venceu)
//   >1             → lay win
//
// P/L segue o simulador: stake 10, win = +stake×(1−comissão),
// loss = −stake×(odd−1). Picks fora do range [13,20] são REPORTADOS mas
// excluídos do P/L "apostável" (a cascata real não os apostaria — anomalia
// conhecida do selectMainPick, fix pendente pós-homologação).

import { supabase } from "../..";
import {
	getDataSchema,
	getOutputSchema,
	modelPath,
} from "../../shared/db-config";
import { logger } from "../../shared/logger";
import { MAX_ODD_THRESHOLD, MIN_ODD_THRESHOLD } from "./claude-generate-picks";
import { BUCKET } from "./eval/harness";
import { COMMISSION_RATE, STAKE } from "./eval/simulator";

interface DayStats {
	picks: number;
	decided: number;
	wins: number;
	losses: number;
	nonRunners: number;
	pending: number;
	offRange: number;
	pnlBettable: number; // só picks dentro do range
	byModel: Record<string, { picks: number; wins: number; losses: number }>;
}

export interface HomologReport {
	generatedAt: string;
	periodDays: number;
	commissionRate: number;
	stake: number;
	oddRange: [number, number];
	days: Record<string, DayStats>;
	totals: DayStats & { winRate: number | null };
}

function emptyDay(): DayStats {
	return {
		picks: 0,
		decided: 0,
		wins: 0,
		losses: 0,
		nonRunners: 0,
		pending: 0,
		offRange: 0,
		pnlBettable: 0,
		byModel: {},
	};
}

export async function generateHomologReport(
	periodDays = 10,
): Promise<HomologReport | null> {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - periodDays);
	const cutoffStr = cutoff.toISOString().split("T")[0];

	const { data: picks, error } = await supabase
		.schema(getOutputSchema())
		.from("lay_betting_picks")
		.select("race_date, race_horse_id, market_odd, model_version")
		.gte("race_date", cutoffStr)
		.order("race_date");
	if (error) {
		logger.error(
			"Homolog report: falha ao buscar picks",
			new Error(error.message),
		);
		return null;
	}
	if (!picks || picks.length === 0) {
		logger.warn("Homolog report: nenhum pick no período");
		return null;
	}

	const ids = picks.map((p) => p.race_horse_id);
	const rhMap = new Map<
		number,
		{ position: number | null; sp: number | null }
	>();
	const CHUNK = 500;
	for (let i = 0; i < ids.length; i += CHUNK) {
		const { data: rh, error: e2 } = await supabase
			.schema(getDataSchema())
			.from("race_horses_hr_enriched")
			.select("id, position, sp_decimal")
			.in("id", ids.slice(i, i + CHUNK));
		if (e2) {
			logger.error(
				"Homolog report: falha ao buscar posições",
				new Error(e2.message),
			);
			return null;
		}
		for (const r of rh || [])
			rhMap.set(r.id, {
				position: r.position,
				sp: r.sp_decimal ? Number(r.sp_decimal) : null,
			});
	}

	const days: Record<string, DayStats> = {};
	const totals = emptyDay();

	for (const p of picks) {
		const day = (days[p.race_date] ??= emptyDay());
		const rh = rhMap.get(p.race_horse_id);
		// Odd de LARGADA quando existe (é a odd em que a aposta real aconteceria
		// — drift mediano geração→SP é ~35%, ver analyze_odds_drift); fallback
		// pra odd da geração enquanto o resultado não chega.
		const odd = rh?.sp && rh.sp > 1 ? rh.sp : Number(p.market_odd);
		const inRange = odd >= MIN_ODD_THRESHOLD && odd <= MAX_ODD_THRESHOLD;
		const pos = rh?.position;

		for (const s of [day, totals]) {
			s.picks++;
			if (!inRange) s.offRange++;
			const m = (s.byModel[p.model_version] ??= {
				picks: 0,
				wins: 0,
				losses: 0,
			});
			m.picks++;

			if (pos === null || pos === undefined || pos === 99) {
				s.pending++;
			} else if (pos === 0) {
				s.nonRunners++;
			} else if (pos === 1) {
				s.decided++;
				s.losses++;
				m.losses++;
				if (inRange) s.pnlBettable -= STAKE * (odd - 1);
			} else {
				s.decided++;
				s.wins++;
				m.wins++;
				if (inRange) s.pnlBettable += STAKE * (1 - COMMISSION_RATE);
			}
		}
	}

	const report: HomologReport = {
		generatedAt: new Date().toISOString(),
		periodDays,
		commissionRate: COMMISSION_RATE,
		stake: STAKE,
		oddRange: [MIN_ODD_THRESHOLD, MAX_ODD_THRESHOLD],
		days,
		totals: {
			...totals,
			winRate: totals.decided > 0 ? totals.wins / totals.decided : null,
		},
	};

	// Log resumido (uma linha por dia + total)
	for (const [d, s] of Object.entries(days)) {
		const wr =
			s.decided > 0 ? `${((s.wins / s.decided) * 100).toFixed(1)}%` : "—";
		logger.info(
			`Homolog ${d}: ${s.picks} picks | decididos ${s.decided} | WR ${wr} | P/L apostável ${s.pnlBettable.toFixed(2)} | fora-range ${s.offRange} | pendentes ${s.pending}`,
		);
	}
	const twr =
		report.totals.winRate !== null
			? `${(report.totals.winRate * 100).toFixed(2)}%`
			: "—";
	logger.info(
		`Homolog TOTAL (${periodDays}d): ${totals.picks} picks | WR ${twr} | P/L apostável ${totals.pnlBettable.toFixed(2)} | fora-range ${totals.offRange}`,
	);

	// Persistência best-effort no bucket
	const today = new Date().toISOString().split("T")[0];
	const path = modelPath(
		`horse_probability_model/homolog_reports/${today}.json`,
	);
	const { error: upErr } = await supabase.storage
		.from(BUCKET)
		.upload(path, new TextEncoder().encode(JSON.stringify(report, null, 2)), {
			contentType: "application/json",
			upsert: true,
		});
	if (upErr) {
		logger.warn(`Homolog report: falha ao salvar no bucket (${upErr.message})`);
	} else {
		logger.info(`Homolog report salvo: ${path}`);
	}

	return report;
}
