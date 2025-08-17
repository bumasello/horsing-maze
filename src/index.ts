import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import mongoose from "mongoose";
import { runPipeline, setupCronJob } from "./pipeline/pipeline";
import mdb_dataRouter from "./router/mdb_DataRouter";
import spb_dataRouter from "./router/spb_DataRouter";
import tle_dataRouter, { initBot } from "./router/tle_DataRouter";
import tsr_dataRouter from "./router/tsr_DataRouter";
import upt_dataRouter from "./router/upt_DataRouter";

interface CustomError extends Error {
  status?: number;
}

dotenv.config();

const port = process.env.PORT || 3000;

const app = express();

// initBot();

// Endpoint de health check para manter o serviço ativo
app.get("/health", (_req: Request, res: Response) => {
  const now = new Date();
  console.log(`[HEALTH] Health check realizado às ${now.toISOString()}`);
  res.status(200).json({
    status: "OK",
    timestamp: now.toISOString(),
    uptime: process.uptime(),
  });
});

// Endpoint para verificar o status do agendamento
app.get("/cron-status", (_req: Request, res: Response) => {
  const now = new Date();
  console.log(
    `[CRON] Status do agendamento verificado às ${now.toISOString()}`,
  );
  res.status(200).json({
    status: "OK",
    timestamp: now.toISOString(),
    nextScheduledTime: getNextScheduledTime(),
    timezone: {
      serverTime: now.toISOString(),
      utcOffset: now.getTimezoneOffset(),
    },
  });
});

// Função para calcular o próximo horário agendado (22:00 UTC)
function getNextScheduledTime(): string {
  const now = new Date();
  const nextRun = new Date();

  // Configurar para 22:00 UTC
  nextRun.setUTCHours(22, 0, 0, 0);

  // Se já passou das 22:00 UTC hoje, agendar para amanhã
  if (now.getUTCHours() >= 22) {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  }

  return nextRun.toISOString();
}

// Rotas da API (comentadas conforme seu código)
app.use("/mdb_data", mdb_dataRouter);
app.use("/spb_data", spb_dataRouter);
// app.use("/tle_data", tle_dataRouter);
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
    console.log(`API ativa na porta ${port} às ${new Date().toISOString()}`);
    setupCronJob();
    //  runPipeline().then((result) => {
    //    console.log(result);
    // });
  });
});
