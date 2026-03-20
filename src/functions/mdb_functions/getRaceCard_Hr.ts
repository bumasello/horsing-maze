import dotenv from "dotenv";
import RaceCard from "../../models/modelHr/raceCardHrModel";
import { toZonedTime, format } from "date-fns-tz";

import type { IRaceCard_Hr } from "../../models/modelHr/raceCardHrModel";

dotenv.config();

const getOneStoredRaceCard_Hr = async (
  idrace: number,
): Promise<IRaceCard_Hr | null> => {
  const racecard = await RaceCard.findOne<IRaceCard_Hr>({
    id_race: idrace,
  }).lean();

  return racecard;
};

const getStoredRaceCard_Hr = async (): Promise<IRaceCard_Hr[]> => {
  const racecards = await RaceCard.find<IRaceCard_Hr>().lean();
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
  await new Promise((resolve) => {
    setTimeout(resolve, 2000);
  });

  const headers = new Headers();
  const url = `${process.env.HORSERACINGAPIURLRACECARDS}${date}` || "error";

  headers.set("x-rapidapi-key", `${process.env.XRAPIDAPIKEY85}`);
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

      if (!checkRc) {
        const raceCard = new RaceCard<IRaceCard_Hr>(rc);
        const [, off_time = "00:00"] = (rc.date || "").split(" ");

        raceCard.off_time_br = timeUkToBr(rc.date || "");
        raceCard.checked_detail = false;

        await raceCard.save();
        inseridos++;
      }
    }

    return {
      recebidos: data.length,
      inseridos: inseridos,
    };
  } catch (err) {
    throw new Error(`Erro na requisição getRaceCard: ${err}`);
  }
};

const timeUkToBr = (dateStr: string): string => {
  const ukTimeZone = "Europe/London";
  const brTimeZone = "America/Sao_Paulo";

  const ukDate = toZonedTime(new Date(dateStr.replace(" ", "T")), ukTimeZone);

  const brDate = toZonedTime(ukDate, brTimeZone);

  return format(brDate, "HH:mm", { timeZone: brTimeZone });
};

export default {
  getRaceCardAndStore_Hr,
  getStoredRaceCard_Hr,
  getOneStoredRaceCard_Hr,
  getUnfinishedRaceCard_Hr,
};
