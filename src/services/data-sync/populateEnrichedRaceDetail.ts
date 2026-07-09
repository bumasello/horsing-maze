import { supabase } from "../..";
import { getDataSchema } from "../../shared/db-config";
import { getHistoryRaceDetailId } from "../../shared/utils/getHistoryRaceDetailId";
import { insertEnrichedRaceDetail } from "../../shared/utils/insertEnrichedRaceDetail";

interface UnfinishedRaces {
	id: number;
	id_race: string;
}

interface UnfinishedRacesHorse {
	id: number;
	racecard_id: number;
	id_horse: number;
}

export const populateEnrichedRaceDetail_spb = async () => {
	const { data: unfinishedracecards, error: unfinishedracecardsError } =
		await supabase
			.schema(getDataSchema())
			.from("racecards_hr_enriched")
			.select("id, id_race")
			.eq("finished", 0)
			.eq("canceled", 0);

	if (unfinishedracecardsError)
		throw new Error("Erro ao carregar corridas não finalizadas no Supabase.");

	const totalRaces = unfinishedracecards?.length || 0;
	console.log(
		`Iniciando processamento de ${totalRaces} corridas não finalizadas`,
	);

	if (totalRaces === 0) {
		console.log("Nenhuma corrida não finalizada encontrada.");
		return;
	}

	// Busca todos os racecard_ids das corridas não finalizadas de uma vez
	const racecardIds = unfinishedracecards.map((r) => r.id);

	const { data: allHorses, error: allHorsesError } = await supabase
		.schema(getDataSchema())
		.from("race_horses_hr_enriched")
		.select("id, racecard_id, id_horse")
		.in("racecard_id", racecardIds);

	if (allHorsesError)
		throw new Error("Erro ao carregar cavalos das corridas não finalizadas.");

	// Busca todos os id_race já existentes no Supabase de uma vez
	const { data: existingRacecards, error: existingRacecardsError } =
		await supabase
			.schema(getDataSchema())
			.from("racecards_hr_enriched")
			.select("id_race");

	if (existingRacecardsError)
		throw new Error("Erro ao carregar corridas existentes no Supabase.");

	const existingRaceIds = new Set(
		existingRacecards.map((r) => r.id_race.toString()),
	);

	// Agrupa cavalos por corrida em memória
	const horsesByRace = new Map<number, UnfinishedRacesHorse[]>();
	for (const horse of allHorses as UnfinishedRacesHorse[]) {
		const group = horsesByRace.get(horse.racecard_id) || [];
		group.push(horse);
		horsesByRace.set(horse.racecard_id, group);
	}

	let processedRaces = 0;

	for (const race of unfinishedracecards as UnfinishedRaces[]) {
		processedRaces++;
		console.log(
			`[${processedRaces}/${totalRaces}] Processando corrida ID: ${race.id} (Race: ${race.id_race})`,
		);

		const horses = horsesByRace.get(race.id) || [];
		const totalHorses = horses.length;

		if (totalHorses === 0) {
			console.log(
				`Nenhum cavalo encontrado para a corrida ${race.id}, pulando...`,
			);
			continue;
		}

		console.log(`Total de cavalos nesta corrida: ${totalHorses}`);

		let processedHorses = 0;

		for (const horse of horses) {
			processedHorses++;
			console.log(
				`[${processedHorses}/${totalHorses}] Processando cavalo ID: ${horse.id_horse}`,
			);

			try {
				const raceIds = await getHistoryRaceDetailId(horse.id_horse);
				const totalHistoricRaces = raceIds.length;
				console.log(
					`Encontradas ${totalHistoricRaces} corridas históricas para cavalo ${horse.id_horse}`,
				);

				let insertedHistoricRaces = 0;
				let skippedHistoricRaces = 0;

				for (const raceId of raceIds) {
					if (existingRaceIds.has(raceId.toString())) {
						skippedHistoricRaces++;
						continue;
					}

					await insertEnrichedRaceDetail(+raceId);
					// Adiciona ao Set em memória para evitar inserções duplicadas
					// no mesmo ciclo de processamento
					existingRaceIds.add(raceId.toString());
					insertedHistoricRaces++;
					console.log(`Race ID ${raceId} inserida com sucesso`);
				}

				console.log(
					`Cavalo ${horse.id_horse}: ${insertedHistoricRaces} inseridas, ${skippedHistoricRaces} puladas de ${totalHistoricRaces} total`,
				);
			} catch (error) {
				console.error(
					`Erro ao processar historico do cavalo ${horse.id_horse}:`,
					error,
				);
			}
		}

		const progressPercentage = ((processedRaces / totalRaces) * 100).toFixed(1);
		console.log(
			`Progresso: ${processedRaces}/${totalRaces} corridas (${progressPercentage}%) | Restam: ${totalRaces - processedRaces}`,
		);
	}

	console.log(
		`Processamento concluido. Total de ${totalRaces} corridas processadas.`,
	);
};
