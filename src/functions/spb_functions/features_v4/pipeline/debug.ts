// features_v4/debug.ts - Script para debugar o problema

import { supabase } from "../../../..";

export async function debugPredictionRaces() {
  console.log("=== DEBUGGING PREDICTION RACES ===\n");

  // 1. Buscar corridas futuras
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 59, 999);

  const { data: upcomingRaces, error: raceError } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select("*") // Pegar todos os campos para debug
    .gte("date", today.toISOString())
    .lte("date", tomorrow.toISOString())
    .eq("finished", 0)
    .eq("canceled", 0)
    .limit(2); // Pegar apenas 2 para debug

  if (raceError) {
    console.error("Error fetching races:", raceError);
    return;
  }

  console.log(`Found ${upcomingRaces?.length || 0} upcoming races\n`);

  if (!upcomingRaces || upcomingRaces.length === 0) {
    console.log("No upcoming races found");
    return;
  }

  // 2. Para cada corrida, verificar cavalos
  for (const race of upcomingRaces) {
    console.log(`\n--- RACE DEBUG ---`);
    console.log(`Race ID: ${race.id}`);
    console.log(`Race ID_RACE: ${race.id_race}`);
    console.log(`Course: ${race.course}`);
    console.log(`Date: ${race.date}`);
    console.log(`Finished: ${race.finished}`);

    // Tentar buscar cavalos por race.id
    const { data: horsesByID, error: error1 } = await supabase
      .schema("hml")
      .from("race_horses_hr_enriched")
      .select("id, horse, racecard_id, id_race, non_runner")
      .eq("racecard_id", race.id)
      .limit(5);

    console.log(
      `\nHorses found using race.id (${race.id}): ${horsesByID?.length || 0}`,
    );
    if (horsesByID && horsesByID.length > 0) {
      console.log("Sample horses:", horsesByID.slice(0, 2));
    }

    // Tentar buscar cavalos por race.id_race
    const { data: horsesByIDRace, error: error2 } = await supabase
      .schema("hml")
      .from("race_horses_hr_enriched")
      .select("id, horse, racecard_id, id_race, non_runner")
      .eq("id_race", race.id_race)
      .limit(5);

    console.log(
      `Horses found using race.id_race (${race.id_race}): ${horsesByIDRace?.length || 0}`,
    );
    if (horsesByIDRace && horsesByIDRace.length > 0) {
      console.log("Sample horses:", horsesByIDRace.slice(0, 2));
    }

    // Ver estrutura de um cavalo
    if (horsesByID && horsesByID.length > 0) {
      console.log("\n--- HORSE STRUCTURE ---");
      console.log("First horse full structure:");
      const { data: fullHorse } = await supabase
        .schema("hml")
        .from("race_horses_hr_enriched")
        .select("*")
        .eq("id", horsesByID[0].id)
        .single();

      console.log("Key fields:");
      console.log(`  id: ${fullHorse?.id}`);
      console.log(`  racecard_id: ${fullHorse?.racecard_id}`);
      console.log(`  id_race: ${fullHorse?.id_race}`);
      console.log(`  horse: ${fullHorse?.horse}`);
      console.log(`  non_runner: ${fullHorse?.non_runner}`);
    }
  }

  console.log("\n=== END DEBUG ===");
}

// Executar debug
export async function runDebug() {
  await debugPredictionRaces();
}
