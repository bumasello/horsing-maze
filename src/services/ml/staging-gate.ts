// Staging gate pro retreino automático (TODO alta prioridade do CLAUDE.md,
// implementado 2026-07-04).
//
// Fluxo por modelType (flat, jump):
//   1. Treina candidato → baselines/candidate_{type} (via EXPERIMENT_LABEL,
//      prod NÃO é tocado durante o treino)
//   2. Avalia candidato vs prod atual: simulação LAY nos últimos
//      GATE_PERIOD_DAYS com regras de pick 1:1 com prod (funções importadas
//      de claude-generate-picks, odds sp_decimal, P/L com odd real)
//   3. Promove (com backup do prod) conforme GATE_MODE:
//        "bootstrap" (default, desde 2026-08-19): bootstrap PAREADO por corrida
//           do ROI de LAY (candidato − prod). Promove só se
//           IC95_lower(ROI_diff) > 0 E pnl_candidato > pnl_prod.
//        "edge_tolerance" (legado): edge_cand >= edge_prod - GATE_EDGE_TOLERANCE_PP.
//      Em ambos, apostas simuladas >= GATE_MIN_BETS.
//   4. Grava log da decisão em staging_gate_logs/ no bucket
//
// ⚠️ CAVEAT metodológico: a janela de eval é IN-SAMPLE pro candidato (treinado
// com dados até ontem) e ~OOS pro prod (treinado antes). O gate protege contra
// REGRESSÃO (candidato quebrado, dado ruim, treino degenerado) — o edge do
// candidato reportado aqui NÃO é estimativa não-enviesada de ROI futuro.
//
// ⚠️ POR QUE O MODO LEGADO FOI APOSENTADO (2026-08-19): `edge_cand >= edge_prod
// - 0.2pp` compara dois pontos sem intervalo. Em 90 dias (~520 apostas) o
// erro-padrão da margem é da ordem de ~1pp — o limiar de 0.2pp é ~5x mais fino
// que a resolução da medição, então entre dois modelos parecidos a promoção era
// sorteio. GATE_MIN_BETS=30 também estava duas ordens de grandeza abaixo das
// ~6.200 apostas necessárias pra distinguir edge de zero (medição de 2026-08-12).
//
// ✅ GATE ATIVO desde 2026-08-20: horsingmaze-prd tem ENABLE_CRON_RETRAIN=1.
// O retreino roda no cron diário (00:00 local / 03:00 UTC). Foi ligado DEPOIS
// de o pré-registro #1 ser executado, então não há mais janela cega a preservar.
//
// ⚠️ Volume por tipo vs GATE_MIN_BETS=300, medido em 2026-08-20:
//     flat: 545 apostas/90d → passa, é julgado pelo bootstrap
//     jump: 200 apostas/90d → REJEITA SEMPRE por amostra insuficiente
// Manter o jump no retreino foi decisão consciente do usuário: ele treina e é
// descartado. Se um dia isso incomodar, GATE_TYPES=flat resolve.

import { supabase } from "../..";
import { modelPath } from "../../shared/db-config";
import { logger } from "../../shared/logger";
import type { ModelConfig } from "../../shared/types/ml.types";
import { MAX_ODD_THRESHOLD, MIN_ODD_THRESHOLD } from "./claude-generate-picks";
import {
	type BootstrapCI,
	bootstrapRisk,
	pairedRoiBootstrap,
} from "./eval/bootstrap";
import {
	BANKROLL_INITIAL,
	BUCKET,
	type LoadedModel,
	download,
	loadModelFromPath,
	loadPeriodData,
	predictRace,
	simulateWithPredictor,
} from "./eval/harness";
import { type ModelSummary, summarize } from "./eval/report";
import { COMMISSION_RATE, STAKE, type SimResult } from "./eval/simulator";
import {
	MODEL_TYPE_CONFIG,
	type ModelType,
	trainLayBettingModel,
} from "./training_final";

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const GATE_PERIOD_DAYS = Number(process.env.GATE_PERIOD_DAYS || 90);
// Candidato pode ser até X pp PIOR que prod e ainda promover (mantém modelo
// fresco tolerando ruído). Espec original do CLAUDE.md: 0.2pp.
const GATE_EDGE_TOLERANCE_PP = Number(
	process.env.GATE_EDGE_TOLERANCE_PP || 0.2,
);
// Amostra mínima de apostas simuladas pra decisão ser significativa.
// Subido de 30 pra 300 em 2026-08-19: 30 não sustenta nenhuma inferência.
// Continua MUITO abaixo das ~6.200 necessárias pra distinguir edge de zero —
// serve pra barrar candidato degenerado, não pra confirmar edge.
const GATE_MIN_BETS = Number(process.env.GATE_MIN_BETS || 300);

