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
  headers.set("x-rapidapi-key", process.env.XRAPIDAPIKEY0 || "error");
  headers.set("x-rapidapi-host", process.env.XRAPIDAPIHOST || "error");
  try {
    const response = await fetch(url, { method: "GET", headers });
    if (!response.ok) {
      throw new Error(
        `Erro na requisição getRaceDetail: ${response.statusText}`,
      );
    }
    const data: IRaceDetail_Hr = await response.json();

    if (!data) throw new Error("Requisição retornou sem dados.");

    const horses = Array.isArray(data.horses) ? data.horses : [];
    const { _id: detailId, ...dataSansId } = data as any;
    const { horses: horsesArray, _id: cardId, ...raceCardFields } = dataSansId;

    if (horses.length > 8 && horses.length <= 15) {
      // 1) Atualiza RaceCard (só campos que interessam + checked_detail)
      await RaceCard.findOneAndUpdate(
        { id_race: data.id_race },
        {
          $set: {
            ...raceCardFields,
            checked_detail: true,
          },
        },
        { new: true },
      );

      // 2) Processamento dos cavalos antes de salvá-los
      const processedHorses: IHorse_Hr[] = [];
      const incomingHorseIds: number[] = [];

      for (const hr of horses as IHorse_Hr[]) {
        // Verifica se id_horse é um número válido, caso contrário marca como non-runner

        if (hr.non_runner === 1) {
          hr.position = "0";
          hr.distance_beaten = "0";
        }

        if (Number.isNaN(Number(hr.position))) {
          hr.position = "0"; // Define como 0 se não for um número válido
          hr.non_runner = 1; // Marca como non-runner
          hr.distance_beaten = "0";
        }

        hr.distance_beaten = hr.distance_beaten || "0";
        hr.position = hr.position || "0";
        hr.sp = hr.sp || "0";

        incomingHorseIds.push(hr.id_horse);
        hr.id_race = data.id_race;

        // remove o _id do hr antes de atualizar
        const { _id: hid, ...horseSansId } = hr as IHorse_Hr;

        // Salva o cavalo no banco de dados
        const savedHorse = await Horse.HorseModel_Hr.findOneAndUpdate(
          { id_horse: hr.id_horse, id_race: hr.id_race },
          horseSansId,
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );

        // Adiciona o cavalo processado ao array
        processedHorses.push(savedHorse);
      }

      // 3) Agora fazemos o upsert do RaceCardDetail com os cavalos já processados
      const updatedData = {
        ...raceCardFields,
        horses: processedHorses,
        id_race: data.id_race, // Garantindo que o id_race esteja presente
      };

      await RaceCardDetail.findOneAndUpdate(
        { id_race: data.id_race },
        updatedData,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      // 4) Limpa horses removidos do feed
      await Horse.HorseModel_Hr.deleteMany({
        id_race: raceid,
        id_horse: { $nin: incomingHorseIds },
      });
    } else {
      // se inválido, remove tudo
      await RaceCardDetail.deleteOne({ id_race: raceid });
      await Horse.HorseModel_Hr.deleteMany({ id_race: raceid });
      await RaceCard.deleteOne({ id_race: raceid });
    }
  } catch (error) {
    throw new Error(`Erro em getRaceDetailAndStore_Hr: ${error}`);
  }
};

export default {
  getStoredRaceDetail_Hr,
  getRaceDetailAndStore_Hr,
  getAllStoredRaceDetail_Hr,
};
