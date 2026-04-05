import express from "express";
import * as dataSync from "./handlers/data-sync.handler";
import * as mongodb from "./handlers/mongodb.handler";
import * as ml from "./handlers/ml.handler";

const router = express.Router();

// MongoDB — coleta de dados
router.get("/mdb/racecards", mongodb.getRaceCards);
router.get("/mdb/racedetails", mongodb.getRaceCardsDetails);
router.get("/mdb/horsestats", mongodb.getHorseStats);
router.get("/mdb/update-racecards", mongodb.updateRaceCard);
router.get("/mdb/check-racecards", mongodb.checkRacecards);
router.get("/mdb/check-racedetails", mongodb.checkRacedetails);

// Data Sync — Supabase population
router.get("/sync/racecards", dataSync.raceCards);
router.get("/sync/racedetails", dataSync.raceDetails);
router.get("/sync/horsestats", dataSync.horseStats);
router.get("/sync/enriched-details", dataSync.enrichedDetails);
router.get("/sync/check-entries", dataSync.checkCreateEntry);
router.get("/sync/enrichracecards", dataSync.enrichRacecards);
router.get("/sync/features", dataSync.horseFeatures);
router.get("/sync/update-racecards", dataSync.updateRacecard);

// ML — treino, predição e picks
router.get("/ml/training", ml.training);
router.get("/ml/predictions", ml.predictions);
router.get("/ml/lay-picks", ml.layPicks);

export default router;
