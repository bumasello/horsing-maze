import dotenv from "dotenv";
import { supabase } from "../..";
import { apiKeys } from "../../config/apiKeys";
import type { IHorse_Hr } from "../../models/modelHr/horseHrModel";
import type { IRaceDetail_Hr } from "../../models/modelHr/raceDetailHrModel";
import { cleanNumericValue } from "./cleanNumericValue";
import { processHorsePosition } from "./processHorsePosition";
import { parseSP } from "../../services/features/converters";

dotenv.config();

/**
 * Função para obter detalhes de corrida histórica e armazenar no Supabase
 */
export const insertEnrichedRaceDetail = async (
  raceid: number,
): Promise<void> => {
  if (apiKeys.length === 0) {
    throw new Error("Nenhuma API key disponível.");
  }

  // Verifica se o racecard já existe ANTES de fazer a requisição
  const { data: existingRacecard } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select("id")
    .eq("id_race", raceid.toString())
    .single();

  if (existingRacecard) {
    console.log(`Corrida ${raceid} já existe no Supabase, pulando requisição.`);
    return;
  }

  let currentKeyIndex = 0;

  const getHeaders = (): Headers => {
    const headers = new Headers();
    headers.set("x-rapidapi-key", apiKeys[currentKeyIndex]);
    headers.set("x-rapidapi-host", process.env.XRAPIDAPIHOST || "");
    return headers;
  };

  const rotateApiKey = (): Headers => {
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    return getHeaders();
  };

  const MAX_RETRIES = 4;
  let retryCount = 0;
  let waitTime = 5000;
  let success = false;
  let headers = getHeaders();
  let keysTriedCount = 0;

  const url = `${process.env.HORSERACINGAPIURLRACEDETAILS}${raceid}`;

  await new Promise((resolve) => setTimeout(resolve, 2000));

  while (!success && retryCount < MAX_RETRIES) {
    try {
      const response = await fetch(url, { method: "GET", headers });

      if (!response.ok) {
        if (response.status === 429 || response.status === 403) {
          if (response.status === 403) {
            console.error(
              `Erro 403 na key [${currentKeyIndex}]: ${apiKeys[currentKeyIndex]?.substring(0, 12)}...`,
            );
          }
          keysTriedCount++;
          if (keysTriedCount >= apiKeys.length) {
            throw new Error(
              `Todas as ${apiKeys.length} API keys falharam com ${response.status}`,
            );
          }
          headers = rotateApiKey();
          continue;
        }
        throw new Error(
          `Erro na requisição: ${response.status} ${response.statusText}`,
        );
      }

      const data: IRaceDetail_Hr = await response.json();
      if (!data) throw new Error("Resposta vazia da API");

      const horses = Array.isArray(data.horses) ? data.horses : [];

      if (horses.length === 0) {
        console.log(`Corrida ${raceid} sem cavalos`);
        success = true;
        return;
      }

      console.log(`Processando corrida ${raceid} com ${horses.length} cavalos`);

      // Inserir novo racecard
      const { data: insertedRacecard, error: insertError } = await supabase
        .schema("hml")
        .from("racecards_hr_enriched")
        .insert({
          id_race: raceid.toString(),
          course: data.course || null,
          date: data.date || null,
          off_time_br: data.off_time_br || null,
          off_time_uk: data.off_time_uk || null,
          title: data.title || null,
          distance: data.distance || null,
          age: data.age || null,
          going: data.going || null,
          finished: 1,
          canceled: data.canceled || 0,
          finish_time: data.finish_time || null,
          prize: data.prize || null,
          class: data.class || null,
        })
        .select("id")
        .single();

      if (insertError) {
        throw new Error(`Erro ao inserir racecard: ${insertError.message}`);
      }

      const racecardId = insertedRacecard.id;
      console.log(`Novo racecard criado: ${racecardId}`);

      for (const horse of horses as IHorse_Hr[]) {
        try {
          processHorsePosition(horse, raceid);

          const horseData = {
            racecard_id: racecardId,
            horse: horse.horse || null,
            id_horse: horse.id_horse || null,
            jockey: horse.jockey || null,
            trainer: horse.trainer || null,
            age: cleanNumericValue(horse.age),
            weight: horse.weight || null,
            number: cleanNumericValue(horse.number),
            last_ran_days_ago: cleanNumericValue(horse.last_ran_days_ago),
            non_runner: horse.non_runner === 1 ? 1 : 0,
            form: horse.form || null,
            position: horse.non_runner === 1 ? 0 : horse.position || 99,
            distance_beaten: horse.distance_beaten || null,
            owner: horse.owner || null,
            sire: horse.sire || null,
            dam: horse.dam || null,
            or_rating: cleanNumericValue(horse.OR),
            sp: horse.sp || null,
            sp_decimal: parseSP(horse.sp || null),
          };

          const { error: upsertError } = await supabase
            .schema("hml")
            .from("race_horses_hr_enriched")
            .upsert(horseData, { onConflict: "racecard_id,id_horse" });

          if (upsertError) {
            console.error(
              `Erro ao inserir cavalo ${horse.id_horse}:`,
              upsertError,
            );
          }
        } catch (horseError) {
          console.error(
            `Erro ao processar cavalo ${horse.id_horse}:`,
            horseError,
          );
        }
      }

      success = true;
      console.log(`Corrida ${raceid} processada com sucesso.`);
    } catch (error) {
      retryCount++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `Tentativa ${retryCount}/${MAX_RETRIES} falhou: ${errorMessage}`,
      );

      if (retryCount < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        waitTime = Math.min(waitTime * 2, 30000);
      } else {
        throw new Error(
          `Falha após ${MAX_RETRIES} tentativas: ${errorMessage}`,
        );
      }
    }
  }
};
