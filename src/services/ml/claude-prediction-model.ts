// services/ml/predictions.ts
//
// RACE-LEVEL PREDICTION
// Processa uma corrida por vez: agrupa cavalos, faz padding para MAX_HORSES=30,
// passa pelo modelo, aplica softmax mascarado e extrai P(vence) por cavalo.
// P(não vence) = 1 - P(vence) — agora coerente dentro da corrida.

import * as tf from "@tensorflow/tfjs-node";
import dotenv from "dotenv";
import { supabase } from "../..";
import {
	getDataSchema,
	getOutputSchema,
	modelPath,
} from "../../shared/db-config";
import "./layers/attention";
import { applyIsotonicToRace } from "./calibration";

import type { ModelConfig } from "../../shared/types/ml.types";

dotenv.config();

// ============================================================================
// CONFIGURAÇÃO — MESMA DO TRAINING
// ============================================================================

const BUCKET_NAME = "modelos-tfjs-publicos";
const MAX_HORSES = 30; // Deve bater com o training

type ModelType = "flat" | "jump";

const MODEL_TYPE_CONFIG = {
	flat: {
		name: "claude-ml-model-flat",
		raceTypes: ["Flat"],
		label: "Flat",
	},
	jump: {
		name: "claude-ml-model-jump",
		raceTypes: ["Hurdle", "Chase", "NHF"],
		label: "Jump",
	},
};

function getModelPath(modelType: ModelType): string {
	return modelPath(
		`horse_probability_model/${MODEL_TYPE_CONFIG[modelType].name}`,
	);
}

// Temperature scaling para softmax
// T > 1 → distribuição mais uniforme (calibração, reduz overconfidence)
// T < 1 → distribuição mais afiada (amplifica diferenças entre cavalos)
// T = 1 → sem alteração (comportamento original)
const DEFAULT_TEMPERATURE: Record<ModelType, number> = {
	flat: 1.5,
	jump: 1.2, // Jump já funciona bem, ajuste conservador
};

const supabaseUrl =
	process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";

// ============================================================================
// TYPES
// ============================================================================

interface RaceForPrediction {
	id: number;
	id_race: string;
	course: string;
	date: Date;
	off_time_br: string;
	title: string;
	class: number;
	distance: string;
	going: string;
	race_type: string | null;
}

interface HorseForPrediction {
	id: number;
	race_horse_id: number;
	race_id: number;
	horse_id: number;
	horse: string;
	features: any;
}

interface LoadedModel {
	model: tf.LayersModel;
	config: ModelConfig;
	modelType: ModelType;
}

// ============================================================================
// PIPELINE PRINCIPAL
// ============================================================================

