"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rapidFetch = rapidFetch;
// utils/rapidFetch.ts
const rapidapi_1 = require("../config/rapidapi");
const node_fetch_1 = __importDefault(require("node-fetch"));
/**
 * Faz fetch para RapidAPI trocando a key se receber 429.
 */
function rapidFetch(path_1) {
    return __awaiter(this, arguments, void 0, function* (path, headersInit = {}, options = {}, maxRetries = rapidapi_1.RAPIDAPI_KEYS.length) {
        let attempt = 0;
        let keyIndex = 0;
        while (attempt < maxRetries) {
            const headers = new Headers(headersInit);
            headers.set("x-rapidapi-host", rapidapi_1.RAPIDAPI_HOST);
            headers.set("x-rapidapi-key", rapidapi_1.RAPIDAPI_KEYS[keyIndex]);
            const res = yield (0, node_fetch_1.default)(path, Object.assign(Object.assign({}, options), { headers }));
            if (res.status !== 429) {
                // ou seja, OK (200) ou outro erro que NÃO seja limite
                return res;
            }
            // Se 429, trocamos de chave e re-tentamos
            attempt++;
            keyIndex = (keyIndex + 1) % rapidapi_1.RAPIDAPI_KEYS.length;
            console.warn(`RapAPI 429 — trocando para key[${keyIndex}] e retry ${attempt}/${maxRetries}`);
            // opcional: usar Retry-After header para delay
            const retryAfter = res.headers.get("Retry-After");
            const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000;
            yield new Promise((r) => setTimeout(r, waitMs));
        }
        throw new Error("Todas as chaves estouraram o limite (429 Too Many Requests)");
    });
}
