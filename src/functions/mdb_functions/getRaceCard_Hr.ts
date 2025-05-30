import dotenv from "dotenv";
import RaceCard from "../../models/modelHr/raceCardHrModel";

import type { IRaceCard_Hr } from "../../models/modelHr/raceCardHrModel";

dotenv.config();

const getOneStoredRaceCard_Hr = async (
  idrace: number,
): Promise<IRaceCard_Hr | null> => {
  const racecard = await RaceCard.findOne<IRaceCard_Hr>({ id_race: idrace });

  return racecard;
};

const getStoredRaceCard_Hr = async (): Promise<IRaceCard_Hr[]> => {
  const racecards = await RaceCard.find<IRaceCard_Hr>();
  return racecards;
};

// const getUnfinishedRaceCard_Hr = async (
//   bool: boolean,
// ): Promise<IRaceCard_Hr[]> => {
//   const racecards = await RaceCard.find<IRaceCard_Hr>({
//     finished: "0",
//     canceled: "0",
//     checked_detail: { $exists: false },
//   });
//
//   return racecards;
// };

const getUnfinishedRaceCard_Hr = async (
  bool: boolean,
): Promise<IRaceCard_Hr[]> => {
  const racecards = await RaceCard.find<IRaceCard_Hr>({
    finished: "0",
    canceled: "0",
    checked_detail: bool,
  });

  return racecards;
};

const getRaceCardAndStore_Hr = async (date: string) => {
  const headers = new Headers();
  const url = `${process.env.HORSERACINGAPIURLRACECARDS}${date}` || "error";

  headers.set("x-rapidapi-key", `${process.env.XRAPIDAPIKEY4}`);
  headers.set("x-rapidapi-host", `${process.env.XRAPIDAPIHOST}`);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: headers,
    });

    if (!response.ok) {
      throw new Error(`Erro na requisição getRaceCard: ${response.statusText}`);
    }
    const data = await response.json();

    if (data.length === 0) {
      throw new Error("Requisição retornou sem dados.");
    }

    let inseridos = 0;

    for (const rc of data as IRaceCard_Hr[]) {
      const checkRc = await RaceCard.findOne({ id_race: rc.id_race });

      if (!checkRc && inseridos < 22) {
        const raceCard = new RaceCard<IRaceCard_Hr>(rc);
        const [, off_time = "00:00"] = (rc.date || "").split(" ");

        raceCard.off_time_br = timeUkToBr(off_time);
        raceCard.checked_detail = false;

        await raceCard.save();
        inseridos++;
      }
    }
  } catch (err) {
    throw new Error(`Erro na requisição getRaceCard: ${err}`);
  }
};

const timeUkToBr = (off_time: string): string => {
  const [horasStr, minStr] = off_time.split(":");

  let horasBr = Number.parseInt(horasStr);

  horasBr -= 4;

  if (horasBr >= 24) {
    horasBr = horasBr - 24;
  }

  const off_time_br = `${horasBr.toString()}:${minStr}`;

  // console.log(off_time, horasStr, minStr, off_time_br);

  return off_time_br;
};

export default {
  getRaceCardAndStore_Hr,
  getStoredRaceCard_Hr,
  getOneStoredRaceCard_Hr,
  getUnfinishedRaceCard_Hr,
};