export async function generatePredictions_v4(): Promise<void> {
	console.log("🔮 Iniciando geração de predições RACE-LEVEL...\n");

	try {
		console.log("📥 Carregando modelos Flat e Jump...");
		const models = await loadAllModels();

		if (!models.flat && !models.jump) {
			console.error("❌ Nenhum modelo disponível. Abortando.");
			return;
		}

		if (models.flat) {
			console.log(
				`  ✅ Flat — v${models.flat.config.version}, ${models.flat.config.features.length} features`,
			);
		} else {
			console.warn("  ! Modelo Flat não encontrado");
		}

		if (models.jump) {
			console.log(
				`  ✅ Jump — v${models.jump.config.version}, ${models.jump.config.features.length} features`,
			);
		} else {
			console.warn("  ! Modelo Jump não encontrado");
		}

		const upcomingRaces = await getUpcomingRaces();
		console.log(`\n🏇 ${upcomingRaces.length} corridas futuras encontradas`);

		if (upcomingRaces.length === 0) {
			disposeModels(models);
			return;
		}

		const flatRaces = upcomingRaces.filter((r) => r.race_type === "Flat");
		const jumpRaces = upcomingRaces.filter((r) =>
			["Hurdle", "Chase", "NHF"].includes(r.race_type || ""),
		);
		const unknownRaces = upcomingRaces.filter(
			(r) =>
				!r.race_type ||
				!["Flat", "Hurdle", "Chase", "NHF"].includes(r.race_type),
		);

		console.log(
			`  🏇 Flat: ${flatRaces.length} | Jump: ${jumpRaces.length} | Sem tipo: ${unknownRaces.length}`,
		);

		if (unknownRaces.length > 0) {
			console.warn(
				`  ! ${unknownRaces.length} corridas sem race_type — usando modelo Flat`,
			);
		}

		let totalPredictions = 0;
		let racesProcessed = 0;

		if (models.flat && (flatRaces.length > 0 || unknownRaces.length > 0)) {
			const racesToProcess = [...flatRaces, ...unknownRaces];
			console.log(
				`\n🏇 Processando ${racesToProcess.length} corridas com modelo Flat...`,
			);

			for (const race of racesToProcess) {
				try {
					const count = await processRaceAfterTraining(
						race,
						models.flat.model,
						models.flat.config,
						"flat",
					);
					totalPredictions += count;
					racesProcessed++;
				} catch (error) {
					console.error(`❌ Erro corrida ${race.id_race}:`, error);
				}
			}
		}

		if (models.jump && jumpRaces.length > 0) {
			console.log(
				`\n🏇 Processando ${jumpRaces.length} corridas com modelo Jump...`,
			);

			for (const race of jumpRaces) {
				try {
					const count = await processRaceAfterTraining(
						race,
						models.jump.model,
						models.jump.config,
						"jump",
					);
					totalPredictions += count;
					racesProcessed++;
				} catch (error) {
					console.error(`❌ Erro corrida ${race.id_race}:`, error);
				}
			}
		}

		disposeModels(models);

		console.log("\n" + "=".repeat(50));
		console.log("🎯 RESUMO DAS PREDIÇÕES");
		console.log("=".repeat(50));
		console.log(
			`📊 Corridas processadas: ${racesProcessed}/${upcomingRaces.length}`,
		);
		console.log(`💾 Total de predições: ${totalPredictions}`);
		if (models.flat) {
			const tFlat =
				(models.flat.config as any).softmaxTemperature ??
				DEFAULT_TEMPERATURE.flat;
			console.log(`🏇 Modelo Flat v${models.flat.config.version} | T=${tFlat}`);
		}
		if (models.jump) {
			const tJump =
				(models.jump.config as any).softmaxTemperature ??
				DEFAULT_TEMPERATURE.jump;
			console.log(`🏇 Modelo Jump v${models.jump.config.version} | T=${tJump}`);
		}
		console.log("=".repeat(50));
	} catch (error) {
		console.error("❌ Erro no pipeline de predições:", error);
		throw error;
	}
}

// ============================================================================
// CARREGAR MODELOS
// ============================================================================

async function loadAllModels(): Promise<{
	flat: LoadedModel | null;
	jump: LoadedModel | null;
}> {
	const [flat, jump] = await Promise.all([
		loadModelFromSupabase("flat").catch((err) => {
			console.warn(`! Falha Flat: ${err.message}`);
			return null;
		}),
		loadModelFromSupabase("jump").catch((err) => {
			console.warn(`! Falha Jump: ${err.message}`);
			return null;
		}),
	]);
	return { flat, jump };
}

