import { apiKeys } from "../../config/apiKeys";

interface QueryRaces {
  id_race: string;
  name: string;
  course: string;
  date: string;
  distance: string;
  class: string;
}

interface SummaryRaces {
  summary: {
    total_results: string;
    total_pages: string;
    current_page: string;
  };
  races: QueryRaces[];
}

export const getHistoryRaceDetailId = async (
  horseId: number,
): Promise<string[]> => {
  if (apiKeys.length === 0) {
    throw new Error("Nenhuma API key disponível no array.");
  }

  let currentKeyIndex = 0;

  const getHeaders = (): Headers => {
    const headers = new Headers();
    headers.set("x-rapidapi-key", apiKeys[currentKeyIndex]);
    headers.set("x-rapidapi-host", process.env.XRAPIDAPIHOST || "error");
    return headers;
  };

  const rotateApiKey = (): Headers => {
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    return getHeaders();
  };

  const makePageRequest = async (pageUrl: string): Promise<SummaryRaces> => {
    const MAX_RETRIES = 3;
    let retryCount = 0;
    let waitTime = 5000;
    let success = false;
    let headers = getHeaders();
    let keysTriedCount = 0;

    await new Promise((resolve) => setTimeout(resolve, 2000));

    while (!success && retryCount < MAX_RETRIES) {
      try {
        const response = await fetch(pageUrl, { method: "GET", headers });

        if (!response.ok) {
          if (response.status === 429 || response.status === 403) {
            if (response.status === 403) {
              console.error(
                `Erro 403 na key [${currentKeyIndex}]: ${apiKeys[currentKeyIndex]?.substring(0, 12)}...`,
              );
            }
            keysTriedCount++;
            if (keysTriedCount >= apiKeys.length) {
              throw new Error(
                `Todas as ${apiKeys.length} API keys falharam com ${response.status}`,
              );
            }
            headers = rotateApiKey();
            continue;
          }
          throw new Error(
            `Erro na requisição getHistoryRaceDetailId: ${response.statusText}`,
          );
        }

        const data: SummaryRaces = await response.json();
        if (!data) throw new Error("Requisição retornou sem dados.");

        success = true;
        return data;
      } catch (error) {
        retryCount++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(`Erro em getHistoryRaceDetailId: ${errorMessage}`);

        if (retryCount < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          waitTime *= 2;
        } else {
          throw new Error(
            `Erro em getHistoryRaceDetailId após ${MAX_RETRIES} tentativas: ${errorMessage}`,
          );
        }
      }
    }

    throw new Error(
      `Falha na requisição após ${MAX_RETRIES} tentativas para cavalo ${horseId}`,
    );
  };

  const allRaceIds: string[] = [];
  let currentPage = 1;
  let totalPages = 1;

  while (currentPage <= totalPages) {
    const baseUrl = `${process.env.HORSERACINGAPIURLQUERYHORSE}${horseId}`;
    const pageUrl =
      currentPage === 1 ? baseUrl : `${baseUrl}&page=${currentPage}`;

    console.log(
      `Processando página ${currentPage}/${totalPages} para cavalo ${horseId}`,
    );

    const data = await makePageRequest(pageUrl);

    if (currentPage === 1) {
      totalPages = Number.parseInt(data.summary.total_pages);
      console.log(`Total de páginas encontradas: ${totalPages}`);
    }

    const raceIds = data.races.map((race) => race.id_race);
    allRaceIds.push(...raceIds);
    console.log(
      `Página ${currentPage}: ${raceIds.length} corridas adicionadas`,
    );

    currentPage++;
  }

  console.log(
    `Total de ${allRaceIds.length} IDs coletados para cavalo ${horseId}`,
  );
  return allRaceIds;
};
