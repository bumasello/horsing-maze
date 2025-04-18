import mongoose from "mongoose";

export interface IOdds_Hr extends Document {
  bookie: string;
  odd: string;
  last_update: string;
  url: string;
}

export interface IHorse_Hr extends Document {
  horse: string;
  id_horse: number;
  id_race: number;
  jockey: string;
  trainer: string;
  age: number;
  weight: string;
  number: number;
  last_ran_days_ago: number;
  non_runner: number;
  form: string;
  position: string;
  distance_beaten: string;
  owner: string;
  sire: string;
  dam: string;
  OR: number;
  sp: string;
  odds: IOdds_Hr[];
}

const OddsSchema_Hr = new mongoose.Schema<IOdds_Hr>(
  {
    bookie: { type: String, required: true },
    odd: { type: String, required: true },
    last_update: { type: String, required: true },
    url: { type: String, required: true },
  },
  {
    _id: false, // opcional: impede que cada subdoc gere seu próprio _id
    timestamps: false, // desliga createdAt/updatedAt no subdocument
  },
);

const HorseSchema_Hr = new mongoose.Schema<IHorse_Hr>({
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
  position: String,
  distance_beaten: String,
  owner: String,
  sire: String,
  dam: String,
  OR: Number,
  sp: String,
  odds: [OddsSchema_Hr],
});

const HorseModel_Hr = mongoose.model("HorseSchema_Hr", HorseSchema_Hr);

export default {
  HorseModel_Hr,
  HorseSchema_Hr,
};
