import { supabase } from "../../.."; // ajuste conforme sua estrutura
import raceDetail from "../../mdb_functions/getRaceDetail_Hr";
import type { IHorse_Hr } from "../../../models/modelHr/horseHrModel";

export const populateRaceDetail_spb = async () => {
  // Seleciona as racecards do Supabase para obter os ids e o id_race original
  const { data: racecards, error: racecardsError } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select("id, id_race")
    .eq("finished", "0")
    .eq("canceled", "0");

  if (racecardsError) {
    console.error("Erro ao selecionar racecards_hr: ", racecardsError);
    return;
  }

  for (const race of racecards) {
    // Obtém os detalhes da corrida (do Mongo)
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

      // Processa cada cavalo do array
      for (const h of horses) {
        // Verifica se o cavalo já foi inserido para esse racecard, pelo par (racecard_id, id_horse)
        const { data: existingHorse, error: checkHorseError } = await supabase
          .schema("hml")
          .from("race_horses_hr_enriched")
          .select("id")
          .eq("racecard_id", race.id)
          .eq("id_horse", h.id_horse);

        if (checkHorseError) {
          console.error(
            `Erro verificando cavalo ${h.horse} para a corrida ${race.id_race}:`,
            checkHorseError,
          );
          continue;
        }

        let raceHorseId: number;
        if (existingHorse && existingHorse.length > 0) {
          // Já existe, use o id existente
          raceHorseId = existingHorse[0].id;
          console.log(
            `Cavalo "${h.horse}" já existente para a corrida ${race.id_race} com race_horse_id: ${raceHorseId}`,
          );
        } else {
          // Insere o cavalo e captura o id gerado
          const { data: insertedHorse, error: insertHorseError } =
            await supabase
              .schema("hml")
              .from("race_horses_hr_enriched")
              .insert({
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
              })
              .select("id");
          if (insertHorseError) {
            console.error(
              `Erro inserindo cavalo ${h.horse} para a corrida ${race.id_race}:`,
              insertHorseError,
            );
            continue;
          }
          raceHorseId = insertedHorse![0].id;
          console.log(
            `Inserido cavalo "${h.horse}" para a corrida ${race.id_race} com race_horse_id: ${raceHorseId}`,
          );
        }

        // Agora, para as odds: verifique se há odds para esse cavalo
        if (h.odds && h.odds.length > 0) {
          // Para cada odds, verificar se já existe (por exemplo, usando bookie e last_update como chave)
          for (const o of h.odds) {
            const { data: existingOdd, error: checkOddError } = await supabase
              .schema("hml")
              .from("odds_enriched")
              .select("id")
              .eq("race_horse_id", raceHorseId)
              .eq("bookie", o.bookie)
              .eq("last_update", o.last_update);
            if (checkOddError) {
              console.error(
                `Erro verificando odds para o cavalo ${h.horse} (bookie: ${o.bookie}):`,
                checkOddError,
              );
              continue;
            }
            if (existingOdd && existingOdd.length > 0) {
              console.log(
                `Odds para o cavalo "${h.horse}" (bookie: ${o.bookie}) já existem.`,
              );
              continue;
            } else {
              const { error: insertOddError } = await supabase
                .schema("hml")
                .from("odds_enriched")
                .insert({
                  race_horse_id: raceHorseId,
                  bookie: o.bookie || null,
                  odd: o.odd || null,
                  last_update: o.last_update || null,
                  url: o.url || null,
                });
              if (insertOddError) {
                console.error(
                  `Erro inserindo odds para o cavalo ${h.horse} (bookie: ${o.bookie}):`,
                  insertOddError,
                );
              } else {
                console.log(
                  `Inserida odds para o cavalo "${h.horse}" (bookie: ${o.bookie}).`,
                );
              }
            }
          }
        } else {
          console.log(
            `Sem odds para o cavalo "${h.horse}" na corrida ${race.id_race}.`,
          );
        }
      } // Fim do loop para cada cavalo
    } // Fim do loop de detalhes
  } // Fim do loop para cada racecard
};
