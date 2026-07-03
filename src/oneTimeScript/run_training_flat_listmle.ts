// Script wrapper para testar o treino race-level com ListMLE em produção.
// Roda APENAS o modelo flat (mais rápido), salva normalmente no Supabase (nova versão).
//
// Uso: nvm use 20 && npx ts-node src/oneTimeScript/run_training_flat_listmle.ts

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { trainLayBettingModel } from "../services/ml/training_final";

async function main() {
  const start = Date.now();
  console.log("🔌 Conectando ao MongoDB...");
  await mongoose.connect(process.env.MONGOOSE as string);
  console.log("✅ MongoDB conectado\n");

  try {
    await trainLayBettingModel("flat");
    const total = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`\n🏁 Treino flat finalizado em ${total}s`);
  } catch (err) {
    console.error("\n❌ Erro durante treino:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("🔌 MongoDB desconectado");
  }
}

main().then(() => process.exit(process.exitCode ?? 0));
