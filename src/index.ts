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

mongoose.connect(uri).then(() => {
  app.listen(port, () => {
    console.log("api on air");
  });
});
