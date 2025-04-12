"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const Results_Hr_Schema = new mongoose_1.default.Schema({
    date: String,
    position: Number,
    course: String,
    distance: String,
    class: Number,
    weight: String,
    starting_price: Number,
    jockey: String,
    trainer: String,
    OR: Number,
    race: String,
    prize: String,
});
const HorseStats_Hr_Schema = new mongoose_1.default.Schema({
    horse: String,
    id_horse: Number,
    results: [Results_Hr_Schema],
});
exports.default = mongoose_1.default.model("HorseStats_HR", HorseStats_Hr_Schema);
