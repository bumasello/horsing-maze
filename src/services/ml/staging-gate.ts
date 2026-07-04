// Staging gate pro retreino automático (TODO alta prioridade do CLAUDE.md,
// implementado 2026-07-04).
//
// Fluxo por modelType (flat, jump):
//   1. Treina candidato → baselines/candidate_{type} (via EXPERIMENT_LABEL,
//      prod NÃO é tocado durante o treino)
//   2. Avalia candidato vs prod atual: simulação LAY nos últimos
//      GATE_PERIOD_DAYS com regras de pick 1:1 com prod (funções importadas
//      de claude-generate-picks, odds sp_decimal, P/L com odd real)
//   3. Promove (com backup do prod) se:
//        edge_candidato >= edge_prod - GATE_EDGE_TOLERANCE_PP
//        E apostas simuladas >= GATE_MIN_BETS
//   4. Grava log da decisão em staging_gate_logs/ no bucket
//
// ⚠️ CAVEAT metodológico: a janela de eval é IN-SAMPLE pro candidato (treinado
// com dados até ontem) e ~OOS pro prod (treinado antes). O gate protege contra
// REGRESSÃO (candidato quebrado, dado ruim, treino degenerado) — o edge do
// candidato reportado aqui NÃO é estimativa não-enviesada de ROI futuro.

import * as tf from "@tensorflow/tfjs-node";
import { supabase } from "../..";
import "./layers/attention";
import { logger } from "../../shared/logger";
import type { ModelConfig } from "../../shared/types/ml.types";
import {
	MAX_ODD_THRESHOLD,
	MIN_ODD_THRESHOLD,
	calculateCombinedScore,
	calculateLayValueIndex,
} from "./claude-generate-picks";
import { type ModelSummary, summarize } from "./eval/report";
import {
	COMMISSION_RATE,
	type PickCandidate,
	simulateRace,
} from "./eval/simulator";
import {
	MODEL_TYPE_CONFIG,
	type ModelType,
	trainLayBettingModel,
} from "./training_final";

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const BUCKET = "modelos-tfjs-publicos";
const MAX_HORSES = 30;
const BANKROLL_INITIAL = 200;

const GATE_PERIOD_DAYS = Number(process.env.GATE_PERIOD_DAYS || 90);
// Candidato pode ser até X pp PIOR que prod e ainda promover (mantém modelo
// fresco tolerando ruído). Espec original do CLAUDE.md: 0.2pp.
const GATE_EDGE_TOLERANCE_PP = Number(
	process.env.GATE_EDGE_TOLERANCE_PP || 0.2,
);
// Amostra mínima de apostas simuladas pra decisão ser significativa.
const GATE_MIN_BETS = Number(process.env.GATE_MIN_BETS || 30);

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

// Mesmos defaults de claude-prediction-model.ts (paridade com prod).
const DEFAULT_TEMPERATURE: Record<ModelType, number> = {
	flat: 1.5,
	jump: 1.2,
};

const supabaseUrl =
	process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";

const FILES = ["model.json", "weights.bin", "config.json"];
const CONTENT_TYPES: Record<string, string> = {
	"model.json": "application/json",
	"weights.bin": "application/octet-stream",
	"config.json": "application/json",
};

function prodPath(modelType: ModelType): string {
	return `horse_probability_model/${MODEL_TYPE_CONFIG[modelType].name}`;
}

function candidatePath(modelType: ModelType): string {
	return `horse_probability_model/baselines/${CANDIDATE_LABEL}_${modelType}`;
}

function backupPath(modelType: ModelType): string {
	const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
	return `horse_probability_model/baselines/prod_backup_${today}_${modelType}`;
}

// ============================================================================
// STORAGE HELPERS
// ============================================================================

async function download(path: string): Promise<Uint8Array> {
	const { data, error } = await supabase.storage.from(BUCKET).download(path);
	if (error || !data) throw new Error(`download ${path}: ${error?.message}`);
	return new Uint8Array(await data.arrayBuffer());
}

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

interface LoadedModel {
	config: ModelConfig;
	model: tf.LayersModel;
	temperature: number;
}

