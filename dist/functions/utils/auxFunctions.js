"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertHorseWeightToKg = exports.cleanDateString = exports.convertFurlongsToMeters = exports.countPlaces = exports.countWins = exports.variance = exports.average = void 0;
// Função para calcular a média de um array de números
const average = (numbers) => numbers.reduce((sum, n) => sum + n, 0) / (numbers.length || 1);
exports.average = average;
// Função para calcular a variância
const variance = (numbers, avg) => numbers.reduce((sum, n) => sum + (n - avg) ** 2, 0) / (numbers.length || 1);
exports.variance = variance;
// Função para contar vitórias (posição == 1)
const countWins = (positions) => positions.filter((pos) => pos === 1).length;
exports.countWins = countWins;
// Função para contar colocados (posição <= 3)
const countPlaces = (positions) => positions.filter((pos) => pos <= 3).length;
exports.countPlaces = countPlaces;
// Função para converter distância (ex: "5f") para metros (1f ≈ 201.168 meters)
const convertFurlongsToMeters = (distanceStr) => {
    // Constantes de conversão
    const FURLONG_TO_METERS = 201.168;
    const YARD_TO_METERS = 0.9144;
    const MILE_TO_FURLONGS = 8;
    // 1. Limpa espaços e remove conteúdo entre parênteses, ex: "1m(Rnd)" -> "1m"
    const cleaned = distanceStr
        .toLowerCase()
        .trim()
        .replace(/\([^)]*\)/g, "") // remove tudo de '(' até ')' :contentReference[oaicite:1]{index=1}
        .trim();
    // 2. Caso "1m4f" (milhas + furlongs)
    const mileAndFurlongMatch = cleaned.match(/(\d+)m(\d+)f/);
    if (mileAndFurlongMatch) {
        const miles = parseInt(mileAndFurlongMatch[1], 10);
        const furlongs = parseInt(mileAndFurlongMatch[2], 10);
        return Math.round((miles * MILE_TO_FURLONGS + furlongs) * FURLONG_TO_METERS);
    }
    // 3. Caso "6f" (apenas furlongs)
    const furlongMatch = cleaned.match(/(\d+(\.\d+)?)f/);
    if (furlongMatch) {
        return Math.round(parseFloat(furlongMatch[1]) * FURLONG_TO_METERS);
    }
    // 4. Caso "6f110y" (furlongs + jardas)
    const furlongYardMatch = cleaned.match(/(\d+)f(\d+)y/);
    if (furlongYardMatch) {
        const furlongs = parseInt(furlongYardMatch[1], 10);
        const yards = parseInt(furlongYardMatch[2], 10);
        return Math.round(furlongs * FURLONG_TO_METERS + yards * YARD_TO_METERS);
    }
    // 5. Caso "1m" (apenas milhas)
    const mileMatch = cleaned.match(/(\d+(\.\d+)?)m$/);
    if (mileMatch) {
        return Math.round(parseFloat(mileMatch[1]) * MILE_TO_FURLONGS * FURLONG_TO_METERS);
    }
    // 6. Caso numérico simples (assume furlongs)
    const numericMatch = cleaned.match(/^(\d+(\.\d+)?)$/);
    if (numericMatch) {
        return Math.round(parseFloat(numericMatch[1]) * FURLONG_TO_METERS);
    }
    // 7. Não reconheceu o formato
    console.warn(`Formato de distância não reconhecido: ${distanceStr}`);
    return 0;
};
exports.convertFurlongsToMeters = convertFurlongsToMeters;
const cleanDateString = (dateStr) => {
    return dateStr
        .trim()
        .replace(/[\x00-\x1F\x7F]/g, "")
        .replace(/[\/\.]/g, "-");
};
exports.cleanDateString = cleanDateString;
const convertHorseWeightToKg = (weightStr) => {
    // Constantes de conversão
    const POUND_TO_KG = 0.45359237;
    const STONE_TO_POUNDS = 14;
    // Remover espaços
    const cleanStr = weightStr.trim();
    // Formato "11-12" (11 stones e 12 pounds)
    const stonePoundMatch = cleanStr.match(/(\d+)-(\d+)/);
    if (stonePoundMatch) {
        const stones = Number.parseInt(stonePoundMatch[1], 10);
        const pounds = Number.parseInt(stonePoundMatch[2], 10);
        // Converter stones para pounds e adicionar aos pounds extra
        const totalPounds = stones * STONE_TO_POUNDS + pounds;
        // Converter pounds para kg com precisão de 2 casas decimais
        return Number.parseFloat((totalPounds * POUND_TO_KG).toFixed(2));
    }
    // Caso tenha apenas stones (ex: "11")
    const stonesOnlyMatch = cleanStr.match(/^(\d+)$/);
    if (stonesOnlyMatch) {
        const stones = Number.parseInt(stonesOnlyMatch[1], 10);
        return Number.parseFloat((stones * STONE_TO_POUNDS * POUND_TO_KG).toFixed(2));
    }
    // Caso tenha apenas pounds (ex: "165lb" ou "165")
    const poundsMatch = cleanStr.match(/^(\d+)(?:lb)?$/);
    if (poundsMatch) {
        const pounds = Number.parseInt(poundsMatch[1], 10);
        return Number.parseFloat((pounds * POUND_TO_KG).toFixed(2));
    }
    // Se chegou aqui, não conseguiu interpretar o formato
    console.warn(`Formato de peso não reconhecido: ${weightStr}`);
    return 0;
};
exports.convertHorseWeightToKg = convertHorseWeightToKg;
