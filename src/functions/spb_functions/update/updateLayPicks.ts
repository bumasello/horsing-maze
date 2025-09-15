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
        .select("position")
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
        continue; // Continua para a próxima entrada se a posição não for encontrada
      }

      const position = String(positionData[0].position); // Garante que position é uma string para comparação

      let wasCorrectValue: boolean;
      let voidValue: boolean;
      let resultPositionValue: number;

      // Lógica de atualização mais explícita
      if (position === "1") {
        wasCorrectValue = false;
        voidValue = false;
        resultPositionValue = 1;
      } else if (position === "0") {
        wasCorrectValue = false;
        voidValue = true;
        resultPositionValue = 0;
      } else {
        // Assumimos que qualquer outro valor válido para position significa que o cavalo não venceu e não foi anulado
        wasCorrectValue = true;
        voidValue = false;
        resultPositionValue = Number.parseInt(position, 10); // Converte para número
        if (Number.isNaN(resultPositionValue)) {
          logger.warn(
            `Posição inválida '${position}' para race_horse_id ${lay.race_horse_id}. Definindo result_position como null.`,
          );
          resultPositionValue = 0; // Ou outro valor padrão, dependendo da sua regra de negócio
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
          `Horse_entry id ${lay.id} atualizada com sucesso. was_correct: ${wasCorrectValue}, void: ${voidValue}, position: ${resultPositionValue}`,
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
