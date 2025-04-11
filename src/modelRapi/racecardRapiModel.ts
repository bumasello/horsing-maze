import mongoose from "mongoose";
import HorseSchema from "./horseRapiModel";

import type { IHorse } from "./horseRapiModel";

export interface IRaceCard_RAPI extends Document {
  course: string;
  date: Date;
  off_time: string;
  off_time_br: string;
  off_dt: Date;
  race_name: string;
  distance_f: number;
  region: string;
  pattern: string;
  race_class: string;
  type: string;
  age_band: string;
  rating_band: string;
  prize: string;
  field_size: number;
  going: string;
  surface: string;
  // Referência para o model Horse
  runners: IHorse[];
}

const RaceCard_Api = new mongoose.Schema<IRaceCard_RAPI>({
  course: { type: String, required: true },
  date: { type: Date, required: true },
  off_time: { type: String, required: true },
  off_time_br: { type: String, required: true },
  off_dt: { type: Date, required: true },
  race_name: { type: String, required: true },
  distance_f: { type: Number, required: true },
  region: { type: String, required: true },
  pattern: { type: String, default: "" },
  race_class: { type: String, required: true },
  type: { type: String, required: true },
  age_band: { type: String, required: true },
  rating_band: { type: String, default: "" },
  prize: { type: String, required: true },
  field_size: { type: Number, required: true },
  going: { type: String, required: true },
  surface: { type: String, required: true },
  runners: [HorseSchema.HorseSchema],
});

export default mongoose.model("RaceCard_API", RaceCard_Api);

/*
 {
            "course": "Ascot",
            "date": "2025-03-30",
            "off_time": "2:45",
            "off_dt": "2025-03-30T14:45:00+01:00",
            "race_name": "Sodexo Live! Juvenile Handicap Hurdle (GBB Race)",
            "distance_f": "15.5",
            "region": "GB",
            "pattern": "",
            "race_class": "Class 2",
            "type": "Hurdle",
            "age_band": "4yo",
            "rating_band": "",
            "prize": "£20,812",
            "field_size": "8",
            "going": "Good",
            "surface": "Turf",
            "runners": [
                {
                    "horse": "Sauvignon",
                    "age": "4",
                    "sex": "gelding",
                    "sex_code": "G",
                    "colour": "b",
                    "region": "FR",
                    "dam": "Salicorne",
                    "sire": "Inns Of Court",
                    "damsire": "Aragorn",
                    "trainer": "Paul Nicholls",
                    "owner": "Mrs Johnny de la Hey",
                    "number": "1",
                    "draw": "0",
                    "headgear": "",
                    "lbs": "168",
                    "ofr": "128",
                    "jockey": "Harry Cobden",
                    "last_run": "36",
                    "form": "1-21P4"
                },
                {
                    "horse": "Maitre En Science",
                    "age": "4",
                    "sex": "gelding",
                    "sex_code": "G",
                    "colour": "gr",
                    "region": "FR",
                    "dam": "Vassileva",
                    "sire": "Master's Spirit",
                    "damsire": "Lomitas",
                    "trainer": "Harry Derham",
                    "owner": "Barratt Racing",
                    "number": "2",
                    "draw": "0",
                    "headgear": "tp",
                    "lbs": "163",
                    "ofr": "123",
                    "jockey": "Paul O'Brien",
                    "last_run": "44",
                    "form": "21144"
                },
                {
                    "horse": "Torrent",
                    "age": "4",
                    "sex": "gelding",
                    "sex_code": "G",
                    "colour": "b",
                    "region": "GB",
                    "dam": "Ighraa",
                    "sire": "Camelot",
                    "damsire": "Tamayuz",
                    "trainer": "Nigel Hawke",
                    "owner": "Denise Smith & Partner",
                    "number": "3",
                    "draw": "0",
                    "headgear": "p",
                    "lbs": "161",
                    "ofr": "121",
                    "jockey": "David Noonan",
                    "last_run": "64",
                    "form": "123333"
                },
                {
                    "horse": "Galactic Charm",
                    "age": "4",
                    "sex": "gelding",
                    "sex_code": "G",
                    "colour": "b",
                    "region": "GB",
                    "dam": "Gold Charm",
                    "sire": "Sea The Moon",
                    "damsire": "Key Of Luck",
                    "trainer": "Gary & Josh Moore",
                    "owner": "The Fat Jockey Partnership",
                    "number": "4",
                    "draw": "0",
                    "headgear": "p",
                    "lbs": "160",
                    "ofr": "120",
                    "jockey": "Caoilin Quinn",
                    "last_run": "11",
                    "form": "21P22"
                },
                {
                    "horse": "Moutarde",
                    "age": "4",
                    "sex": "gelding",
                    "sex_code": "G",
                    "colour": "b",
                    "region": "IRE",
                    "dam": "Ros Mountain",
                    "sire": "Raven's Pass",
                    "damsire": "Montjeu",
                    "trainer": "Anthony Charlton",
                    "owner": "Mrs Kate Kenyon",
                    "number": "5",
                    "draw": "0",
                    "headgear": "t",
                    "lbs": "159",
                    "ofr": "119",
                    "jockey": "Callum Pritchard(5)",
                    "last_run": "19",
                    "form": "1616F0"
                },
                {
                    "horse": "Ocean Conquest",
                    "age": "4",
                    "sex": "gelding",
                    "sex_code": "G",
                    "colour": "b",
                    "region": "GB",
                    "dam": "Lady Glinka",
                    "sire": "Time Test",
                    "damsire": "Galileo",
                    "trainer": "Nigel Twiston-Davies",
                    "owner": "Millsy & Dans Partnership",
                    "number": "6",
                    "draw": "0",
                    "headgear": "",
                    "lbs": "153",
                    "ofr": "113",
                    "jockey": "Sam Twiston-Davies",
                    "last_run": "30",
                    "form": "7422"
                },
                {
                    "horse": "Star Of Guiting",
                    "age": "4",
                    "sex": "gelding",
                    "sex_code": "G",
                    "colour": "br",
                    "region": "IRE",
                    "dam": "Innisfree Dawn",
                    "sire": "Vadamos",
                    "damsire": "Yeats",
                    "trainer": "Nigel Twiston-Davies",
                    "owner": "Willy Twiston-Davies",
                    "number": "7",
                    "draw": "0",
                    "headgear": "",
                    "lbs": "152",
                    "ofr": "112",
                    "jockey": "Jamie Brace(5)",
                    "last_run": "14",
                    "form": "041231"
                },
                {
                    "horse": "Benvoy",
                    "age": "4",
                    "sex": "gelding",
                    "sex_code": "G",
                    "colour": "b",
                    "region": "IRE",
                    "dam": "Mont Etoile",
                    "sire": "Fastnet Rock",
                    "damsire": "Montjeu",
                    "trainer": "Jo Davis",
                    "owner": "These Girls Can Syndicate",
                    "number": "8",
                    "draw": "0",
                    "headgear": "t",
                    "lbs": "147",
                    "ofr": "107",
                    "jockey": "Gavin Sheehan",
                    "last_run": "28",
                    "form": "431"
                }
            ]
        }
        */
