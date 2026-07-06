// Harness de avaliação compartilhado (extraído do staging-gate em 2026-07-04).
//
// Primitivas usadas pelo staging gate e por experimentos offline (ex: blend
// Benter) pra garantir que TODA avaliação use o mesmo código: mesma carga de
// dados (sp_decimal + fallback última odd), mesma inferência (softmax head,
// paridade com claude-prediction-model) e mesma simulação (regras de pick
// importadas de claude-generate-picks, P/L com odd real, comissão).

import * as tf from "@tensorflow/tfjs-node";
import { supabase } from "../../..";
import "../layers/attention";
import { withRetry } from "../../../shared/retry";
import type { ModelConfig } from "../../../shared/types/ml.types";
import {
	MAX_ODD_THRESHOLD,
	MIN_ODD_THRESHOLD,
	calculateCombinedScore,
	calculateLayValueIndex,
} from "../claude-generate-picks";
import type { ModelType } from "../training_final";
import { type ModelSummary, summarize } from "./report";
import { type PickCandidate, simulateRace } from "./simulator";

export const BUCKET = "modelos-tfjs-publicos";
export const MAX_HORSES = 30;
export const BANKROLL_INITIAL = 200;

// Mesmos defaults de claude-prediction-model.ts (paridade com prod).
export const DEFAULT_TEMPERATURE: Record<ModelType, number> = {
	flat: 1.5,
	jump: 1.2,
};

const supabaseUrl =
	process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";

// ============================================================================
// STORAGE
// ============================================================================

export async function download(path: string): Promise<Uint8Array> {
	const { data, error } = await supabase.storage.from(BUCKET).download(path);
	if (error || !data) throw new Error(`download ${path}: ${error?.message}`);
	return new Uint8Array(await data.arrayBuffer());
}

export interface LoadedModel {
	config: ModelConfig;
	model: tf.LayersModel;
	temperature: number;
}

