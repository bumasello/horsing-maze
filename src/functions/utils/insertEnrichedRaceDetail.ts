import dotenv from "dotenv";
import { supabase } from "../..";

import type { IHorse_Hr } from "../../models/modelHr/horseHrModel";
import type { IRaceDetail_Hr } from "../../models/modelHr/raceDetailHrModel";

// Lista de siglas que indicam que o cavalo participou mas não terminou (Green para Lay)
const didNotFinishCodes = ["PU", "UR", "F", "BD", "RO", "DSQ", "SU", "REF"];

// Lista de siglas que indicam void/anulação
const voidCodes = ["VO", "NR"];

dotenv.config();

/**
 * Função para obter detalhes de corrida histórica e armazenar no Supabase,
 * com implementação de rotação de API keys para evitar limites de requisição
 */
export const insertEnrichedRaceDetail = async (
  raceid: number,
): Promise<void> => {
  // Array de API keys disponíveis, filtradas para remover valores undefined/null
  const apiKeys = [
    process.env.XRAPIDAPIKEY0,
    process.env.XRAPIDAPIKEY1,
    process.env.XRAPIDAPIKEY2,
    process.env.XRAPIDAPIKEY3,
    process.env.XRAPIDAPIKEY4,
    process.env.XRAPIDAPIKEY5,
    process.env.XRAPIDAPIKEY6,
    process.env.XRAPIDAPIKEY7,
    process.env.XRAPIDAPIKEY8,
    process.env.XRAPIDAPIKEY9,
    process.env.XRAPIDAPIKEY10,
    process.env.XRAPIDAPIKEY11,
    process.env.XRAPIDAPIKEY12,
    process.env.XRAPIDAPIKEY13,
    process.env.XRAPIDAPIKEY14,
    process.env.XRAPIDAPIKEY15,
    process.env.XRAPIDAPIKEY16,
    process.env.XRAPIDAPIKEY17,
    process.env.XRAPIDAPIKEY18,
    process.env.XRAPIDAPIKEY19,
    process.env.XRAPIDAPIKEY20,
    process.env.XRAPIDAPIKEY21,
    process.env.XRAPIDAPIKEY22,
    process.env.XRAPIDAPIKEY23,
    process.env.XRAPIDAPIKEY24,
    process.env.XRAPIDAPIKEY25,
    process.env.XRAPIDAPIKEY26,
    process.env.XRAPIDAPIKEY27,
    process.env.XRAPIDAPIKEY28,
    process.env.XRAPIDAPIKEY29,
    process.env.XRAPIDAPIKEY30,
    process.env.XRAPIDAPIKEY31,
    process.env.XRAPIDAPIKEY32,
  ].filter((key): key is string => Boolean(key));

  if (apiKeys.length === 0) {
    throw new Error("Nenhuma API key disponível no array.");
  }

  let currentKeyIndex = 0;

  // Função para obter headers com a API key atual
  const getHeaders = (): Headers => {
    const headers = new Headers();
    headers.set("x-rapidapi-key", apiKeys[currentKeyIndex]);
    headers.set("x-rapidapi-host", process.env.XRAPIDAPIHOST || "error");
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
  const MAX_RETRIES = 3;
  let retryCount = 0;
  let waitTime = 5000; // Tempo inicial de espera para retry
  let success = false;
  let headers = getHeaders();

  // URL da API
  const url = `${process.env.HORSERACINGAPIURLRACEDETAILS}${raceid}` || "error";

  // Delay inicial antes da requisição
  await new Promise((resolve) => setTimeout(resolve, 2000));

  while (!success && retryCount < MAX_RETRIES) {
    try {
      const response = await fetch(url, { method: "GET", headers });

      if (!response.ok) {
        // Se receber erro 429 (Too Many Requests), rotaciona a API key
        if (response.status === 429) {
          console.log("Erro 429: Too many requests detectado");
          headers = rotateApiKey();
          continue; // Tenta novamente com a nova key sem incrementar retry
        }
        throw new Error(
          `Erro na requisição insertEnrichedRaceDetail: ${response.statusText}`,
        );
      }

      const data: IRaceDetail_Hr = await response.json();

      if (!data) throw new Error("Requisição retornou sem dados.");

      const horses = Array.isArray(data.horses) ? data.horses : [];

      // Para dados históricos, gravar independente da quantidade de cavalos
      if (horses.length > 0) {
        console.log(
          `Processando corrida histórica ${raceid} com ${horses.length} cavalos`,
        );

        // Verificar se já existe racecard para esta corrida no Supabase
        const { data: existingRacecard, error: racecardError } = await supabase
          .schema("hml")
          .from("racecards_hr_enriched")
          .select("id")
          .eq("id_race", raceid.toString())
          .single();

        let racecardId: number;

        if (racecardError || !existingRacecard) {
          // Criar racecard histórico no Supabase
          const { data: insertedRacecard, error: insertRacecardError } =
            await supabase
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
                finished: 1, // Dados históricos são sempre finalizados
                canceled: data.canceled || 0,
                finish_time: data.finish_time || null,
                prize: data.prize || null,
                class: data.class || null,
              })
              .select("id")
              .single();

          if (insertRacecardError) {
            throw new Error(
              `Erro ao inserir racecard histórico: ${insertRacecardError.message}`,
            );
          }

          racecardId = insertedRacecard.id;
        } else {
          racecardId = existingRacecard.id;
        }

        // Processar cada cavalo
        for (const hr of horses as IHorse_Hr[]) {
          processHorsePosition(hr, raceid);

          hr.sp = hr.sp || "0";
          hr.id_race = raceid;

          // Verificar se o cavalo já existe para esta corrida
          const { data: existingHorse, error: checkHorseError } = await supabase
            .schema("hml")
            .from("race_horses_hr_enriched")
            .select("id")
            .eq("racecard_id", racecardId)
            .eq("id_horse", hr.id_horse)
            .single();

          if (checkHorseError && checkHorseError.code !== "PGRST116") {
            console.error(
              "Erro ao verificar cavalo existente:",
              checkHorseError,
            );
            continue;
          }

          if (!existingHorse) {
            // Inserir cavalo histórico no Supabase
            const { error: insertHorseError } = await supabase
              .schema("hml")
              .from("race_horses_hr_enriched")
              .insert({
                racecard_id: racecardId,
                horse: hr.horse || null,
                id_horse: hr.id_horse || null,
                jockey: hr.jockey || null,
                trainer: hr.trainer || null,
                age: hr.age || null,
                weight: hr.weight || null,
                number: hr.number || null,
                last_ran_days_ago: hr.last_ran_days_ago || null,
                non_runner: hr.non_runner || null,
                form: hr.form || null,
                position: hr.position || null,
                distance_beaten: hr.distance_beaten || null,
                owner: hr.owner || null,
                sire: hr.sire || null,
                dam: hr.dam || null,
                or_rating: hr.OR || null,
                sp: hr.sp || null,
              });

            if (insertHorseError) {
              console.error(
                `Erro ao inserir cavalo histórico ${hr.id_horse}:`,
                insertHorseError,
              );
            } else {
              console.log(
                `Cavalo histórico ${hr.id_horse} inserido com sucesso na corrida ${raceid}`,
              );
            }
          } else {
            console.log(
              `Cavalo ${hr.id_horse} já existe para a corrida ${raceid}`,
            );
          }
        }
      } else {
        console.log(`Corrida ${raceid} não possui cavalos válidos`);
      }

      // Marca como sucesso para sair do loop
      success = true;
    } catch (error: unknown) {
      retryCount++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      console.error(`Erro em insertEnrichedRaceDetail: ${errorMessage}`);

      if (errorMessage.includes("Too Many Requests")) {
        console.log("Erro de limite de requisições, trocando de API key...");
        headers = rotateApiKey();
        // Reduzir o tempo de espera quando estamos apenas trocando de chave
        waitTime = 1000;
      } else if (retryCount < MAX_RETRIES) {
        console.log(
          `Aguardando ${waitTime / 1000} segundos antes de tentar novamente...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        waitTime *= 2; // Aumenta o tempo de espera exponencialmente
      } else {
        console.error(
          `Falha após ${MAX_RETRIES} tentativas para corrida ${raceid}`,
        );
        throw new Error(
          `Erro em insertEnrichedRaceDetail após ${MAX_RETRIES} tentativas: ${errorMessage}`,
        );
      }
    }
  }
};

const processHorsePosition = (hr: IHorse_Hr, raceId: number): void => {
  // Se já é non_runner, manter como está
  if (hr.non_runner === 1) {
    hr.position = null;
    hr.distance_beaten = null;
    return;
  }

  // Se position é um número válido, garantir que não seja non_runner
  if (!Number.isNaN(Number(hr.position))) {
    hr.non_runner = 0;
    hr.distance_beaten = hr.distance_beaten || "0";
    return;
  }

  // Tratar siglas
  const positionUpper = String(hr.position).toUpperCase().trim();

  if (didNotFinishCodes.includes(positionUpper)) {
    hr.position = "99"; // Posição alta para indicar que não terminou (mas participou)
    hr.non_runner = 0; // NÃO é non_runner, pois participou
    hr.distance_beaten = hr.distance_beaten || "DNF"; // "Did Not Finish"
  } else if (voidCodes.includes(positionUpper)) {
    hr.position = null; // ou null, dependendo da sua preferência
    hr.non_runner = 1; // É considerado non_runner para efeitos de void
    hr.distance_beaten = hr.distance_beaten || "DNF";
  } else {
    // Para qualquer outra sigla não reconhecida, tratar como não terminou
    hr.position = "99";
    hr.non_runner = 0;
    hr.distance_beaten = hr.distance_beaten || "DNF";
    console.warn(
      `Sigla de posição não reconhecida: ${positionUpper} para cavalo ${hr.id_horse} na corrida ${raceId}`,
    );
  }
};

