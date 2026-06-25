// Smoke test pra pace.features.ts:
//   1. Pega 1 corrida real do Supabase (date+course com bom matching rate)
//   2. Pra cada cavalo, busca últimos 5 starts via rpscrape_results JOIN race_horses_hr_enriched
//   3. Computa HorsePaceFeatures por cavalo
//   4. Computa RaceFieldPaceFeatures do field
//   5. Reporta interaction paceMatchScore por cavalo
//
// Roda: nvm use 20 && npx ts-node src/oneTimeScript/test_pace_features.ts

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

import {
  computeFieldPaceFeatures,
  extractPaceFeatures,
  paceMatchScore,
  PACE_HISTORY_WINDOW,
  type PaceHistoryEntry,
} from "../services/features/features/pace.features";

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
);

interface HorseInRace {
  race_horse_id: number;
  id_horse: number;
  horse: string;
  position: number | null;
}

async function pickTestRace(): Promise<{
  race_date: string;
  course: string;
  horses: HorseInRace[];
} | null> {
  // Pega corrida Doncaster 2024-06-01 que sabemos ter 5 cavalos (vimos no smoke do matcher)
  const { data: rc } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select("id, date, course")
    .eq("date", "2024-06-01")
    .eq("course", "Doncaster")
    .limit(1)
    .single();
  if (!rc) return null;

  const { data: horses } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("id, id_horse, horse, position")
    .eq("racecard_id", rc.id);

  if (!horses) return null;

  return {
    race_date: rc.date as string,
    course: rc.course as string,
    horses: horses.map((h) => ({
      race_horse_id: h.id,
      id_horse: h.id_horse,
      horse: h.horse,
      position: h.position,
    })),
  };
}

async function loadHistory(
  id_horse: number,
  before: string,
): Promise<PaceHistoryEntry[]> {
  // 3-query approach (FK race_horses → racecards é IMPLÍCITA, PostgREST não
  // resolve embedded join):
  //   q1) todos race_horse_id do cavalo
  //   q2) datas das racecards correspondentes, filtra < before, top N
  //   q3) rpscrape data dos race_horse_id que sobraram

  const { data: rhRows, error: e1 } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("id, racecard_id")
    .eq("id_horse", id_horse);
  if (e1) console.error(`q1 err id_horse=${id_horse}:`, e1.message);
  if (!rhRows || rhRows.length === 0) return [];

  const racecardIds = rhRows.map((r) => r.racecard_id as number).filter((x) => x);
  if (racecardIds.length === 0) return [];

  const { data: rcRows } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select("id, date")
    .in("id", racecardIds)
    .lt("date", before)
    .order("date", { ascending: false });
  if (!rcRows || rcRows.length === 0) return [];

  const dateByRcId = new Map<number, string>();
  for (const rc of rcRows) dateByRcId.set(rc.id as number, rc.date as string);

  // Pega os top N race_horse_id ordenados por data DESC
  const validStarts = rhRows
    .map((r) => ({ id: r.id as number, racecardId: r.racecard_id as number }))
    .filter((x) => dateByRcId.has(x.racecardId))
    .map((x) => ({ id: x.id, date: dateByRcId.get(x.racecardId)! }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, PACE_HISTORY_WINDOW);
  if (validStarts.length === 0) return [];

  const { data: rps } = await supabase
    .schema("hml")
    .from("rpscrape_results")
    .select("race_horse_id, comment, rpr_rating, ts_rating, ovr_btn")
    .in(
      "race_horse_id",
      validStarts.map((s) => s.id),
    );
  if (!rps) return [];

  const rpsById = new Map<number, any>();
  for (const r of rps) rpsById.set(r.race_horse_id as number, r);

  const entries: PaceHistoryEntry[] = [];
  for (const s of validStarts) {
    const r = rpsById.get(s.id);
    if (!r) continue;
    entries.push({
      race_date: s.date,
      comment: r.comment,
      rpr_rating: r.rpr_rating,
      ts_rating: r.ts_rating,
      ovr_btn: r.ovr_btn,
    });
  }
  return entries;
}

async function main() {
  const race = await pickTestRace();
  if (!race) {
    console.log("FAIL: no test race");
    process.exit(1);
  }

  console.log(`🏇 Race: ${race.course} ${race.race_date} (${race.horses.length} horses)\n`);

  // Pra cada cavalo, pega histórico + extrai features
  const horsePaceFeats = [];
  for (const h of race.horses) {
    const history = await loadHistory(h.id_horse, race.race_date);
    const feats = extractPaceFeatures(history);
    horsePaceFeats.push({ horse: h, feats });
    console.log(
      `  ${h.horse.padEnd(28)} → n=${feats.pace_data_count} dom=${
        feats.pace_dominant_style_code
      } cons=${(feats.pace_consistency * 100).toFixed(0)}% E=${(feats.pace_E_pct_recent * 100).toFixed(0)}% EP=${(feats.pace_EP_pct_recent * 100).toFixed(0)}% P=${(feats.pace_P_pct_recent * 100).toFixed(0)}% S=${(feats.pace_S_pct_recent * 100).toFixed(0)}% rpr=${feats.pace_rpr_avg_recent.toFixed(1)}`,
    );
  }

  // Field pace features
  const field = computeFieldPaceFeatures(horsePaceFeats.map((x) => x.feats));
  console.log("\n📊 Field:");
  console.log(`  pace_pressure: ${(field.field_pace_pressure * 100).toFixed(1)}%`);
  console.log(`  n_early=${field.n_early_runners} n_pressers=${field.n_pressers} n_held_up=${field.n_held_up}`);
  console.log(`  is_lone_speed: ${field.is_lone_speed}`);
  console.log(`  pace_field_size: ${field.pace_field_size}/${race.horses.length}`);

  // Match scores
  console.log("\n🎯 Pace Match Score (per horse):");
  for (const x of horsePaceFeats) {
    const score = paceMatchScore(x.feats, field);
    console.log(
      `  ${x.horse.horse.padEnd(28)} (pos=${x.horse.position}) dom=${x.feats.pace_dominant_style_code} → match=${score.toFixed(2)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
