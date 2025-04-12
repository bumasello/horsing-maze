"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tleUserModel = void 0;
// Classe para gerenciar usuários
class UserModel {
    constructor() {
        this.users = new Map();
    }
    // Adicionar ou atualizar usuário
    addUser(user) {
        this.users.set(user.chatId, user);
        console.log(`Usuário ${user.chatId} adicionado/atualizado`);
    }
    // Verificar se um usuário existe
    hasUser(chatId) {
        return this.users.has(chatId);
    }
    // Obter todos os chatIds
    getAllChatIds() {
        return Array.from(this.users.keys());
    }
    // Obter informações de um usuário
    getUser(chatId) {
        return this.users.get(chatId);
    }
    // Obter contagem de usuários
    getUserCount() {
        return this.users.size;
    }
}
exports.tleUserModel = new UserModel();
