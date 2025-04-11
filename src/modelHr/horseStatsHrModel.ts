import mongoose from "mongoose";

export interface IResults_Hr extends Document {
  date: string;
  position: number;
  course: string;
  distance: string;
  class: number;
  weight: string;
  starting_price: number;
  jockey: string;
  trainer: string;
  OR: number;
  race: string;
  prize: string;
}

export interface IHorseStats_HR extends Document {
  horse: string;
  id_horse: number;
  results: IResults_Hr[];
}

const Results_Hr_Schema = new mongoose.Schema<IResults_Hr>({
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

const HorseStats_Hr_Schema = new mongoose.Schema<IHorseStats_HR>({
  horse: String,
  id_horse: Number,
  results: [Results_Hr_Schema],
});

export default mongoose.model("HorseStats_HR", HorseStats_Hr_Schema);
