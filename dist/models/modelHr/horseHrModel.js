"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const OddsSchema_Hr = new mongoose_1.default.Schema({
    bookie: { type: String, required: true },
    odd: { type: String, required: true },
    last_update: { type: String, required: true },
    url: { type: String, required: true },
}, {
    _id: false, // opcional: impede que cada subdoc gere seu próprio _id
    timestamps: false, // desliga createdAt/updatedAt no subdocument
});
const HorseSchema_Hr = new mongoose_1.default.Schema({
    horse: String,
    id_horse: Number,
    id_race: Number,
    jockey: String,
    trainer: String,
    age: Number,
    weight: String,
    number: Number,
    last_ran_days_ago: Number,
    non_runner: Number,
    form: String,
    position: Number,
    distance_beaten: String,
    owner: String,
    sire: String,
    dam: String,
    OR: Number,
    sp: String,
    odds: [OddsSchema_Hr],
});
const HorseModel_Hr = mongoose_1.default.model("HorseSchema_Hr", HorseSchema_Hr);
exports.default = {
    HorseModel_Hr,
    HorseSchema_Hr,
};
