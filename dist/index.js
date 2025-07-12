"use strict";
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
exports.supabase = void 0;
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const node_cron_1 = __importDefault(require("node-cron"));
const supabase_js_1 = require("@supabase/supabase-js");
const mdb_DataRouter_1 = __importDefault(require("./router/mdb_DataRouter"));
const spb_DataRouter_1 = __importDefault(require("./router/spb_DataRouter"));
const tle_DataRouter_1 = __importDefault(require("./router/tle_DataRouter"));
const tsr_DataRouter_1 = __importDefault(require("./router/tsr_DataRouter"));
const upt_DataRouter_1 = __importDefault(require("./router/upt_DataRouter"));
const updateRacecard_hr_1 = require("./functions/spb_functions/update/updateRacecard_hr");
const updateLayPicks_1 = require("./functions/spb_functions/update/updateLayPicks");
const populateHorseFeatures_1 = __importDefault(require("./functions/spb_functions/features_v1/populateHorseFeatures"));
const claude_trainData_1 = require("./functions/tensor_functions/claude_trainData");
const populateLayPicks_1 = __importDefault(require("./functions/spb_functions/populate/populateLayPicks"));
dotenv_1.default.config();
const port = process.env.PORT || 3000;
const app = (0, express_1.default)();
// initBot();
app.use("/mdb_data", mdb_DataRouter_1.default);
app.use("/spb_data", spb_DataRouter_1.default);
app.use("/tle_data", tle_DataRouter_1.default);
app.use("/tsr_data", tsr_DataRouter_1.default);
app.use("/upt_data", upt_DataRouter_1.default);
app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    console.error(error);
    res.status(status).json({ message: error.message });
});
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "error";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "error";
exports.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
const uri = process.env.MONGOOSE || "error";
const execPipeline = () => __awaiter(void 0, void 0, void 0, function* () {
    console.log("🔁 Executando pipeline...");
    try {
        console.log("🔁 Executando updateRacecards_spb...");
        yield (0, updateRacecard_hr_1.updateRacecards_spb)();
        console.log("✅ updateRacecards_spb concluído");
        console.log("🔁 Executando updateLayPicks_spb...");
        yield (0, updateLayPicks_1.updateLayPicks_spb)();
        console.log("✅ updateLayPicks_spb concluído");
        console.log("🔁 Executando populateHorseFeature_spb...");
        yield (0, populateHorseFeatures_1.default)();
        console.log("✅ populateHorseFeature_spb concluído");
        console.log("🔁 Executando cl_trainData...");
        yield (0, claude_trainData_1.cl_trainData)();
        console.log("✅ cl_trainData concluído");
        console.log("🔁 Executando generateLayPicks...");
        yield populateLayPicks_1.default.generateLayPicks();
        console.log("✅ generateLayPicks concluído");
        return {
            success: true,
            message: "Pipeline executado com sucesso.",
        };
    }
    catch (error) {
        console.error("❌ Erro ao executar pipeline:", error);
        return {
            success: false,
            message: "Erro ao executar pipeline.",
        };
    }
});
const setupPipelineScheduler = () => {
    // Expressão cron: "0 23 * * *" significa "às 23:00 todos os dias"
    // Ajuste o horário conforme necessário para não conflitar com o outro processo.
    const cronExpression = "30 1 * * *";
    console.log(`[Scheduler] Agendando pipeline para rodar diariamente às ${cronExpression}`);
    node_cron_1.default.schedule(cronExpression, () => __awaiter(void 0, void 0, void 0, function* () {
        console.log(`[Scheduler] Horário atingido! Iniciando execução agendada do pipeline às ${new Date().toISOString()}`);
        // Chama a sua função de pipeline existente
        const result = yield execPipeline();
        console.log(`[Scheduler] Execução agendada concluída. Resultado: ${result.success ? "Sucesso" : "Falha"}`);
        if (!result.success) {
            console.error(`[Scheduler] Erro detalhado da execução agendada: ${result.message}`);
            // Aqui você pode adicionar lógicas de notificação de falha, se desejar.
        }
    }));
};
mongoose_1.default
    .connect(uri)
    .then(() => {
    app.listen(port, () => __awaiter(void 0, void 0, void 0, function* () {
        console.log("api on air");
        setupPipelineScheduler();
        // execPipeline().then((result) => {
        //   console.log(result);
        // });
    }));
})
    .catch((error) => {
    console.error("Erro ao conectar ao MongoDB:", error);
});
