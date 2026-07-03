// Smoke test do parser de comments.
// Roda: npx ts-node src/oneTimeScript/test_comment_parser.ts

import {
  parseRunStyle,
  parseCommentFlags,
  runStyleToInt,
} from "../services/features/converters/comment.converter";

const cases: Array<{ comment: string; expected_style: string; description: string }> = [
  {
    comment: "Made all - ridden over 1f out - ran on well",
    expected_style: "E",
    description: "Made all → E",
  },
  {
    comment: "Towards rear - smooth headway on far side of group 2f out - kept on",
    expected_style: "S",
    description: "Towards rear + kept_on",
  },
  {
    comment: "Prominent - outpaced and lost position over 2f out - rallied",
    expected_style: "EP",
    description: "Prominent",
  },
  {
    comment: "Held up in rear - outpaced 2f out - kept on final 110yds",
    expected_style: "S",
    description: "Held up in rear",
  },
  {
    comment: "Led - headed 2f out - hung right and weakened over 1f out",
    expected_style: "E",
    description: "Led + weakened + hung right",
  },
  {
    comment: "Soon led - ridden over 1f out - faded",
    expected_style: "E",
    description: "Soon led + weakened",
  },
  {
    comment: "Midfield - kept on under pressure",
    expected_style: "P",
    description: "Midfield",
  },
  {
    comment: "Chased leaders throughout - ran on final 1f",
    expected_style: "EP",
    description: "Chased leaders",
  },
  {
    comment: "Tracked leader on inside",
    expected_style: "EP",
    description: "Tracked leader",
  },
  {
    comment: "In rear of midfield - never threatened",
    expected_style: "S",
    description: "In rear",
  },
  {
    comment: "Settled in rear",
    expected_style: "S",
    description: "Settled in rear",
  },
  {
    comment: "",
    expected_style: "unknown",
    description: "empty",
  },
  // ─── Casos descobertos em produção (top 20 comments reais) ───
  {
    comment: "In touch with leaders - pushed along over 2f out - weakened",
    expected_style: "EP",
    description: "In touch with leaders → EP",
  },
  {
    comment: "Took keen hold - in touch with leaders - weakened",
    expected_style: "EP",
    description: "Took keen hold prefix → still EP",
  },
  {
    comment: "Took keen hold - in touch with leaders on outer - pushed along",
    expected_style: "EP",
    description: "Took keen hold + extra detail → EP",
  },
  {
    comment: "Towards rear of midfield - pushed along and headway",
    expected_style: "S",
    description: "Towards rear of midfield → S",
  },
  {
    comment: "Always towards rear",
    expected_style: "S",
    description: "Always towards rear → S",
  },
  {
    comment: "Steadied start - took keen hold - held up in rear",
    expected_style: "S",
    description: "Steadied + Took keen hold prefixes → held up = S",
  },
  {
    comment: "Tracked leaders - pushed along over 2f out - ridden",
    expected_style: "EP",
    description: "Tracked leaders → EP",
  },
  {
    comment: "Didn't always jump with fluency - in touch with leaders",
    expected_style: "EP",
    description: "Jump prefix → in touch leaders = EP",
  },
  {
    comment: "Never better than mid-division - pushed along",
    expected_style: "P",
    description: "Never better than mid → P",
  },
];

console.log("🧪 RUN_STYLE PARSER SMOKE TEST\n");

let pass = 0;
let fail = 0;
for (const c of cases) {
  const got = parseRunStyle(c.comment);
  const ok = got === c.expected_style;
  const icon = ok ? "✅" : "❌";
  console.log(`${icon} [${c.expected_style.padEnd(7)} ← got ${got.padEnd(7)}] ${c.description}`);
  if (!ok) console.log(`     comment: "${c.comment.substring(0, 80)}"`);
  if (ok) pass++;
  else fail++;
}

console.log(`\n${pass}/${cases.length} passed (${fail} failed)`);

// Quick test of flags
console.log("\n🧪 FLAGS\n");
const flagCases = [
  "Made all - ridden over 1f out - ran on well",
  "Held up in rear - weakened over 1f out",
  "Led - hung right and faded - kept on briefly",
  "Slowly away - never travelling - tailed off",
  "Bumped at start - eased home",
];
for (const c of flagCases) {
  console.log(`"${c.substring(0, 60)}"`);
  console.log(`  flags=`, parseCommentFlags(c));
}

// Test runStyleToInt
console.log("\n🧪 runStyleToInt: E=4, EP=3, P=2, S=1, unknown=0");
for (const s of ["E", "EP", "P", "S", "unknown"] as const) {
  console.log(`  ${s} → ${runStyleToInt(s)}`);
}

process.exit(fail === 0 ? 0 : 1);
