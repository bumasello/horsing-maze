import { supabase } from "../..";
import horseStatsData from "../../integrations/mongodb/getHorseResults_Hr";
import horseStatsHrModel from "../../models/modelHr/horseStatsHrModel";
import type { IHorseStats_HR } from "../../models/modelHr/horseStatsHrModel";
import { getDataSchema } from "../../shared/db-config";

export const populateHorseStats_spb = async () => {
	console.log("Iniciando população de estatísticas de cavalos no Supabase...");

	const horseStats: IHorseStats_HR[] =
		await horseStatsData.getStoredHorseStats_Hr();

	console.log(
		`Processando ${horseStats.length} cavalos com estatísticas atualizadas.`,
	);

	for (const stats of horseStats) {
		try {
			// Upsert do cavalo
			const { data: insertedStats, error: upsertError } = await supabase
				.schema(getDataSchema())
				.from("horse_stats_enriched")
				.upsert(
					{
						horse: stats.horse,
						id_horse: stats.id_horse,
						result_count: stats.result_count || 0,
					},
					{ onConflict: "id_horse" },
				)
				.select("id")
				.single();

			if (upsertError) {
				console.error(
					`Erro no upsert para ${stats.horse}:`,
					upsertError.message,
				);
				continue;
			}

			const stats_id = insertedStats?.id;
			if (!stats_id) {
				console.warn(
					`Não foi possível obter ID após upsert para ${stats.horse}`,
				);
				continue;
			}

			// Upsert dos resultados — elimina o select prévio
			for (const result of stats.results) {
				if (!result.position) continue;

				const { error: upsertResultError } = await supabase
					.schema(getDataSchema())
					.from("horse_results_enriched")
					.upsert(
						{
							stats_id,
							date: result.date,
							position: result.position,
							course: result.course,
							distance: result.distance,
							class: result.class || 0,
							weight: result.weight,
							starting_price: result.starting_price,
							jockey: result.jockey,
							trainer: result.trainer,
							or_rating: result.OR || 0,
							race: result.race,
							prize: result.prize,
						},
						{ onConflict: "stats_id,date,race", ignoreDuplicates: true },
					);

				if (upsertResultError) {
					console.error(
						`Erro no upsert do resultado para "${stats.horse}" na data ${result.date}:`,
						upsertResultError.message,
					);
				}
			}

			// Marca como processado no MongoDB — só roda se tudo correu bem
			await horseStatsHrModel.updateOne(
				{ id_horse: stats.id_horse },
				{ $set: { updated: false } },
			);

			console.log(`Cavalo "${stats.horse}" processado com sucesso.`);
		} catch (error) {
			// Erro num cavalo não para os outros
			console.error(`Erro ao processar cavalo "${stats.horse}":`, error);
		}
	}

	console.log("População de estatísticas de cavalos concluída com sucesso.");
};
