import { supabase } from "../../..";

import type { NextFunction } from "express";

interface IHorseEntrie {
  id: number;
  race_horse_id: number;
}

export const updateHorseEntries_spb = async () => {
  const { data: unFinished, error } = await supabase
    .schema("hml")
    .from("horse_entries")
    .select("id, race_horse_id")
    .is("was_correct", null);

  if (error) {
    throw new Error(`Erro ao buscar entradas pendentes: ${error.message}`);
  }

  if (!unFinished || unFinished.length === 0) {
    console.log("Nenhuma entrada pendente encontrada.");
    return;
  }

  console.log(`Atualizando ${unFinished.length} entradas pendentes...`);

  let resolved = 0;
  let skipped = 0;

  for (const lay of unFinished as IHorseEntrie[]) {
    try {
      const { data: positionData, error: positionError } = await supabase
        .schema("hml")
        .from("race_horses_hr_enriched")
        .select("position")
        .eq("id", lay.race_horse_id)
        .single();

      if (positionError || !positionData) {
        console.warn(
          `Cavalo ${lay.race_horse_id} sem posição disponível, pulando.`,
        );
        skipped++;
        continue;
      }

      const position = positionData.position;

      // Corrida ainda não finalizada
      if (position === null || position === undefined) {
        console.log(
          `Entrada ${lay.id}: corrida ainda não finalizada, pulando.`,
        );
        skipped++;
        continue;
      }

      // Determina o resultado do LAY
      let was_correct: boolean;
      let isVoid: boolean;

      if (position === 0) {
        // Void — cavalo não correu (non_runner, etc.)
        was_correct = false;
        isVoid = true;
      } else if (position === 1) {
        // Cavalo venceu — LAY perdeu
        was_correct = false;
        isVoid = false;
      } else {
        // Cavalo não venceu — LAY ganhou
        was_correct = true;
        isVoid = false;
      }

      const { error: updateError } = await supabase
        .schema("hml")
        .from("horse_entries")
        .update({
          was_correct,
          void: isVoid,
          result_position: position,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", lay.id);

      if (updateError) {
        console.error(
          `Erro ao atualizar entrada ${lay.id}:`,
          updateError.message,
        );
        continue;
      }

      resolved++;
      console.log(
        `Entrada ${lay.id} resolvida: posição=${position}, was_correct=${was_correct}, void=${isVoid}`,
      );
    } catch (error) {
      console.error(`Erro ao processar entrada ${lay.id}:`, error);
    }
  }

  console.log(
    `Atualização concluída: ${resolved} resolvidas, ${skipped} puladas de ${unFinished.length} total.`,
  );
};
