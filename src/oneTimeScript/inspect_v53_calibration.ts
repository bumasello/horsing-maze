// Inspeciona o config.json v53 (modelo flat) salvo no Supabase
// pra verificar se config.calibration foi gravado corretamente.
// Roda: nvm use 20 && npx ts-node src/oneTimeScript/inspect_v53_calibration.ts

import dotenv from "dotenv";
dotenv.config();

import { supabase } from "../index";
import { applyIsotonic } from "../services/ml/calibration";

async function main() {
  console.log("📥 Baixando config.json do flat model...");
  const { data, error } = await supabase.storage
    .from("modelos-tfjs-publicos")
    .download("horse_probability_model/claude-ml-model-flat/config.json");

  if (error || !data) {
    console.error("❌ Erro ao baixar config:", error);
    process.exit(1);
  }

  const text = await data.text();
  const config = JSON.parse(text);

  console.log(`\n✅ Versão: ${config.version}`);
  console.log(`📊 Métricas salvas:`);
  console.log(`   val_loss = ${config.metrics.valLoss?.toFixed(4)}`);
  console.log(`   val_top1 = ${(config.metrics.valAccuracy * 100).toFixed(2)}%`);
  if (config.metrics.valBrier !== undefined) {
    console.log(`   val_brier = ${config.metrics.valBrier.toFixed(4)}`);
  } else {
    console.log("   val_brier = (AUSENTE)");
  }
  if (config.metrics.valEce !== undefined) {
    console.log(`   val_ece = ${(config.metrics.valEce * 100).toFixed(2)}%`);
  } else {
    console.log("   val_ece = (AUSENTE)");
  }

  if (!config.calibration) {
    console.error("\n❌ config.calibration AUSENTE! Algo deu errado.");
    process.exit(1);
  }

  console.log(`\n🎯 Calibração:`);
  console.log(`   method = ${config.calibration.method}`);
  console.log(`   knots = ${config.calibration.knots.x.length} pontos`);
  console.log(`   fittedOn = ${config.calibration.fittedOn} pares`);
  const xs: number[] = config.calibration.knots.x;
  const ys: number[] = config.calibration.knots.y;
  console.log(
    `   range x = [${xs[0].toFixed(4)}, ${xs[xs.length - 1].toFixed(4)}]`,
  );
  console.log(
    `   range y = [${ys[0].toFixed(4)}, ${ys[ys.length - 1].toFixed(4)}]`,
  );

  // Sanity: y deve ser monótono não-decrescente
  let monoOk = true;
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] < ys[i - 1] - 1e-9) {
      monoOk = false;
      break;
    }
  }
  console.log(`   monotônica = ${monoOk ? "✅" : "❌ NÃO MONOTÔNICA!"}`);

  // Amostra: como a curva mapeia P(win) típicas
  console.log(`\n📈 Curva de calibração (P_raw → P_calibrado):`);
  const samples = [0.01, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.7];
  const curve = { x: xs, y: ys };
  for (const p of samples) {
    const cal = applyIsotonic(curve, p);
    const diff = cal - p;
    const sign = diff > 0 ? "+" : "";
    console.log(
      `   ${(p * 100).toFixed(1).padStart(5)}% → ${(cal * 100).toFixed(2).padStart(6)}% (${sign}${(diff * 100).toFixed(2)}pp)`,
    );
  }

  // Top/bottom de knots pra visualização
  console.log(`\n🔍 Primeiros 5 knots:`);
  for (let i = 0; i < Math.min(5, xs.length); i++) {
    console.log(
      `   x=${xs[i].toFixed(4)}  →  y=${ys[i].toFixed(4)}`,
    );
  }
  console.log(`\n🔍 Últimos 5 knots:`);
  for (let i = Math.max(0, xs.length - 5); i < xs.length; i++) {
    console.log(
      `   x=${xs[i].toFixed(4)}  →  y=${ys[i].toFixed(4)}`,
    );
  }

  console.log("\n✅ Inspeção concluída");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
