import * as tf from "@tensorflow/tfjs-node";

import { loadTrainingData, pendingRaces } from "./loadData";
import { supabase } from "../..";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

import type { IHorseFeatureEntry_Spb } from "../../models/modelSpb/horseFeatureEntry_Spb";

const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);
const rmdir = promisify(fs.rm);

const BUCKET_NAME = "modelos-tfjs-publicos"; // Substitua pelo nome do seu bucket
const MODEL_BASE_NAME = "trainHorseData";
const LOCAL_TEMP_MODEL_DIR = path.join(__dirname, "temp_model_save"); // Diretório temporário local

async function ensureDir(dirPath: string) {
  try {
    await stat(dirPath);
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ENOENT") {
        await mkdir(dirPath, { recursive: true });
      } else {
        throw error;
      }
    }
  }
}

async function getLatestModelPathFromSupabase(): Promise<string | null> {
  console.log(`Buscando modelos em ${BUCKET_NAME}/${MODEL_BASE_NAME}/`);
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .list(`${MODEL_BASE_NAME}`, {
      limit: 100,
      sortBy: { column: "name", order: "desc" },
    });

  if (error) {
    console.error("Erro ao listar modelos no Supabase:", error);
    return null;
  }

  if (data && data.length > 0) {
    // Filtra para garantir que são diretórios (versões)
    const versionFolders = data.filter(
      (item) => !item.id && item.name !== ".emptyFolderPlaceholder",
    ); // Supabase pode criar placeholders
    if (versionFolders.length > 0) {
      // A ordenação por nome (desc) deve colocar o timestamp mais recente primeiro
      const latestVersionFolder = versionFolders[0].name;
      const modelJsonPath = `${MODEL_BASE_NAME}/${latestVersionFolder}/model.json`;
      console.log(
        `Caminho do model.json mais recente encontrado: ${modelJsonPath}`,
      );
      return modelJsonPath;
    }
  }
  console.log("Nenhuma versão de modelo encontrada no Supabase.");
  return null;
}

