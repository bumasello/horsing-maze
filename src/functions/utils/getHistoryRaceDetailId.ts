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

  // Função para fazer requisição com retry para uma página específica
  const makePageRequest = async (pageUrl: string): Promise<SummaryRaces> => {
    const MAX_RETRIES = 3;
    let retryCount = 0;
    let waitTime = 5000;
    let success = false;
    let headers = getHeaders();

    // Delay inicial
    await new Promise((resolve) => setTimeout(resolve, 2000));

    while (!success && retryCount < MAX_RETRIES) {
      try {
        const response = await fetch(pageUrl, { method: "GET", headers });

        if (!response.ok) {
          // Se receber erro 429 (Too Many Requests), rotaciona a API key
          if (response.status === 429) {
            console.log("Erro 429: Too many requests detectado");
            headers = rotateApiKey();
            continue; // Tenta novamente com a nova key sem incrementar retry
          }
          throw new Error(
            `Erro na requisição getHistoryRaceDetailId: ${response.statusText}`,
          );
        }

        const data: SummaryRaces = await response.json();

        if (!data) throw new Error("Requisição retornou sem dados.");

        // Marca como sucesso para sair do loop
        success = true;
        return data;
      } catch (error) {
        retryCount++;

        const errorMessage =
          error instanceof Error ? error.message : String(error);

        console.error(`Erro em getHistoryRaceDetailId: ${errorMessage}`);

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
            `Falha após ${MAX_RETRIES} tentativas para cavalo ${horseId}`,
          );
          throw new Error(
            `Erro em getHistoryRaceDetailId após ${MAX_RETRIES} tentativas: ${errorMessage}`,
          );
        }
      }
    }

    // Se chegou aqui, todas as tentativas falharam
    throw new Error(
      `Falha na requisição após ${MAX_RETRIES} tentativas para cavalo ${horseId}`,
    );
  };

  // Array para armazenar todos os id_race
  const allRaceIds: string[] = [];
  let currentPage = 1;
  let totalPages = 1;

  // Loop principal de paginação
  while (currentPage <= totalPages) {
    const baseUrl = `${process.env.HORSERACINGAPIURLQUERYHORSE}${horseId}`;
    const pageUrl =
      currentPage === 1 ? baseUrl : `${baseUrl}&page=${currentPage}`;

    console.log(
      `Processando página ${currentPage}/${totalPages} para cavalo ${horseId}`,
    );

    const data = await makePageRequest(pageUrl);

    // Na primeira página, capturar total de páginas
    if (currentPage === 1) {
      totalPages = Number.parseInt(data.summary.total_pages);
      console.log(`Total de páginas encontradas: ${totalPages}`);
    }

    // Extrair apenas id_race e adicionar ao array
    const raceIds = data.races.map((race) => race.id_race);
    allRaceIds.push(...raceIds);

    console.log(
      `Página ${currentPage}: ${raceIds.length} corridas adicionadas`,
    );

    currentPage++;
  }

  console.log(
    `Total de ${allRaceIds.length} IDs de corrida coletados para cavalo ${horseId}`,
  );
  return allRaceIds;
};