async function loadModelFromSupabase(
	modelType: ModelType,
): Promise<LoadedModel> {
	const modelPath = getModelPath(modelType);
	console.log(`  📥 Baixando modelo ${modelType}...`);

	const { data: configData, error: configError } = await supabase.storage
		.from(BUCKET_NAME)
		.download(`${modelPath}/config.json`);

	if (configError || !configData) {
		throw new Error(`Config ${modelType}: ${configError?.message}`);
	}

	const configText = await configData.text();
	const config = JSON.parse(configText) as ModelConfig;

	const modelUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${modelPath}/model.json`;
	const model = await tf.loadLayersModel(modelUrl);

	return { model, config, modelType };
}

function disposeModels(models: {
	flat: LoadedModel | null;
	jump: LoadedModel | null;
}): void {
	if (models.flat) models.flat.model.dispose();
	if (models.jump) models.jump.model.dispose();
}

// ============================================================================
// BUSCAR CORRIDAS
// ============================================================================

async function getUpcomingRaces(): Promise<RaceForPrediction[]> {
	const { data, error } = await supabase
		.schema(getDataSchema())
		.from("racecards_hr_enriched")
		.select(
			"id, id_race, course, date, off_time_br, title, class, distance, going, race_type",
		)
		.eq("finished", 0)
		.eq("canceled", 0)
		.order("date", { ascending: true })
		.order("off_time_br", { ascending: true });

	if (error) throw error;
	return data || [];
}

// ============================================================================
// PROCESSAR CORRIDA — RACE-LEVEL SOFTMAX
// ============================================================================

async function processRaceAfterTraining(
	race: RaceForPrediction,
	model: tf.LayersModel,
	config: ModelConfig,
	modelType: ModelType,
): Promise<number> {
	console.log(
		`  📍 ${race.id_race} - ${race.course} (${race.race_type || "unknown"}) [${modelType}]`,
	);

	const horses = await getHorsesWithFeatures(race.id);
	if (horses.length === 0) {
		console.log(`  ! Nenhum cavalo com features`);
		return 0;
	}

	// Validação e extração de features
	const validHorses: HorseForPrediction[] = [];
	const featureVectors: number[][] = [];

	for (const horse of horses) {
		const featureVector: number[] = [];
		let isValid = true;

		for (const featureName of config.features) {
			let value = horse.features[featureName];

			if (
				(featureName === "sp_decimal" || featureName === "sp_implied_prob") &&
				(value === null || value === undefined)
			) {
				isValid = false;
				break;
			}

			if (value === null || value === undefined) value = 0;
			featureVector.push(Number(value));
		}

		if (isValid && featureVector.length === config.features.length) {
			validHorses.push(horse);
			featureVectors.push(featureVector);
		}
	}

	if (validHorses.length === 0) {
		console.log("  ! Nenhum cavalo válido após preparação");
		return 0;
	}

	if (validHorses.length > MAX_HORSES) {
		console.warn(
			`  ! Corrida com ${validHorses.length} cavalos — limitado a ${MAX_HORSES}`,
		);
		validHorses.splice(MAX_HORSES);
		featureVectors.splice(MAX_HORSES);
	}

	// Construir tensor 3D: [1, MAX_HORSES, featureCount] com padding
	const featureCount = config.features.length;
	const xBuffer = new Float32Array(MAX_HORSES * featureCount);
	const median = config.normalization.median;
	const iqr = config.normalization.iqr;

	for (let h = 0; h < validHorses.length; h++) {
		const vec = featureVectors[h];
		for (let f = 0; f < featureCount; f++) {
			// Normalização robusta + clipping (igual ao training)
			const normalized = (vec[f] - median[f]) / (iqr[f] > 0 ? iqr[f] : 1);
			xBuffer[h * featureCount + f] = Math.max(-3, Math.min(3, normalized));
		}
	}
	// Posições padded ficam em 0 (já inicializado pelo Float32Array)

	// Calcular probabilidades via masked softmax com temperature scaling
	const temperature: number =
		(config as any).softmaxTemperature ?? DEFAULT_TEMPERATURE[modelType];

	const { probabilities, loseHead, diagnostics } = tf.tidy(() => {
		const inputTensor = tf.tensor3d(xBuffer, [1, MAX_HORSES, featureCount]);
		const maskArr = new Float32Array(MAX_HORSES);
		for (let i = 0; i < validHorses.length; i++) maskArr[i] = 1;
		const maskTensor = tf.tensor2d(maskArr, [1, MAX_HORSES]);

		// Passar pelo modelo. Modelos multi-task (mt_b05+) retornam ARRAY
		// [scoreOutput, loseOutput]. Modelos legados retornam apenas o scoreOutput.
		// PREDICTION_PLOSE_SOURCE=heads_avg usa também a cabeça lose (validado
		// por bootstrap pareado 2026-07-09: Δpnl +588 [0,1264], p=2.4%).
		const rawOut = model.predict([inputTensor, maskTensor]) as
			| tf.Tensor3D
			| tf.Tensor3D[];
		const scoresRaw = (
			Array.isArray(rawOut) ? rawOut[0] : rawOut
		) as tf.Tensor3D;
		const loseOut =
			Array.isArray(rawOut) && rawOut[1] ? (rawOut[1] as tf.Tensor3D) : null;
		const loseHeadArr = loseOut
			? Array.from((loseOut.squeeze([0, 2]) as tf.Tensor1D).dataSync())
			: [];
		const scores = scoresRaw.squeeze([0, 2]) as tf.Tensor1D; // [MAX_HORSES]

		// Extrair raw scores dos cavalos válidos para diagnóstico
		const rawScoresArr = scores.dataSync().slice(0, validHorses.length);
		const rawMin = Math.min(...Array.from(rawScoresArr));
		const rawMax = Math.max(...Array.from(rawScoresArr));
		const rawSpread = rawMax - rawMin;

		const mask = tf.tensor1d(maskArr);

		// Mascarar scores: padding vira -1e9, fica ~0 no softmax
		const maskAdjustment = mask.sub(1).mul(1e9);
		const maskedScores = scores.add(maskAdjustment);

		// Temperature scaling: divide logits por T antes do softmax
		const scaledScores = maskedScores.div(temperature);

		// Softmax dentro da corrida
		const probs = tf.softmax(scaledScores);
		const probsArr = probs.dataSync(); // Float32Array [MAX_HORSES]

		// Diagnóstico: spread de P(win) entre os 3 picks LAY (menores P(win))
		const validProbs = Array.from(probsArr).slice(0, validHorses.length);
		const sortedWinProbs = [...validProbs].sort((a, b) => a - b);
		const top3LayProbs = sortedWinProbs.slice(0, 3); // 3 menores P(win)
		const probSpread =
			top3LayProbs.length >= 3 ? top3LayProbs[2] - top3LayProbs[0] : 0;

		return {
			probabilities: probsArr,
			loseHead: loseHeadArr,
			diagnostics: {
				rawMin: rawMin.toFixed(4),
				rawMax: rawMax.toFixed(4),
				rawSpread: rawSpread.toFixed(4),
				top3WinProbs: top3LayProbs.map((p) => (p * 100).toFixed(2) + "%"),
				probSpread: (probSpread * 100).toFixed(2) + "pp",
				temperature,
			},
		};
	});

	// Log diagnóstico por corrida
	console.log(
		`  🌡  T=${diagnostics.temperature} | raw=[${diagnostics.rawMin}..${diagnostics.rawMax}] spread=${diagnostics.rawSpread} | top3 P(win)=[${diagnostics.top3WinProbs.join(", ")}] spread=${diagnostics.probSpread}`,
	);

	// ─── Calibração isotonic (se disponível e não desativada) ───
	// Aplica curva monótona ajustada no val set + renormaliza dentro da corrida.
	// disableCalibration=true: mantém knots salvos pra análise mas pula a aplicação.
	if (
		config.calibration &&
		config.calibration.method === "isotonic" &&
		!config.disableCalibration
	) {
		const rawValid = Array.from(probabilities).slice(0, validHorses.length);
		const calibrated = applyIsotonicToRace(
			{ x: config.calibration.knots.x, y: config.calibration.knots.y },
			rawValid,
		);
		for (let i = 0; i < calibrated.length; i++)
			probabilities[i] = calibrated[i];
		const top3CalibSorted = [...calibrated].sort((a, b) => a - b).slice(0, 3);
		console.log(
			`  🎯 Isotonic aplicado: top3 calibrado=[${top3CalibSorted.map((p) => (p * 100).toFixed(2) + "%").join(", ")}]`,
		);
	}

	// ─── Calcular P(não vence) e registrar predições ───
	const fieldSize = validHorses.length;
	const avgWinProb = 1 / fieldSize;

	const predictionRecords = [];

	// PREDICTION_PLOSE_SOURCE=heads_avg → P(perder) = média de (1−softmax) e
	// da cabeça lose (só em modelos multi-task). Default: softmax (prod atual).
	const useHeadsAvg =
		(process.env.PREDICTION_PLOSE_SOURCE || "softmax").trim() === "heads_avg" &&
		loseHead.length > 0;

	for (let i = 0; i < validHorses.length; i++) {
		const horse = validHorses[i];
		const winProb = probabilities[i];
		const notWinProb = useHeadsAvg
			? (1 - winProb + loseHead[i]) / 2
			: 1 - winProb;

		let layRecommendation: string;
		if (winProb <= avgWinProb * 0.4) layRecommendation = "STRONG_LAY";
		else if (winProb <= avgWinProb * 0.7) layRecommendation = "LAY";
		else if (winProb <= avgWinProb) layRecommendation = "NEUTRAL";
		else layRecommendation = "AVOID";

		const qualityScore = calculateQualityScore(horse.features);

		predictionRecords.push({
			race_horse_id: horse.race_horse_id,
			race_id: horse.race_id,
			horse_id: horse.horse_id,
			features: horse.features,
			predicted_probability: notWinProb,
			lay_recommendation: layRecommendation,
			race_date: race.date,
			model_version: `v${config.version}-${modelType}`,
			quality_score: qualityScore,
			prediction_status: "PENDING",
			generated_at: new Date().toISOString(),
		});
	}

	if (predictionRecords.length > 0) {
		const uniqueRecords = predictionRecords.reduce(
			(acc, record) => {
				const exists = acc.find(
					(r) => r.race_horse_id === record.race_horse_id,
				);
				if (!exists) acc.push(record);
				return acc;
			},
			[] as typeof predictionRecords,
		);

		const { error } = await supabase
			.schema(getOutputSchema())
			.from("prediction_enriched_horse_features")
			.upsert(uniqueRecords, {
				onConflict: "race_horse_id,model_version",
				ignoreDuplicates: false,
			});

		if (error) {
			console.error("  Erro ao inserir predições:", error);
			throw error;
		}

		// ── FIX #2: Limpar predições PENDING de versões anteriores ──
		// Após inserir predições novas (ex: v17-flat), marca todas as de versões
		// anteriores (v4.0, v16-flat, etc.) como FINISHED para esta corrida.
		// Isso evita: (a) acúmulo infinito de registros PENDING,
		// (b) cavalos duplicados no getHorsesWithFeatures,
		// (c) queries estourando o limite de 1000 do Supabase.
		const currentVersion = `v${config.version}-${modelType}`;
		const { error: cleanupError } = await supabase
			.schema(getOutputSchema())
			.from("prediction_enriched_horse_features")
			.update({ prediction_status: "FINISHED" })
			.eq("race_id", race.id)
			.neq("model_version", currentVersion)
			.eq("prediction_status", "PENDING");

		if (cleanupError) {
			console.warn(
				`  ! Erro ao limpar predições antigas da corrida ${race.id}:`,
				cleanupError.message,
			);
		}

		const strongLays = uniqueRecords.filter(
			(p) => p.lay_recommendation === "STRONG_LAY",
		);
		const regularLays = uniqueRecords.filter(
			(p) => p.lay_recommendation === "LAY",
		);

		console.log(
			`  📊 field=${fieldSize}, avg P(win)=${(avgWinProb * 100).toFixed(1)}%`,
		);
		if (strongLays.length > 0) {
			console.log(`  🔥 ${strongLays.length} STRONG LAY`);
		}
		if (regularLays.length > 0) {
			console.log(`  ✅ ${regularLays.length} LAY`);
		}
	}

	return predictionRecords.length;
}

// ============================================================================
// BUSCAR CAVALOS
// ============================================================================

async function getHorsesWithFeatures(
	raceId: number,
): Promise<HorseForPrediction[]> {
	const { data, error } = await supabase
		.schema(getOutputSchema())
		.from("prediction_enriched_horse_features")
		.select("race_horse_id, race_id, horse_id, features")
		.eq("race_id", raceId);

	if (error) {
		console.error(`  Erro ao buscar features para corrida ${raceId}:`, error);
		return [];
	}

	if (!data || data.length === 0) return [];

	// FIX: Deduplicar por race_horse_id — múltiplas model_versions criam registros
	// duplicados para o mesmo cavalo (v4.0 do orchestrator + vN de predições anteriores).
	// Sem isso, o softmax distribui probabilidade sobre field inflado (ex: 33 em vez de 11).
	const uniqueByHorse = new Map<number, (typeof data)[0]>();
	for (const row of data) {
		if (!uniqueByHorse.has(row.race_horse_id)) {
			uniqueByHorse.set(row.race_horse_id, row);
		}
	}

	const uniqueData = Array.from(uniqueByHorse.values());

	if (uniqueData.length !== data.length) {
		console.log(
			`  🧹 Dedup: ${data.length} registros → ${uniqueData.length} cavalos únicos`,
		);
	}

	return uniqueData.map((p) => ({
		id: p.race_horse_id,
		race_horse_id: p.race_horse_id,
		race_id: p.race_id,
		horse_id: p.horse_id,
		horse: "N/A",
		features: p.features,
	}));
}

// ============================================================================
// QUALITY SCORE
// ============================================================================

function calculateQualityScore(features: any): number {
	const importantFeatures = [
		"career_win_rate",
		"form_last3_avg",
		"or_rating",
		"jockey_win_rate",
		"trainer_win_rate",
		"sp_decimal",
		"race_field_size",
		"course_win_rate",
	];

	let presentCount = 0;
	let totalWeight = 0;

	for (const feature of importantFeatures) {
		const weight =
			feature.includes("career") || feature.includes("form") ? 2 : 1;
		totalWeight += weight;

		if (features[feature] !== null && features[feature] !== undefined) {
			presentCount += weight;
		}
	}

	return Math.min(1, presentCount / totalWeight);
}

// ============================================================================
// STATS
// ============================================================================

export async function runPredictionPipeline(): Promise<void> {
	console.log("\n" + "=".repeat(50));
	console.log("🎯 LAY BETTING ML - PIPELINE DE PREDIÇÕES");
	console.log("=".repeat(50));

	await generatePredictions_v4();
	await showPredictionStats();
}

async function showPredictionStats(): Promise<void> {
	console.log("\n📊 ESTATÍSTICAS DAS PREDIÇÕES RECENTES");
	console.log("-".repeat(40));

	const { data, error } = await supabase
		.schema(getOutputSchema())
		.from("prediction_enriched_horse_features")
		.select(
			"lay_recommendation, predicted_probability, race_date, model_version",
		)
		.gte(
			"generated_at",
			new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
		)
		.order("predicted_probability", { ascending: false });

	if (error || !data) {
		console.log("Erro ao buscar estatísticas");
		return;
	}

	const flatPreds = data.filter((d) => d.model_version?.includes("flat"));
	const jumpPreds = data.filter((d) => d.model_version?.includes("jump"));

	console.log(`\n🏇 Flat: ${flatPreds.length} | Jump: ${jumpPreds.length}`);

	const stats = {
		STRONG_LAY: data.filter((d) => d.lay_recommendation === "STRONG_LAY")
			.length,
		LAY: data.filter((d) => d.lay_recommendation === "LAY").length,
		NEUTRAL: data.filter((d) => d.lay_recommendation === "NEUTRAL").length,
		AVOID: data.filter((d) => d.lay_recommendation === "AVOID").length,
	};

	console.log(`🔥 STRONG LAY: ${stats.STRONG_LAY}`);
	console.log(`✅ LAY: ${stats.LAY}`);
	console.log(`📊 NEUTRAL: ${stats.NEUTRAL}`);
	console.log(`! AVOID: ${stats.AVOID}`);

	if (data.length > 0) {
		const avgProb =
			data.reduce((sum, d) => sum + d.predicted_probability, 0) / data.length;
		console.log(`\n📈 P(não vence) médio: ${(avgProb * 100).toFixed(2)}%`);
	}

	console.log("-".repeat(40));
}
