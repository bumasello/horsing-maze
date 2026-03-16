// features_v4/converters/going.converter.ts

export function encodeGoing(going: string | null): number {
  if (!going) return 7;

  const normalized = going.toLowerCase().trim();

  const cleaned = normalized
    .replace(
      /chase course|hurdles? course|straight course|round course|flat course|nh course|aw course|turf course/gi,
      "",
    )
    .replace(/\(.*?\)/g, "")
    .replace(/[;,]/g, "")
    .trim();

  const mainGoing = extractMainGoing(cleaned);
  return mapGoingToNumber(mainGoing);
}

function extractMainGoing(going: string): string {
  // FIX 1: compostos primeiro, simples depois
  const conditions = [
    "good to firm",
    "good to yielding",
    "yielding to soft",
    "good to soft",
    "soft to heavy",
    "standard to slow",
    "hard",
    "firm",
    "good",
    "yielding",
    "soft",
    "heavy",
    "standard",
    "slow",
  ];

  // Exact match primeiro
  for (const condition of conditions) {
    if (going === condition) return condition;
  }

  // Contains match (compostos já vêm antes, então não há falso match)
  for (const condition of conditions) {
    if (going.includes(condition)) return condition;
  }

  return "good"; // fallback
}

function mapGoingToNumber(going: string): number {
  const goingMap: Record<string, number> = {
    hard: 1,
    firm: 2,
    "good to firm": 3,
    good: 4,
    "good to yielding": 5,
    yielding: 6,
    "yielding to soft": 7,
    "good to soft": 8,
    soft: 9,
    "soft to heavy": 10,
    heavy: 11,
    standard: 12,
    "standard to slow": 13,
    slow: 14,
  };

  return goingMap[going] || 7;
}

export function getGoingCategory(encoded: number): string {
  if (encoded <= 3) return "firm";
  if (encoded <= 5) return "good";
  if (encoded <= 8) return "yielding_soft";
  if (encoded <= 11) return "heavy";
  return "all_weather";
}

export function isGoingSuitable(
  currentGoing: number,
  preferredGoing: number,
  tolerance = 2,
): boolean {
  return Math.abs(currentGoing - preferredGoing) <= tolerance;
}

export function parseGoingComponents(going: string | null): {
  primary: string;
  variations: string[];
  courses: string[];
  encoded: number;
} {
  if (!going) {
    return { primary: "unknown", variations: [], courses: [], encoded: 7 };
  }

  const normalized = going.toLowerCase();

  const courses: string[] = [];
  if (normalized.includes("chase")) courses.push("chase");
  if (normalized.includes("hurdle")) courses.push("hurdle");
  if (normalized.includes("straight")) courses.push("straight");
  if (normalized.includes("round")) courses.push("round");
  if (normalized.includes("flat")) courses.push("flat");
  if (normalized.includes("nh")) courses.push("nh");

  const variations: string[] = [];
  const inPlacesMatch = normalized.match(/\((.*?)\)/g);
  if (inPlacesMatch) {
    variations.push(...inPlacesMatch.map((m) => m.replace(/[()]/g, "")));
  }

  const primary = extractMainGoing(normalized);
  const encoded = mapGoingToNumber(primary);

  return { primary, variations, courses, encoded };
}

export function calculateGoingChangeImpact(
  previousGoing: number,
  currentGoing: number,
  horseGoingPreference: number,
): number {
  const previousDiff = Math.abs(previousGoing - horseGoingPreference);
  const currentDiff = Math.abs(currentGoing - horseGoingPreference);
  const improvement = previousDiff - currentDiff;
  return 1 + improvement * 0.05;
}

export function isExtremeGoing(encoded: number): boolean {
  return encoded <= 2 || encoded >= 10;
}

export function decodeGoing(encoded: number): string {
  const reverseMap: Record<number, string> = {
    1: "hard",
    2: "firm",
    3: "good to firm",
    4: "good",
    5: "good to yielding",
    6: "yielding",
    7: "yielding to soft",
    8: "good to soft",
    9: "soft",
    10: "soft to heavy",
    11: "heavy",
    12: "standard",
    13: "standard to slow",
    14: "slow",
  };

  return reverseMap[encoded] || "unknown";
}

export const GoingConverter = {
  encodeGoing,
  getGoingCategory,
  isGoingSuitable,
  parseGoingComponents,
  calculateGoingChangeImpact,
  isExtremeGoing,
  decodeGoing,
};
