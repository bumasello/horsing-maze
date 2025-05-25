import express from "express";
import spbController from "../controller/spbDataController";

const router = express.Router();

router.get("/spbracecard", spbController.spbUpdateRacecard);

export default router;
