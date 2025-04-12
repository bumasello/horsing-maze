"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const RaceCard_Hr = new mongoose_1.default.Schema({
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
});
const RaceCardModel_Hr = mongoose_1.default.model("RaceCard_Hr", RaceCard_Hr);
exports.default = RaceCardModel_Hr;
