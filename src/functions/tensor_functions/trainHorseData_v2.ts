import * as tf from "@tensorflow/tfjs-node";
import { supabase } from "../.."; // Ajuste o caminho conforme necessário
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);

const BUCKET_NAME = "modelos-tfjs-publicos";
const MODEL_BASE_NAME = "trainHorseData";
const LOCAL_TEMP_MODEL_DIR = path.join(__dirname, "temp_model_save");

// *** DEFINIR EXPLICITAMENTE AS FEATURES E SUA ORDEM ***
const EXPECTED_FEATURE_KEYS: string[] = [
  "going_encoded",
  "distance_meters",
  "field_size",
  "race_class",
  "horse_age",
  "weight_kg",
  "or_rating",
  "days_since_last_run",
  "avg_position",
  "position_variance",
  "win_rate",
  "place_rate",
  "avg_or_rating",
  "or_trend",
  "going_performance",
  "distance_performance",
  "jockey_win_rate",
  "jockey_horse_win_rate",
  "jockey_course_win_rate",
  "recent_form",
];

// Interface para os parâmetros de normalização
interface NormalizationParams {
  mean: number[];
  std: number[];
  featureKeys: string[];
}

// Interface para os dados de treinamento
interface TrainingFeature {
  target: number | null;
  going_encoded: number | null;
  distance_meters: number | null;
  field_size: number | null;
  race_class: number | null;
  horse_age: number | null;
  weight_kg: number | null;
  or_rating: number | null;
  days_since_last_run: number | null;
  avg_position: number | null;
  position_variance: number | null;
  win_rate: number | null;
  place_rate: number | null;
  avg_or_rating: number | null;
  or_trend: number | null;
  going_performance: number | null;
  distance_performance: number | null;
  jockey_win_rate: number | null;
  jockey_horse_win_rate: number | null;
  jockey_course_win_rate: number | null;
  recent_form: number | null;
}

// Interface para o retorno da função getLatestModelPathFromSupabase
interface ModelPaths {
  modelJsonPath: string;
  normJsonPath: string;
}

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

async function getLatestModelPathFromSupabase(): Promise<ModelPaths | null> {
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
    const versionFolders = data.filter(
      (item) => !item.id && item.name !== ".emptyFolderPlaceholder",
    );
    if (versionFolders.length > 0) {
      const latestVersionFolder = versionFolders[0].name;
      const modelJsonPath = `${MODEL_BASE_NAME}/${latestVersionFolder}/model.json`;
      const normJsonPath = `${MODEL_BASE_NAME}/${latestVersionFolder}/normalization.json`;
      console.log(
        `Caminho do model.json mais recente encontrado: ${modelJsonPath}`,
      );
      return { modelJsonPath, normJsonPath };
    }
  }
  console.log("Nenhuma versão de modelo encontrada no Supabase.");
  return null;
}

async function saveNormalizationParams(
  xMean: tf.Tensor,
  xStd: tf.Tensor,
  featureKeys: string[], // Usar a lista explícita
): Promise<void> {
  try {
    const meanValues = Array.from(xMean.dataSync());
    const stdValues = Array.from(xStd.dataSync());

    const normalizationParams: NormalizationParams = {
      mean: meanValues,
      std: stdValues,
      featureKeys: featureKeys,
    };

    const normParamsPath = path.join(
      LOCAL_TEMP_MODEL_DIR,
      "normalization.json",
    );
    await fs.promises.writeFile(
      normParamsPath,
      JSON.stringify(normalizationParams),
      "utf8",
    );

    console.log("Parâmetros de normalização salvos com sucesso.");
  } catch (error) {
    console.error("Erro ao salvar parâmetros de normalização:", error);
    throw error;
  }
}

