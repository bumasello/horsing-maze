import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import { initBot } from "./router/tle_DataRouter";

import mdb_dataRouter from "./router/mdb_DataRouter";
import spb_dataRouter from "./router/spb_DataRouter";
import tle_dataRouter from "./router/tle_DataRouter";
import tsr_dataRouter from "./router/tsr_DataRouter";
import upt_dataRouter from "./router/upt_DataRouter";

import type { Request, Response, NextFunction } from "express";
import { updateRacecards_spb } from "./functions/spb_functions/update/updateRacecard_hr";
import { updateLayPicks_spb } from "./functions/spb_functions/update/updateLayPicks";
import populateHorseFeature_spb from "./functions/spb_functions/features_v1/populateHorseFeatures";
import { cl_trainData } from "./functions/tensor_functions/claude_trainData";
import populateLayPicks from "./functions/spb_functions/populate/populateLayPicks";
import { message } from "./controller/tleController";

interface CustomError extends Error {
  status?: number;
}

dotenv.config();

const port = process.env.PORT || 3000;

const app = express();

initBot();

app.use("/mdb_data", mdb_dataRouter);
app.use("/spb_data", spb_dataRouter);
app.use("/tle_data", tle_dataRouter);
app.use("/tsr_data", tsr_dataRouter);
app.use("/upt_data", upt_dataRouter);

app.use(
  (error: CustomError, _req: Request, res: Response, _next: NextFunction) => {
    const status = error.status || 500;
    console.error(error);
    res.status(status).json({ message: error.message });
  },
);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "error";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "error";

export const supabase = createClient(supabaseUrl, supabaseKey);

const uri = process.env.MONGOOSE || "error";

const execPipeline = async () => {
  try {
    await updateRacecards_spb();
    await updateLayPicks_spb();
    await populateHorseFeature_spb();
    await cl_trainData();
    await populateLayPicks.generateLayPicks();

    return {
      success: true,
      message: "Pipeline executado com sucesso.",
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      message: "Erro ao executar pipeline.",
    };
  }
};

mongoose.connect(uri).then(() => {
  app.listen(port, () => {
    console.log("api on air");
    execPipeline();
  });
});
