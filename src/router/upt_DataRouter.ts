import express from "express";

import spbController from "../controller/spbDataController";

import racingCardController from "../controller/mdbDataController";

const router = express.Router();

router.get("/mdbracecard", racingCardController.updateRaceCard);

router.get("/spbracecard", spbController.spbUpdateRacecard);

export default router;
