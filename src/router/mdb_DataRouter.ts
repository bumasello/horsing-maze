import express from "express";

import racingCardController from "../controller/mdbDataController";

const router = express.Router();

router.get("/racecards", racingCardController.getRaceCards);

router.get("/racedetails", racingCardController.getRaceCardsDetails);

router.get("/horsestats", racingCardController.getHorseStats);

router.get("/updateracecard", racingCardController.updateRaceCard);

router.get("/checkracecards", racingCardController.checkRacecards);

router.get("/checkracedetails", racingCardController.checkRacedetails);

export default router;