async function loadModelFromPath(
	path: string,
	modelType: ModelType,
): Promise<LoadedModel> {
	const cfgBytes = await download(`${path}/config.json`);
	const config = JSON.parse(
		Buffer.from(cfgBytes).toString("utf8"),
	) as ModelConfig;
	const modelUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}/model.json`;
	const model = await tf.loadLayersModel(modelUrl);
	const temperature =
		(config as unknown as { softmaxTemperature?: number }).softmaxTemperature ??
		DEFAULT_TEMPERATURE[modelType];
	return { config, model, temperature };
}

// ============================================================================
// DADOS DO PERÍODO DE EVAL
// ============================================================================

interface HorseRecord {
	race_id: number;
	race_date: string;
	race_horse_id: number;
	horse_id: number;
	features: Record<string, number | null>;
	finish_position: number;
	non_runner: boolean;
	market_odd: number;
}

async function loadPeriodData(
	raceTypes: string[],
): Promise<Map<number, HorseRecord[]>> {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - GATE_PERIOD_DAYS);
	const cutoffStr = cutoff.toISOString().split("T")[0];

	const pageSize = 1000;
	let page = 0;
	const rawFeatures: Array<{
		race_id: number;
		race_date: string;
		race_horse_id: number;
		horse_id: number;
		features: Record<string, number | null>;
		finish_position: number;
	}> = [];

	while (true) {
		const from = page * pageSize;
		const to = from + pageSize - 1;
		const { data, error } = await supabase
			.schema("hml")
			.from("training_enriched_horse_features")
			.select(
				"race_id, race_date, race_horse_id, horse_id, features, finish_position",
			)
			.in("race_type", raceTypes)
			.eq("model_version", "v5.0")
			.gte("quality_score", 0.7)
			.gte("race_date", cutoffStr)
			.order("race_date", { ascending: true })
			.range(from, to);

		if (error) throw error;
		if (!data || data.length === 0) break;
		rawFeatures.push(...(data as typeof rawFeatures));
		if (data.length < pageSize) break;
		page++;
	}

	if (rawFeatures.length === 0) return new Map();

	// race_horses_hr_enriched: sp_decimal (odd primária), non_runner, position
	const raceHorseIds = Array.from(
		new Set(rawFeatures.map((r) => r.race_horse_id)),
	);
	const rhMap = new Map<
		number,
		{ non_runner: number; sp_decimal: number | null }
	>();
	const CHUNK = 500;
	for (let i = 0; i < raceHorseIds.length; i += CHUNK) {
		const chunk = raceHorseIds.slice(i, i + CHUNK);
		const { data, error } = await supabase
			.schema("hml")
			.from("race_horses_hr_enriched")
			.select("id, non_runner, sp_decimal")
			.in("id", chunk);
		if (error) throw error;
		for (const row of data || []) {
			rhMap.set(row.id, {
				non_runner: row.non_runner,
				sp_decimal:
					row.sp_decimal !== null && row.sp_decimal !== undefined
						? Number(row.sp_decimal)
						: null,
			});
		}
	}

	// Fallback de odd: ÚLTIMA odd de odds_enriched (mesma regra do getMarketOdd
	// de prod — NÃO média). sp_decimal cobre ~99.96%, fallback é residual.
	const lastOdd = new Map<number, { odd: number; lastUpdate: string }>();
	for (let i = 0; i < raceHorseIds.length; i += CHUNK) {
		const chunk = raceHorseIds.slice(i, i + CHUNK);
		const { data, error } = await supabase
			.schema("hml")
			.from("odds_enriched")
			.select("race_horse_id, odd, last_update")
			.in("race_horse_id", chunk);
		if (error) throw error;
		for (const row of data || []) {
			const cur = lastOdd.get(row.race_horse_id);
			if (!cur || String(row.last_update) > cur.lastUpdate) {
				lastOdd.set(row.race_horse_id, {
					odd: Number(row.odd),
					lastUpdate: String(row.last_update),
				});
			}
		}
	}

	const raceMap = new Map<number, HorseRecord[]>();
	for (const f of rawFeatures) {
		const rh = rhMap.get(f.race_horse_id);
		const spOdd = rh?.sp_decimal ?? 0;
		const fallbackOdd = lastOdd.get(f.race_horse_id)?.odd ?? 0;
		const marketOdd = spOdd > 0 ? spOdd : fallbackOdd;

		const record: HorseRecord = {
			race_id: f.race_id,
			race_date: f.race_date,
			race_horse_id: f.race_horse_id,
			horse_id: f.horse_id,
			features: f.features,
			finish_position: f.finish_position,
			non_runner: rh?.non_runner === 1,
			market_odd: marketOdd,
		};
		if (!raceMap.has(f.race_id)) raceMap.set(f.race_id, []);
		const group = raceMap.get(f.race_id);
		if (group) group.push(record);
	}
	return raceMap;
}

// ============================================================================
// INFERÊNCIA (softmax head — mesmo caminho da predição de prod)
// ============================================================================

function predictRace(horses: HorseRecord[], loaded: LoadedModel): number[] {
	const featureNames = loaded.config.features;
	const median = loaded.config.normalization.median;
	const iqr = loaded.config.normalization.iqr;

	const validVecs: number[][] = [];
	const validOrigIdx: number[] = [];
	for (let i = 0; i < horses.length; i++) {
		const vec: number[] = [];
		let ok = true;
		for (const fn of featureNames) {
			let v = horses[i].features?.[fn];
			if (
				(fn === "sp_decimal" || fn === "sp_implied_prob") &&
				(v === null || v === undefined)
			) {
				ok = false;
				break;
			}
			if (v === null || v === undefined) v = 0;
			vec.push(Number(v));
		}
		if (ok && vec.length === featureNames.length) {
			validVecs.push(vec);
			validOrigIdx.push(i);
		}
	}

	const result = new Array(horses.length).fill(-1);
	if (validVecs.length === 0) return result;

	const nValid = Math.min(validVecs.length, MAX_HORSES);
	const featCount = featureNames.length;
	const xBuf = new Float32Array(MAX_HORSES * featCount);
	for (let h = 0; h < nValid; h++) {
		for (let f = 0; f < featCount; f++) {
			const normalized =
				(validVecs[h][f] - median[f]) / (iqr[f] > 0 ? iqr[f] : 1);
			xBuf[h * featCount + f] = Math.max(-3, Math.min(3, normalized));
		}
	}

	const losePerHorse = tf.tidy(() => {
		const x = tf.tensor3d(xBuf, [1, MAX_HORSES, featCount]);
		const maskArr = new Float32Array(MAX_HORSES);
		for (let i = 0; i < nValid; i++) maskArr[i] = 1;
		const maskT = tf.tensor2d(maskArr, [1, MAX_HORSES]);
		const rawOut = loaded.model.predict([x, maskT]) as
			| tf.Tensor3D
			| tf.Tensor3D[];
		const scoreOut = Array.isArray(rawOut) ? rawOut[0] : rawOut;
		const scores = scoreOut.squeeze([0, 2]) as tf.Tensor1D;
		const mask1d = tf.tensor1d(maskArr);
		const adj = mask1d.sub(1).mul(1e9);
		const scaled = scores.add(adj).div(loaded.temperature);
		const probs = tf.softmax(scaled);
		const winProbs = Array.from(probs.dataSync());
		return winProbs.map((p) => 1 - p);
	});

	for (let i = 0; i < nValid; i++) {
		result[validOrigIdx[i]] = losePerHorse[i];
	}
	return result;
}

// ============================================================================
// SIMULAÇÃO
// ============================================================================

function evaluateModel(
	label: string,
	loaded: LoadedModel,
	raceMap: Map<number, HorseRecord[]>,
): ModelSummary {
	let bankroll = BANKROLL_INITIAL;
	const results = [];

	for (const [raceId, horses] of raceMap) {
		if (horses.length < 3) continue;
		const raceDate = horses[0].race_date;
		const pLose = predictRace(horses, loaded);

		const candidates: PickCandidate[] = [];
		for (let i = 0; i < horses.length; i++) {
			if (pLose[i] < 0) continue;
			const ivl = calculateLayValueIndex(pLose[i], horses[i].market_odd);
			const combined = calculateCombinedScore(
				pLose[i],
				ivl,
				horses[i].market_odd,
			);
			candidates.push({
				race_horse_id: horses[i].race_horse_id,
				horse_id: horses[i].horse_id,
				predicted_probability: pLose[i],
				combined_score: combined,
				ivl_score: ivl,
				market_odd: horses[i].market_odd,
				non_runner: horses[i].non_runner,
				won_race: horses[i].finish_position === 1,
				finish_position: horses[i].finish_position,
			});
		}

		candidates.sort((a, b) => b.combined_score - a.combined_score);
		const top3 = candidates.slice(0, 3);
		const sim = simulateRace(
			raceId,
			raceDate,
			top3,
			bankroll,
			MIN_ODD_THRESHOLD,
			MAX_ODD_THRESHOLD,
			true, // P/L com odd real (Betfair math) — sempre, independente do env
		);
		bankroll = sim.bankrollAfter;
		results.push(sim);
	}

	return summarize(label, results, BANKROLL_INITIAL);
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
		periodDays: number;
		edgeTolerancePp: number;
		minBets: number;
		minOdd: number;
		maxOdd: number;
	};
	candidate: ModelSummary;
	prod: ModelSummary | null;
}

async function saveGateLog(decision: GateDecision): Promise<void> {
	const path = `horse_probability_model/staging_gate_logs/${decision.date}_${decision.modelType}.json`;
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

	const raceMap = await loadPeriodData(MODEL_TYPE_CONFIG[modelType].raceTypes);
	logger.info(
		`Staging gate [${label}]: ${raceMap.size} corridas nos últimos ${GATE_PERIOD_DAYS} dias`,
	);

	const params = {
		periodDays: GATE_PERIOD_DAYS,
		edgeTolerancePp: GATE_EDGE_TOLERANCE_PP,
		minBets: GATE_MIN_BETS,
		minOdd: MIN_ODD_THRESHOLD,
		maxOdd: MAX_ODD_THRESHOLD,
		commissionRate: COMMISSION_RATE,
	};
	const today = new Date().toISOString().slice(0, 10);

	try {
		const candSummary = evaluateModel(
			`candidate_${modelType}`,
			candidate,
			raceMap,
		);
		const prodSummary = prod
			? evaluateModel(`prod_${modelType}`, prod, raceMap)
			: null;

		const candEdgePp = candSummary.edge * 100;
		const prodEdgePp = prodSummary ? prodSummary.edge * 100 : null;
		logger.info(
			`Staging gate [${label}]: candidato edge=${candEdgePp.toFixed(2)}pp (${candSummary.betsPlaced} apostas, pnl=${candSummary.totalPnl.toFixed(0)}) | prod edge=${prodEdgePp !== null ? prodEdgePp.toFixed(2) : "n/a"}pp (${prodSummary?.betsPlaced ?? 0} apostas, pnl=${prodSummary?.totalPnl.toFixed(0) ?? "n/a"})`,
		);

		let decision: GateDecision["decision"];
		let reason: string;

		if (!prodSummary || prodEdgePp === null) {
			decision = "promoted_no_prod";
			reason = "Sem modelo de prod pra comparar — promoção direta.";
		} else if (candSummary.betsPlaced < GATE_MIN_BETS) {
			decision = "rejected";
			reason = `Amostra insuficiente: ${candSummary.betsPlaced} apostas < GATE_MIN_BETS=${GATE_MIN_BETS}.`;
		} else if (candEdgePp >= prodEdgePp - GATE_EDGE_TOLERANCE_PP) {
			decision = "promoted";
			reason = `edge_cand ${candEdgePp.toFixed(2)}pp >= edge_prod ${prodEdgePp.toFixed(2)}pp - ${GATE_EDGE_TOLERANCE_PP}pp.`;
		} else {
			decision = "rejected";
			reason = `edge_cand ${candEdgePp.toFixed(2)}pp < edge_prod ${prodEdgePp.toFixed(2)}pp - ${GATE_EDGE_TOLERANCE_PP}pp. Prod mantido; candidato fica em ${candidatePath(modelType)} pra análise.`;
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
		`Staging gate: retreino gated iniciando (period=${GATE_PERIOD_DAYS}d, tolerância=${GATE_EDGE_TOLERANCE_PP}pp, min_bets=${GATE_MIN_BETS})`,
	);
	const start = Date.now();

	const types: ModelType[] = ["flat", "jump"];
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
