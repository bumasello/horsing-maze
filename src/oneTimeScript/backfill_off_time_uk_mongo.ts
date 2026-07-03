import raceCard, { timeUkToBr } from "../integrations/mongodb/getRaceCard_Hr";
import RaceCardModel_Hr from "../models/modelHr/raceCardHrModel";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const backfill = async () => {
  await mongoose.connect(process.env.MONGOOSE || "");
  console.log("MongoDB conectado");

  const allRacecards = await raceCard.getStoredRaceCard_Hr();

  let updated = 0;
  for (const rc of allRacecards) {
    if (rc.date) {
      const times = timeUkToBr(rc.date);
      await RaceCardModel_Hr.updateOne(
        { id_race: rc.id_race },
        { $set: { off_time_uk: times.uk, off_time_br: times.br } },
      );
      updated++;
    }
  }

  console.log(
    `Backfill concluido: ${updated}/${allRacecards.length} atualizados`,
  );
  await mongoose.disconnect();
  process.exit(0);
};

backfill();
