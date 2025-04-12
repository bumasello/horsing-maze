"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.message2 = exports.message = void 0;
exports.message = "aposta no cavalo branco viado";
const message2 = (req, res, next) => {
    console.log(exports.message, "oieoieoei");
    next();
};
exports.message2 = message2;
