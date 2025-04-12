"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initBot = exports.bot = void 0;
const express_1 = __importDefault(require("express"));
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const dotenv_1 = __importDefault(require("dotenv"));
const tleController_1 = require("../controller/tleController");
const tle_userModel_1 = require("../models/modelTle/tle_userModel");
const router = express_1.default.Router();
dotenv_1.default.config();
const token = process.env.TELEGRAMKEY || "error";
exports.bot = new node_telegram_bot_api_1.default(token, { polling: true });
const initBot = () => {
    console.log("Bot telegram iniciado");
    exports.bot.onText(/\/start/, (msg) => {
        var _a;
        const chatId = msg.chat.id;
        const username = (_a = msg.from) === null || _a === void 0 ? void 0 : _a.username;
        tle_userModel_1.tleUserModel.addUser({
            chatId,
            username,
            registeredAt: new Date(),
        });
        exports.bot.sendMessage(chatId, `Olá ${username}, você foi registrado!🥵 😅`);
        console.log("Novo usuário: ", chatId);
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
