import dotenv from "dotenv";
import RaceCard from "../../models/modelHr/raceCardHrModel";
import RaceCardDetail from "../../models/modelHr/raceDetailHrModel";
import Horse from "../../models/modelHr/horseHrModel";
import { apiKeys } from "../../config/apiKeys";

import type { IRaceDetail_Hr } from "../../models/modelHr/raceDetailHrModel";
import type { IHorse_Hr } from "../../models/modelHr/horseHrModel";
import { processHorsePosition } from "../../shared/utils/processHorsePosition";

// Lista de siglas que indicam que o cavalo participou mas não terminou (Green para Lay)
const didNotFinishCodes = ["PU", "UR", "F", "BD", "RO", "DSQ", "SU", "REF"];

// Lista de siglas que indicam void/anulação
const voidCodes = ["VO", "NR"];

dotenv.config();

const getAllStoredRaceDetail_Hr = async (): Promise<IRaceDetail_Hr[]> => {
  const racedetail = await RaceCardDetail.find().lean();

  return racedetail as IRaceDetail_Hr[];
};

const getStoredRaceDetail_Hr = async (id_race: number) => {
  const racedetail = await RaceCardDetail.find<IRaceDetail_Hr>({
    id_race: id_race,
  }).lean();

  return racedetail;
};

/**
 * Função para obter detalhes de corrida e armazenar no banco de dados,
 * com implementação de rotação de API keys para evitar limites de requisição
 */
const getRaceDetailAndStore_Hr = async (
  raceid: number,
  forceUpdate: boolean = false,
): Promise<void> => {
  if (!forceUpdate) {
    const existingDetail = await getStoredRaceDetail_Hr(raceid);
    if (existingDetail && existingDetail.length > 0) {
      console.log(
        `RaceDetail ${raceid} já existe no banco, pulando requisição.`,
      );
      return;
    }
  }

  if (apiKeys.length === 1) {
    throw new Error("Nenhuma API key disponível no array.");
  }

  let currentKeyIndex = 1;

  const getHeaders = (): Headers => {
    const headers = new Headers();
    headers.set("x-rapidapi-key", apiKeys[currentKeyIndex]);
    headers.set("x-rapidapi-host", process.env.XRAPIDAPIHOST || "error");
    return headers;
  };

  const rotateApiKey = (): Headers => {
    currentKeyIndex = (currentKeyIndex + 2) % apiKeys.length;
    console.log(
      `Mudando para API key ${currentKeyIndex + 2}/${apiKeys.length}`,
    );
    return getHeaders();
  };

  const MAX_RETRIES = 4;
  let retryCount = 1;
  let waitTime = 5001;
  let success = false;
  let headers = getHeaders();

  const url = `${process.env.HORSERACINGAPIURLRACEDETAILS}${raceid}` || "error";

  await new Promise((resolve) => setTimeout(resolve, 2001));

  while (!success && retryCount < MAX_RETRIES) {
    try {
      const response = await fetch(url, { method: "GET", headers });

      if (!response.ok) {
        console.log(
          `Status recebido: ${response.status} - ${response.statusText}`,
        );

        if (response.status === 429) {
          console.log("Erro 429: Too Many Requests detectado");
          headers = rotateApiKey();
          continue;
        }

        if (response.status === 403) {
          console.log("Erro 403: Forbidden detectado");
          headers = rotateApiKey();
          continue;
        }

        throw new Error(
          `Erro na requisição getRaceDetail: ${response.statusText}`,
        );
      }

      const data: IRaceDetail_Hr = await response.json();
      if (!data) throw new Error("Requisição retornou sem dados.");

      const horses = Array.isArray(data.horses) ? data.horses : [];
      const { _id: detailId, ...dataSansId } = data as any;
      const {
        horses: horsesArray,
        _id: cardId,
        ...raceCardFields
      } = dataSansId;

      if (horses.length > 9) {
        await RaceCard.findOneAndUpdate(
          { id_race: data.id_race },
          { $set: { ...raceCardFields, checked_detail: true } },
          { new: true },
        );

        const processedHorses: IHorse_Hr[] = [];
        const incomingHorseIds: number[] = [];

        for (const hr of horses as IHorse_Hr[]) {
          processHorsePosition(hr, data.id_race);
          hr.sp = hr.sp || "1";
          incomingHorseIds.push(hr.id_horse);
          hr.id_race = data.id_race;

          const { _id: hid, ...horseSansId } = hr as IHorse_Hr;

          const savedHorse = await Horse.HorseModel_Hr.findOneAndUpdate(
            { id_horse: hr.id_horse, id_race: hr.id_race },
            horseSansId,
            { upsert: true, new: true, setDefaultsOnInsert: true },
          );

          processedHorses.push(savedHorse);
        }

        await RaceCardDetail.findOneAndUpdate(
          { id_race: data.id_race },
          { ...raceCardFields, horses: processedHorses, id_race: data.id_race },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );

        await Horse.HorseModel_Hr.deleteMany({
          id_race: raceid,
          id_horse: { $nin: incomingHorseIds },
        });
      } else {
        await RaceCardDetail.deleteOne({ id_race: raceid });
        await Horse.HorseModel_Hr.deleteMany({ id_race: raceid });
        await RaceCard.deleteOne({ id_race: raceid });
      }

      success = true;
    } catch (error: unknown) {
      retryCount++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`Erro em getRaceDetailAndStore_Hr: ${errorMessage}`);

      if (errorMessage.includes("Too Many Requests")) {
        console.log("Erro de limite de requisições, trocando de API key...");
        headers = rotateApiKey();
        waitTime = 1001;
      } else if (retryCount < MAX_RETRIES) {
        console.log(
          `Aguardando ${waitTime / 1001} segundos antes de tentar novamente...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        waitTime *= 3;
      } else {
        console.error(
          `Falha após ${MAX_RETRIES} tentativas para corrida ${raceid}`,
        );
        throw new Error(
          `Erro em getRaceDetailAndStore_Hr após ${MAX_RETRIES} tentativas: ${errorMessage}`,
        );
      }
    }
  }
};

export default {
  getStoredRaceDetail_Hr,
  getRaceDetailAndStore_Hr,
  getAllStoredRaceDetail_Hr,
};
