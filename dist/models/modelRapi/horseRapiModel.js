"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
// 2. Criar o esquema do Mongoose
const HorseSchema = new mongoose_1.default.Schema({
    horse: { type: String, required: true },
    age: { type: Number, required: true },
    sex: { type: String, required: true },
    sex_code: { type: String, required: true },
    colour: { type: String, required: true },
    region: { type: String, required: true },
    dam: { type: String, required: true },
    sire: { type: String, required: true },
    damsire: { type: String, required: true },
    trainer: { type: String, required: true },
    owner: { type: String, required: true },
    number: { type: Number, required: true },
    draw: { type: Number, required: true },
    headgear: { type: String },
    lbs: { type: Number, required: true },
    ofr: { type: String, required: true },
    jockey: { type: String, required: true },
    last_run: { type: String },
    form: { type: String },
});
const Horse = mongoose_1.default.model("Horse", HorseSchema);
exports.default = { Horse, HorseSchema };
/*
 {
  "horse": "Jackstell",
  "age": "6",
  "sex": "gelding",
  "sex_code": "G",
  "colour": "ch",
  "region": "FR",
  "dam": "Prestelle",
  "sire": "No Risk At All",
  "damsire": "Rochesson",
  "trainer": "Jamie Snowden",
  "owner": "Value Racing - Jackstell",
  "number": "3",
  "draw": "0",
  "headgear": "",
  "lbs": "161",
  "ofr": "113",
  "jockey": "Gavin Sheehan",
  "last_run": "102",
  "form": "33-123"
  }
*/
