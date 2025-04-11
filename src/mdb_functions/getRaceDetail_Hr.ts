import dotenv from "dotenv";
import RaceCardDetail from "../modelHr/raceDetailHrModel";
import Horse from "../modelHr/horseHrModel";

import type { IRaceDetail_Hr } from "../modelHr/raceDetailHrModel";
import type { IHorse_Hr } from "../modelHr/horseHrModel";

dotenv.config();

const getStoredRaceDetail_Hr = async (id_race: number) => {
  const racedetail = await RaceCardDetail.find<IRaceDetail_Hr>({
    id_race: id_race,
  });

  return racedetail;
};

const getRaceDetailAndStore_Hr = async (raceid: number) => {
  const headers = new Headers();
  const url = `${process.env.HORSERACINGAPIURLRACEDETAILS}${raceid}` || "error";

  headers.set("x-rapidapi-key", `${process.env.XRAPIDAPIKEY2}`);
  headers.set("x-rapidapi-host", `${process.env.XRAPIDAPIHOST}`);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: headers,
    });

    if (!response.ok) {
      throw new Error(
        `Erro na requisição getRaceDetailAndStore_Hr: ${response.statusText}`,
      );
    }

    const data = await response.json();

    if (data.length === 0) {
      throw new Error("Requisição retornou sem dados.");
    }

    const raceDetail = new RaceCardDetail<IRaceDetail_Hr>(data);

    await raceDetail.save();

    for (const hr of data.horses) {
      const horse = new Horse.HorseModel_Hr<IHorse_Hr>(hr);
      horse.id_race = raceDetail.id_race;

      await horse.save();
    }
  } catch (error) {
    throw new Error(`Erro na requisição getRaceDetailAndStore_Hr: ${error}`);
  }
};

export default { getStoredRaceDetail_Hr, getRaceDetailAndStore_Hr };
