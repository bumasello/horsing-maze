import express from "express";

import racingCardController from "../controller/mdbDataController";

const router = express.Router();

router.get("/racecards", racingCardController.getRaceCards);

router.get("/racedetails", racingCardController.getRaceCardsDetails);

router.get("/horsestats", racingCardController.getHorseStats);

export default router;
