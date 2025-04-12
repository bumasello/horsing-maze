import mongoose from "mongoose";
import horse from "../modelHr/horseHrModel";

import type { IRaceCard_Hr } from "./raceCardHrModel";
import type { IHorse_Hr } from "./horseHrModel";

export interface IRaceDetail_Hr extends IRaceCard_Hr {
  horses: IHorse_Hr[];
}

const RaceCardDetailSchema_Hr = new mongoose.Schema<IRaceDetail_Hr>({
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
  horses: [horse.HorseSchema_Hr],
});

const RaceCardDetailModel_Hr = mongoose.model<IRaceDetail_Hr>(
  "RaceCardDetail_Hr",
  RaceCardDetailSchema_Hr,
);

export default RaceCardDetailModel_Hr;
