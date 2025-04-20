import HorseStatsHrModel from "../../models/modelHr/horseStatsHrModel";
import raceDetail from "./getRaceDetail_Hr";

import type { IRaceCard_Hr } from "../../models/modelHr/raceCardHrModel";
import type {
  IHorseStats_HR,
  IResults_Hr,
} from "../../models/modelHr/horseStatsHrModel";
import { IHorse_Hr } from "../../models/modelHr/horseHrModel";

const getStoredHorseStats_Hr = async () => {
  const horseStats = await HorseStatsHrModel.find<IHorseStats_HR>();

  return horseStats;
};

const getHorseStatsAndStore_hr = async (racecard: IRaceCard_Hr[]) => {
  const headers = new Headers();

  headers.set("x-rapidapi-key", `${process.env.XRAPIDAPIKEY4}`);
  headers.set("x-rapidapi-host", `${process.env.XRAPIDAPIHOST}`);
  let key = 0;
  const rc = racecard;
  const BATCH_SIZE = 10; // Processar 10 requisições por lote
  const BATCH_DELAY = 60000; // 60 segundos de pausa entre lotes
  const REQUEST_DELAY = 2000; // 1 segundo entre requisições

  for (const racecard of rc) {
    const detail = await raceDetail.getStoredRaceDetail_Hr(racecard.id_race);
    console.log("temos o detail da corrida: ", racecard.id_race);

    for (const rdetail of detail) {
      for (let i = 0; i < rdetail.horses.length; i++) {
        const horse = rdetail.horses[i] as IHorse_Hr;
        let success = false;
        let retryCount = 0;
        const MAX_RETRIES = 3;
        let waitTime = 5000; // Tempo inicial de espera para retry

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
              throw new Error(
                `Erro na requisição getRaceDetailAndStore_Hr: ${response.statusText}`,
              );
            }

            const data: IHorseStats_HR = await response.json();

            if (!data) {
              throw new Error("Requisição retornou sem dados.");
            }

            const cleanedData = cleanHorseStatsData(data);

            const horseStats = new HorseStatsHrModel(cleanedData);

            await horseStats.save();
            success = true;
          } catch (error) {
            retryCount++;
            key++;
            console.error(error);
            if (retryCount < MAX_RETRIES) {
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
  const cleanedData = JSON.parse(JSON.stringify(data));

  // Validar resultados se existirem
  if (Array.isArray(cleanedData.results)) {
    cleanedData.results = cleanedData.results.map((result: IResults_Hr) => {
      const cleanResult = { ...result };

      // Limpar campos numéricos específicos
      // position
      if (
        typeof cleanResult.position === "string" &&
        isNaN(Number(cleanResult.position))
      ) {
        cleanResult.position = null;
      } else if (typeof cleanResult.position === "string") {
        cleanResult.position = Number(cleanResult.position);
      }

      // class
      if (
        typeof cleanResult.class === "string" &&
        isNaN(Number(cleanResult.class))
      ) {
        cleanResult.class = null;
      } else if (typeof cleanResult.class === "string") {
        cleanResult.class = Number(cleanResult.class);
      }

      // starting_price
      if (
        typeof cleanResult.starting_price === "string" &&
        isNaN(Number(cleanResult.starting_price))
      ) {
        cleanResult.starting_price = null;
      } else if (typeof cleanResult.starting_price === "string") {
        cleanResult.starting_price = Number(cleanResult.starting_price);
      }

      // OR (Official Rating)
      if (typeof cleanResult.OR === "string" && isNaN(Number(cleanResult.OR))) {
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
    !isNaN(Number(cleanedData.id_horse))
  ) {
    cleanedData.id_horse = Number(cleanedData.id_horse);
  }

  return cleanedData;
}
export default {
  getHorseStatsAndStore_hr,
  getStoredHorseStats_Hr,
};
