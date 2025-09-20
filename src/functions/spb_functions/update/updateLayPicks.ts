import { supabase } from "../../..";

interface IHorseEntrie {
  id: number;
  race_horse_id: number;
}

// Adicionando um logger básico para simular o logger do pipeline principal
const logger = {
  info: (message: string) =>
    console.log(`[INFO] ${new Date().toISOString()} ${message}`),
  warn: (message: string) =>
    console.warn(`[WARN] ${new Date().toISOString()} ${message}`),
  error: (message: string, error?: Error) => {
    console.error(`[ERROR] ${new Date().toISOString()} ${message}`);
    if (error) console.error(error);
  },
};

export const updateHorseEntries_spb = async () => {
  logger.info("Iniciando updateHorseEntries_spb_refactored.");

  const { data: unFinished, error: unFinishedError } = await supabase
    .schema("hml")
    .from("horse_entries")
    .select("id,race_horse_id")
    .is("was_correct", null);

  if (unFinishedError) {
    logger.error(
      "Erro ao buscar horse_entries não finalizadas:",
      unFinishedError,
    );
    return; // Interrompe a execução em caso de erro na busca inicial
  }

  if (!unFinished || unFinished.length === 0) {
    logger.info(
      "Nenhuma horse_entry não finalizada encontrada para processar.",
    );
    return;
  }

  logger.info(
    `Encontradas ${unFinished.length} horse_entries não finalizadas para processamento.`,
  );

  for (const lay of unFinished as IHorseEntrie[]) {
    try {
      const { data: positionData, error: positionError } = await supabase
        .schema("public")
        .from("race_horses_hr")
        .select("position, non_runner")
        .eq("id", lay.race_horse_id);

      if (positionError) {
        logger.error(
          `Erro ao buscar posição para race_horse_id ${lay.race_horse_id}:`,
          positionError,
        );
        continue; // Continua para a próxima entrada em caso de erro
      }

      if (!positionData || positionData.length === 0) {
        logger.warn(
          `Nenhuma posição encontrada para race_horse_id ${lay.race_horse_id}. Pulando atualização para horse_entry id: ${lay.id}`,
        );
        continue; // Continua para a próxima entrada se a posição não foi encontrada
      }

      const rawPosition = positionData[0].position;
      const nonRunner = positionData[0].non_runner;
      
      // Validação adicional para evitar valores inválidos
      if (rawPosition === null || rawPosition === undefined || rawPosition === "") {
        logger.warn(
          `Posição ainda não está disponível para race_horse_id ${lay.race_horse_id} (valor: ${rawPosition}). Pulando atualização para horse_entry id: ${lay.id}`,
        );
        continue; // Pula se a posição ainda não foi atualizada
      }
      
      // Log de depuração
      logger.info(`DEBUG - race_horse_id: ${lay.race_horse_id}, position raw: ${rawPosition} (tipo: ${typeof rawPosition}), non_runner: ${nonRunner}`);
      
      let wasCorrectValue: boolean;
      let voidValue: boolean;
      let resultPositionValue: number;

      // Lógica corrigida para lay betting
      if (nonRunner === 1) {
        // Cavalo não correu (non-runner) - aposta é anulada
        logger.info(`  -> Cavalo não correu (non_runner=1)`);
        wasCorrectValue = false;
        voidValue = true;
        resultPositionValue = 0;
      } else if (rawPosition === null || rawPosition === undefined || rawPosition === "" || Number.isNaN(Number(rawPosition))) {
        // Posição ainda não disponível ou inválida
        logger.warn(`  -> Posição não disponível ou inválida (${rawPosition})`);
        wasCorrectValue = false;
        voidValue = true;
        resultPositionValue = 0;
      } else {
        const position = Number(rawPosition);
        logger.info(`  -> Posição convertida: ${position}`);
        
        if (position === 1) {
          // Cavalo venceu - aposta lay perdeu
          logger.info(`  -> Cavalo venceu - lay perdeu`);
          wasCorrectValue = false;
          voidValue = false;
          resultPositionValue = 1;
        } else if (position > 1) {
          // Cavalo não venceu - aposta lay ganhou
          logger.info(`  -> Cavalo não venceu (posição ${position}) - lay ganhou`);
          wasCorrectValue = true;
          voidValue = false;
          resultPositionValue = position;
        } else {
          // Posição inválida (0 ou negativa)
          logger.warn(`  -> Posição inválida: ${position}`);
          wasCorrectValue = false;
          voidValue = true;
          resultPositionValue = 0;
        }
      }

      const { error: updateError } = await supabase
        .schema("hml")
        .from("horse_entries")
        .update({
          was_correct: wasCorrectValue,
          void: voidValue,
          result_position: resultPositionValue,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", lay.id);

      if (updateError) {
        logger.error(
          `Erro ao atualizar horse_entry id ${lay.id}:`,
          updateError,
        );
      } else {
        logger.info(
          `Horse_entry id ${lay.id} atualizada com sucesso. race_horse_id: ${lay.race_horse_id}, was_correct: ${wasCorrectValue}, void: ${voidValue}, result_position: ${resultPositionValue}`,
        );
      }
    } catch (err) {
      logger.error(
        `Erro inesperado ao processar horse_entry id ${lay.id}:`,
        err as Error,
      );
    }
  }
  logger.info("Finalizando updateHorseEntries_spb_refactored.");
};
