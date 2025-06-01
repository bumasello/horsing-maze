import updateRacecard_mdb from "../functions/mdb_functions/updateRaceCard_Hr";
import raceCards from "../functions/mdb_functions/getRaceCard_Hr";
import raceDetails from "../functions/mdb_functions/getRaceDetail_Hr";
import horseStats from "../functions/mdb_functions/getHorseResults_Hr";
import { updateRacecards_spb } from "../functions/spb_functions/update/updateRacecard_hr";
import { updateHorseEntries_spb } from "../functions/spb_functions/update/updateLayPicks";

export const runPipeline_v1 = async () => {
  try {
    console.info("Iniciando pipeline de atualização de dados de corridas");

    // Parte 1: Funções do pipeline original
    console.info("Iniciando atualização de Race Card HR");
    await updateRacecard_mdb.updateRaceCard_Hr();
    console.info("Atualização de Race Card HR concluída com sucesso");

    console.info("Iniciando atualização de Racecards SPB");
    await updateRacecards_spb();
    console.info("Atualização de Racecards SPB concluída com sucesso");

    console.info("Iniciando atualização de Horse Entries SPB");
    await updateHorseEntries_spb();
    console.info("Atualização de Horse Entries SPB concluída com sucesso");

    // Parte 2: Lógica extraída do controller

    // Lógica de getRaceCards
    console.info("Iniciando obtenção de race cards");
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate());
    const formatted = tomorrowDate.toISOString().slice(0, 10);

    console.info(`Obtendo race cards para a data: ${formatted}`);
    await raceCards.getRaceCardAndStore_Hr(formatted);
    console.info("Race cards obtidos e armazenados com sucesso");

    // Lógica de getRaceCardsDetails
    console.info("Iniciando obtenção de detalhes de race cards");
    const racecards = await raceCards.getUnfinishedRaceCard_Hr(false);
    console.info(
      `Encontrados ${racecards.length} race cards não finalizados para processamento`,
    );

    const BATCH_SIZE = 10; // Processar 10 requisições por lote
    const BATCH_DELAY = 60000; // 60 segundos de pausa entre lotes
    const REQUEST_DELAY = 2000; // 2 segundos entre requisições

    for (let i = 0; i < racecards.length; i++) {
      const rc = racecards[i];
      let success = false;
      let retryCount = 0;
      const MAX_RETRIES = 3;
      let waitTime = 5000; // Tempo inicial de espera para retry

      while (!success && retryCount < MAX_RETRIES) {
        try {
          console.info(
            `Processando detalhes para race card ${rc.id_race} (${i + 1}/${racecards.length})`,
          );
          await raceDetails.getRaceDetailAndStore_Hr(rc.id_race);
          console.info(
            `Detalhes para race card ${rc.id_race} atualizados com sucesso`,
          );
          success = true;
        } catch (error) {
          retryCount++;
          console.error(
            `Erro ao atualizar detalhes do race card ${rc.id_race}, tentativa ${retryCount}: ${error.message}`,
          );

          if (retryCount < MAX_RETRIES) {
            console.info(
              `Aguardando ${waitTime / 1000} segundos antes de tentar novamente...`,
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            waitTime *= 2; // Backoff exponencial
          } else {
            console.error(
              `Falha após ${MAX_RETRIES} tentativas para corrida ${rc.id_race}`,
            );
          }
        }
      }

      if (i < racecards.length - 1) {
        // Espera normal entre requisições
        await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY));

        // Se estamos no final de um lote, faz uma pausa maior
        if ((i + 1) % BATCH_SIZE === 0) {
          const currentBatch = Math.floor((i + 1) / BATCH_SIZE);
          const totalBatches = Math.ceil(racecards.length / BATCH_SIZE);
          console.info(
            `Completado lote ${currentBatch} de ${totalBatches}. Pausando por ${BATCH_DELAY / 1000} segundos...`,
          );
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
        }
      }
    }

    console.info(
      "Todos os detalhes de race cards foram processados com sucesso",
    );

    // Lógica de getHorseStats
    console.info("Iniciando obtenção de estatísticas de cavalos");
    const racecardsForStats = await raceCards.getUnfinishedRaceCard_Hr(true);

    if (!racecardsForStats || racecardsForStats.length === 0) {
      console.warn(
        "Não foram encontradas corridas não iniciadas para obtenção de estatísticas de cavalos",
      );
    } else {
      console.info(
        `Encontrados ${racecardsForStats.length} race cards não iniciados para processamento de estatísticas de cavalos`,
      );
      await horseStats.getHorseStatsAndStore_hr(racecardsForStats);
      console.info("Estatísticas de cavalos obtidas e armazenadas com sucesso");
    }

    console.info("Pipeline de atualização concluído com sucesso");
    return {
      success: true,
      message: "Pipeline de atualização concluído com sucesso",
    };
  } catch (error) {
    // Tratamento de erros centralizado
    console.error(`Erro no pipeline de atualização: ${error.message}`, {
      stack: error.stack,
    });

    // Aqui você pode adicionar notificações, alertas ou outras ações em caso de falha

    return { success: false, error: error.message };
  }
};