export async function loadModelFromPath(
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
// DADOS DE PERÍODO
// ============================================================================

// Sockets keepalive do Supabase ficam obsoletos após fases CPU-bound longas
// (treino/fit/inferência) e a primeira query seguinte falha com "fetch failed".
// Retry genérico resolve — crítico pro staging gate, que consulta o banco
// logo após ~1h de treino.
async function queryWithRetry<T>(
	label: string,
	fn: () => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
	return withRetry(
		async () => {
			const { data, error } = await fn();
			if (error) throw error;
			return (data ?? []) as T[];
		},
		{},
		label,
	);
}

export interface HorseRecord {
	race_id: number;
	race_date: string;
	race_horse_id: number;
	horse_id: number;
	features: Record<string, number | null>;
	finish_position: number;
	non_runner: boolean;
	market_odd: number;
}

/**
 * Carrega corridas com resultado no intervalo [hoje - periodDays - endDaysAgo,
 * hoje - endDaysAgo). endDaysAgo > 0 permite janelas passadas disjuntas
 * (ex: fit de blend em [180,90) e eval em [90,0) sem overlap).
 */
export async function loadPeriodData(
	raceTypes: string[],
	periodDays: number,
	endDaysAgo = 0,
): Promise<Map<number, HorseRecord[]>> {
	const start = new Date();
	start.setDate(start.getDate() - periodDays - endDaysAgo);
	const startStr = start.toISOString().split("T")[0];
	const end = new Date();
	end.setDate(end.getDate() - endDaysAgo);
	const endStr = end.toISOString().split("T")[0];

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
		const data = await queryWithRetry(`features page ${page}`, () =>
			supabase
				.schema("hml")
				.from("training_enriched_horse_features")
				.select(
					"race_id, race_date, race_horse_id, horse_id, features, finish_position",
				)
				.in("race_type", raceTypes)
				.eq("model_version", "v5.0")
				.gte("quality_score", 0.7)
				.gte("race_date", startStr)
				.lt("race_date", endStr)
				.order("race_date", { ascending: true })
				.range(from, to),
		);

		if (data.length === 0) break;
		rawFeatures.push(...(data as typeof rawFeatures));
		if (data.length < pageSize) break;
		page++;
	}

	if (rawFeatures.length === 0) return new Map();

	// race_horses_hr_enriched: sp_decimal (odd primária), non_runner
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
		const data = await queryWithRetry(`race_horses chunk ${i}`, () =>
			supabase
				.schema("hml")
				.from("race_horses_hr_enriched")
				.select("id, non_runner, sp_decimal")
				.in("id", chunk),
		);
		for (const row of data) {
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
		const data = await queryWithRetry(`odds chunk ${i}`, () =>
			supabase
				.schema("hml")
				.from("odds_enriched")
				.select("race_horse_id, odd, last_update")
				.in("race_horse_id", chunk),
		);
		for (const row of data) {
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

/**
 * Roda o modelo e retorna AMBAS as cabeças por cavalo:
 * - score: logit cru pré-softmax (sempre presente)
 * - lose: saída sigmoid da cabeça P(perder) (null em modelos single-head)
 * null no array = cavalo inválido (sem sp_decimal/sp_implied_prob nas
 * features ou fora do MAX_HORSES).
 */
export function predictRaceHeads(
	horses: HorseRecord[],
	loaded: LoadedModel,
): { score: (number | null)[]; lose: (number | null)[] | null } {
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

	const scoreResult: (number | null)[] = new Array(horses.length).fill(null);
	if (validVecs.length === 0) return { score: scoreResult, lose: null };

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

	// rawLose vazio = modelo single-head (tf.tidy não aceita null no retorno)
	const [rawScores, rawLose] = tf.tidy(() => {
		const x = tf.tensor3d(xBuf, [1, MAX_HORSES, featCount]);
		const maskArr = new Float32Array(MAX_HORSES);
		for (let i = 0; i < nValid; i++) maskArr[i] = 1;
		const maskT = tf.tensor2d(maskArr, [1, MAX_HORSES]);
		const rawOut = loaded.model.predict([x, maskT]) as
			| tf.Tensor3D
			| tf.Tensor3D[];
		const [scoreOut, loseOut] = Array.isArray(rawOut)
			? [rawOut[0], rawOut[1] ?? null]
			: [rawOut, null];
		const scores = scoreOut.squeeze([0, 2]) as tf.Tensor1D;
		const scoreArr = Array.from(scores.dataSync());
		const loseArr = loseOut
			? Array.from((loseOut.squeeze([0, 2]) as tf.Tensor1D).dataSync())
			: [];
		return [scoreArr, loseArr];
	});

	for (let i = 0; i < nValid; i++) {
		scoreResult[validOrigIdx[i]] = rawScores[i];
	}
	let loseResult: (number | null)[] | null = null;
	if (rawLose.length > 0) {
		loseResult = new Array(horses.length).fill(null);
		for (let i = 0; i < nValid; i++) {
			loseResult[validOrigIdx[i]] = rawLose[i];
		}
	}
	return { score: scoreResult, lose: loseResult };
}

/** Scores crus (logit pré-softmax) por cavalo — atalho sobre predictRaceHeads. */
export function predictRaceScores(
	horses: HorseRecord[],
	loaded: LoadedModel,
): (number | null)[] {
	return predictRaceHeads(horses, loaded).score;
}

/**
 * P(lose) direto da cabeça sigmoid (multi-task). Retorna null se o modelo
 * for single-head. -1 = cavalo inválido. NÃO passa por softmax race-level —
 * são probabilidades independentes por cavalo.
 */
export function predictRaceLoseHead(
	horses: HorseRecord[],
	loaded: LoadedModel,
): number[] | null {
	const { lose } = predictRaceHeads(horses, loaded);
	if (!lose) return null;
	return lose.map((v) => (v === null ? -1 : v));
}

/** Softmax race-level sobre scores (com temperature). null → -1 no output. */
export function scoresToPLose(
	scores: (number | null)[],
	temperature: number,
): number[] {
	const valid = scores
		.map((s, i) => ({ s, i }))
		.filter((x): x is { s: number; i: number } => x.s !== null);
	const result = new Array(scores.length).fill(-1);
	if (valid.length === 0) return result;

	const maxS = Math.max(...valid.map((v) => v.s / temperature));
	const exps = valid.map((v) => Math.exp(v.s / temperature - maxS));
	const sum = exps.reduce((a, b) => a + b, 0);
	for (let k = 0; k < valid.length; k++) {
		result[valid[k].i] = 1 - exps[k] / sum;
	}
	return result;
}

/** P(lose) por cavalo via softmax race-level (paridade com prod). */
export function predictRace(
	horses: HorseRecord[],
	loaded: LoadedModel,
): number[] {
	return scoresToPLose(predictRaceScores(horses, loaded), loaded.temperature);
}

// ============================================================================
// SIMULAÇÃO
// ============================================================================

/** predictFn deve retornar P(lose) por cavalo; -1 = cavalo inválido. */
export function evaluateWithPredictor(
	label: string,
	raceMap: Map<number, HorseRecord[]>,
	predictFn: (horses: HorseRecord[]) => number[],
): ModelSummary {
	let bankroll = BANKROLL_INITIAL;
	const results = [];

	for (const [raceId, horses] of raceMap) {
		if (horses.length < 3) continue;
		const raceDate = horses[0].race_date;
		const pLose = predictFn(horses);

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

export function evaluateModel(
	label: string,
	loaded: LoadedModel,
	raceMap: Map<number, HorseRecord[]>,
): ModelSummary {
	return evaluateWithPredictor(label, raceMap, (horses) =>
		predictRace(horses, loaded),
	);
}
