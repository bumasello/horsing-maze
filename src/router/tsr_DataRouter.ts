import express from "express";

import tensorController from "../controller/tsrDataController";

const router = express.Router();

router.get("/training", tensorController.getTraining);

router.get("/prediction", tensorController.getGeneratePredictions);

router.get("/laypicks", tensorController.getInsertPredictions);

export default router;