export const trainHorseData_v2 = async (): Promise<void> => {
  let model: tf.Sequential | undefined = undefined;
  let xMean: tf.Tensor | undefined = undefined;
  let xStd: tf.Tensor | undefined = undefined;
  let xTrainTensorRaw: tf.Tensor2D | undefined = undefined;
  let yTrainTensor: tf.Tensor2D | undefined = undefined;
  let normalizedXTrainTensor: tf.Tensor2D | undefined = undefined;

  try {
    console.log(
      "Iniciando treinamento do modelo com dados da tabela training_horse_features...",
    );

    // 1. Buscar dados de treinamento
    // Selecionar explicitamente as colunas na ordem definida
    const selectColumns = ["target", ...EXPECTED_FEATURE_KEYS].join(", ");
    const { data: trainingEntries, error: trainingError } = await supabase
      .schema("hml")
      .from("training_horse_features")
      .select(selectColumns);

    if (trainingError) {
      throw new Error(
        `Erro ao buscar dados de treinamento: ${JSON.stringify(trainingError)}`,
      );
    }

    if (!trainingEntries || trainingEntries.length === 0) {
      console.log(
        "Sem dados de treinamento suficientes na tabela training_horse_features.",
      );
      return;
    }

    console.log(
      `Encontrados ${trainingEntries.length} registros para treinamento.`,
    );
    console.log(
      `Features esperadas (${EXPECTED_FEATURE_KEYS.length}): ${EXPECTED_FEATURE_KEYS.join(", ")}`,
    );

    // 2. Extrair features e target usando a lista explícita
    // Fazer cast explícito para o tipo correto
    const typedEntries = trainingEntries as unknown as TrainingFeature[];

    const xs_raw = typedEntries.map((e) =>
      EXPECTED_FEATURE_KEYS.map((k) => (e as any)[k] as number | null),
    );
    const ys_raw = typedEntries.map((e) => e.target ?? 0); // Usar 0 como fallback para null

    // 3. Limpar e processar os dados
    const xs_train_cleaned = xs_raw.map((arr) =>
      arr.map((val) => (val === null || Number.isNaN(val) ? 0 : val)),
    );
    const ys_train_cleaned = ys_raw.map((val) => (Number.isNaN(val) ? 0 : val));

    if (xs_train_cleaned.length === 0) {
      console.log("Dados de treinamento estão vazios após processamento.");
      return;
    }

    // 4. Diagnóstico da variável target
    console.log("---------------------------------------------------------");
    console.log("DIAGNÓSTICO DA VARIÁVEL TARGET");
    console.log(
      `Número total de entradas para treinamento: ${ys_train_cleaned.length}`,
    );

    if (ys_train_cleaned.length > 0) {
      const primeirosValoresYs = ys_train_cleaned.slice(0, 20);
      console.log("Primeiros 20 valores de target:", primeirosValoresYs);

      const contagemValoresYs: { [key: string]: number } = {};
      for (const valor of ys_train_cleaned) {
        const chave = String(valor);
        contagemValoresYs[chave] = (contagemValoresYs[chave] || 0) + 1;
      }
      console.log("Contagem de cada valor único em target:", contagemValoresYs);

      const todosIguais = ys_train_cleaned.every(
        (val) => val === ys_train_cleaned[0],
      );
      if (todosIguais) {
        console.warn("ALERTA: Todos os valores de target são IDÊNTICOS!");
        console.warn("O modelo não conseguirá aprender com dados homogêneos.");
        console.warn("Verifique a geração de features de treinamento.");
      }
    }
    console.log("---------------------------------------------------------");

    // 5. Criar tensores e normalizar
    xTrainTensorRaw = tf.tensor2d(xs_train_cleaned as number[][]);
    yTrainTensor = tf.tensor2d(ys_train_cleaned, [ys_train_cleaned.length, 1]);

    // 6. Carregar modelo existente ou criar novo
    const latestModelPaths = await getLatestModelPathFromSupabase();
    let loadedNormalizationParams: NormalizationParams | null = null;

    if (latestModelPaths) {
      try {
        // Carregar parâmetros de normalização primeiro
        const { data: normUrlData } = supabase.storage
          .from(BUCKET_NAME)
          .getPublicUrl(latestModelPaths.normJsonPath);

        if (!normUrlData || !normUrlData.publicUrl) {
          throw new Error(
            "Falha ao obter URL pública dos parâmetros de normalização.",
          );
        }

        const normResponse = await fetch(normUrlData.publicUrl);
        if (!normResponse.ok)
          throw new Error(
            `Erro ao buscar normalization.json: ${normResponse.statusText}`,
          );
        loadedNormalizationParams = await normResponse.json();

        // *** VALIDAR CONSISTÊNCIA DAS FEATURES ***
        if (
          JSON.stringify(loadedNormalizationParams?.featureKeys) !==
          JSON.stringify(EXPECTED_FEATURE_KEYS)
        ) {
          throw new Error(
            "Incompatibilidade de features entre o modelo salvo e o código atual. Crie um novo modelo.",
          );
        }

        // Carregar modelo
        const { data: modelUrlData } = supabase.storage
          .from(BUCKET_NAME)
          .getPublicUrl(latestModelPaths.modelJsonPath);

        if (!modelUrlData || !modelUrlData.publicUrl) {
          throw new Error("Falha ao obter URL pública do modelo.");
        }

        const modelUrl = modelUrlData.publicUrl;
        console.log("Carregando modelo de", modelUrl);

        const loadedModel = (await tf.loadLayersModel(
          modelUrl,
        )) as tf.Sequential;
        console.log("Modelo carregado com sucesso do Supabase");

        loadedModel.compile({
          optimizer: tf.train.adam(0.0005), // Taxa de aprendizado menor para fine-tuning
          loss: "binaryCrossentropy",
          metrics: ["accuracy"],
        });

        console.log("Modelo recompilado para treinamento contínuo.");
        model = loadedModel;

        // Usar parâmetros de normalização carregados
        if (loadedNormalizationParams) {
          // Adicionar esta verificação
          xMean = tf.tensor1d(loadedNormalizationParams.mean);
          xStd = tf.tensor1d(loadedNormalizationParams.std);
        }
      } catch (error) {
        console.log(
          "Erro ao carregar ou validar modelo/normalização do Supabase, criando um novo:",
          error,
        );
        model = undefined; // Garantir que um novo modelo seja criado
        loadedNormalizationParams = null;
      }
    }

    // Calcular/Normalizar com base na disponibilidade dos parâmetros carregados
    if (
      loadedNormalizationParams &&
      loadedNormalizationParams.mean &&
      loadedNormalizationParams.std
    ) {
      // Se temos parâmetros carregados, usá-los
      xMean = tf.tensor1d(loadedNormalizationParams.mean);
      xStd = tf.tensor1d(loadedNormalizationParams.std);
      console.log(
        "Usando parâmetros de normalização carregados do modelo existente.",
      );
    } else {
      // Caso contrário, calcular novos parâmetros
      console.log("Calculando novos parâmetros de normalização.");

      // Garantir que xTrainTensorRaw está definido
      if (xTrainTensorRaw === undefined || xTrainTensorRaw === null) {
        throw new Error("Tensor de dados de treinamento não está definido.");
      }
      const tensor = xTrainTensorRaw as tf.Tensor2D;
      xMean = tensor.mean(0);

      // Usar tf.tidy sem acessar xMean ou xTrainTensorRaw com operador !
      xStd = tf.tidy(() => {
        // Garantir que xMean está definido
        if (!xMean) {
          return tf.scalar(1.0); // Valor padrão em caso de erro
        }

        // Usar xTrainTensorRaw diretamente, já verificamos que não é undefined acima
        const variance = tensor.square().mean(0).sub(xMean.square());
        return variance.sqrt().add(tf.scalar(1e-8));
      });
    }

    // Garantir que xMean, xStd e xTrainTensorRaw estão definidos
    if (!xMean || !xStd || !xTrainTensorRaw) {
      throw new Error(
        "Falha ao calcular ou carregar parâmetros de normalização.",
      );
    }
    // Usar type assertions para garantir ao TypeScript que os tensores têm os tipos corretos
    const inputTensor = xTrainTensorRaw as tf.Tensor2D; // Garantir que é Tensor2D
    const meanTensor = xMean as tf.Tensor1D; // Garantir que é Tensor1D
    const stdTensor = xStd as tf.Tensor1D; // Garantir que é Tensor1D

    // Agora podemos usar os tensores com segurança, sem operadores !
    normalizedXTrainTensor = tf.tidy(
      () => inputTensor.sub(meanTensor).div(stdTensor) as tf.Tensor2D,
    );

    // Criar novo modelo se necessário
    if (!model) {
      console.log("Criando novo modelo...");
      model = tf.sequential();
      model.add(
        tf.layers.dense({
          inputShape: [EXPECTED_FEATURE_KEYS.length], // Usar tamanho da lista explícita
          units: 64,
          activation: "relu",
        }),
      );
      model.add(tf.layers.dropout({ rate: 0.2 }));
      model.add(tf.layers.dense({ units: 32, activation: "relu" }));
      model.add(tf.layers.dropout({ rate: 0.2 }));
      model.add(tf.layers.dense({ units: 1, activation: "sigmoid" }));

      model.compile({
        optimizer: tf.train.adam(0.001),
        loss: "binaryCrossentropy",
        metrics: ["accuracy"],
      });

      console.log("Novo modelo criado e compilado.");
    }

    // 7. Treinar o modelo
    console.log("Iniciando o treinamento...");
    const history = await model.fit(normalizedXTrainTensor, yTrainTensor, {
      epochs: 50,
      batchSize: 32,
      validationSplit: 0.2,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          console.log(
            `Epoch ${epoch + 1}: loss = ${logs?.loss?.toFixed(4)}, acc = ${logs?.acc?.toFixed(4)}, val_loss = ${logs?.val_loss?.toFixed(4)}, val_acc = ${logs?.val_acc?.toFixed(4)}`,
          );
        },
      },
    });

    console.log("Treinamento concluído.");
    const finalAcc = history.history.acc[history.history.acc.length - 1];
    // Extrair valor numérico, seja de um tensor ou já de um número
    const finalAccValue =
      finalAcc instanceof tf.Tensor
        ? finalAcc.dataSync()[0]
        : (finalAcc as number);
    console.log(
      `Acurácia final: ${finalAccValue !== undefined ? finalAccValue.toFixed(4) : "N/A"}`,
    );

    // 8. Salvar o modelo e os parâmetros de normalização
    try {
      await ensureDir(LOCAL_TEMP_MODEL_DIR);

      // Salvar parâmetros de normalização
      await saveNormalizationParams(xMean, xStd, EXPECTED_FEATURE_KEYS);

      // Salvar o modelo
      await model.save(`file://${LOCAL_TEMP_MODEL_DIR}`);
      console.log(`Modelo salvo temporariamente em ${LOCAL_TEMP_MODEL_DIR}`);

      // Fazer upload para o Supabase
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
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
            cacheControl: "3600",
            upsert: true,
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
    } catch (saveError) {
      console.error("Erro ao salvar o modelo no Supabase:", saveError);
    }
  } catch (error) {
    console.error("Erro durante o treinamento:", error);
    throw error;
  } finally {
    // 9. Limpar recursos
    const tensorsToDispose = [
      xTrainTensorRaw,
      yTrainTensor,
      xMean,
      xStd,
      normalizedXTrainTensor,
    ].filter((t) => t !== undefined) as tf.Tensor[]; // Filtrar undefined antes de dispose

    if (tensorsToDispose.length > 0) {
      tf.dispose(tensorsToDispose);
    }

    if (model) {
      model.dispose();
      console.log("Recursos do modelo liberados.");
    }

    console.log("Treinamento finalizado.");
  }
};
