import { CONFIG } from "../shared/config";
/**
 * Pipeline automatizado para atualização de dados de corridas
 *
 * Este script executa uma sequência de funções para atualizar dados de corridas,
 * transferir dados entre MongoDB e Supabase, treinar modelos de ML e gerar previsões.
 *
 * Foi projetado para ser executado como um microsserviço agendado via Node Cron.
 */
import { logger, metrics } from "../shared/logger";
import { withRetry } from "../shared/retry";

import { supabase } from "..";
import horseStats from "../integrations/mongodb/getHorseResults_Hr";
import raceCards from "../integrations/mongodb/getRaceCard_Hr";
import raceDetails from "../integrations/mongodb/getRaceDetail_Hr";
import updateRacecard_mdb from "../integrations/mongodb/updateRaceCard_Hr";
import { checkHorseResultLength } from "../services/data-sync/checkHorseResultLength";
import { populateEnrichedRaceDetail_spb } from "../services/data-sync/populateEnrichedRaceDetail";
import { populateHorseStats_spb } from "../services/data-sync/populateHorseStats_spb";
import { populateRacecardsEnriched_spb } from "../services/data-sync/populateRaceCard_spb_enriched";
import { populateRaceDetail_spb } from "../services/data-sync/populateRaceDetail_spb";
import { updateCleanRacecard } from "../services/data-sync/updateCleanRacecard";
import {
	generatePredictionFeatures_v4,
	generateTrainingFeatures_v4,
} from "../services/features/pipeline/feature-orchestrator";
import { updateRaceResults } from "../services/features/pipeline/update_race_result";
import {
	updateLayBettingResults,
	updateRacecardsAndDetails,
} from "../services/features/pipeline/update_results";
import { generateLayBettingPicks } from "../services/ml/claude-generate-picks";
import { generatePredictions_v4 } from "../services/ml/claude-prediction-model";
import { trainAllModelsWithGate } from "../services/ml/staging-gate";
import {
	enrichRacecardsFromRacingApi,
	enrichResultsFromRacingApi,
} from "../services/racing-api/racingApi.service";

/**
 * Interface para o resultado do pipeline
 */
interface PipelineResult {
	success: boolean;
	message?: string;
	error?: string;
	time: string;
}

/**
 * Interface para opções de processamento em lotes
 */
interface BatchProcessingOptions {
	batchSize?: number;
	batchDelay?: number;
	requestDelay?: number;
}

/**
 * Função utilitária para processamento em lotes
 * @param items - Itens a serem processados
 * @param processFn - Função de processamento para cada item
 * @param options - Opções de configuração
 */
async function processBatch<T>(
	items: T[],
	processFn: (item: T, index: number, array: T[]) => Promise<void>,
	options: BatchProcessingOptions = {},
): Promise<void> {
	const batchSize = options.batchSize || CONFIG.batchProcessing.batchSize;
	const batchDelay = options.batchDelay || CONFIG.batchProcessing.batchDelay;
	const requestDelay =
		options.requestDelay || CONFIG.batchProcessing.requestDelay;

	logger.info(
		`Iniciando processamento em lotes de ${items.length} itens (tamanho do lote: ${batchSize})`,
	);

	for (let i = 0; i < items.length; i++) {
		await processFn(items[i], i, items);

		if (i < items.length - 1) {
			// Espera normal entre requisições
			await new Promise<void>((resolve) => setTimeout(resolve, requestDelay));

			// Se estamos no final de um lote, faz uma pausa maior
			if ((i + 1) % batchSize === 0) {
				const currentBatch = Math.floor((i + 1) / batchSize);
				const totalBatches = Math.ceil(items.length / batchSize);
				logger.info(
					`Completado lote ${currentBatch} de ${totalBatches}. Pausando por ${batchDelay / 1000} segundos...`,
				);
				await new Promise<void>((resolve) => setTimeout(resolve, batchDelay));
			}
		}
	}

	logger.info(`Processamento em lotes concluído para ${items.length} itens`);
}

