import * as tf from "@tensorflow/tfjs-node";

import { pendingRaces } from "./loadData";
import { supabase } from "../..";

import type { IHorseFeatureEntry_Spb } from "../../models/modelSpb/horseFeatureEntry_Spb";

export const trainData = async () => {
  const races = await pendingRaces();

  if (races.length === 0) {
    console.log("Nenhuma corrida pendente.");
    return;
  }

  const allEntries: IHorseFeatureEntry_Spb[] = races.flatMap((r) => r.features);
  const featureKeys = Object.keys(allEntries[0]).filter(
    (k) =>
      ![
        "id",
        "race_horse_id",
        "race_id",
        "target",
        "created_at",
        "updated_at",
      ].includes(k),
  );

  const xs = allEntries.map((e) =>
    featureKeys.map((k) => (e as any)[k] as number),
  );
  const ys = allEntries.map((e) => e.target);

  // tensor

  const xTensor = tf.tensor2d(xs, [xs.length, featureKeys.length]);
  const yTensor = tf.tensor2d(ys, [ys.length, 1]);

  // modelo

  const model = tf.sequential();
  model.add(
    tf.layers.dense({
      inputShape: [featureKeys.length],
      units: 64,
      activation: "relu",
    }),
  );
  model.add(tf.layers.dense({ units: 32, activation: "relu" }));
  model.add(tf.layers.dense({ units: 1, activation: "sigmoid" }));
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: "binaryCrossentropy",
    metrics: ["accuracy"],
  });

  await model.fit(xTensor, yTensor, {
    epochs: 10,
    batchSize: 32,
    validationSplit: 0.2,
  });

  for (const { raceId, features } of races) {
    if (features.length === 0) continue;

    const input = tf.tensor2d(
      features.map((e) => featureKeys.map((k) => (e as any)[k] as number)),
      [features.length, featureKeys.length],
    );
    const probs = model.predict(input, {
      batchSize: features.length,
    }) as tf.Tensor;
    const probArr = Array.from(probs.dataSync());

    const rows = features.map((e, i) => ({
      racecard_id: raceId,
      race_horse_id: e.race_horse_id,
      probability: probArr[i],
    }));

    const { error: insertError } = await supabase
      .from("race_predictions")
      .insert(rows);

    if (insertError) {
      throw new Error(`Erro salvando previsões: ${insertError}`);
      continue;
    }

    const maxIdx = probArr.indexOf(Math.max(...probArr));
    const loser = features[maxIdx];
    console.log(
      `Corrida ${raceId} (${features.length} candidatos):` +
        ` cavalo '${loser.race_horse_id}' com prob. ${(probArr[maxIdx] * 100).toFixed(1)}% de NÃO vencer.`,
    );
  }

  console.log("Previsões salvas com sucesso.");
};
