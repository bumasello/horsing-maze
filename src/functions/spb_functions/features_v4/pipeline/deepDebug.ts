// features_v4/deepDebug.ts - Debug mais profundo

import { supabase } from "../../../..";

export async function deepDebug() {
  console.log("=== DEEP DEBUG ===\n");

  // 1. Verificar se consegue acessar QUALQUER cavalo na tabela
  console.log("1. Checking if we can access ANY horse in the table:");
  const { data: anyHorse, error: anyError } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("id, horse, racecard_id, id_race, position, non_runner")
    .limit(3);

  if (anyError) {
    console.error("Error accessing horses table:", anyError);
  } else {
    console.log(`Found ${anyHorse?.length || 0} horses in table`);
    if (anyHorse && anyHorse.length > 0) {
      console.log("Sample horse:", anyHorse[0]);
    }
  }

  // 2. Verificar especificamente o cavalo Opal Storm que você mencionou
  console.log("\n2. Looking for specific horse (Opal Storm):");
  const { data: opalStorm, error: opalError } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("*")
    .eq("racecard_id", 14661)
    .eq("horse", "Opal Storm")
    .single();

  if (opalError) {
    console.error("Error finding Opal Storm:", opalError);
  } else if (opalStorm) {
    console.log("Found Opal Storm!");
    console.log(`  racecard_id: ${opalStorm.racecard_id}`);
    console.log(`  id_race: ${opalStorm.id_race}`);
    console.log(`  non_runner: ${opalStorm.non_runner}`);
    console.log(`  position: ${opalStorm.position}`);
  }

  // 3. Contar TODOS os cavalos para racecard_id = 14661
  console.log("\n3. Counting ALL horses for racecard_id 14661:");
  const { count: horseCount, error: countError } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("*", { count: "exact", head: true })
    .eq("racecard_id", 14661);

  console.log(`Total horses for racecard 14661: ${horseCount || 0}`);

  // 4. Buscar cavalos SEM filtro de non_runner
  console.log("\n4. Fetching horses WITHOUT any filters:");
  const { data: allHorses14661, error: allError } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("id, horse, non_runner, position")
    .eq("racecard_id", 14661);

  if (allError) {
    console.error("Error:", allError);
  } else {
    console.log(`Found ${allHorses14661?.length || 0} horses total`);
    if (allHorses14661 && allHorses14661.length > 0) {
      console.log("All horses for this race:");
      allHorses14661.forEach((h) => {
        console.log(
          `  - ${h.horse}: non_runner=${h.non_runner}, position=${h.position}`,
        );
      });
    }
  }

  // 5. Verificar se o problema é com NULL values
  console.log("\n5. Checking non_runner values:");
  const { data: nonRunnerCheck } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("non_runner")
    .eq("racecard_id", 14661)
    .limit(5);

  if (nonRunnerCheck) {
    nonRunnerCheck.forEach((h, i) => {
      console.log(
        `  Horse ${i + 1}: non_runner = ${h.non_runner} (type: ${typeof h.non_runner})`,
      );
    });
  }

  // 6. Testar a query EXATA que o orchestrator usa
  console.log("\n6. Testing EXACT orchestrator query:");
  const runners = allHorses14661?.filter((h) => h.non_runner === 0) || [];
  console.log(`After filtering for non_runner === 0: ${runners.length} horses`);

  // 7. Testar com diferentes comparações para non_runner
  console.log("\n7. Testing different non_runner filters:");

  // Teste com != 1
  const { data: notOne } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("id")
    .eq("racecard_id", 14661)
    .neq("non_runner", 1);
  console.log(`  non_runner != 1: ${notOne?.length || 0} horses`);

  // Teste com IS NULL
  const { data: isNull } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("id")
    .eq("racecard_id", 14661)
    .is("non_runner", null);
  console.log(`  non_runner IS NULL: ${isNull?.length || 0} horses`);

  // Teste com .or
  const { data: nullOrZero } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("id")
    .eq("racecard_id", 14661)
    .or("non_runner.is.null,non_runner.eq.0");
  console.log(`  non_runner IS NULL OR = 0: ${nullOrZero?.length || 0} horses`);

  console.log("\n=== END DEBUG ===");
}

// Executar
export async function runDeepDebug() {
  await deepDebug();
}
