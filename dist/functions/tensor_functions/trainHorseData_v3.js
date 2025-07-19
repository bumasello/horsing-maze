"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.trainHorseData_v3 = void 0;
const tf = __importStar(require("@tensorflow/tfjs-node"));
const node_fs_1 = __importDefault(require("node:fs"));
const __1 = require("../..");
function loadTrainingData() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Carregando features de treinamento do Supabase...");
        const { data: trainingFeatures, error } = yield __1.supabase
            .schema("hml")
            .from("training_horse_features")
            .select("*");
        if (error) {
            throw new Error(`Erro ao buscar features de treinamento: ${error.message}`);
        }
        if (!trainingFeatures || trainingFeatures.length === 0) {
            throw new Error("Nenhuma feature de treinamento encontrada.");
        }
        const typedTrainingFeatures = trainingFeatures;
        // Calcular contagem de classes para pesos
        const classCounts = trainingFeatures.reduce((acc, feature) => {
            acc[feature.target] = (acc[feature.target] || 0) + 1;
            return acc;
        }, {});
        const totalSamples = trainingFeatures.length;
        const numClasses = Object.keys(classCounts).length;
        const classWeights = {};
        for (const classIdStr in classCounts) {
            const classId = Number(classIdStr); // Converter para número
            classWeights[classId] =
                totalSamples / (numClasses * classCounts[classIdStr]);
        }
        console.log("Pesos de classe calculados:", classWeights);
        // Assumindo que as featureKeys são as mesmas que você me forneceu anteriormente
        const featureKeys = [
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
        const xs = typedTrainingFeatures.map((f) => featureKeys.map((key) => {
            const value = f[key];
            return value === null || value === undefined ? 0 : value;
        }));
        const ys = typedTrainingFeatures.map((f) => f.target);
        const xTensor = tf.tensor2d(xs);
        const yTensor = tf.tensor2d(ys, [ys.length, 1]);
        // Calcular normalização (mean e std) dos dados de treinamento usando tf.moments
        const { mean, variance } = tf.moments(xTensor, 0);
        const std = tf.sqrt(variance).arraySync();
        // Evitar divisão por zero para features com std = 0
        const safeStd = std.map((s) => (s === 0 ? 1e-7 : s));
        const normalization = {
            mean: mean.arraySync(),
            std: safeStd,
            featureKeys,
        };
        // Normalizar os dados de treinamento
        const normalizedXs = xTensor.sub(mean).div(safeStd);
        // Descartar tensores temporários
        mean.dispose();
        variance.dispose();
        return { xs: normalizedXs, ys: yTensor, normalization, classWeights };
    });
}
// Função para treinar o modelo
const trainHorseData_v3 = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("Iniciando treinamento do modelo de probabilidade de cavalos...");
        const { xs, ys, normalization, classWeights } = yield loadTrainingData();
        // Definir a arquitetura do modelo
        const model = tf.sequential({
            layers: [
                tf.layers.dense({
                    units: 128,
                    activation: "relu",
                    inputShape: [xs.shape[1]],
                }),
                tf.layers.batchNormalization(),
                tf.layers.dropout({ rate: 0.3 }),
                tf.layers.dense({ units: 64, activation: "relu" }),
                tf.layers.batchNormalization(),
                tf.layers.dropout({ rate: 0.3 }),
                tf.layers.dense({ units: 32, activation: "relu" }),
                tf.layers.dropout({ rate: 0.2 }),
                tf.layers.dense({ units: 1, activation: "sigmoid" }),
            ],
        });
        // Compilar o modelo com otimizador e função de perda
        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: "binaryCrossentropy",
            metrics: ["accuracy"],
        });
        // Treinar o modelo com pesos de classe
        console.log("Treinando o modelo...");
        yield model.fit(xs, ys, {
            epochs: 100, // Ajuste conforme necessário
            batchSize: 32, // Ajuste conforme necessário
            validationSplit: 0.2, // Usar 20% dos dados para validação
            callbacks: tf.callbacks.earlyStopping({
                monitor: "val_loss",
                patience: 10,
                mode: "min",
            }),
            classWeight: classWeights, // Aplicar pesos de classe aqui
        });
        console.log("Treinamento concluído. Salvando modelo e normalização...");
        // Salvar o modelo localmente
        const AGENT_MODEL_NAME = "GEMINI_1_5_PRO"; // Substitua pelo nome do seu modelo/agente
        const timestamp = new Date()
            .toISOString()
            .replace(/\.\d{3}Z$/, "Z")
            .replace(/[:.-]/g, "");
        const modelVersionDir = `./src/functions/tensor_functions/${AGENT_MODEL_NAME}/${timestamp}`;
        if (!node_fs_1.default.existsSync(modelVersionDir)) {
            node_fs_1.default.mkdirSync(modelVersionDir, { recursive: true });
        }
        const modelSavePath = `file://${modelVersionDir}`;
        yield model.save(modelSavePath);
        console.log(`Modelo salvo localmente em: ${modelSavePath}`);
        // Salvar os parâmetros de normalização localmente
        const normalizationSavePath = `${modelVersionDir}/normalization.json`;
        node_fs_1.default.writeFileSync(normalizationSavePath, JSON.stringify(normalization));
        console.log(`Parâmetros de normalização salvos localmente em: ${normalizationSavePath}`);
        console.log("Iniciando upload do modelo e normalização para Supabase Storage...");
        // Caminhos para upload no Supabase Storage
        const supabaseModelPath = `horse_probability_model/${AGENT_MODEL_NAME}/${timestamp}/model.json`;
        const supabaseWeightsPath = `horse_probability_model/${AGENT_MODEL_NAME}/${timestamp}/weights.bin`;
        const supabaseNormalizationPath = `horse_probability_model/${AGENT_MODEL_NAME}/${timestamp}/normalization.json`;
        // Upload do model.json
        const modelJsonContent = node_fs_1.default.readFileSync(`${modelVersionDir}/model.json`);
        const { error: modelUploadError } = yield __1.supabase.storage
            .from("modelos-tfjs-publicos")
            .upload(supabaseModelPath, modelJsonContent, {
            upsert: true,
        });
        if (modelUploadError) {
            throw new Error(`Erro ao fazer upload de model.json: ${modelUploadError.message}`);
        }
        console.log("model.json uploaded to Supabase Storage.");
        // Upload do weights.bin
        const weightsBinContent = node_fs_1.default.readFileSync(`${modelVersionDir}/weights.bin`);
        const { error: weightsUploadError } = yield __1.supabase.storage
            .from("modelos-tfjs-publicos")
            .upload(supabaseWeightsPath, weightsBinContent, {
            upsert: true,
        });
        if (weightsUploadError) {
            throw new Error(`Erro ao fazer upload de weights.bin: ${weightsUploadError.message}`);
        }
        console.log("weights.bin uploaded to Supabase Storage.");
        // Upload do normalization.json
        const normalizationContent = node_fs_1.default.readFileSync(normalizationSavePath);
        const { error: normUploadError } = yield __1.supabase.storage
            .from("modelos-tfjs-publicos")
            .upload(supabaseNormalizationPath, normalizationContent, {
            upsert: true,
        });
        if (normUploadError) {
            throw new Error(`Erro ao fazer upload de normalization.json: ${normUploadError.message}`);
        }
        console.log("normalization.json uploaded to Supabase Storage.");
        console.log("Upload para Supabase Storage concluído com sucesso.");
        // Limpar tensores
        xs.dispose();
        ys.dispose();
        model.dispose();
    }
    catch (error) {
        console.error("Erro no treinamento do modelo:", error);
        throw error;
    }
});
exports.trainHorseData_v3 = trainHorseData_v3;
