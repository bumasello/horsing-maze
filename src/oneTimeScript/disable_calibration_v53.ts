// One-shot: baixa config.json do flat model atual, seta disableCalibration=true,
// reupload. Usado depois da eval histórica mostrar -4.66pp ROI com isotonic.
// Roda: nvm use 20 && npx ts-node src/oneTimeScript/disable_calibration_v53.ts

import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import type { ModelConfig } from "../shared/types/ml.types";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
);

const BUCKET_NAME = "modelos-tfjs-publicos";
const MODEL_PATH = "horse_probability_model/claude-ml-model-flat";

async function main() {
  console.log("📥 Baixando config.json...");
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .download(`${MODEL_PATH}/config.json`);
  if (error || !data) throw new Error(`Download: ${error?.message}`);

  const config = JSON.parse(await data.text()) as ModelConfig;
  console.log(`✅ Versão atual: v${config.version}`);
  console.log(`   disableCalibration atual: ${config.disableCalibration ?? "(undefined)"}`);

  config.disableCalibration = true;

  console.log("\n💾 Subindo config atualizado...");
  const { error: upErr } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(`${MODEL_PATH}/config.json`, JSON.stringify(config, null, 2), {
      contentType: "application/json",
      upsert: true,
    });
  if (upErr) throw new Error(`Upload: ${upErr.message}`);

  console.log("✅ Upload concluído");

  // Sanity download
  console.log("\n🔁 Verificando re-download...");
  const { data: data2, error: err2 } = await supabase.storage
    .from(BUCKET_NAME)
    .download(`${MODEL_PATH}/config.json`);
  if (err2 || !data2) throw new Error(`Re-download: ${err2?.message}`);
  const config2 = JSON.parse(await data2.text()) as ModelConfig;
  console.log(`   disableCalibration agora: ${config2.disableCalibration}`);
  console.log(`   calibration.knots ainda presente: ${config2.calibration ? `${config2.calibration.knots.x.length} knots` : "NÃO"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
