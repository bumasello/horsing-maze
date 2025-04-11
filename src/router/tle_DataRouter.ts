import express from "express";
import telegrambot from "node-telegram-bot-api";
import dotenv from "dotenv";

import { message, message2 } from "../controller/tleController";
import { tleUserModel } from "../models/modelTle/tle_userModel";

import type { Response, Request, NextFunction } from "express";

const router = express.Router();

dotenv.config();
const token = process.env.TELEGRAMKEY || "error";

export const bot = new telegrambot(token, { polling: true });

export const initBot = (): void => {
  console.log("Bot telegram iniciado");

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from?.username;

    tleUserModel.addUser({
      chatId,
      username,
      registeredAt: new Date(),
    });

    bot.sendMessage(chatId, `Olá ${username}, você foi registrado!🥵 😅`);
    console.log("Novo usuário: ", chatId);
  });
};

router.post("/test", (req: Request, res: Response, next: NextFunction) => {
  const chatIds = tleUserModel.getAllChatIds();
  let success = 0;
  let failed = 0;

  console.log(`Iniciando broadcast para ${chatIds.length} usuários`);

  // Envia a mensagem para cada usuário registrado
  for (const chatId of chatIds) {
    try {
      bot.sendMessage(chatId, "oie");
      success++;
    } catch (error) {
      console.error(`Falha ao enviar mensagem para ${chatId}:`, error);
      failed++;
    }
  }
});

router.post(
  "/test2",
  message2,
  (req: Request, res: Response, next: NextFunction) => {
    const chatIds = tleUserModel.getAllChatIds();
    let success = 0;
    let failed = 0;

    console.log(`Iniciando broadcast para ${chatIds.length} usuários`);

    // Envia a mensagem para cada usuário registrado
    for (const chatId of chatIds) {
      try {
        bot.sendMessage(chatId, message);
        success++;
      } catch (error) {
        console.error(`Falha ao enviar mensagem para ${chatId}:`, error);
        failed++;
      }
    }

    res.status(200).json({ message: "mensagem enviada" });
  },
);

export default router;
