import { supabase } from "../..";
import raceDetail from "../../integrations/mongodb/getRaceDetail_Hr";
import { getDataSchema } from "../../shared/db-config";

export const populateRaceDetail_spb = async () => {
	const { data: racecards, error: racecardsError } = await supabase
		.schema(getDataSchema())
		.from("racecards_hr_enriched")
		.select("id, id_race")
		.eq("finished", 0)
		.eq("canceled", 0);

	if (racecardsError) {
		throw new Error(
			`Erro ao selecionar racecards_hr: ${racecardsError.message}`,
		);
	}

	if (!racecards || racecards.length === 0) {
		console.log("Nenhuma corrida não finalizada encontrada.");
		return;
	}

	console.log(`Processando ${racecards.length} corridas...`);

	for (const race of racecards) {
		const details = await raceDetail.getStoredRaceDetail_Hr(race.id_race);

		if (!details || details.length === 0) {
			console.warn(`Detalhes não encontrados para a corrida ${race.id_race}`);
			continue;
		}

		for (const rc_detail of details) {
			const horses = rc_detail.horses;

			if (!horses || horses.length === 0) {
				console.warn(`Nenhum cavalo encontrado para a corrida ${race.id_race}`);
				continue;
			}

			for (const h of horses) {
				// Upsert do cavalo — retorna o id para usar nas odds
				const { data: upsertedHorse, error: upsertHorseError } = await supabase
					.schema(getDataSchema())
					.from("race_horses_hr_enriched")
					.upsert(
						{
							racecard_id: race.id,
							horse: h.horse || null,
							id_horse: h.id_horse || null,
							jockey: h.jockey || null,
							trainer: h.trainer || null,
							age: h.age || null,
							weight: h.weight || null,
							number: h.number || null,
							last_ran_days_ago: h.last_ran_days_ago || null,
							non_runner: h.non_runner || null,
							form: h.form || null,
							position: h.position || null,
							distance_beaten: h.distance_beaten || null,
							owner: h.owner || null,
							sire: h.sire || null,
							dam: h.dam || null,
							or_rating: h.OR || null,
							sp: h.sp || null,
						},
						{ onConflict: "racecard_id,id_horse" },
					)
					.select("id")
					.single();

				if (upsertHorseError) {
					console.error(
						`Erro no upsert do cavalo ${h.horse} para corrida ${race.id_race}:`,
						upsertHorseError,
					);
					continue;
				}

				const raceHorseId = upsertedHorse.id;
				console.log(
					`Cavalo "${h.horse}" upserted para corrida ${race.id_race} (id: ${raceHorseId})`,
				);

				// Odds
				if (!h.odds || h.odds.length === 0) {
					console.log(
						`Sem odds para o cavalo "${h.horse}" na corrida ${race.id_race}.`,
					);
					continue;
				}

				for (const o of h.odds) {
					const { error: upsertOddError } = await supabase
						.schema(getDataSchema())
						.from("odds_enriched")
						.upsert(
							{
								race_horse_id: raceHorseId,
								bookie: o.bookie || null,
								odd: o.odd || null,
								last_update: o.last_update || null,
								url: o.url || null,
							},
							{
								onConflict: "race_horse_id,bookie,last_update",
								ignoreDuplicates: true,
							},
						);

					if (upsertOddError) {
						console.error(
							`Erro no upsert de odds para cavalo ${h.horse} (bookie: ${o.bookie}):`,
							upsertOddError,
						);
					} else {
						console.log(
							`Odds upserted para cavalo "${h.horse}" (bookie: ${o.bookie}).`,
						);
					}
				}
			}
		}
	}

	console.log("Population de race details concluída com sucesso.");
};
