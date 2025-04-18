import HorseStatsHrModel from "../../models/modelHr/horseStatsHrModel";
import raceDetail from "./getRaceDetail_Hr";

import type { IRaceCard_Hr } from "../../models/modelHr/raceCardHrModel";
import type {
  IHorseStats_HR,
  IResults_Hr,
} from "../../models/modelHr/horseStatsHrModel";

const getStoredHorseStats_Hr = async () => {
  const horseStats = await HorseStatsHrModel.find<IHorseStats_HR>();

  return horseStats;
};

const getHorseStatsAndStore_hr = async (racecard: IRaceCard_Hr[]) => {
  const headers = new Headers();

  headers.set("x-rapidapi-key", `${process.env.XRAPIDAPIKEY2}`);
  headers.set("x-rapidapi-host", `${process.env.XRAPIDAPIHOST}`);
  const rc = racecard;

  for (const racecard of rc) {
    const detail = await raceDetail.getStoredRaceDetail_Hr(racecard.id_race);

    for (const rdetail of detail) {
      for (const horse of rdetail.horses) {
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
        } catch (error) {
          console.error(error);
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
