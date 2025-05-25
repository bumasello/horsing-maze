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
Object.defineProperty(exports, "__esModule", { value: true });
exports.cl_trainData = void 0;
const tf = __importStar(require("@tensorflow/tfjs-node"));
const loadData_1 = require("./loadData");
const __1 = require("../..");
const cl_trainData = () => __awaiter(void 0, void 0, void 0, function* () {
    // Carregar dados de treinamento (corridas já finalizadas)
    const trainingData = yield (0, loadData_1.loadTrainingData)();
    if (trainingData.length === 0) {
        console.log("Sem dados de treinamento suficientes.");
        return;
    }
    // Carregar corridas pendentes para previsão
    const races = yield (0, loadData_1.pendingRaces)();
    if (races.length === 0) {
        console.log("Nenhuma corrida pendente.");
        return;
    }
    // Extrair características (features) para treinamento
    const featureKeys = Object.keys(trainingData[0]).filter((k) => ![
        "id",
        "race_horse_id",
        "race_id",
        "target",
        "created_at",
        "updated_at",
    ].includes(k));
    // Preparar dados de treinamento
    const xs = trainingData.map((e) => featureKeys.map((k) => e[k]));
    const ys = trainingData.map((e) => e.target);
    // Normalizar dados para melhorar o treinamento
    const xsArray = xs.map((arr) => arr.map((val) => (isNaN(val) ? 0 : val))); // Replace NaN with 0
    const xTensor = tf.tensor2d(xsArray);
    // Calcular média e desvio padrão manualmente
    const xMean = xTensor.mean(0);
    // Para o desvio padrão, vamos usar uma abordagem alternativa
    const xSquared = xTensor.square();
    const xSquaredMean = xSquared.mean(0);
    const xMeanSquared = xMean.square();
    const xStd = xSquaredMean.sub(xMeanSquared).sqrt().add(tf.scalar(1e-8));
    // Normalizar os dados de treinamento
    const normalizedXs = xTensor.sub(xMean).div(xStd);
    const yTensor = tf.tensor2d(ys.map((y) => (isNaN(y) ? 0 : y)), [ys.length, 1]);
    // Criar e treinar o modelo
    const model = tf.sequential();
    model.add(tf.layers.dense({
        inputShape: [featureKeys.length],
        units: 64,
        activation: "relu",
    }));
    model.add(tf.layers.dropout({ rate: 0.2 })); // Corrigido para usar objeto
    model.add(tf.layers.dense({ units: 32, activation: "relu" }));
    model.add(tf.layers.dropout({ rate: 0.2 })); // Corrigido para usar objeto
    model.add(tf.layers.dense({ units: 1, activation: "sigmoid" }));
    model.compile({
        optimizer: tf.train.adam(0.001),
        loss: "binaryCrossentropy",
        metrics: ["accuracy"],
    });
    // Treinar o modelo
    const history = yield model.fit(normalizedXs, yTensor, {
        epochs: 50,
        batchSize: 32,
        validationSplit: 0.2,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                console.log(`Epoch ${epoch}: loss = ${logs === null || logs === void 0 ? void 0 : logs.loss.toFixed(4)}, accuracy = ${logs === null || logs === void 0 ? void 0 : logs.acc.toFixed(4)}`);
            },
        },
    });
    console.log(`Modelo treinado com acurácia: ${history.history.acc[history.history.acc.length - 1]}`);
    // Fazer previsões para corridas pendentes
    for (const { raceId, features } of races) {
        if (features.length === 0)
            continue;
        // Preparar dados de entrada para previsão
        const inputData = features.map((e) => featureKeys
            .map((k) => e[k])
            .map((val) => (isNaN(val) ? 0 : val)));
        // Normalizar os dados de entrada usando as mesmas estatísticas
        const inputTensor = tf.tensor2d(inputData);
        const normalizedInput = inputTensor.sub(xMean).div(xStd);
        // Fazer previsões
        const probs = model.predict(normalizedInput, {
            batchSize: features.length,
        });
        // Converter para array
        const probArr = Array.from(probs.dataSync());
        // Preparar resultados para salvar no banco
        const rows = features.map((e, i) => ({
            racecard_id: raceId,
            race_horse_id: e.race_horse_id,
            probability: probArr[i], // Probabilidade de não vencer
        }));
        // Limpar registros existentes antes de inserir novos
        const { error: deleteError } = yield __1.supabase
            .from("race_predictions")
            .delete()
            .eq("racecard_id", raceId);
        if (deleteError) {
            console.error(`Erro ao limpar previsões existentes: ${deleteError.message}`);
        }
        // Inserir novas previsões
        const { error: insertError } = yield __1.supabase
            .from("race_predictions")
            .insert(rows);
        if (insertError) {
            console.error(`Erro salvando previsões: ${insertError.message}`);
            continue;
        }
        // Identificar o cavalo com maior probabilidade de perder
        const maxIdx = probArr.indexOf(Math.max(...probArr));
        const loser = features[maxIdx];
        console.log(`Corrida ${raceId} (${features.length} candidatos):` +
            ` cavalo '${loser.race_horse_id}' com prob. ${(probArr[maxIdx] * 100).toFixed(1)}% de NÃO vencer.`);
        // Log de todas as probabilidades para verificação
        console.log("Probabilidades para cada cavalo:");
        features.forEach((f, i) => {
            console.log(`Cavalo ${f.race_horse_id}: ${(probArr[i] * 100).toFixed(2)}%`);
        });
    }
    // Limpar tensores para evitar memory leaks
    xTensor.dispose();
    xMean.dispose();
    xStd.dispose();
    xSquared.dispose();
    xSquaredMean.dispose();
    xMeanSquared.dispose();
    normalizedXs.dispose();
    yTensor.dispose();
    model.dispose();
    console.log("Previsões salvas com sucesso.");
});
exports.cl_trainData = cl_trainData;
