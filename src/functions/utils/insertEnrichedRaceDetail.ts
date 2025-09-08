import dotenv from "dotenv";
import { supabase } from "../..";
import { apiKeys } from "../../config/apiKeys";
import type { IHorse_Hr } from "../../models/modelHr/horseHrModel";
import type { IRaceDetail_Hr } from "../../models/modelHr/raceDetailHrModel";
import { cleanNumericValue } from "./cleanNumericValue";
import { processHorsePosition } from "./processHorsePosition";

dotenv.config();

/**
 * Função melhorada para processar a posição do cavalo
 * Garante que sempre retorna valores válidos para o banco
 */

/**
 * Função auxiliar para validar e limpar valores numéricos
 * Retorna null se o valor for 0, negativo ou inválido
 */

/**
 * Função para obter detalhes de corrida histórica e armazenar no Supabase
 */
export const insertEnrichedRaceDetail = async (
  raceid: number,
): Promise<void> => {
  // Array de API keys disponíveis

  if (apiKeys.length === 0) {
    throw new Error("Nenhuma API key disponível.");
  }

  let currentKeyIndex = 0;

  // Função para obter headers com a API key atual
  const getHeaders = (): Headers => {
    const headers = new Headers();
    headers.set("x-rapidapi-key", apiKeys[currentKeyIndex]);
    headers.set("x-rapidapi-host", process.env.XRAPIDAPIHOST || "");
    return headers;
  };

  // Função para rotacionar para a próxima API key
  const rotateApiKey = (): Headers => {
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    console.log(
      `Mudando para API key ${currentKeyIndex + 1}/${apiKeys.length}`,
    );
    return getHeaders();
  };

  // Configurações de retry
  const MAX_RETRIES = 4;
  let retryCount = 0;
  let waitTime = 5000;
  let success = false;
  let headers = getHeaders();

  const url = `${process.env.HORSERACINGAPIURLRACEDETAILS}${raceid}`;

  // Delay inicial
  await new Promise((resolve) => setTimeout(resolve, 2000));

  while (!success && retryCount < MAX_RETRIES) {
    try {
      const response = await fetch(url, { method: "GET", headers });

      if (!response.ok) {
        if (response.status === 429) {
          console.log("Erro 429: Too many requests");
          headers = rotateApiKey();
          continue;
        }
        throw new Error(
          `Erro na requisição: ${response.status} ${response.statusText}`,
        );
      }

      const data: IRaceDetail_Hr = await response.json();
      console.log(`Dados recebidos para corrida ${raceid}`);

      if (!data) {
        throw new Error("Resposta vazia da API");
      }

      const horses = Array.isArray(data.horses) ? data.horses : [];

      if (horses.length === 0) {
        console.log(`Corrida ${raceid} sem cavalos`);
        success = true;
        return;
      }

      console.log(`Processando corrida ${raceid} com ${horses.length} cavalos`);

      // Verificar se já existe racecard
      const { data: existingRacecard } = await supabase
        .schema("hml")
        .from("racecards_hr_enriched")
        .select("id")
        .eq("id_race", raceid.toString())
        .single();

      let racecardId: number;

      if (existingRacecard) {
        racecardId = existingRacecard.id;
        console.log(`Usando racecard existente: ${racecardId}`);
      } else {
        // Criar novo racecard
        const { data: insertedRacecard, error: insertError } = await supabase
          .schema("hml")
          .from("racecards_hr_enriched")
          .insert({
            id_race: raceid.toString(),
            course: data.course || null,
            date: data.date || null,
            off_time_br: data.off_time_br || null,
            title: data.title || null,
            distance: data.distance || null,
            age: data.age || null,
            going: data.going || null,
            finished: 1, // Corrida histórica finalizada
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

        racecardId = insertedRacecard.id;
        console.log(`Novo racecard criado: ${racecardId}`);
      }

      // Processar cada cavalo
      for (const horse of horses as IHorse_Hr[]) {
        try {
          // Processar posição ANTES de preparar os dados
          processHorsePosition(horse, raceid);

          // Preparar dados limpos para inserção
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
            non_runner: horse.non_runner === 1 ? 1 : 0, // Garantir 0 ou 1
            form: horse.form || null,
            position: horse.non_runner === 1 ? 0 : horse.position || 99, // Default para 99 se não houver posição
            distance_beaten: horse.distance_beaten || null,
            owner: horse.owner || null,
            sire: horse.sire || null,
            dam: horse.dam || null,
            or_rating: cleanNumericValue(horse.OR),
            sp: horse.sp || null,
          };

          // Validação final antes de inserir
          if (horseData.position === null || horseData.position === undefined) {
            horseData.position = 99;
          }
          if (
            horseData.non_runner === null ||
            horseData.non_runner === undefined
          ) {
            horseData.non_runner = 0;
          }

          // Fazer upsert
          const { error: upsertError } = await supabase
            .schema("hml")
            .from("race_horses_hr_enriched")
            .upsert(horseData, {
              onConflict: "racecard_id,id_horse",
            });

          if (upsertError) {
            console.error(
              `Erro ao inserir cavalo ${horse.id_horse}:`,
              upsertError,
            );
          } else {
            console.log(
              `Cavalo ${horse.id_horse} (${horse.horse}) inserido/atualizado`,
            );
          }
        } catch (horseError) {
          console.error(
            `Erro ao processar cavalo ${horse.id_horse}:`,
            horseError,
          );
          // Continuar com o próximo cavalo
        }
      }

      success = true;
      console.log(`Corrida ${raceid} processada com sucesso!`);
    } catch (error) {
      retryCount++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      console.error(
        `Tentativa ${retryCount}/${MAX_RETRIES} falhou: ${errorMessage}`,
      );

      if (
        errorMessage.includes("Too Many Requests") ||
        errorMessage.includes("429")
      ) {
        headers = rotateApiKey();
        waitTime = 1000;
      } else if (retryCount < MAX_RETRIES) {
        console.log(
          `Aguardando ${waitTime / 1000}s antes de tentar novamente...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        waitTime = Math.min(waitTime * 2, 30000); // Max 30 segundos
      } else {
        throw new Error(
          `Falha após ${MAX_RETRIES} tentativas: ${errorMessage}`,
        );
      }
    }
  }
};
