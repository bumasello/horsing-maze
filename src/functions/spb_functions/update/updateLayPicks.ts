import { supabase } from "../../..";

import type { NextFunction } from "express";

export const updateLayPicks_spb = async () => {
  try {
    const { data: unFinished, error } = await supabase
      .from("lay_picks")
      .select("id,race_horse_id!inner(position)")
      .is("was_correct", null);

    if (!unFinished) return;

    // console.log(unFinished);

    // console.log(unFinished);
    for (const lay of unFinished) {
      // Vamos verificar a estrutura e acessar a posição corretamente
      let position: number;

      if (Array.isArray(lay.race_horse_id)) {
        // Se for um array, pegamos a posição do primeiro item (se existir)
        position =
          lay.race_horse_id.length > 0 ? lay.race_horse_id[0].position : 0;
      } else {
        // Se for um objeto único
        position = (lay.race_horse_id as { position: number }).position;
      }

      if (position === 1) {
        await supabase
          .from("lay_picks")
          .update({
            was_correct: false,
            void: false,
            result_position: position,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", lay.id);
      } else if (position === 0) {
        await supabase
          .from("lay_picks")
          .update({
            was_correct: false,
            void: true,
            result_position: position,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", lay.id);
      } else {
        await supabase
          .from("lay_picks")
          .update({
            was_correct: true,
            void: false,
            result_position: position,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", lay.id);
      }

      // console.log(`LayPick ID: ${lay.id}, Position: ${position}`);
    }
  } catch (error) {
    console.error(error);
  }
};