/**
 * Etapa 1: Atualização de dados no MongoDB
 */
async function updateMongoDBData(): Promise<void> {
	logger.info("Iniciando atualização de dados no MongoDB");

	await metrics.measure("Atualização de Race Card HR", async () => {
		await updateRacecard_mdb.updateRaceCard_Hr();
		logger.info("Atualização de Race Card HR concluída com sucesso");
	});

	await metrics.measure("Atualização de Racecards SPB", async () => {
		await updateRacecardsAndDetails();
		logger.info("Atualização de Racecards SPB concluída com sucesso");
	});

	await metrics.measure("Atualização de resultados dos picks", async () => {
		await updateLayBettingResults();
		logger.info("Resultados dos picks atualizados com sucesso");
	});

	await metrics.measure("Atualização de resultados por corrida", async () => {
		await updateRaceResults();
	});

	logger.info("Atualização de dados no MongoDB concluída com sucesso");
}

/**
 * Etapa 2: Processamento de dados no MongoDB
 */
async function processMongoDBData(): Promise<void> {
	logger.info("Iniciando processamento de dados no MongoDB");

	// Obtenção de race cards
	await metrics.measure("Obtenção de race cards", async () => {
		const date = new Date();
		date.setDate(date.getDate() + CONFIG.dates.daysToAdd);
		const formatted = date.toISOString().slice(0, 10);

		logger.info(`Obtendo race cards para a data: ${formatted}`);
		const stats = await raceCards.getRaceCardAndStore_Hr(formatted);
		logger.info(
			`Race cards obtidos e armazenados com sucesso. Recebidos: ${stats.recebidos}, Inseridos: ${stats.inseridos}`,
		);
	});

	// Obtenção de detalhes de race cards
	await metrics.measure("Obtenção de detalhes de race cards", async () => {
		const racecards = await raceCards.getUnfinishedRaceCard_Hr(false);
		logger.info(
			`Encontrados ${racecards.length} race cards não finalizados para processamento`,
		);

		if (racecards.length === 0) {
			logger.warn(
				"Nenhum race card não finalizado encontrado para processamento",
			);
			return;
		}

		await processBatch(racecards, async (rc, index, array) => {
			await withRetry(
				async () => {
					logger.info(
						`Processando detalhes para race card ${rc.id_race} (${index + 1}/${array.length})`,
					);
					await raceDetails.getRaceDetailAndStore_Hr(rc.id_race);
					logger.info(
						`Detalhes para race card ${rc.id_race} atualizados com sucesso`,
					);
				},
				{},
				`race card ${rc.id_race}`,
			);
		});

		logger.info(
			"Todos os detalhes de race cards foram processados com sucesso",
		);
	});

	// Obtenção de estatísticas de cavalos
	await metrics.measure("Obtenção de estatísticas de cavalos", async () => {
		const racecardsForStats = await raceCards.getUnfinishedRaceCard_Hr(true);

		if (!racecardsForStats || racecardsForStats.length === 0) {
			logger.warn(
				"Não foram encontradas corridas não iniciadas para obtenção de estatísticas de cavalos",
			);
			return;
		}

		logger.info(
			`Encontrados ${racecardsForStats.length} race cards não iniciados para processamento de estatísticas de cavalos`,
		);
		await horseStats.getHorseStatsAndStore_hr(racecardsForStats);
		logger.info("Estatísticas de cavalos obtidas e armazenadas com sucesso");
	});

	logger.info("Processamento de dados no MongoDB concluído com sucesso");
}

/**
 * Etapa 3: Transferência e preparação de dados no Supabase
 */