// "bootstrap" (default) | "edge_tolerance" (legado, ver caveat no topo)
const GATE_MODE = (process.env.GATE_MODE || "bootstrap").trim();
// Iterações do cluster bootstrap por corrida.
const GATE_BOOTSTRAP_B = Number(process.env.GATE_BOOTSTRAP_B || 1000);

// Controles operacionais (teste/dry-run — ver run_staging_gate.ts):
//   GATE_DRY_RUN=1         → avalia e loga decisão mas NÃO promove nem escreve log no bucket
//   GATE_SKIP_TRAINING=1   → pula o treino, usa candidato já salvo no path
//   GATE_CANDIDATE_LABEL=x → avalia baselines/x_{type} como candidato (default "candidate")
const GATE_DRY_RUN = (process.env.GATE_DRY_RUN || "").trim() === "1";
const GATE_SKIP_TRAINING =
	(process.env.GATE_SKIP_TRAINING || "").trim() === "1";
const CANDIDATE_LABEL = (
	process.env.GATE_CANDIDATE_LABEL || "candidate"
).trim();

const FILES = ["model.json", "weights.bin", "config.json"];
const CONTENT_TYPES: Record<string, string> = {
	"model.json": "application/json",
	"weights.bin": "application/octet-stream",
	"config.json": "application/json",
};

function prodPath(modelType: ModelType): string {
	return modelPath(
		`horse_probability_model/${MODEL_TYPE_CONFIG[modelType].name}`,
	);
}

function candidatePath(modelType: ModelType): string {
	return modelPath(
		`horse_probability_model/baselines/${CANDIDATE_LABEL}_${modelType}`,
	);
}

function backupPath(modelType: ModelType): string {
	const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
	return modelPath(
		`horse_probability_model/baselines/prod_backup_${today}_${modelType}`,
	);
}

// ============================================================================
// STORAGE HELPERS (download/loadModelFromPath vêm do eval/harness)
// ============================================================================

async function upload(
	path: string,
	content: Uint8Array,
	contentType: string,
): Promise<void> {
	const { error } = await supabase.storage.from(BUCKET).upload(path, content, {
		contentType,
		upsert: true,
	});
	if (error) throw new Error(`upload ${path}: ${error.message}`);
}

// ============================================================================
// PROMOÇÃO
// ============================================================================

async function promoteCandidate(
	modelType: ModelType,
	gateMeta: Record<string, unknown>,
): Promise<number> {
	const source = candidatePath(modelType);
	const prod = prodPath(modelType);
	const backup = backupPath(modelType);

	const sourceFiles: Record<string, Uint8Array> = {};
	for (const f of FILES) {
		sourceFiles[f] = await download(`${source}/${f}`);
	}

	// Backup do prod atual (se existir)
	for (const f of FILES) {
		try {
			const bytes = await download(`${prod}/${f}`);
			await upload(`${backup}/${f}`, bytes, CONTENT_TYPES[f]);
		} catch {
			logger.warn(`Staging gate: ${prod}/${f} não existe — skip backup`);
		}
	}

	// Version bump preservando a sequência do prod
	let newVersion = 1;
	try {
		const prodCfg = JSON.parse(
			Buffer.from(await download(`${prod}/config.json`)).toString("utf8"),
		) as ModelConfig;
		newVersion = (prodCfg.version || 0) + 1;
	} catch {
		// primeiro deploy neste path
	}

	const candidateCfg = JSON.parse(
		Buffer.from(sourceFiles["config.json"]).toString("utf8"),
	) as ModelConfig;
	const promotedCfg = {
		...candidateCfg,
		version: newVersion,
		promoted_from: source,
		promoted_at: new Date().toISOString(),
		staging_gate: gateMeta,
	};

	await upload(
		`${prod}/model.json`,
		sourceFiles["model.json"],
		CONTENT_TYPES["model.json"],
	);
	await upload(
		`${prod}/weights.bin`,
		sourceFiles["weights.bin"],
		CONTENT_TYPES["weights.bin"],
	);
	await upload(
		`${prod}/config.json`,
		new TextEncoder().encode(JSON.stringify(promotedCfg, null, 2)),
		CONTENT_TYPES["config.json"],
	);

	return newVersion;
}

