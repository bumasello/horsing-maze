import express from "express";

import spbDataController from "../controller/spbDataController";

const router = express.Router();

router.get("/racecards", spbDataController.spbRaceCards);

router.get("/racedetails", spbDataController.spbRaceDetail);

export default router;
