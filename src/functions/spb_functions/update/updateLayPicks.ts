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
    .select("id,race_horse_id")
    .is("was_correct", null);

  if (!unFinished) return;

  for (const lay of unFinished as IHorseEntrie[]) {
    const { data: positionData, error: positionError } = await supabase
      .from("race_horses_hr")
      .select("position")
      .eq("id", lay.race_horse_id);

    if (!positionData) return;

    const position = positionData[0].position;

    if (position === "1") {
      await supabase
        .schema("hml")
        .from("horse_entries")
        .update({
          was_correct: false,
          void: false,
          result_position: position,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", lay.id);
    } else if (position === "0") {
      await supabase
        .schema("hml")
        .from("horse_entries")
        .update({
          was_correct: false,
          void: true,
          result_position: position,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", lay.id);
    } else {
      await supabase
        .schema("hml")
        .from("horse_entries")
        .update({
          was_correct: true,
          void: false,
          result_position: position,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", lay.id);
    }
  }
};