// ============================================================================
// LOG DA DECISÃO
// ============================================================================

interface GateDecision {
	date: string;
	modelType: ModelType;
	decision: "promoted" | "promoted_no_prod" | "rejected";
	reason: string;
	promotedVersion: number | null;
	params: {
		mode: string;
		periodDays: number;
		edgeTolerancePp: number;
		minBets: number;
		minOdd: number;
		maxOdd: number;
		commissionRate: number;
		stake: number;
		bootstrapB: number;
	};
	candidate: ModelSummary;
	prod: ModelSummary | null;
	// Preenchido só no GATE_MODE=bootstrap
	stats: {
		roiDiff: BootstrapCI; // candidato − prod, pareado por corrida
		nPairedRaces: number;
		candidateRoi: BootstrapCI;
		candidateMaxDrawdown: BootstrapCI;
		prodRoi: BootstrapCI | null;
		prodMaxDrawdown: BootstrapCI | null;
	} | null;
}

async function saveGateLog(decision: GateDecision): Promise<void> {
	const path = modelPath(
		`horse_probability_model/staging_gate_logs/${decision.date}_${decision.modelType}.json`,
	);
	try {
		await upload(
			path,
			new TextEncoder().encode(JSON.stringify(decision, null, 2)),
			"application/json",
		);
	} catch (e) {
		// Log é best-effort — não pode derrubar o pipeline
		logger.error(
			"Staging gate: falha ao salvar log da decisão",
			e instanceof Error ? e : new Error(String(e)),
		);
	}
}

// ============================================================================
// GATE POR TIPO DE MODELO
// ============================================================================

