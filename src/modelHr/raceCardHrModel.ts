import mongoose from "mongoose";

export interface IRaceCard_Hr extends Document {
  id_race: number;
  course: string;
  date: string;
  off_time_br: string;
  title: string;
  distance: string;
  age: number;
  going: string;
  finished: number;
  canceled: number;
  finish_time: string;
  prize: string;
  class: number;
}

const RaceCard_Hr = new mongoose.Schema<IRaceCard_Hr>({
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

const RaceCardModel_Hr = mongoose.model<IRaceCard_Hr>(
  "RaceCard_Hr",
  RaceCard_Hr,
);

export default RaceCardModel_Hr;
