"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const spbDataController_1 = __importDefault(require("../controller/spbDataController"));
const router = express_1.default.Router();
router.get("/spbracecard", spbDataController_1.default.spbUpdateRacecard);
exports.default = router;
