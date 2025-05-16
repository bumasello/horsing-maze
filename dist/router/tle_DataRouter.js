"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initBot = exports.pendingEmail = exports.bot = void 0;
const express_1 = __importDefault(require("express"));
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const dotenv_1 = __importDefault(require("dotenv"));
const tleController_1 = require("../controller/tleController");
const tle_userModel_1 = require("../models/modelTle/tle_userModel");
const router = express_1.default.Router();
dotenv_1.default.config();
const token = process.env.TELEGRAMKEY || "error";
exports.bot = new node_telegram_bot_api_1.default(token, { polling: true });
exports.pendingEmail = new Map();
const initBot = () => {
    console.log("Bot telegram iniciado");
    exports.bot.onText(/\/start/, (msg) => {
        var _a, _b, _c;
        const chatId = msg.chat.id;
        const username = (_a = msg.from) === null || _a === void 0 ? void 0 : _a.username;
        const firstName = (_b = msg.from) === null || _b === void 0 ? void 0 : _b.first_name;
        const lastName = (_c = msg.from) === null || _c === void 0 ? void 0 : _c.last_name;
        tle_userModel_1.tleUserModel.addUser({
            chatId,
            username,
            firstName,
            lastName,
            active: false,
            registeredAt: new Date(),
        });
        exports.pendingEmail.set(chatId, true);
        exports.bot.sendMessage(chatId, `Olá ${username}, você foi registrado! Para terminar seu cadastro, por favor, envie seu melhor email.`);
        exports.bot.on("message", (msg) => {
            var _a;
            const chatId = msg.chat.id;
            const text = (_a = msg.text) === null || _a === void 0 ? void 0 : _a.trim();
            if (!text || !exports.pendingEmail.has(chatId))
                return;
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(text)) {
                exports.bot.sendMessage(chatId, "❌ E‑mail inválido. Tente novamente:");
                exports.pendingEmail.delete(chatId);
                return;
            }
            try {
                tle_userModel_1.tleUserModel.updateUser(chatId, {
                    email: text,
                    active: true,
                });
                exports.pendingEmail.delete(chatId);
                exports.bot.sendMessage(chatId, `✅ Cadastro finalizado!\nE‑mail: ${text}\nStatus: ativo`);
                console.log("Novo usuário: ", chatId);
            }
            catch (err) {
                console.log(err);
                exports.bot.sendMessage(chatId, "! Ocorreu um erro ao salvar seu e‑mail. Por favor, envie /start novamente.");
            }
        });
    });
};
exports.initBot = initBot;
router.post("/test", (req, res, next) => {
    const chatIds = tle_userModel_1.tleUserModel.getAllChatIds();
    let success = 0;
    let failed = 0;
    console.log(`Iniciando broadcast para ${chatIds.length} usuários`);
    // Envia a mensagem para cada usuário registrado
    for (const chatId of chatIds) {
        try {
            exports.bot.sendMessage(chatId, "oie");
            success++;
        }
        catch (error) {
            console.error(`Falha ao enviar mensagem para ${chatId}:`, error);
            failed++;
        }
    }
});
router.post("/test2", tleController_1.message2, (req, res, next) => {
    const chatIds = tle_userModel_1.tleUserModel.getAllChatIds();
    let success = 0;
    let failed = 0;
    console.log(`Iniciando broadcast para ${chatIds.length} usuários`);
    // Envia a mensagem para cada usuário registrado
    for (const chatId of chatIds) {
        try {
            exports.bot.sendMessage(chatId, tleController_1.message);
            success++;
        }
        catch (error) {
            console.error(`Falha ao enviar mensagem para ${chatId}:`, error);
            failed++;
        }
    }
    res.status(200).json({ message: "mensagem enviada" });
});
exports.default = router;
