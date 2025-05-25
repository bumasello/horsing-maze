"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const horseHrModel_1 = __importDefault(require("../modelHr/horseHrModel"));
const RaceCardDetailSchema_Hr = new mongoose_1.default.Schema({
    id_race: String,
    course: String,
    date: String,
    off_time_br: String,
    title: String,
    distance: String,
    age: Number,
    going: String,
    finished: Number,
    canceled: Number,
    finish_time: String,
    prize: String,
    class: Number,
    horses: [horseHrModel_1.default.HorseSchema_Hr],
});
const RaceCardDetailModel_Hr = mongoose_1.default.model("RaceCardDetail_Hr", RaceCardDetailSchema_Hr);
exports.default = RaceCardDetailModel_Hr;
