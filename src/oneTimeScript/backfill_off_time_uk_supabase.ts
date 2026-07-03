import mongoose from "mongoose";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import raceCard, { timeUkToBr } from "../integrations/mongodb/getRaceCard_Hr";

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
);

const backfillSupabase = async () => {
  await mongoose.connect(process.env.MONGOOSE || "");
  console.log("MongoDB conectado.");

  const allRacecards = await raceCard.getStoredRaceCard_Hr();
  console.log(`${allRacecards.length} racecards encontrados no MongoDB.`);

  let updated = 0;
  let errors = 0;

  const CHUNK_SIZE = 20;

  for (let i = 0; i < allRacecards.length; i += CHUNK_SIZE) {
    const chunk = allRacecards.slice(i, i + CHUNK_SIZE);

    const promises = chunk.map(async (rc) => {
      if (!rc.date) return;

      const times = timeUkToBr(rc.date);

      const { error } = await supabase
        .schema("hml")
        .from("racecards_hr_enriched")
        .update({
          off_time_br: times.br,
          off_time_uk: times.uk,
        })
        .eq("id_race", rc.id_race.toString());

      if (error) {
        console.error(`Erro no racecard ${rc.id_race}: ${error.message}`);
        errors++;
      } else {
        updated++;
      }
    });

    await Promise.all(promises);

    if (i + CHUNK_SIZE < allRacecards.length) {
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(
      `Progresso: ${Math.min(i + CHUNK_SIZE, allRacecards.length)}/${allRacecards.length}`,
    );
  }

  console.log(`Backfill concluído: ${updated} atualizados, ${errors} erros.`);
  await mongoose.disconnect();
  process.exit(0);
};

backfillSupabase();
