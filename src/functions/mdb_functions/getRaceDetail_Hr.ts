import dotenv from "dotenv";
import RaceCard from "../../models/modelHr/raceCardHrModel";
import RaceCardDetail from "../../models/modelHr/raceDetailHrModel";
import Horse from "../../models/modelHr/horseHrModel";

import type { IRaceDetail_Hr } from "../../models/modelHr/raceDetailHrModel";
import type { IHorse_Hr } from "../../models/modelHr/horseHrModel";

dotenv.config();

const getAllStoredRaceDetail_Hr = async (): Promise<IRaceDetail_Hr[]> => {
  const racedetail = await RaceCardDetail.find().lean();

  return racedetail as IRaceDetail_Hr[];
};

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

    const data: IRaceDetail_Hr = await response.json();

    if (!data) {
      throw new Error("Requisição retornou sem dados.");
    }

    if (data.horses.length > 6 && data.horses.length <= 15) {
      const { _id, ...dataWithoutId } = data;

      await RaceCardDetail.findOneAndUpdate(
        { id_race: data.id_race },
        dataWithoutId,
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        },
      );

      for (const hr of data.horses) {
        hr.id_race = data.id_race;

        // Atualizar ou inserir os dados do cavalo
        const { _id: horseId, ...horseWithoutId } = hr;
        await Horse.HorseModel_Hr.findOneAndUpdate(
          { id_horse: hr.id_horse, id_race: hr.id_race },
          horseWithoutId,
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
      }
    }

    if (data.horses.length <= 6 || data.horses.length >= 15) {
      await RaceCard.findOneAndDelete({ id_race: raceid });
    }

    // const checkRd = await RaceCardDetail.findOne({ id_race: data.id_race });
    //
    // if (!checkRd) {
    //   const raceDetail = new RaceCardDetail<IRaceDetail_Hr>(data);
    //
    //   if (raceDetail.horses.length > 6 && raceDetail.horses.length <= 15) {
    //     await raceDetail.save();
    //
    //     for (const hr of data.horses) {
    //       const checkHr = await Horse.HorseModel_Hr.findOne({
    //         id_horse: hr.id_horse,
    //         id_race: hr.id_race,
    //       });
    //
    //       if (!checkHr) {
    //         const horse = new Horse.HorseModel_Hr<IHorse_Hr>(hr);
    //         horse.id_race = raceDetail.id_race;
    //
    //         await horse.save();
    //       }
    //     }
    //   }
    // }
  } catch (error) {
    throw new Error(`Erro na requisição getRaceDetailAndStore_Hr: ${error}`);
  }
};

export default {
  getStoredRaceDetail_Hr,
  getRaceDetailAndStore_Hr,
  getAllStoredRaceDetail_Hr,
};
