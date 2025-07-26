"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeGoing = void 0;
const encodeGoing = (going) => {
    if (!going) {
        console.log("Sem going");
        return 4; // Valor padrão: Good
    }
    const goingLower = going.toLowerCase().trim();
    // Mapeamento direto para casos exatos (mais rápido)
    const exactMap = {
        hard: 1,
        fast: 2,
        firm: 3,
        good: 4,
        "good to firm": 5,
        "good-good to yielding": 6,
        "yielding to soft": 7,
        yielding: 8,
        "good to soft": 9,
        "standard to slow": 10,
        standard: 11,
        heavy: 13,
        soft: 14,
    };
    // Verificar correspondência exata primeiro
    if (exactMap[goingLower]) {
        return exactMap[goingLower];
    }
    // Fallback para verificações com includes() (para casos com descrições adicionais)
    if (goingLower.includes("good to firm"))
        return 5;
    if (goingLower.includes("good-good to yielding"))
        return 6;
    if (goingLower.includes("yielding to soft"))
        return 7;
    if (goingLower.includes("yielding"))
        return 8;
    if (goingLower.includes("good to soft"))
        return 9;
    if (goingLower.includes("standard to slow"))
        return 10;
    if (goingLower.includes("standard"))
        return 11;
    if (goingLower.includes("soft (heavy"))
        return 12;
    if (goingLower.includes("heavy"))
        return 13;
    if (goingLower.includes("soft"))
        return 14;
    if (goingLower.includes("hard"))
        return 1;
    if (goingLower.includes("fast"))
        return 2;
    if (goingLower.includes("firm"))
        return 3;
    if (goingLower.includes("good"))
        return 4;
    console.warn(`Going não reconhecido: ${going}, usando valor padrão 4.`);
    return 4;
};
exports.encodeGoing = encodeGoing;
