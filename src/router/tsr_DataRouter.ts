import express from "express";

import tensorController from "../controller/tsrDataController";

const router = express.Router();

router.get("/prediction", tensorController.getPredictions);

export default router;
