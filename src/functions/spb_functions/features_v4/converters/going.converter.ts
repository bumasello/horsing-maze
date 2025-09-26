// features_v4/converters/going.converter.ts

/**
 * Encode going condition to numeric value
 * Lower numbers = harder/faster ground
 * Higher numbers = softer/heavier ground
 */
export function encodeGoing(going: string | null): number {
  if (!going) return 7; // Default to middle value

  // Normalize string
  const normalized = going.toLowerCase().trim();

  // Remove course-specific info (chase, hurdles, straight, round, etc.)
  const cleaned = normalized
    .replace(
      /chase course|hurdles? course|straight course|round course|flat course|nh course|aw course|turf course/gi,
      "",
    )
    .replace(/\(.*?\)/g, "") // Remove anything in parentheses
    .replace(/[;,]/g, "") // Remove punctuation
    .trim();

  // Extract the main going condition
  const mainGoing = extractMainGoing(cleaned);

  // Map to numeric value
  return mapGoingToNumber(mainGoing);
}

/**
 * Extract the main going condition from complex descriptions
 */
function extractMainGoing(going: string): string {
  // Priority order for extraction (from driest to wettest)
  const conditions = [
    "hard",
    "firm",
    "good to firm",
    "good",
    "good to yielding",
    "yielding",
    "yielding to soft",
    "good to soft",
    "soft",
    "soft to heavy",
    "heavy",
    "standard",
    "standard to slow",
  ];

  // Check for exact matches first
  for (const condition of conditions) {
    if (going === condition) {
      return condition;
    }
  }

  // Check for contains (but prioritize the first/main mention)
  for (const condition of conditions) {
    if (going.includes(condition)) {
      return condition;
    }
  }

  // Handle special cases
  if (going.includes("standard")) return "standard";
  if (going.includes("heavy")) return "heavy";
  if (going.includes("soft")) return "soft";
  if (going.includes("yielding")) return "yielding";
  if (going.includes("good")) return "good";
  if (going.includes("firm")) return "firm";
  if (going.includes("hard")) return "hard";

  return "good"; // Default fallback
}

/**
 * Map going condition to numeric value
 */
function mapGoingToNumber(going: string): number {
  const goingMap: Record<string, number> = {
    // Turf conditions (1-14 scale)
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

    // All-weather conditions
    standard: 12,
    "standard to slow": 13,
    slow: 14,
  };

  return goingMap[going] || 7; // Default to middle value
}

/**
 * Get going category for grouping
 */
export function getGoingCategory(encoded: number): string {
  if (encoded <= 3) return "firm";
  if (encoded <= 5) return "good";
  if (encoded <= 8) return "yielding_soft";
  if (encoded <= 11) return "heavy";
  return "all_weather";
}

/**
 * Check if going is suitable for a horse based on history
 */
export function isGoingSuitable(
  currentGoing: number,
  preferredGoing: number,
  tolerance: number = 2,
): boolean {
  return Math.abs(currentGoing - preferredGoing) <= tolerance;
}

/**
 * Parse complex going descriptions into components
 */
export function parseGoingComponents(going: string | null): {
  primary: string;
  variations: string[];
  courses: string[];
  encoded: number;
} {
  if (!going) {
    return {
      primary: "unknown",
      variations: [],
      courses: [],
      encoded: 7,
    };
  }

  const normalized = going.toLowerCase();

  // Extract course types mentioned
  const courses: string[] = [];
  if (normalized.includes("chase")) courses.push("chase");
  if (normalized.includes("hurdle")) courses.push("hurdle");
  if (normalized.includes("straight")) courses.push("straight");
  if (normalized.includes("round")) courses.push("round");
  if (normalized.includes("flat")) courses.push("flat");
  if (normalized.includes("nh")) courses.push("nh");

  // Extract variations (in places, etc.)
  const variations: string[] = [];
  const inPlacesMatch = normalized.match(/\((.*?)\)/g);
  if (inPlacesMatch) {
    variations.push(...inPlacesMatch.map((m) => m.replace(/[()]/g, "")));
  }

  // Get primary going
  const primary = extractMainGoing(normalized);
  const encoded = mapGoingToNumber(primary);

  return {
    primary,
    variations,
    courses,
    encoded,
  };
}

/**
 * Calculate going change impact
 * Returns a multiplier for performance adjustment
 */
export function calculateGoingChangeImpact(
  previousGoing: number,
  currentGoing: number,
  horseGoingPreference: number,
): number {
  const previousDiff = Math.abs(previousGoing - horseGoingPreference);
  const currentDiff = Math.abs(currentGoing - horseGoingPreference);

  // If moving closer to preference, positive impact
  // If moving away from preference, negative impact
  const improvement = previousDiff - currentDiff;

  // Convert to multiplier (max 20% impact)
  return 1 + improvement * 0.05;
}

/**
 * Determine if going is extreme
 */
export function isExtremeGoing(encoded: number): boolean {
  return encoded <= 2 || encoded >= 10; // Very firm or very soft/heavy
}

/**
 * Get going description from encoded value
 */
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

// Export as object for backward compatibility
export const GoingConverter = {
  encodeGoing,
  getGoingCategory,
  isGoingSuitable,
  parseGoingComponents,
  calculateGoingChangeImpact,
  isExtremeGoing,
  decodeGoing,
};