export const trainHorseData = async () => {
  const trainingEntries: IHorseFeatureEntry_Spb[] = await loadTrainingData();
  if (trainingEntries.length === 0) {
    console.log("Sem dados de treinamento (trainingEntries) suficientes.");
    return;
  }

  const racesToPredict = await pendingRaces();

  if (racesToPredict.length === 0) {
    console.log("Nenhuma corrida pendente.");
    return;
  }

  const featureKeys = Object.keys(trainingEntries[0]).filter(
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

  const xs_raw = trainingEntries.map((e) =>
    featureKeys.map((k) => (e as any)[k] as number),
  );
  const ys_raw = trainingEntries.map((e) => e.target);

  const xs_train_cleaned = xs_raw.map((arr) =>
    arr.map((val) => (Number.isNaN(val) ? 0 : val)),
  );
  const ys_train_cleaned = ys_raw.map((val) => (Number.isNaN(val) ? 0 : val));

  if (xs_train_cleaned.length === 0) {
    console.log(
      "Dados de treinamento (xs_train_cleaned) estão vazios após processamento.",
    );
    return;
  }

  // INÍCIO DO BLOCO DE DIAGNÓSTICO PARA YS
  console.log("---------------------------------------------------------");
  console.log("DIAGNÓSTICO DA VARIÁVEL TARGET (ys_train_cleaned)");
  console.log(
    `Número total de entradas para treinamento: ${ys_train_cleaned.length}`,
  );
  if (ys_train_cleaned.length > 0) {
    const primeirosValoresYs = ys_train_cleaned.slice(0, 20);
    console.log(
      "Primeiros 20 valores de ys_train_cleaned:",
      primeirosValoresYs,
    );
    const contagemValoresYs: { [key: string]: number } = {};
    for (const valor of ys_train_cleaned) {
      const chave = String(valor);
      contagemValoresYs[chave] = (contagemValoresYs[chave] || 0) + 1;
    }
    console.log(
      "Contagem de cada valor único em ys_train_cleaned:",
      contagemValoresYs,
    );
    const todosIguais = ys_train_cleaned.every(
      (val) => val === ys_train_cleaned[0],
    );
    if (todosIguais) {
      console.warn(
        "ALERTA EM YS_TRAIN_CLEANED: Todos os valores são IDÊNTICOS!",
      );
    }
  }
  console.log("---------------------------------------------------------");
  // FIM DO BLOCO DE DIAGNÓSTICO PARA YS

  // tensor

  const xTrainTensorRaw = tf.tensor2d(xs_train_cleaned);
  const yTrainTensor = tf.tensor2d(ys_train_cleaned, [
    ys_train_cleaned.length,
    1,
  ]);

  const xMean = xTrainTensorRaw.mean(0);
  const xStd = tf.tidy(() => {
    const variance = xTrainTensorRaw.square().mean(0).sub(xMean.square());
    return variance.sqrt().add(tf.scalar(1e-8));
  });

  const normalizedXTrainTensor = tf.tidy(() =>
    xTrainTensorRaw.sub(xMean).div(xStd),
  );

  // modelo

  let model: tf.Sequential | undefined = undefined;
  const latestModelJsonPath = await getLatestModelPathFromSupabase();

  if (latestModelJsonPath) {
    try {
      const { data: publicUrlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(latestModelJsonPath);

      if (!publicUrlData || !publicUrlData.publicUrl) {
        console.error(
          "Failed to retrieve a valid public URL object or URL string from Supabase.",
        );
        throw new Error("Invalid public URL data from Supabase.");
      }
      const modelUrl = publicUrlData.publicUrl;

      console.log("Carregando modelo de ", modelUrl);

      const loadedModel = (await tf.loadLayersModel(modelUrl)) as tf.Sequential;
      console.log("Modelo carregado com sucesso do supabase");
      loadedModel.compile({
        optimizer: tf.train.adam(0.0005), // Taxa de aprendizado menor para fine-tuning
        loss: "binaryCrossentropy",
        metrics: ["accuracy"],
      });
      console.log("Modelo recompilado para treinamento contínuo.");
      model = loadedModel;
    } catch (error) {
      console.log(
        "Erro ao carregar modelo do Supabase, criando um novo: ",
        error,
      );
    }
  } else {
    // Se o modelo não foi carregado, cria um novo
    model = tf.sequential();
    model.add(
      tf.layers.dense({
        inputShape: [featureKeys.length],
        units: 64,
        activation: "relu",
      }),
    );
    model.add(tf.layers.dropout({ rate: 0.2 })); // ADICIONADO DROPOUT
    model.add(tf.layers.dense({ units: 32, activation: "relu" }));
    model.add(tf.layers.dropout({ rate: 0.2 })); // ADICIONADO DROPOUT
    model.add(tf.layers.dense({ units: 1, activation: "sigmoid" }));
    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: "binaryCrossentropy",
      metrics: ["accuracy"],
    });
    console.log("Novo modelo criado e compilado.");
  }

  if (!model) {
    console.log("Algum erro ao criar o modelo");
    return;
  }

  console.log("Iniciando o treinamento.");
  await model.fit(normalizedXTrainTensor, yTrainTensor, {
    epochs: 50,
    batchSize: 32,
    validationSplit: 0.2,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        console.log(
          `Epoch ${epoch + 1}: loss = ${logs?.loss?.toFixed(4)}, acc = ${logs?.acc?.toFixed(4)}, val_loss = ${logs?.val_loss?.toFixed(4)}, val_acc = ${logs?.val_acc?.toFixed(4)}`,
        );
      },
      // Considere adicionar earlyStopping aqui DEPOIS de confirmar que os dados estão bons
      // tf.callbacks.earlyStopping({ monitor: "val_loss", patience: 5, restoreBestWeights: true })
    },
  });
  console.log("Treinamento concluido.");

  try {
    await ensureDir(LOCAL_TEMP_MODEL_DIR);
    await model.save(`file://${LOCAL_TEMP_MODEL_DIR}`);
    console.log(`Modelo salvo temporariamente em ${LOCAL_TEMP_MODEL_DIR}`);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-"); // Formato de timestamp para nome da pasta
    const supabaseModelPath = `${MODEL_BASE_NAME}/${timestamp}`;

    const filesToUpload = await readdir(LOCAL_TEMP_MODEL_DIR);
    for (const fileName of filesToUpload) {
      const localFilePath = path.join(LOCAL_TEMP_MODEL_DIR, fileName);
      const fileBuffer = await readFile(localFilePath);
      const supabaseFilePath = `${supabaseModelPath}/${fileName}`;

      console.log(
        `Fazendo upload de ${fileName} para ${BUCKET_NAME}/${supabaseFilePath}...`,
      );
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(supabaseFilePath, fileBuffer, {
          cacheControl: "3600", // Opcional
          upsert: true, // Sobrescreve se já existir (não deve acontecer com timestamp único)
        });

      if (uploadError) {
        console.error(`Erro ao fazer upload de ${fileName}:`, uploadError);
      } else {
        console.log(`${fileName} enviado com sucesso.`);
      }
    }
    console.log(
      `Modelo salvo com sucesso no Supabase em ${BUCKET_NAME}/${supabaseModelPath}`,
    );

    // Opcional: Limpar diretório temporário local
    // await rmdir(LOCAL_TEMP_MODEL_DIR, { recursive: true });
    // console.log("Diretório temporário local limpo.");
  } catch (saveError) {
    console.error("Erro ao salvar o modelo no Supabase:", saveError);
  }

  for (const { raceId, features } of racesToPredict) {
    if (features.length === 0 || !features) continue;

    const inputData_predict_raw: number[][] = features.map((e) =>
      featureKeys.map((k) => (e as any)[k] as number),
    );

    const inputData_predict_cleaned: number[][] = inputData_predict_raw.map(
      (arr: number[]) =>
        arr.map((val: number) => (Number.isNaN(val) ? 0 : val)),
    );

    if (inputData_predict_cleaned.length === 0) continue;

    const inputTensor_predict = tf.tensor2d(inputData_predict_cleaned);

    const normalizedInput_predict = tf.tidy(() =>
      inputTensor_predict.sub(xMean).div(xStd),
    );

    const probsTensor = model.predict(normalizedInput_predict, {
      batchSize: features.length,
    }) as tf.Tensor;
    const probArr = Array.from(probsTensor.dataSync());

    const rows = features.map((e, i) => ({
      racecard_id: raceId,
      race_horse_id: e.race_horse_id,
      probability: probArr[i],
    }));

    const { error: insertError } = await supabase
      .from("horse_race_predictions")
      .insert(rows);

    if (insertError) {
      throw new Error(`Erro salvando previsões: ${insertError}`);
    }

    const maxIdx = probArr.indexOf(Math.max(...probArr));
    const loser = features[maxIdx];
    console.log(
      `Corrida ${raceId} (${features.length} candidatos):` +
        ` cavalo '${loser.race_horse_id}' com prob. ${(probArr[maxIdx] * 100).toFixed(1)}% de NÃO vencer.`,
    );
    tf.dispose([inputTensor_predict, normalizedInput_predict, probsTensor]);
  }

  tf.dispose([
    xTrainTensorRaw,
    yTrainTensor,
    xMean,
    xStd,
    normalizedXTrainTensor,
  ]);

  if (model) {
    model.dispose();
  }
  console.log("Previsões salvas com sucesso.");
};
