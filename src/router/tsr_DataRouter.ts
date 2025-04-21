import express from "express";

import tensorController from "../controller/tsrDataController";

const router = express.Router();

router.get("/prediction", tensorController.getTrainDataAndCreatePredictions);

router.get("/laypicks", tensorController.getInsertPredictions);

export default router;
