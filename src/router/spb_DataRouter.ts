import express from "express";

import spbDataController from "../controller/spbDataController";

const router = express.Router();

router.get("/racecards", spbDataController.spbRaceCards);

router.get("/racedetails", spbDataController.spbRaceDetail);

router.get("/horsestats", spbDataController.spbHorseStats);

router.get("/horsefeatures", spbDataController.spbHorseFeatures);

export default router;
