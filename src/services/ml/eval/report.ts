// Agregação de resultados da simulação + output em console/CSV/JSON.

import * as fs from "fs";
import * as path from "path";
import type { SimResult } from "./simulator";

export interface ModelSummary {
  modelLabel: string;
  totalRaces: number;
  racesWithPicks: number;
  betsPlaced: number;
  skipped: number;
  skipReasonCounts: Record<string, number>;
  pickIndexDistribution: {
    index0: number; // usou pick #1
    index1: number; // caiu pra #2
    index2: number; // caiu pra #3
  };
  winRate: number; // % das apostas em que o cavalo apostado PERDEU (nós ganhamos)
  breakEvenWinRate: number; // = 200/210
  edge: number; // winRate - breakEvenWinRate (positivo = lucrativo)
  totalPnl: number;
  bankrollInitial: number;
  bankrollFinal: number;
  roiPct: number;
  maxDrawdown: number;
  firstRuinAt: number | null; // corridas até bankroll cruzar 0
  ruinCount: number; // quantas vezes bankroll ficou negativo (crossings 0→neg)
  avgOddChosen: number;
  avgPredictedProbabilityChosen: number;
  avgIvlChosen: number;
  oddBucketWinRate: Record<string, { bets: number; winRate: number }>;
}

export function summarize(
  modelLabel: string,
  results: SimResult[],
  bankrollInitial: number,
): ModelSummary {
  const bets = results.filter((r) => r.pickIndexUsed !== null);
  const wins = bets.filter((r) => r.chosenWonRace === false).length;
  const losses = bets.filter((r) => r.chosenWonRace === true).length;

  const skipReasonCounts: Record<string, number> = {};
  for (const r of results) {
    if (r.skipReason) {
      skipReasonCounts[r.skipReason] = (skipReasonCounts[r.skipReason] || 0) + 1;
    }
  }

  const pickIndexDistribution = {
    index0: bets.filter((r) => r.pickIndexUsed === 0).length,
    index1: bets.filter((r) => r.pickIndexUsed === 1).length,
    index2: bets.filter((r) => r.pickIndexUsed === 2).length,
  };

  const winRate = bets.length > 0 ? wins / bets.length : 0;
  const breakEvenWinRate = 200 / 210;
  const totalPnl = results.reduce((s, r) => s + r.pnl, 0);
  const bankrollFinal = bankrollInitial + totalPnl;
  const roiPct = (totalPnl / bankrollInitial) * 100;

  // Drawdown máximo (pico → vale) na curva da banca
  let bankroll = bankrollInitial;
  let peak = bankrollInitial;
  let maxDrawdown = 0;
  let firstRuinAt: number | null = null;
  let ruinCount = 0;
  let wasPositive = true;
  let raceIdx = 0;

  for (const r of results) {
    if (r.pnl !== 0) {
      bankroll += r.pnl;
      if (bankroll > peak) peak = bankroll;
      const dd = peak - bankroll;
      if (dd > maxDrawdown) maxDrawdown = dd;

      if (bankroll < 0 && wasPositive) {
        ruinCount++;
        if (firstRuinAt === null) firstRuinAt = raceIdx;
        wasPositive = false;
      } else if (bankroll >= 0 && !wasPositive) {
        wasPositive = true;
      }
    }
    raceIdx++;
  }

  const avgOddChosen =
    bets.length > 0
      ? bets.reduce((s, r) => s + (r.chosenOdd || 0), 0) / bets.length
      : 0;
  const avgPredictedProbabilityChosen =
    bets.length > 0
      ? bets.reduce((s, r) => s + (r.chosenPredictedProbability || 0), 0) /
        bets.length
      : 0;
  const avgIvlChosen =
    bets.length > 0
      ? bets.reduce((s, r) => s + (r.chosenIvlScore || 0), 0) / bets.length
      : 0;

  // Win rate por bucket de odd
  const oddBucketWinRate: Record<string, { bets: number; winRate: number }> = {};
  const buckets: [number, number, string][] = [
    [4, 6, "4-6"],
    [6, 8, "6-8"],
    [8, 10, "8-10"],
    [10, 13, "10-13"],
    [13, 17, "13-17"],
    [17, 20, "17-20"],
  ];
  for (const [lo, hi, label] of buckets) {
    const inBucket = bets.filter(
      (r) => (r.chosenOdd || 0) >= lo && (r.chosenOdd || 0) < hi,
    );
    const winsInBucket = inBucket.filter(
      (r) => r.chosenWonRace === false,
    ).length;
    oddBucketWinRate[label] = {
      bets: inBucket.length,
      winRate: inBucket.length > 0 ? winsInBucket / inBucket.length : 0,
    };
  }

  return {
    modelLabel,
    totalRaces: results.length,
    racesWithPicks: results.filter((r) => r.skipReason !== "no_picks").length,
    betsPlaced: bets.length,
    skipped: results.length - bets.length,
    skipReasonCounts,
    pickIndexDistribution,
    winRate,
    breakEvenWinRate,
    edge: winRate - breakEvenWinRate,
    totalPnl,
    bankrollInitial,
    bankrollFinal,
    roiPct,
    maxDrawdown,
    firstRuinAt,
    ruinCount,
    avgOddChosen,
    avgPredictedProbabilityChosen,
    avgIvlChosen,
    oddBucketWinRate,
  };
}

