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
exports.generatePredictions = void 0;
exports.normalizeFeatures = normalizeFeatures;
const tf = __importStar(require("@tensorflow/tfjs-node"));
const __1 = require("../../..");
const trainHorseData_v2_1 = require("../../tensor_functions/trainHorseData_v2");
// Função normalizeFeatures corrigida para usar todos os parâmetros
function normalizeFeatures(xTensor, normalization) {
    const xMean = tf.tensor1d(normalization.mean);
    const xStd = tf.tensor1d(normalization.std);
    return tf.tidy(() => {
        const normalized = xTensor.sub(xMean).div(xStd);
        // Limpar tensores temporários
        xMean.dispose();
        xStd.dispose();
        return normalized;
    });
}
// Função para carregar o modelo e os parâmetros de normalização
function loadModelAndNormalization() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Obter os caminhos do modelo e dos parâmetros de normalização
            const modelPaths = yield (0, trainHorseData_v2_1.getLatestModelPathFromSupabase)();
            if (!modelPaths) {
                console.log("Nenhum modelo encontrado no Supabase.");
                return null;
            }
            // Verificar se modelPaths é um objeto com modelJsonPath e normJsonPath
            if (typeof modelPaths === "object" &&
                modelPaths !== null &&
                "modelJsonPath" in modelPaths &&
                "normJsonPath" in modelPaths) {
                // Fazer cast explícito para o tipo ModelPaths
                const paths = modelPaths;
                // Obter URLs públicas
                const { data: modelUrlData } = __1.supabase.storage
                    .from("modelos-tfjs-publicos")
                    .getPublicUrl(paths.modelJsonPath);
                const { data: normUrlData } = __1.supabase.storage
                    .from("modelos-tfjs-publicos")
                    .getPublicUrl(paths.normJsonPath);
                if (!(modelUrlData === null || modelUrlData === void 0 ? void 0 : modelUrlData.publicUrl) || !(normUrlData === null || normUrlData === void 0 ? void 0 : normUrlData.publicUrl)) {
                    throw new Error("Falha ao obter URLs públicas do modelo ou parâmetros de normalização.");
                }
                // Carregar o modelo
                console.log(`Carregando modelo de ${modelUrlData.publicUrl}`);
                const model = yield tf.loadLayersModel(modelUrlData.publicUrl);
                // Carregar os parâmetros de normalização
                console.log(`Carregando parâmetros de normalização de ${normUrlData.publicUrl}`);
                const normResponse = yield fetch(normUrlData.publicUrl);
                if (!normResponse.ok) {
                    throw new Error(`Erro ao buscar normalization.json: ${normResponse.statusText}`);
                }
                const normalization = (yield normResponse.json());
                return { model, normalization };
            }
            // Se modelPaths for uma string (caminho direto do modelo)
            if (typeof modelPaths === "string") {
                // Obter URL pública do modelo
                const { data: modelUrlData } = __1.supabase.storage
                    .from("modelos-tfjs-publicos")
                    .getPublicUrl(modelPaths);
                if (!(modelUrlData === null || modelUrlData === void 0 ? void 0 : modelUrlData.publicUrl)) {
                    throw new Error("Falha ao obter URL pública do modelo.");
                }
                // Carregar o modelo
                console.log(`Carregando modelo de ${modelUrlData.publicUrl}`);
                const model = yield tf.loadLayersModel(modelUrlData.publicUrl);
                // Tentar carregar os parâmetros de normalização
                const normJsonPath = modelPaths.replace("model.json", "normalization.json");
                const { data: normUrlData } = __1.supabase.storage
                    .from("modelos-tfjs-publicos")
                    .getPublicUrl(normJsonPath);
                if (!(normUrlData === null || normUrlData === void 0 ? void 0 : normUrlData.publicUrl)) {
                    throw new Error("Falha ao obter URL pública dos parâmetros de normalização.");
                }
                const normResponse = yield fetch(normUrlData.publicUrl);
                if (!normResponse.ok) {
                    throw new Error(`Erro ao buscar normalization.json: ${normResponse.statusText}`);
                }
                const normalization = (yield normResponse.json());
                return { model, normalization };
            }
            throw new Error("Formato de caminho do modelo não reconhecido.");
        }
        catch (error) {
            console.error("Erro ao carregar modelo e parâmetros de normalização:", error);
            return null;
        }
    });
}
const generatePredictions = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("Iniciando geração de previsões com o modelo treinado...");
        // 1. Carregar o modelo treinado mais recente e os parâmetros de normalização
        console.log("Carregando modelo treinado mais recente...");
        const loadedModel = yield loadModelAndNormalization();
        if (!loadedModel) {
            throw new Error("Nenhum modelo treinado encontrado. Execute o treinamento primeiro.");
        }
        const { model, normalization } = loadedModel;
        // 2. Buscar features de previsão da tabela
        console.log("Buscando features de previsão...");
        const { data: predictionFeatures, error: featuresError } = yield __1.supabase
            .schema("hml")
            .from("prediction_horse_features")
            .select("*");
        if (featuresError) {
            throw new Error(`Erro ao buscar features de previsão: ${JSON.stringify(featuresError)}`);
        }
        if (!predictionFeatures || predictionFeatures.length === 0) {
            console.log("Nenhuma feature de previsão encontrada. Execute generatePredictionFeatures() primeiro.");
            return;
        }
        console.log(`Encontradas ${predictionFeatures.length} features de previsão para processamento.`);
        console.log("LOG: predictionFeatures (primeiros 5):", predictionFeatures.slice(0, 5));
        // 3. Agrupar features por corrida
        const featuresByRace = {};
        for (const feature of predictionFeatures) {
            if (!featuresByRace[feature.race_id]) {
                featuresByRace[feature.race_id] = [];
            }
            featuresByRace[feature.race_id].push(feature);
        }
        // 4. Para cada corrida, fazer previsões
        for (const raceId in featuresByRace) {
            const raceFeatures = featuresByRace[raceId];
            console.log(`Processando previsões para corrida ${raceId} (${raceFeatures.length} cavalos)...`);
            // Usar as features definidas nos parâmetros de normalização
            const featureKeys = normalization.featureKeys;
            if (!featureKeys || featureKeys.length === 0) {
                throw new Error("Lista de features não encontrada nos parâmetros de normalização.");
            }
            // Preparar dados para o modelo
            const xs = raceFeatures.map((e) => featureKeys.map((k) => {
                const value = e[k];
                return value === null || value === undefined ? 0 : value;
            }));
            console.log("LOG: xs (primeiros 5, antes da normalização):", xs.slice(0, 5));
            // Normalizar os dados (usando as mesmas estatísticas do treinamento)
            const xsArray = xs.map((arr) => arr.map((val) => (Number.isNaN(val) ? 0 : val)));
            const xTensor = tf.tensor2d(xsArray);
            // Aplicar a mesma normalização usada no treinamento
            const normalizedInput = normalizeFeatures(xTensor, normalization);
            console.log("LOG: normalizedInput (após normalização):", normalizedInput.arraySync());
            // Fazer previsões com o modelo
            const probsTensor = model.predict(normalizedInput);
            const probArr = Array.from(probsTensor.dataSync());
            console.log("LOG: probsTensor (após previsão):", probsTensor.arraySync());
            console.log("LOG: probArr (após previsão):", probArr);
            // Verificar se TODAS as probabilidades são EXATAMENTE 1
            const allExactlyOne = probArr.every((p) => p === 1);
            console.log("LOG: allExactlyOne:", allExactlyOne);
            // Apenas se todas as probabilidades forem exatamente 1, aplicar a lógica alternativa
            if (allExactlyOne) {
                console.warn("ALERTA: Todas as probabilidades são exatamente 1. Aplicando lógica alternativa.");
                // Usar OR rating para diferenciar os cavalos apenas neste caso extremo
                const orRatings = raceFeatures.map((f) => f.or_rating || 0);
                const maxRating = Math.max(...orRatings);
                const minRating = Math.min(...orRatings);
                if (maxRating > minRating) {
                    for (let i = 0; i < probArr.length; i++) {
                        // Inverter a escala (maior OR rating = menor probabilidade de perder)
                        const normalizedRating = (orRatings[i] - minRating) / (maxRating - minRating);
                        // Ajustar probabilidade para estar entre 0.9 e 0.99
                        probArr[i] = 0.9 + normalizedRating * 0.09;
                    }
                    console.log("Probabilidades ajustadas com base no OR rating devido a erro no modelo.");
                    console.log("LOG: probArr (após lógica alternativa):", probArr);
                }
            }
            // Preparar resultados para salvar
            const predictions = raceFeatures.map((feature, i) => ({
                racecard_id: Number.parseInt(raceId),
                race_horse_id: feature.race_horse_id,
                probability: probArr[i],
            }));
            console.log("LOG: predictions (antes de salvar no Supabase):", predictions);
            // Limpar previsões existentes para esta corrida
            const { error: deleteError } = yield __1.supabase
                .schema("hml")
                .from("horse_predictions")
                .delete()
                .eq("racecard_id", raceId);
            if (deleteError) {
                console.error(`Erro ao limpar previsões existentes: ${deleteError.message}`);
            }
            // Salvar novas previsões
            const { error: insertError } = yield __1.supabase
                .schema("hml")
                .from("horse_predictions")
                .insert(predictions);
            if (insertError) {
                throw new Error(`Erro salvando previsões para corrida ${raceId}: ${insertError.message}`);
            }
            // Identificar o cavalo com maior probabilidade de perder
            const maxIdx = probArr.indexOf(Math.max(...probArr));
            const loser = raceFeatures[maxIdx];
            console.log(`Corrida ${raceId} (${raceFeatures.length} candidatos):` +
                ` cavalo \'${loser.race_horse_id}\' com prob. ${(probArr[maxIdx] * 100).toFixed(1)}% de NÃO vencer.`);
            // Limpar tensores
            tf.dispose([xTensor, normalizedInput, probsTensor]);
        }
        console.log("Geração de previsões concluída com sucesso.");
    }
    catch (error) {
        console.error("Erro na geração de previsões:", error);
        throw error;
    }
});
exports.generatePredictions = generatePredictions;
