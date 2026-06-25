// Smoke test do parseRunStyle:
//   1. Casos sintéticos com expected code conhecido
//   2. Validação em 500 comments REAIS do Supabase (via SSH tunnel ao server)
//      pra ver distribuição E/EP/P/S/U e calibrar falsos U's.
//
// Roda: nvm use 20 && npx ts-node src/oneTimeScript/test_run_style_converter.ts

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import {
  encodeRunStyle,
  parseRunStyle,
  type RunStyleCode,
} from "../services/features/converters/run_style.converter";

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
);

function red(s: string) {
  return `\x1b[31m${s}\x1b[0m`;
}
function green(s: string) {
  return `\x1b[32m${s}\x1b[0m`;
}

async function syntheticTests() {
  const cases: Array<{ comment: string; expected: RunStyleCode; note?: string }> = [
    { comment: "Made all - ridden over 1f out - ran on well", expected: "E" },
    {
      comment: "Led - headed 2f out - hung right and weakened over 1f out",
      expected: "E",
    },
    {
      comment: "Disputed lead - led clearly after 2f - headed over 1f out",
      expected: "E",
    },
    {
      comment: "Prominent - hung left and lost position gradually 2f out",
      expected: "EP",
    },
    {
      comment: "Tracked leaders - smooth headway to lead 2f out - ran on well",
      expected: "EP",
    },
    {
      comment: "Mid-division - ridden 2f out - kept on but never threatened",
      expected: "P",
    },
    {
      comment: "Held up in rear - bit short of room over 2f out - smooth headway",
      expected: "S",
    },
    {
      comment: "Towards rear - smooth headway on far side of group 2f out",
      expected: "S",
    },
    {
      comment: "In rear most of way - never threatened",
      expected: "S",
    },
    { comment: "", expected: "U" },
    { comment: null as unknown as string, expected: "U" },
  ];

  console.log("🧪 SYNTHETIC TESTS\n");
  let pass = 0;
  for (const t of cases) {
    const got = parseRunStyle(t.comment);
    const ok = got.code === t.expected;
    if (ok) pass++;
    const tag = ok ? green("✅") : red("❌");
    console.log(
      `  ${tag} expected=${t.expected} got=${got.code} | ${(t.comment ?? "<null>").slice(0, 60)}`,
    );
  }
  console.log(
    `\n  ${pass}/${cases.length} (${((pass / cases.length) * 100).toFixed(0)}%)\n`,
  );
}

async function realDistribution() {
  console.log("📊 REAL DISTRIBUTION (500 random comments from Supabase)\n");
  const { data, error } = await supabase
    .schema("hml")
    .from("rpscrape_results")
    .select("comment")
    .not("comment", "is", null)
    .limit(500);

  if (error || !data) {
    console.error("FAIL:", error);
    return;
  }

  const dist: Record<RunStyleCode, number> = { E: 0, EP: 0, P: 0, S: 0, U: 0 };
  const flagCounts = {
    made_all: 0,
    held_up: 0,
    kept_on: 0,
    hung: 0,
    disputed_lead: 0,
    weakened: 0,
    rallied: 0,
  };
  const unknowns: string[] = [];

  for (const row of data) {
    const r = parseRunStyle(row.comment);
    dist[r.code]++;
    if (r.made_all) flagCounts.made_all++;
    if (r.held_up) flagCounts.held_up++;
    if (r.kept_on) flagCounts.kept_on++;
    if (r.hung) flagCounts.hung++;
    if (r.disputed_lead) flagCounts.disputed_lead++;
    if (r.weakened) flagCounts.weakened++;
    if (r.rallied) flagCounts.rallied++;
    if (r.code === "U" && unknowns.length < 5) unknowns.push(row.comment as string);
  }

  console.log("  Code distribution:");
  for (const code of ["E", "EP", "P", "S", "U"] as RunStyleCode[]) {
    const pct = ((dist[code] / data.length) * 100).toFixed(1);
    console.log(`    ${code.padEnd(3)} : ${dist[code].toString().padStart(3)} (${pct}%)`);
  }
  console.log("  Flags:");
  for (const [k, v] of Object.entries(flagCounts)) {
    const pct = ((v / data.length) * 100).toFixed(1);
    console.log(`    ${k.padEnd(15)} : ${v.toString().padStart(3)} (${pct}%)`);
  }
  if (unknowns.length > 0) {
    console.log("\n  Sample U (unknown) comments — pra debugar falsos U:");
    for (const u of unknowns) {
      console.log(`    "${u.slice(0, 90)}"`);
    }
  }
}

async function encodingTest() {
  console.log("\n🔢 ENCODING TEST");
  for (const code of ["E", "EP", "P", "S", "U"] as RunStyleCode[]) {
    const e = encodeRunStyle(code);
    console.log(`  ${code} → ${JSON.stringify(e)}`);
  }
}

async function main() {
  await syntheticTests();
  await realDistribution();
  await encodingTest();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