export function printConsoleTable(summaries: ModelSummary[]): void {
  const pad = (s: string, w: number): string => s.padStart(w);
  console.log("\n" + "=".repeat(90));
  console.log("📊 RESULTADO CONSOLIDADO — eval_roi_offline");
  console.log("=".repeat(90));

  const rows: [string, (s: ModelSummary) => string][] = [
    ["Corridas avaliadas", (s) => s.totalRaces.toString()],
    ["Corridas com pick", (s) => s.racesWithPicks.toString()],
    ["Apostas feitas", (s) => s.betsPlaced.toString()],
    ["Skipped", (s) => s.skipped.toString()],
    ["  all_ineligible", (s) => (s.skipReasonCounts.all_ineligible || 0).toString()],
    ["  no_picks", (s) => (s.skipReasonCounts.no_picks || 0).toString()],
    ["Pick #1 usado", (s) => s.pickIndexDistribution.index0.toString()],
    ["Pick #2 usado", (s) => s.pickIndexDistribution.index1.toString()],
    ["Pick #3 usado", (s) => s.pickIndexDistribution.index2.toString()],
    [
      "Win rate",
      (s) =>
        `${(s.winRate * 100).toFixed(2)}% (break-even ${(s.breakEvenWinRate * 100).toFixed(2)}%)`,
    ],
    ["Edge vs break-even", (s) => `${(s.edge * 100).toFixed(2)}pp`],
    ["ROI", (s) => `${s.roiPct.toFixed(2)}%`],
    [
      "Banca",
      (s) =>
        `$${s.bankrollInitial} → $${s.bankrollFinal.toFixed(2)} (Δ ${s.totalPnl.toFixed(2)})`,
    ],
    ["Max drawdown", (s) => `$${s.maxDrawdown.toFixed(2)}`],
    ["Primeira ruína (corrida)", (s) => (s.firstRuinAt ?? "—").toString()],
    ["Ruínas", (s) => s.ruinCount.toString()],
    ["Odd média escolhida", (s) => s.avgOddChosen.toFixed(2)],
    ["P(lose) média escolhida", (s) => (s.avgPredictedProbabilityChosen * 100).toFixed(2) + "%"],
    ["IVL média escolhida", (s) => s.avgIvlChosen.toFixed(3)],
  ];

  const headerCols = ["Métrica", ...summaries.map((s) => s.modelLabel)];
  const colWidths = [30, ...summaries.map((s) => Math.max(20, s.modelLabel.length + 2))];

  console.log(
    headerCols.map((h, i) => pad(h, colWidths[i])).join(" | "),
  );
  console.log(colWidths.map((w) => "-".repeat(w)).join("-+-"));

  for (const [label, fn] of rows) {
    const cols = [label, ...summaries.map(fn)];
    console.log(cols.map((c, i) => pad(c, colWidths[i])).join(" | "));
  }

  console.log("\n📊 Win rate por bucket de odd (por modelo):");
  for (const s of summaries) {
    console.log(`\n  ${s.modelLabel}:`);
    for (const [bucket, data] of Object.entries(s.oddBucketWinRate)) {
      const wr = data.bets > 0 ? (data.winRate * 100).toFixed(2) + "%" : "—";
      console.log(`    odd ${bucket}: ${data.bets} apostas, wr=${wr}`);
    }
  }
  console.log("=".repeat(90));
}

export function writeCsv(
  outDir: string,
  fileName: string,
  results: SimResult[],
): string {
  const filepath = path.join(outDir, fileName);
  const header =
    "raceId,raceDate,pickIndexUsed,skipReason,chosenHorseId,chosenOdd,chosenPredictedProbability,chosenIvlScore,chosenWonRace,pnl,bankrollBefore,bankrollAfter";
  const lines = results.map((r) =>
    [
      r.raceId,
      r.raceDate,
      r.pickIndexUsed ?? "",
      r.skipReason ?? "",
      r.chosenHorseId ?? "",
      r.chosenOdd ?? "",
      r.chosenPredictedProbability ?? "",
      r.chosenIvlScore ?? "",
      r.chosenWonRace ?? "",
      r.pnl,
      r.bankrollBefore,
      r.bankrollAfter,
    ].join(","),
  );
  fs.writeFileSync(filepath, [header, ...lines].join("\n"));
  return filepath;
}

export function writeJsonSummary(
  outDir: string,
  fileName: string,
  summaries: ModelSummary[],
): string {
  const filepath = path.join(outDir, fileName);
  fs.writeFileSync(filepath, JSON.stringify(summaries, null, 2));
  return filepath;
}
