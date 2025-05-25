"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mdbDataController_1 = __importDefault(require("../controller/mdbDataController"));
const router = express_1.default.Router();
router.get("/racecards", mdbDataController_1.default.getRaceCards);
router.get("/racedetails", mdbDataController_1.default.getRaceCardsDetails);
router.get("/horsestats", mdbDataController_1.default.getHorseStats);
router.get("/updateracecard", mdbDataController_1.default.updateRaceCard);
router.get("/checkracecards", mdbDataController_1.default.checkRacecards);
router.get("/checkracedetails", mdbDataController_1.default.checkRacedetails);
exports.default = router;
