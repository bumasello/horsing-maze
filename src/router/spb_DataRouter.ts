import express from "express";

import spbDataController from "../controller/spbDataController";

const router = express.Router();

router.get("/racecards", spbDataController.spbRaceCards);

router.get("/racedetails", spbDataController.spbRaceDetail);

router.get("/horsestats", spbDataController.spbHorseStats);

router.get("/enrichedhorses", spbDataController.spbEnrichedDetails);

router.get("/horsefeatures", spbDataController.spbHorseFeatures);

router.get("/checkhorseresultlength", spbDataController.spbCheckCreateEntry);

export default router;
