interface User {
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  registeredAt: Date;
}

// Classe para gerenciar usuários
class UserModel {
  private users: Map<number, User>;

  constructor() {
    this.users = new Map<number, User>();
  }

  // Adicionar ou atualizar usuário
  addUser(user: User): void {
    this.users.set(user.chatId, user);
    console.log(`Usuário ${user.chatId} adicionado/atualizado`);
  }

  // Verificar se um usuário existe
  hasUser(chatId: number): boolean {
    return this.users.has(chatId);
  }

  // Obter todos os chatIds
  getAllChatIds(): number[] {
    return Array.from(this.users.keys());
  }

  // Obter informações de um usuário
  getUser(chatId: number): User | undefined {
    return this.users.get(chatId);
  }

  // Obter contagem de usuários
  getUserCount(): number {
    return this.users.size;
  }
}

export const tleUserModel = new UserModel();