async function transferToSupabase(): Promise<void> {
	logger.info("Iniciando transferência e preparação de dados no Supabase");
	await metrics.measure(
		"Transferência de race cards para Supabase",
		async () => {
			await populateRacecardsEnriched_spb();
			logger.info("Race cards transferidos para Supabase com sucesso");
		},
	);
	// Transferência de race cards
	await Promise.all([
		metrics.measure(
			"Transferência de detalhes de corridas para Supabase",
			async () => {
				await populateRaceDetail_spb();
				logger.info(
					"Detalhes de corridas transferidos para Supabase com sucesso",
				);
			},
		),
		metrics.measure(
			"Transferência de estatísticas de cavalos para Supabase",
			async () => {
				await populateHorseStats_spb();
				logger.info(
					"Estatísticas de cavalos transferidas para Supabase com sucesso",
				);
			},
		),
		metrics.measure(
			"Transferência de detalhes históricos de corridas para Supabase",
			async () => {
				await populateEnrichedRaceDetail_spb();
				logger.info(
					"Detalhes históricos transferidos para Supabase com sucesso",
				);
			},
		),
	]);

	await metrics.measure(
		"Verificação de cavalos com resultados suficientes",
		async () => {
			await checkHorseResultLength();
			logger.info("Verificação de resultados de cavalos concluída com sucesso");
		},
	);

	await metrics.measure("Remoção de race cards não elegíveis", async () => {
		await updateCleanRacecard();
		logger.info("Race cards não elegíveis removidos com sucesso");
	});

	await metrics.measure(
		"Enriquecimento de racecards (Racing API)",
		async () => {
			await enrichRacecardsFromRacingApi();
			logger.info("Racecards enriquecidos com Racing API");
		},
	);

	// Geração de features
	await metrics.measure("Geração de features para treinamento", async () => {
		const endDate = new Date();
		const startDate = new Date();
		startDate.setDate(startDate.getDate() - 7);

		const trainingResult = await generateTrainingFeatures_v4(
			supabase,
			startDate,
			endDate,
			{
				mode: "training",
				batchSize: 25,
				saveToDatabase: true,
				minQualityScore: 0.7,
			},
		);

		logger.info(
			`Features para treinamento geradas com sucesso: ${trainingResult.racesProcessed} corridas, ${trainingResult.featuresGenerated} features`,
		);
	});

	await metrics.measure("Geração de features para previsão", async () => {
		const { data: upcomingRaces, error } = await supabase
			.schema("hml")
			.from("racecards_hr_enriched")
			.select("id_race")
			.eq("finished", 0)
			.eq("canceled", 0);

		if (error) throw error;

		if (!upcomingRaces || upcomingRaces.length === 0) {
			logger.info("Nenhuma corrida futura encontrada para previsão, pulando.");
			return;
		}

		const raceIds = upcomingRaces.map((r) => r.id_race);

		const predictionFeatures = await generatePredictionFeatures_v4(
			supabase,
			raceIds,
			{
				mode: "prediction",
				saveToDatabase: true,
				minQualityScore: 0.5,
			},
		);

		logger.info(
			`Features para previsão geradas com sucesso: ${raceIds.length} corridas, ${predictionFeatures.length} features`,
		);
	});

	logger.info(
		"Transferência e preparação de dados no Supabase concluída com sucesso",
	);
}

/**
 * Etapa 4: Treinamento do modelo e geração de previsões
 */
async function trainAndPredict(): Promise<void> {
	logger.info("Iniciando treinamento do modelo e geração de previsões");

	// Guarda de retreino (2026-07-04): com ENABLE_CRON_RETRAIN=1 o retreino
	// roda ATRÁS do staging gate (treina candidato em path isolado, avalia ROI
	// vs prod nos últimos 90d, promove só se não regredir — ver
	// src/services/ml/staging-gate.ts). Default é NÃO retreinar — o pipeline
	// usa o modelo já promovido em prod. Retreino manual direto (SEM gate)
	// continua disponível via GET /api/ml/training.
	const cronRetrainEnabled =
		(process.env.ENABLE_CRON_RETRAIN || "").trim() === "1";

	if (cronRetrainEnabled) {
		await metrics.measure("Treinamento do modelo (staging gate)", async () => {
			await trainAllModelsWithGate();
			logger.info("Retreino com staging gate concluído");
		});
	} else {
		logger.warn(
			"Retreino automático DESATIVADO (ENABLE_CRON_RETRAIN != 1) — pulando treino, usando modelo atual de prod",
		);
	}

	// Geração de previsões
	await metrics.measure("Geração de previsões", async () => {
		await generatePredictions_v4();
		logger.info("Previsões geradas com sucesso");
	});

	// Inserção de previsões no banco de dados
	await metrics.measure("Inserção de previsões no banco de dados", async () => {
		await generateLayBettingPicks();
		logger.info("Previsões inseridas no banco de dados com sucesso");
	});

	logger.info(
		"Treinamento do modelo e geração de previsões concluídos com sucesso",
	);
}