async function runGateForType(modelType: ModelType): Promise<void> {
	const label = MODEL_TYPE_CONFIG[modelType].label;

	if (GATE_SKIP_TRAINING) {
		logger.info(
			`Staging gate [${label}]: GATE_SKIP_TRAINING=1 — usando candidato existente em ${candidatePath(modelType)}`,
		);
	} else {
		logger.info(`Staging gate [${label}]: treinando candidato...`);
		// Treina candidato em path isolado via EXPERIMENT_LABEL (save/restore do env)
		const prevLabel = process.env.EXPERIMENT_LABEL;
		process.env.EXPERIMENT_LABEL = CANDIDATE_LABEL;
		try {
			await trainLayBettingModel(modelType);
		} finally {
			// "" é equivalente a unset pro getExperimentLabel() (trim + falsy)
			process.env.EXPERIMENT_LABEL = prevLabel ?? "";
		}
		if (global.gc) global.gc();
	}

	logger.info(`Staging gate [${label}]: avaliando candidato vs prod...`);
	const candidate = await loadModelFromPath(
		candidatePath(modelType),
		modelType,
	);

	let prod: LoadedModel | null = null;
	try {
		prod = await loadModelFromPath(prodPath(modelType), modelType);
	} catch {
		logger.warn(
			`Staging gate [${label}]: modelo de prod não existe — candidato será promovido sem comparação`,
		);
	}

	const raceMap = await loadPeriodData(
		MODEL_TYPE_CONFIG[modelType].raceTypes,
		GATE_PERIOD_DAYS,
	);
	logger.info(
		`Staging gate [${label}]: ${raceMap.size} corridas nos últimos ${GATE_PERIOD_DAYS} dias`,
	);

	const params = {
		mode: GATE_MODE,
		periodDays: GATE_PERIOD_DAYS,
		edgeTolerancePp: GATE_EDGE_TOLERANCE_PP,
		minBets: GATE_MIN_BETS,
		minOdd: MIN_ODD_THRESHOLD,
		maxOdd: MAX_ODD_THRESHOLD,
		commissionRate: COMMISSION_RATE,
		stake: STAKE,
		bootstrapB: GATE_BOOTSTRAP_B,
	};
	const today = new Date().toISOString().slice(0, 10);

	try {
		// Simulação crua por corrida — o bootstrap precisa dos SimResult, não
		// só do agregado.
		const candResults: SimResult[] = simulateWithPredictor(raceMap, (h) =>
			predictRace(h, candidate),
		);
		const prodResults: SimResult[] | null = prod
			? simulateWithPredictor(raceMap, (h) => predictRace(h, prod))
			: null;

		const candSummary = summarize(
			`candidate_${modelType}`,
			candResults,
			BANKROLL_INITIAL,
		);
		const prodSummary = prodResults
			? summarize(`prod_${modelType}`, prodResults, BANKROLL_INITIAL)
			: null;

		const candEdgePp = candSummary.edge * 100;
		const prodEdgePp = prodSummary ? prodSummary.edge * 100 : null;
		logger.info(
			`Staging gate [${label}]: candidato edge=${candEdgePp.toFixed(2)}pp (${candSummary.betsPlaced} apostas, pnl=${candSummary.totalPnl.toFixed(0)}) | prod edge=${prodEdgePp !== null ? prodEdgePp.toFixed(2) : "n/a"}pp (${prodSummary?.betsPlaced ?? 0} apostas, pnl=${prodSummary?.totalPnl.toFixed(0) ?? "n/a"})`,
		);

		// Bootstrap: risco de cada lado + diff pareado por corrida.
		let stats: GateDecision["stats"] = null;
		if (GATE_MODE === "bootstrap") {
			const candRisk = bootstrapRisk(candResults, STAKE, GATE_BOOTSTRAP_B);
			const prodRisk = prodResults
				? bootstrapRisk(prodResults, STAKE, GATE_BOOTSTRAP_B)
				: null;
			const paired = prodResults
				? pairedRoiBootstrap(candResults, prodResults, STAKE, GATE_BOOTSTRAP_B)
				: { roiDiff: { mean: 0, lo95: 0, hi95: 0 }, nRaces: 0 };
			stats = {
				roiDiff: paired.roiDiff,
				nPairedRaces: paired.nRaces,
				candidateRoi: candRisk.roi,
				candidateMaxDrawdown: candRisk.maxDrawdown,
				prodRoi: prodRisk ? prodRisk.roi : null,
				prodMaxDrawdown: prodRisk ? prodRisk.maxDrawdown : null,
			};
			const pctOf = (c: BootstrapCI) =>
				`${(c.mean * 100).toFixed(2)}% [${(c.lo95 * 100).toFixed(2)}, ${(c.hi95 * 100).toFixed(2)}]`;
			logger.info(
				`Staging gate [${label}]: ROI cand=${pctOf(candRisk.roi)}${
					prodRisk ? ` | ROI prod=${pctOf(prodRisk.roi)}` : ""
				} | diff pareado=${pctOf(paired.roiDiff)} (${paired.nRaces} corridas, B=${GATE_BOOTSTRAP_B})`,
			);
			logger.info(
				`Staging gate [${label}]: max drawdown cand=${candRisk.maxDrawdown.mean.toFixed(0)} [${candRisk.maxDrawdown.lo95.toFixed(0)}, ${candRisk.maxDrawdown.hi95.toFixed(0)}]${
					prodRisk
						? ` | prod=${prodRisk.maxDrawdown.mean.toFixed(0)} [${prodRisk.maxDrawdown.lo95.toFixed(0)}, ${prodRisk.maxDrawdown.hi95.toFixed(0)}]`
						: ""
				} (banca inicial ${BANKROLL_INITIAL}, stake ${STAKE})`,
			);
		}

		let decision: GateDecision["decision"];
		let reason: string;

		if (!prodSummary || prodEdgePp === null) {
			decision = "promoted_no_prod";
			reason = "Sem modelo de prod pra comparar — promoção direta.";
		} else if (candSummary.betsPlaced < GATE_MIN_BETS) {
			decision = "rejected";
			reason = `Amostra insuficiente: ${candSummary.betsPlaced} apostas < GATE_MIN_BETS=${GATE_MIN_BETS}.`;
		} else if (GATE_MODE === "bootstrap") {
			// Critério novo: o candidato precisa ser melhor que o prod com
			// significância, não por diferença pontual. IC95 do diff pareado
			// tem que excluir zero POR CIMA, e o P/L tem que acompanhar.
			const lo = stats?.roiDiff.lo95 ?? 0;
			const pnlBetter = candSummary.totalPnl > prodSummary.totalPnl;
			if (lo > 0 && pnlBetter) {
				decision = "promoted";
				reason = `IC95 do ROI pareado (cand−prod) = [${(lo * 100).toFixed(2)}%, ${((stats?.roiDiff.hi95 ?? 0) * 100).toFixed(2)}%] exclui zero por cima, e pnl_cand ${candSummary.totalPnl.toFixed(0)} > pnl_prod ${prodSummary.totalPnl.toFixed(0)}.`;
			} else {
				decision = "rejected";
				const why = !pnlBetter
					? `pnl_cand ${candSummary.totalPnl.toFixed(0)} <= pnl_prod ${prodSummary.totalPnl.toFixed(0)}`
					: `IC95 do ROI pareado = [${(lo * 100).toFixed(2)}%, ${((stats?.roiDiff.hi95 ?? 0) * 100).toFixed(2)}%] não exclui zero`;
				reason = `${why}. Prod mantido; candidato fica em ${candidatePath(modelType)} pra análise.`;
			}
		} else if (candEdgePp >= prodEdgePp - GATE_EDGE_TOLERANCE_PP) {
			decision = "promoted";
			reason = `[legado] edge_cand ${candEdgePp.toFixed(2)}pp >= edge_prod ${prodEdgePp.toFixed(2)}pp - ${GATE_EDGE_TOLERANCE_PP}pp.`;
		} else {
			decision = "rejected";
			reason = `[legado] edge_cand ${candEdgePp.toFixed(2)}pp < edge_prod ${prodEdgePp.toFixed(2)}pp - ${GATE_EDGE_TOLERANCE_PP}pp. Prod mantido; candidato fica em ${candidatePath(modelType)} pra análise.`;
		}

		let promotedVersion: number | null = null;
		if (GATE_DRY_RUN) {
			logger.info(
				`Staging gate [${label}]: 🧪 DRY RUN — decisão seria "${decision}" (${reason}). Nada foi escrito.`,
			);
			return;
		}
		if (decision !== "rejected") {
			promotedVersion = await promoteCandidate(modelType, {
				decision,
				reason,
				candidate_edge_pp: candEdgePp,
				prod_edge_pp: prodEdgePp,
				stats,
				...params,
			});
			logger.info(
				`Staging gate [${label}]: ✅ PROMOVIDO → v${promotedVersion} (${reason})`,
			);
		} else {
			logger.warn(`Staging gate [${label}]: ❌ REJEITADO — ${reason}`);
		}

		await saveGateLog({
			date: today,
			modelType,
			decision,
			reason,
			promotedVersion,
			params,
			candidate: candSummary,
			prod: prodSummary,
			stats,
		});
	} finally {
		candidate.model.dispose();
		if (prod) prod.model.dispose();
		if (global.gc) global.gc();
	}
}

