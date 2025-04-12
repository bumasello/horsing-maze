import HorseStatsHrModel from "../../models/modelHr/horseStatsHrModel";
import raceDetail from "./getRaceDetail_Hr";

import type { IRaceCard_Hr } from "../../models/modelHr/raceCardHrModel";
import type { IHorseStats_HR } from "../../models/modelHr/horseStatsHrModel";

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
          // console.log(data);

          // const checkHr = await

          const horseStats = new HorseStatsHrModel(data);

          await horseStats.save();
        } catch (error) {
          console.error(error);
        }
      }
    }
  }
};

export default {
  getHorseStatsAndStore_hr,
  getStoredHorseStats_Hr,
};
