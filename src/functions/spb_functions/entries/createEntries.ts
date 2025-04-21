import { supabase } from "../../..";

interface RawPred {
  racecard_id: number;
  race_horse_id: number;
  probability: number;
  racecards_hr: {
    course: string;
    date: string;
    off_time_br: string;
    title: string;
    finished: number;
    canceled: number;
  };
  race_horses_hr: {
    horse: string;
    number: number;
  };
}

interface Pick {
  racecard_id: number;
  race_horse_id: number;
  probability: number;
  course: string;
  date: string;
  off_time_br: string;
  title: string;
  horse: string;
  number: number;
}

interface RacePrediction {
  racecard_id: number;
  race_horse_id: number;
  probability: number;
  racecards_hr: {
    date: string;
    title: string;
    course: string;
    canceled: number;
    finished: number;
    off_time_br: string;
  };
  race_horses_hr: {
    horse: string;
    number: number;
  };
}

const generateLayPicks = async () => {
  const { data: raw, error } = await supabase
    .from("race_predictions")
    .select(
      `
      racecard_id,
      race_horse_id,
      probability,
      racecards_hr!inner(
        course,
        date,
        off_time_br,
        title,
        finished,
        canceled
      ),
      race_horses_hr!inner(
        horse,
        number
      )
    `,
    )
    .eq("racecards_hr.finished", "0")
    .eq("racecards_hr.canceled", "0")
    .order("racecard_id", { ascending: true })
    .order("probability", { ascending: false });

  if (error) throw error;
  if (!raw?.length) {
    console.log("Nenhuma previsão disponível para corridas pendentes.");
    return;
  }

  // 1) Desaninha os arrays
  const preds: Pick[] = raw
    .map((p: any) => {
      const rc = p.racecards_hr;
      const rh = p.race_horses_hr;
      if (!rc || !rh) {
        console.warn(`! Dados incompletos para racecard_id ${p.racecard_id}`);
        return null;
      }
      return {
        racecard_id: p.racecard_id,
        race_horse_id: p.race_horse_id,
        probability: p.probability,
        course: rc.course,
        date: rc.date,
        off_time_br: rc.off_time_br,
        title: rc.title,
        horse: rh.horse,
        number: rh.number,
      };
    })
    .filter((p): p is Pick => p !== null);

  // 2) Agrupa por corrida
  const byRace = new Map<number, Pick[]>();
  for (const p of preds) {
    const arr = byRace.get(p.racecard_id) || [];
    arr.push(p);
    byRace.set(p.racecard_id, arr);
  }

  // 3) Para cada grupo, só insere se tiver exatamente 1 top‑pick
  for (const [racecard_id, group] of byRace.entries()) {
    const topProb = group[0].probability;
    const topGroup = group.filter((p) => p.probability === topProb);

    if (topGroup.length !== 1) {
      console.log(
        `! Corrida ${racecard_id} ignorada por empate (${topGroup.length}).`,
      );
      continue;
    }

    const pick = topGroup[0];
    const { error: upErr } = await supabase.from("lay_picks").upsert(
      [
        {
          racecard_id: pick.racecard_id,
          race_horse_id: pick.race_horse_id,
          course: pick.course,
          date: pick.date,
          off_time_br: pick.off_time_br,
          title: pick.title,
          horse: pick.horse,
          number: pick.number,
          probability: pick.probability,
        },
      ],
      { onConflict: "racecard_id" },
    );

    if (upErr) {
      console.error(`Erro ao inserir lay‑pick corrida ${racecard_id}:`, upErr);
    } else {
      console.log(
        `√ Lay‑pick corrida ${racecard_id}: ${pick.horse} (#${pick.number}) — ${(pick.probability * 100).toFixed(1)}%`,
      );
    }
  }
};

export default {
  generateLayPicks,
};
