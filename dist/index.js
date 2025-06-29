"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const supabase_js_1 = require("@supabase/supabase-js");
const mdb_DataRouter_1 = __importDefault(require("./router/mdb_DataRouter"));
const spb_DataRouter_1 = __importDefault(require("./router/spb_DataRouter"));
const tle_DataRouter_1 = __importDefault(require("./router/tle_DataRouter"));
const tsr_DataRouter_1 = __importDefault(require("./router/tsr_DataRouter"));
const upt_DataRouter_1 = __importDefault(require("./router/upt_DataRouter"));
const pipeline_1 = require("./pipeline/pipeline");
dotenv_1.default.config();
const port = process.env.PORT || 3000;
const app = (0, express_1.default)();
// initBot();
// Endpoint de health check para manter o serviço ativo
app.get("/health", (_req, res) => {
    const now = new Date();
    console.log(`[HEALTH] Health check realizado às ${now.toISOString()}`);
    res.status(200).json({
        status: "OK",
        timestamp: now.toISOString(),
        uptime: process.uptime(),
    });
});
// Endpoint para verificar o status do agendamento
app.get("/cron-status", (_req, res) => {
    const now = new Date();
    console.log(`[CRON] Status do agendamento verificado às ${now.toISOString()}`);
    res.status(200).json({
        status: "OK",
        timestamp: now.toISOString(),
        nextScheduledTime: getNextScheduledTime(),
        timezone: {
            serverTime: now.toISOString(),
            utcOffset: now.getTimezoneOffset(),
        },
    });
});
// Função para calcular o próximo horário agendado (22:00 UTC)
function getNextScheduledTime() {
    const now = new Date();
    const nextRun = new Date();
    // Configurar para 22:00 UTC
    nextRun.setUTCHours(22, 0, 0, 0);
    // Se já passou das 22:00 UTC hoje, agendar para amanhã
    if (now.getUTCHours() >= 22) {
        nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    }
    return nextRun.toISOString();
}
// Rotas da API (comentadas conforme seu código)
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
mongoose_1.default.connect(uri).then(() => {
    app.listen(port, () => {
        console.log(`API ativa na porta ${port} às ${new Date().toISOString()}`);
        (0, pipeline_1.runPipeline)().then((result) => {
            console.log(result);
        });
    });
});
