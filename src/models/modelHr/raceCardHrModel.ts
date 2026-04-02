import mongoose from "mongoose";

export interface IRaceCard_Hr {
  _id?: string;
  id_race: number;
  course: string;
  date: string;
  off_time_br: string;
  off_time_uk: string;
  title: string;
  distance: string;
  age: number;
  going: string;
  finished: number;
  canceled: number;
  finish_time: string;
  prize: string;
  class: number;
  checked_detail?: boolean;
}

interface IRaceCard_HrModel extends Document, IRaceCard_Hr {}

const RaceCard_Hr = new mongoose.Schema<IRaceCard_HrModel>({
  id_race: String,
  course: String,
  date: String,
  off_time_br: String,
  off_time_uk: String,
  title: String,
  distance: String,
  age: Number,
  going: String,
  finished: Number,
  canceled: Number,
  finish_time: String,
  prize: String,
  class: Number,
  checked_detail: Boolean,
});

const RaceCardModel_Hr = mongoose.model<IRaceCard_HrModel>(
  "RaceCard_Hr",
  RaceCard_Hr,
);

export default RaceCardModel_Hr;
