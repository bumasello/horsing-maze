import mongoose from "mongoose";

export interface IResults_Hr extends Document {
  date: string;
  position: number | null;
  course: string;
  distance: string;
  class: number | null;
  weight: string;
  starting_price: number | null;
  jockey: string;
  trainer: string;
  OR: number | null;
  race: string;
  prize: string;
}

export interface IHorseStats_HR extends Document {
  horse: string;
  id_horse: number;
  updated?: boolean;
  result_count: number;
  results: IResults_Hr[];
}

const Results_Hr_Schema = new mongoose.Schema<IResults_Hr>({
  date: String,
  position: Number || null,
  course: String,
  distance: String,
  class: Number || null,
  weight: String,
  starting_price: Number || null,
  jockey: String,
  trainer: String,
  OR: Number || null,
  race: String,
  prize: String,
});

const HorseStats_Hr_Schema = new mongoose.Schema<IHorseStats_HR>({
  horse: String,
  id_horse: Number,
  updated: Boolean,
  result_count: Number,
  results: [Results_Hr_Schema],
});

export default mongoose.model("HorseStats_HR", HorseStats_Hr_Schema);
