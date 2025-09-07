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
 * Função melhorada para processar a posição do cavalo
 * Garante que sempre retorna valores válidos para o banco
 */
const processHorsePosition = (hr: IHorse_Hr, raceId: number): void => {
  // Converter position para string para análise
  const positionStr = String(hr.position || "")
    .toUpperCase()
    .trim();

  // Se é um número válido e positivo
  const positionNum = Number(hr.position);
  if (!Number.isNaN(positionNum) && positionNum > 0 && positionNum <= 50) {
    hr.position = positionNum;
    hr.non_runner = 0; // Participou da corrida
    hr.distance_beaten = hr.distance_beaten || "0";
    return;
  }

  // Se o cavalo é explicitamente marcado como non_runner
  if (hr.non_runner === "1" || hr.non_runner === 1) {
    hr.position = 0;
    hr.non_runner = 1;
    hr.distance_beaten = "VOID";
    return;
  }

  // Verificar se a position contém uma sigla conhecida
  if (voidCodes.includes(positionStr)) {
    // Cavalo não participou (void/non-runner)
    hr.position = 0;
    hr.non_runner = 1;
    hr.distance_beaten = "VOID";
  } else if (didNotFinishCodes.includes(positionStr)) {
    // Cavalo participou mas não terminou
    hr.position = 99;
    hr.non_runner = 0;
    hr.distance_beaten = "DNF";
  } else if (positionStr === "" || positionStr === "NULL" || !hr.position) {
    // Position vazia ou nula - assumir que não terminou
    hr.position = 99;
    hr.non_runner = 0;
    hr.distance_beaten = "PVN";
  } else {
    // Valor desconhecido - logar e tratar como não terminou
    console.warn(
      `Posição não reconhecida: "${hr.position}" para cavalo ${hr.id_horse} na corrida ${raceId}`,
    );
    hr.position = 99;
    hr.non_runner = 0;
    hr.distance_beaten = "UNK"; // Unknown
  }
};

/**
 * Função auxiliar para validar e limpar valores numéricos
 * Retorna null se o valor for 0, negativo ou inválido
 */
const cleanNumericValue = (value: any): number | null => {
  const num = Number(value);
  if (Number.isNaN(num) || num <= 0) {
    return null;
  }
  return num;
};

/**
 * Função para obter detalhes de corrida histórica e armazenar no Supabase
 */
export const insertEnrichedRaceDetail = async (
  raceid: number,
): Promise<void> => {
  // Array de API keys disponíveis
  const apiKeys = [
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
    process.env.XRAPIDAPIKEY33,
  ].filter((key): key is string => Boolean(key));

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
            position: horse.position || 99, // Default para 99 se não houver posição
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
