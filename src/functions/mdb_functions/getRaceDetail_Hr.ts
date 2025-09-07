import dotenv from "dotenv";
import RaceCard from "../../models/modelHr/raceCardHrModel";
import RaceCardDetail from "../../models/modelHr/raceDetailHrModel";
import Horse from "../../models/modelHr/horseHrModel";

import type { IRaceDetail_Hr } from "../../models/modelHr/raceDetailHrModel";
import type { IHorse_Hr } from "../../models/modelHr/horseHrModel";

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
  });

  return racedetail;
};

/**
 * Função para obter detalhes de corrida e armazenar no banco de dados,
 * com implementação de rotação de API keys para evitar limites de requisição
 */
const getRaceDetailAndStore_Hr = async (raceid: number): Promise<void> => {
  // Array de API keys disponíveis, filtradas para remover valores undefined/null
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
  ].filter((key): key is string => Boolean(key));

  if (apiKeys.length === 0) {
    throw new Error("Nenhuma API key disponível no array.");
  }

  let currentKeyIndex = 0;

  // Função para obter headers com a API key atual
  const getHeaders = (): Headers => {
    const headers = new Headers();
    headers.set("x-rapidapi-key", apiKeys[currentKeyIndex]);
    headers.set("x-rapidapi-host", process.env.XRAPIDAPIHOST || "error");
    return headers;
  };

  // Função para rotacionar para a próxima API key
  const rotateApiKey = (): Headers => {
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    console.log(
      `Mudando para API key ${currentKeyIndex + 1}/${apiKeys.length}`,
    );
    return getHeaders();
  };

  // Configurações de retry
  const MAX_RETRIES = 3;
  let retryCount = 0;
  let waitTime = 5000; // Tempo inicial de espera para retry
  let success = false;
  let headers = getHeaders();

  // URL da API
  const url = `${process.env.HORSERACINGAPIURLRACEDETAILS}${raceid}` || "error";

  // Delay inicial antes da requisição
  await new Promise((resolve) => setTimeout(resolve, 2000));

  while (!success && retryCount < MAX_RETRIES) {
    try {
      const response = await fetch(url, { method: "GET", headers });

      if (!response.ok) {
        // Se receber erro 429 (Too Many Requests), rotaciona a API key
        if (response.status === 429) {
          console.log("Erro 429: Too many requests detectado");
          headers = rotateApiKey();
          continue; // Tenta novamente com a nova key sem incrementar retry
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
          processHorsePosition(hr, data.id_race);

          hr.sp = hr.sp || "0";
          // hr.position = hr.position || "0";

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

      // Marca como sucesso para sair do loop
      success = true;
    } catch (error: unknown) {
      retryCount++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      console.error(`Erro em getRaceDetailAndStore_Hr: ${errorMessage}`);

      if (errorMessage.includes("Too Many Requests")) {
        console.log("Erro de limite de requisições, trocando de API key...");
        headers = rotateApiKey();
        // Reduzir o tempo de espera quando estamos apenas trocando de chave
        waitTime = 1000;
      } else if (retryCount < MAX_RETRIES) {
        console.log(
          `Aguardando ${waitTime / 1000} segundos antes de tentar novamente...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        waitTime *= 2; // Aumenta o tempo de espera exponencialmente
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

const processHorsePosition = (hr: IHorse_Hr, raceId: number): void => {
  // Se já é non_runner, manter como está
  if (hr.non_runner === 1) {
    hr.position = 0;
    hr.distance_beaten = null;
    return;
  }

  // Se position é um número válido, garantir que não seja non_runner
  if (!Number.isNaN(Number(hr.position))) {
    hr.non_runner = 0;
    hr.distance_beaten = hr.distance_beaten || "0";
    return;
  }

  // Tratar siglas
  const positionUpper = String(hr.position).toUpperCase().trim();

  if (didNotFinishCodes.includes(positionUpper)) {
    hr.position = "99"; // Posição alta para indicar que não terminou (mas participou)
    hr.non_runner = 0; // NÃO é non_runner, pois participou
    hr.distance_beaten = hr.distance_beaten || "DNF"; // "Did Not Finish"
  } else if (voidCodes.includes(positionUpper)) {
    hr.position = 0; // ou null, dependendo da sua preferência
    hr.non_runner = 1; // É considerado non_runner para efeitos de void
    hr.distance_beaten = hr.distance_beaten || "DNF";
  } else {
    // Para qualquer outra sigla não reconhecida, tratar como não terminou
    hr.position = "99";
    hr.non_runner = 0;
    hr.distance_beaten = hr.distance_beaten || "DNF";
    console.warn(
      `Sigla de posição não reconhecida: ${positionUpper} para cavalo ${hr.id_horse} na corrida ${raceId}`,
    );
  }
};

export default {
  getStoredRaceDetail_Hr,
  getRaceDetailAndStore_Hr,
  getAllStoredRaceDetail_Hr,
};
