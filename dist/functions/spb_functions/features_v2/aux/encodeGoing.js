"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeGoing = void 0;
const encodeGoing = (going) => {
    if (!going) {
        console.log("Sem going");
        return 4;
    }
    const goingMap = {
        Hard: 1,
        Firm: 2,
        "Good to Firm": 3,
        Good: 4,
        "Good to Soft": 5,
        Soft: 6,
        Heavy: 7,
    };
    return goingMap[going] || 4; // Valor padrão: Good (4)
};
exports.encodeGoing = encodeGoing;
