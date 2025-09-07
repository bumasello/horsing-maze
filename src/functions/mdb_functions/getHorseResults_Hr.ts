import HorseStatsHrModel from "../../models/modelHr/horseStatsHrModel";
import raceDetail from "./getRaceDetail_Hr";

import type { IRaceCard_Hr } from "../../models/modelHr/raceCardHrModel";
import type {
  IHorseStats_HR,
  IResults_Hr,
} from "../../models/modelHr/horseStatsHrModel";
import type { IHorse_Hr } from "../../models/modelHr/horseHrModel";

const getStoredHorseStats_Hr = async () => {
  const horseStats = await HorseStatsHrModel.find<IHorseStats_HR>({
    updated: true,
  });

  return horseStats;
};

const getHorseStatsAndStore_hr = async (racecard: IRaceCard_Hr[]) => {
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
    process.env.XRAPIDAPIKEY33,
    process.env.XRAPIDAPIKEY34,
    process.env.XRAPIDAPIKEY35,
    process.env.XRAPIDAPIKEY36,
    process.env.XRAPIDAPIKEY37,
    process.env.XRAPIDAPIKEY38,
    process.env.XRAPIDAPIKEY39,
    process.env.XRAPIDAPIKEY40,
    process.env.XRAPIDAPIKEY41,
    process.env.XRAPIDAPIKEY42,
    process.env.XRAPIDAPIKEY43,
    process.env.XRAPIDAPIKEY44,
    process.env.XRAPIDAPIKEY45,
    process.env.XRAPIDAPIKEY46,
  ].filter((key): key is string => Boolean(key));

  if (apiKeys.length === 0) {
    throw new Error("Nenhuma api key no array.");
  }

  let currentKeyIndex = 0;

  const getHeaders = () => {
    const headers = new Headers();

    headers.set("x-rapidapi-key", apiKeys[currentKeyIndex]);
    headers.set("x-rapidapi-host", `${process.env.XRAPIDAPIHOST}`);
    return headers;
  };

  const rotateApiKey = () => {
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    console.log("Mudando chave da api");
    return getHeaders();
  };

  const rc = racecard;
  const BATCH_SIZE = 10; // Processar 10 requisições por lote
  const BATCH_DELAY = 60000; // 60 segundos de pausa entre lotes
  const REQUEST_DELAY = 2000; // 1 segundo entre requisições

  for (const racecard of rc) {
    const detail = await raceDetail.getStoredRaceDetail_Hr(racecard.id_race);
    // console.log("temos o detail da corrida: ", racecard.id_race);

    for (const rdetail of detail) {
      for (let i = 0; i < rdetail.horses.length; i++) {
        const horse = rdetail.horses[i] as IHorse_Hr;
        let success = false;
        let retryCount = 0;
        const MAX_RETRIES = 3;
        let waitTime = 5000; // Tempo inicial de espera para retry

        let headers = getHeaders();

        while (!success && retryCount < MAX_RETRIES) {
          try {
            const url =
              `${process.env.HORSERACINGAPIURLHORSESTATS}${horse.id_horse}` ||
              "error";

            const response = await fetch(url, {
              method: "GET",
              headers: headers,
            });

            if (!response.ok) {
              if (response.status === 429) {
                console.log("too many requests detectado");
                headers = rotateApiKey();
                continue;
              }
              throw new Error(
                `Erro na requisição getRaceDetailAndStore_Hr: ${response.statusText}`,
              );
            }

            const data: IHorseStats_HR = await response.json();

            if (!data) {
              throw new Error("Requisição retornou sem dados.");
            }

            const cleanedData = cleanHorseStatsData(data);

            await HorseStatsHrModel.findOneAndUpdate(
              { id_horse: cleanedData.id_horse },
              cleanedData,
              { upsert: true, new: true, setDefaultsOnInsert: true },
            );

            // const horseStats = new HorseStatsHrModel(cleanedData);
            // await horseStats.save();
            success = true;
          } catch (error: unknown) {
            retryCount++;
            const errorMessage =
              error instanceof Error ? error.message : String(error);

            console.error(error);

            if (errorMessage.includes("Too Many Requests")) {
              console.log(
                "Erro de limite de requisições, trocando de API key...",
              );
              headers = rotateApiKey();
              // Reduzir o tempo de espera quando estamos apenas trocando de chave
              waitTime = 1000;
            } else if (retryCount < MAX_RETRIES) {
              console.log(
                `Aguardando ${waitTime / 1000} segundos antes de tentar novamente...`,
              );
              await new Promise((resolve) => setTimeout(resolve, waitTime));
              waitTime *= 2;
            } else {
              console.error(
                `Falha após ${MAX_RETRIES} tentativas para cavalo ${horse.id_horse}`,
              );
            }
          }
        }
        if (i < rdetail.horses.length - 1) {
          // Espera normal entre requisições
          await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY));

          // Se estamos no final de um lote, faz uma pausa maior
          if ((i + 1) % BATCH_SIZE === 0) {
            console.log(
              `Completado lote ${Math.floor((i + 1) / BATCH_SIZE)} de ${Math.ceil(rdetail.horses.length / BATCH_SIZE)}. Pausando por ${BATCH_DELAY / 1000} segundos...`,
            );
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
          }
        }
      }
    }
  }
};

function cleanHorseStatsData(data: IHorseStats_HR): IHorseStats_HR {
  // Cria uma cópia profunda para não modificar o original
  const cleanedData: IHorseStats_HR = JSON.parse(JSON.stringify(data));

  // Validar resultados se existirem
  if (Array.isArray(cleanedData.results)) {
    cleanedData.results = cleanedData.results.map((result: IResults_Hr) => {
      const cleanResult = { ...result };

      // Limpar campos numéricos específicos
      // position
      if (
        typeof cleanResult.position === "string" &&
        Number.isNaN(Number(cleanResult.position))
      ) {
        cleanResult.position = null;
      } else if (typeof cleanResult.position === "string") {
        cleanResult.position = Number(cleanResult.position);
      }

      // class
      if (
        typeof cleanResult.class === "string" &&
        Number.isNaN(Number(cleanResult.class))
      ) {
        cleanResult.class = null;
      } else if (typeof cleanResult.class === "string") {
        cleanResult.class = Number(cleanResult.class);
      }

      // starting_price
      if (
        typeof cleanResult.starting_price === "string" &&
        Number.isNaN(Number(cleanResult.starting_price))
      ) {
        cleanResult.starting_price = null;
      } else if (typeof cleanResult.starting_price === "string") {
        cleanResult.starting_price = Number(cleanResult.starting_price);
      }

      // OR (Official Rating)
      if (
        typeof cleanResult.OR === "string" &&
        Number.isNaN(Number(cleanResult.OR))
      ) {
        cleanResult.OR = null;
      } else if (typeof cleanResult.OR === "string") {
        cleanResult.OR = Number(cleanResult.OR);
      }

      return cleanResult;
    });
  }

  // Validar também os campos principais do cavalo
  if (
    typeof cleanedData.id_horse === "string" &&
    !Number.isNaN(Number(cleanedData.id_horse))
  ) {
    cleanedData.id_horse = Number(cleanedData.id_horse);
  }

  cleanedData.updated = true;
  cleanedData.result_count = cleanedData.results.length;

  return cleanedData;
}
export default {
  getHorseStatsAndStore_hr,
  getStoredHorseStats_Hr,
};
