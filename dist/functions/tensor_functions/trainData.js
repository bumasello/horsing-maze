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
exports.trainData = void 0;
const tf = __importStar(require("@tensorflow/tfjs-node"));
const loadData_1 = require("./loadData");
const __1 = require("../..");
const trainData = () => __awaiter(void 0, void 0, void 0, function* () {
    const races = yield (0, loadData_1.pendingRaces)();
    if (races.length === 0) {
        console.log("Nenhuma corrida pendente.");
        return;
    }
    const allEntries = races.flatMap((r) => r.features);
    const featureKeys = Object.keys(allEntries[0]).filter((k) => ![
        "id",
        "race_horse_id",
        "race_id",
        "target",
        "created_at",
        "updated_at",
    ].includes(k));
    const xs = allEntries.map((e) => featureKeys.map((k) => e[k]));
    const ys = allEntries.map((e) => e.target);
    // tensor
    const xTensor = tf.tensor2d(xs, [xs.length, featureKeys.length]);
    const yTensor = tf.tensor2d(ys, [ys.length, 1]);
    // modelo
    const model = tf.sequential();
    model.add(tf.layers.dense({
        inputShape: [featureKeys.length],
        units: 64,
        activation: "relu",
    }));
    model.add(tf.layers.dense({ units: 32, activation: "relu" }));
    model.add(tf.layers.dense({ units: 1, activation: "sigmoid" }));
    model.compile({
        optimizer: tf.train.adam(0.001),
        loss: "binaryCrossentropy",
        metrics: ["accuracy"],
    });
    yield model.fit(xTensor, yTensor, {
        epochs: 10,
        batchSize: 32,
        validationSplit: 0.2,
    });
    for (const { raceId, features } of races) {
        if (features.length === 0)
            continue;
        const input = tf.tensor2d(features.map((e) => featureKeys.map((k) => e[k])), [features.length, featureKeys.length]);
        const probs = model.predict(input, {
            batchSize: features.length,
        });
        const probArr = Array.from(probs.dataSync());
        const rows = features.map((e, i) => ({
            racecard_id: raceId,
            race_horse_id: e.race_horse_id,
            probability: probArr[i],
        }));
        const { error: insertError } = yield __1.supabase
            .from("race_predictions")
            .insert(rows);
        if (insertError) {
            throw new Error(`Erro salvando previsões: ${insertError}`);
            continue;
        }
        const maxIdx = probArr.indexOf(Math.max(...probArr));
        const loser = features[maxIdx];
        console.log(`Corrida ${raceId} (${features.length} candidatos):` +
            ` cavalo '${loser.race_horse_id}' com prob. ${(probArr[maxIdx] * 100).toFixed(1)}% de NÃO vencer.`);
    }
    console.log("Previsões salvas com sucesso.");
});
exports.trainData = trainData;