/**
 * Função principal do pipeline que executa todas as etapas em sequência
 */
export const runPipeline = async (): Promise<PipelineResult> => {
	const begin = Date.now();
	try {
		logger.info("Iniciando pipeline de atualização de dados de corridas");

		await metrics.measure("Pipeline Completo", async () => {
			// Etapa 1: Atualização de dados no MongoDB
			await updateMongoDBData();

			// Etapa 2: Processamento de dados no MongoDB
			await processMongoDBData();

			// Etapa 3: Transferência e preparação de dados no Supabase
			await transferToSupabase();

			// Etapa 4: Treinamento do modelo e geração de previsões
			await trainAndPredict();
		});

		logger.info("Pipeline de atualização concluído com sucesso");
		return {
			success: true,
			message: "Pipeline de atualização concluído com sucesso",
			time: formatMS(Date.now() - begin),
		};
	} catch (error) {
		// Tratamento de erros centralizado
		const errorMessage =
			error instanceof Error
				? error.message
				: typeof error === "object"
					? JSON.stringify(error)
					: String(error);
		logger.error(
			`Erro no pipeline de atualização: ${errorMessage}`,
			error instanceof Error ? error : new Error(errorMessage),
		);

		// Aqui você pode adicionar notificações, alertas ou outras ações em caso de falha

		return {
			success: false,
			error: errorMessage,
			time: formatMS(Date.now() - begin),
		};
	}
};

/**
 * Captura intraday de odds (2026-07-08, resposta ao drift de 35%
 * geração→SP): re-busca race details das corridas de hoje ainda não
 * iniciadas (odds frescas → MongoDB) e transfere pro Supabase
 * (odds_enriched ganha novos snapshots com last_update mais recente).
 * getMarketOdd (fallback "última odd") passa a enxergar odds atuais
 * automaticamente. Fundação pra regeração de picks intraday.
 */
export async function captureIntradayOdds(): Promise<void> {
	const begin = Date.now();
	logger.info("Captura intraday de odds: iniciando");

	// checked_detail=true → corridas de hoje já processadas pelo pipeline
	// noturno, aguardando largada
	const racecards = await raceCards.getUnfinishedRaceCard_Hr(true);
	if (!racecards || racecards.length === 0) {
		logger.warn("Captura intraday: nenhuma corrida aguardando largada");
		return;
	}
	logger.info(`Captura intraday: ${racecards.length} corridas`);

	await processBatch(racecards, async (rc, index, array) => {
		await withRetry(
			async () => {
				logger.info(
					`Captura intraday: odds da corrida ${rc.id_race} (${index + 1}/${array.length})`,
				);
				await raceDetails.getRaceDetailAndStore_Hr(rc.id_race);
			},
			{},
			`intraday odds ${rc.id_race}`,
		);
	});

	// Mongo → Supabase (upsert idempotente por race_horse_id+bookie+last_update)
	await populateRaceDetail_spb();

	logger.info(
		`Captura intraday de odds concluída em ${formatMS(Date.now() - begin)}`,
	);
}