// ============================================================================
// ENTRY POINT (substitui trainAllModels no cron quando ENABLE_CRON_RETRAIN=1)
// ============================================================================

export async function trainAllModelsWithGate(): Promise<void> {
	logger.info(
		`Staging gate: retreino gated iniciando (mode=${GATE_MODE}, period=${GATE_PERIOD_DAYS}d, min_bets=${GATE_MIN_BETS}, B=${GATE_BOOTSTRAP_B})`,
	);
	const start = Date.now();

	// GATE_TYPES=jump (ou flat) restringe a um tipo — útil pra rodadas manuais
	const types = (process.env.GATE_TYPES || "flat,jump")
		.split(",")
		.map((t) => t.trim())
		.filter((t): t is ModelType => t === "flat" || t === "jump");
	const failures: string[] = [];
	for (const t of types) {
		try {
			await runGateForType(t);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			failures.push(`${t}: ${msg}`);
			logger.error(
				`Staging gate [${t}]: falhou — prod mantido intacto`,
				e instanceof Error ? e : new Error(msg),
			);
		}
	}

	const secs = ((Date.now() - start) / 1000).toFixed(0);
	if (failures.length > 0) {
		logger.warn(
			`Staging gate: concluído em ${secs}s com falhas (${failures.join("; ")})`,
		);
	} else {
		logger.info(`Staging gate: concluído em ${secs}s`);
	}
}
