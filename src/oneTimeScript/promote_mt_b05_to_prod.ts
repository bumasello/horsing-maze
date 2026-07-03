// Promove o modelo mt_b05 (baselines/multitask_flat) para o path de PROD
// (claude-ml-model-flat). Faz backup do modelo atual antes.
//
// Fluxo:
//   1. Baixa model.json + weights.bin + config.json de baselines/multitask_flat/
//   2. Backup do path prod atual em baselines/prod_backup_YYYYMMDD/
//   3. Upload dos arquivos do mt_b05 no path prod
//   4. Ajusta o config.json do prod (bump version, marca como "promoted from multitask")
//
// Uso: nvm use 20 && PORT=3999 npx ts-node src/oneTimeScript/promote_mt_b05_to_prod.ts

import dotenv from "dotenv";
dotenv.config();

import { supabase } from "..";
import type { ModelConfig } from "../shared/types/ml.types";

const BUCKET = "modelos-tfjs-publicos";
const SOURCE_PATH = "horse_probability_model/baselines/multitask_flat";
const PROD_PATH = "horse_probability_model/claude-ml-model-flat";

function today(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

const BACKUP_PATH = `horse_probability_model/baselines/prod_backup_${today()}_flat`;

const FILES = ["model.json", "weights.bin", "config.json"];

async function download(bucket: string, path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`download ${path}: ${error?.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function upload(
  bucket: string,
  path: string,
  content: Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, content, {
      contentType,
      upsert: true,
    });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

const CONTENT_TYPES: Record<string, string> = {
  "model.json": "application/json",
  "weights.bin": "application/octet-stream",
  "config.json": "application/json",
};

async function main() {
  console.log(`🚀 Promoção mt_b05 → PROD (Flat)\n`);
  console.log(`  fonte:  ${SOURCE_PATH}`);
  console.log(`  backup: ${BACKUP_PATH}`);
  console.log(`  prod:   ${PROD_PATH}\n`);

  console.log("📥 Baixando arquivos do mt_b05 (fonte)...");
  const sourceFiles: Record<string, Uint8Array> = {};
  for (const f of FILES) {
    sourceFiles[f] = await download(BUCKET, `${SOURCE_PATH}/${f}`);
    console.log(`  ✅ ${f} (${sourceFiles[f].length} bytes)`);
  }

  console.log("\n📥 Baixando arquivos atuais do PROD (pra backup)...");
  const prodFiles: Record<string, Uint8Array> = {};
  for (const f of FILES) {
    try {
      prodFiles[f] = await download(BUCKET, `${PROD_PATH}/${f}`);
      console.log(`  ✅ ${f} (${prodFiles[f].length} bytes)`);
    } catch (e) {
      console.warn(`  ⚠️  ${f} não existe em prod — skip backup deste arquivo`);
    }
  }

  console.log("\n💾 Fazendo backup do prod atual...");
  for (const f of FILES) {
    if (!prodFiles[f]) continue;
    await upload(
      BUCKET,
      `${BACKUP_PATH}/${f}`,
      prodFiles[f],
      CONTENT_TYPES[f],
    );
    console.log(`  ✅ ${BACKUP_PATH}/${f}`);
  }

  console.log("\n🔧 Ajustando config.json antes do upload em prod...");
  const sourceConfig = JSON.parse(
    Buffer.from(sourceFiles["config.json"]).toString("utf8"),
  ) as ModelConfig & {
    softmaxTemperature?: number;
    promoted_from?: string;
    promoted_at?: string;
  };

  // Preservar número de versão do prod (bump +1 se possível)
  let newVersion = 1;
  if (prodFiles["config.json"]) {
    const prodConfig = JSON.parse(
      Buffer.from(prodFiles["config.json"]).toString("utf8"),
    ) as ModelConfig;
    newVersion = (prodConfig.version || 0) + 1;
  }

  const promotedConfig = {
    ...sourceConfig,
    version: newVersion,
    promoted_from: SOURCE_PATH,
    promoted_at: new Date().toISOString(),
  };

  const configBuffer = new TextEncoder().encode(
    JSON.stringify(promotedConfig, null, 2),
  );

  console.log(`  📊 Nova versão prod: v${newVersion}`);
  console.log(`  📊 Features: ${promotedConfig.features.length}`);

  console.log("\n📤 Upload dos arquivos no path de PROD...");
  await upload(BUCKET, `${PROD_PATH}/model.json`, sourceFiles["model.json"], CONTENT_TYPES["model.json"]);
  console.log(`  ✅ ${PROD_PATH}/model.json`);
  await upload(BUCKET, `${PROD_PATH}/weights.bin`, sourceFiles["weights.bin"], CONTENT_TYPES["weights.bin"]);
  console.log(`  ✅ ${PROD_PATH}/weights.bin`);
  await upload(BUCKET, `${PROD_PATH}/config.json`, configBuffer, CONTENT_TYPES["config.json"]);
  console.log(`  ✅ ${PROD_PATH}/config.json`);

  console.log(`\n✅ Promoção concluída!`);
  console.log(`   Prod agora tem mt_b05 (multitask β=0.5, 74 features).`);
  console.log(`   Backup do modelo anterior em: ${BACKUP_PATH}`);
  console.log(`   Rollback: rodar promote_mt_b05_to_prod.ts inverso (fonte=backup).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Falha:", e);
    process.exit(1);
  });