/**
 * Configuração do Node Cron para execução automática.
 * node-cron SEM opção `timezone` usa a hora LOCAL do servidor
 * (mazeserver = America/Sao_Paulo, UTC-3):
 * - 20:00 local (23:00 UTC): enriquecimento de resultados via Racing API
 * - 00:00 local (03:00 UTC): pipeline completo (dados + features + predição
 *   + picks; retreino só com ENABLE_CRON_RETRAIN=1)
 * - 06:00 e 09:00 local (09:00/12:00 UTC): captura intraday de odds
 *   (só com ENABLE_INTRADAY_ODDS=1)
 */
export function setupCronJob(): boolean {
	try {
		// Importação dinâmica para evitar dependência em ambientes onde node-cron não está disponível
		const cron = require("node-cron");
		// 20:00 local / 23:00 UTC (depois que as corridas UK terminam)
		cron.schedule("0 20 * * *", async () => {
			try {
				logger.info("Iniciando enriquecimento de resultados (Racing API)");
				await enrichResultsFromRacingApi();
				logger.info("Enriquecimento de resultados concluído");
			} catch (error) {
				logger.error(
					"Erro no enriquecimento de resultados (Racing API):",
					error instanceof Error ? error : new Error(String(error)),
				);
			}
			// Relatório de homologação (picks × resultados) — roda aqui porque os
			// resultados acabaram de ser enriquecidos. Best-effort.
			try {
				const { generateHomologReport } = await import(
					"../services/ml/homolog-report"
				);
				await generateHomologReport();
			} catch (error) {
				logger.error(
					"Erro no relatório de homologação:",
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		});

		// 06:00 e 09:00 local (09:00/12:00 UTC — ~3,5h e ~30min antes das
		// primeiras corridas UK): captura intraday de odds. Opt-in via env.
		if ((process.env.ENABLE_INTRADAY_ODDS || "").trim() === "1") {
			cron.schedule("0 6,9 * * *", async () => {
				try {
					await captureIntradayOdds();
				} catch (error) {
					logger.error(
						"Erro na captura intraday de odds:",
						error instanceof Error ? error : new Error(String(error)),
					);
				}
			});
			logger.info("Captura intraday de odds AGENDADA (06:00 e 09:00 local)");
		} else {
			logger.info(
				"Captura intraday de odds desativada (ENABLE_INTRADAY_ODDS != 1)",
			);
		}

		// 00:00 local / 03:00 UTC: pipeline completo diário
		cron.schedule("00 00 * * *", async () => {
			logger.info("Iniciando execução agendada do pipeline de atualização");
			const result = await runPipeline();
			logger.info(
				`Resultado da execução agendada: ${result.success ? "Sucesso" : "Falha"}`,
			);
			logger.info(`Tempo da execução agendada: ${result.time}`);

			if (!result.success) {
				logger.error(`Falha na execução agendada: ${result.error}`);
				// Aqui você pode adicionar notificações de falha
			}
		});

		logger.info(
			"Agendamento do pipeline configurado para execução diária às 00:00",
		);
		return true;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error(
			`Erro ao configurar agendamento: ${errorMessage}`,
			error instanceof Error ? error : new Error(errorMessage),
		);
		return false;
	}
}

function formatMS(ms: number): string {
	// Calculando as unidades
	const segundosTotais = Math.floor(ms / 1000);

	const horas = Math.floor(segundosTotais / 3600);
	const minutos = Math.floor((segundosTotais % 3600) / 60);
	const segundos = segundosTotais % 60;

	// Formatando para string HH:mm:ss
	const hDisplay = String(horas).padStart(2, "0");
	const mDisplay = String(minutos).padStart(2, "0");
	const sDisplay = String(segundos).padStart(2, "0");

	return `${hDisplay}:${mDisplay}:${sDisplay}`;
}

/**
 * Para iniciar o serviço, você pode usar:
 *
 * import { setupCronJob } from './updatePipelineOtimizado';
 * setupCronJob();
 *
 * Ou para execução manual:
 *
 * import { runPipeline } from './updatePipelineOtimizado';
 * runPipeline().then(result => console.log(result));
 */
