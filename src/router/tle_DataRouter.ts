import express from "express";
import telegrambot, { Message } from "node-telegram-bot-api";
import dotenv from "dotenv";

import { message, message2 } from "../controller/tleController";
import { tleUserModel } from "../models/modelTle/tle_userModel";

import type { Response, Request, NextFunction } from "express";

const router = express.Router();

dotenv.config();
const token = process.env.TELEGRAMKEY || "error";

export const bot = new telegrambot(token, { polling: true });
export const pendingEmail = new Map<number, true>();

export const initBot = (): void => {
  console.log("Bot telegram iniciado");

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    const firstName = msg.from?.first_name;
    const lastName = msg.from?.last_name;

    tleUserModel.addUser({
      chatId,
      username,
      firstName,
      lastName,
      active: false,
      registeredAt: new Date(),
    });

    pendingEmail.set(chatId, true);

    bot.sendMessage(
      chatId,
      `Olá ${username}, você foi registrado! Para terminar seu cadastro, por favor, envie seu melhor email.`,
    );

    bot.on("message", (msg: Message) => {
      const chatId = msg.chat.id;
      const text = msg.text?.trim();
      if (!text || !pendingEmail.has(chatId)) return;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) {
        bot.sendMessage(chatId, "❌ E‑mail inválido. Tente novamente:");
        pendingEmail.delete(chatId);
        return;
      }

      try {
        tleUserModel.updateUser(chatId, {
          email: text,
          active: true,
        });
        pendingEmail.delete(chatId);
        bot.sendMessage(
          chatId,
          `✅ Cadastro finalizado!\nE‑mail: ${text}\nStatus: ativo`,
        );
        console.log("Novo usuário: ", chatId);
      } catch (err) {
        console.log(err);
        bot.sendMessage(
          chatId,
          "! Ocorreu um erro ao salvar seu e‑mail. Por favor, envie /start novamente.",
        );
      }
    });
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
