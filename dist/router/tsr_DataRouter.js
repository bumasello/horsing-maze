"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const tsrDataController_1 = __importDefault(require("../controller/tsrDataController"));
const router = express_1.default.Router();
router.get("/prediction", tsrDataController_1.default.getTrainDataAndCreatePredictions);
router.get("/laypicks", tsrDataController_1.default.getInsertPredictions);
exports.default = router;
