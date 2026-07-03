// Parser de "in-running comments" do Racing Post → códigos run-style + flags
// booleanas. Foundation pra features de pace (Tier 1 #3).
//
// Decisões:
//   - 4 códigos primários (E/EP/P/S) + U (unknown).
//   - Cada cavalo recebe UM código primário (o mais alto na hierarquia que
//     bateu). Razão: comentários do RP descrevem trajetória; o primeiro signal
//     posicional define o run-style.
//   - Flags booleanas são independentes (pode ter held_up=true + kept_on=true).
//   - Matching case-insensitive em substring (não regex completo) pra rapidez —
//     comentários do RP são compactos e os termos não geram falsos positivos.
//
// Hierarquia E > EP > P > S:
//   E  = "led", "made all", "soon led", "disputed lead", "dictated"
//   EP = "prominent", "tracked leaders", "chased leaders", "second pair",
//        "raced (in 2nd|prom)"
//   P  = "midfield", "raced midfield", "mid-division", "in touch"
//   S  = "held up", "in rear", "towards rear", "behind", "tailed off"
//
// Referência: terminologia Racing Post / British Horseracing Authority running
// style codes. Equivalente a Brisnet E/EP/P/S.

export type RunStyleCode = "E" | "EP" | "P" | "S" | "U";

export interface ParsedRunStyle {
  code: RunStyleCode;
  // Flags adicionais que carregam sinal além do code primário:
  made_all: boolean; // ganhou levando o tempo todo
  held_up: boolean; // estratégia de waiting
  kept_on: boolean; // sustentou esforço no final
  hung: boolean; // mudou de linha (problemas físicos/táticos)
  disputed_lead: boolean; // duelou pela ponta
  weakened: boolean; // perdeu posição no final
  rallied: boolean; // recuperou após perda
}

const EARLY_PATTERNS = [
  "made all",
  "made virtually all",
  "soon led",
  "soon clear",
  "led",
  "dictated",
  "set the pace",
  "in front",
  "took up running",
  "slight lead",
  "recovered to lead",
  "rushed up into lead",
  "rushed into lead",
  "rushed up to lead",
];

const EARLY_PRESS_PATTERNS = [
  "prominent",
  "chased leaders",
  "chased leader",
  "chased winner",
  "chased leading pair",
  "chased leading group",
  "chasing leaders",
  "chasing leader",
  "pressed leader",
  "pressing leader",
  "pressed pace",
  "tracked leaders",
  "tracked leader",
  "tracking leaders",
  "tracking leader",
  "raced in second",
  "raced prom",
  "racing prominently",
  "close up",
  "second group",
];

const PRESS_PATTERNS = [
  "mid-division",
  "midfield",
  "raced midfield",
  "raced in mid-division",
  "in touch with leaders",
  "in touch",
];

const STALK_PATTERNS = [
  "held up",
  "towards rear",
  "in rear",
  "behind",
  "settled in rear",
  "settled towards rear",
  "tailed off",
  "well behind",
  "raced in rear",
  "raced in last",
  "raced last",
  "slowly into stride",
  "slowly away",
];

const DISPUTED_PATTERNS = ["disputed lead", "disputed the lead"];

function hasAny(text: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (text.includes(p)) return true;
  }
  return false;
}

/**
 * Parseia um comment in-running do Racing Post.
 *
 * @param comment string do campo `comment` em hml.rpscrape_results
 * @returns ParsedRunStyle com code primário + flags. Retorna code='U' se
 *          nada bater (comentário vazio, non-runner, etc).
 */
export function parseRunStyle(comment: string | null): ParsedRunStyle {
  const empty: ParsedRunStyle = {
    code: "U",
    made_all: false,
    held_up: false,
    kept_on: false,
    hung: false,
    disputed_lead: false,
    weakened: false,
    rallied: false,
  };
  if (!comment) return empty;

  const lower = comment.toLowerCase();

  // Hierarquia: primeiro match na ordem E > EP > P > S vence o code primário.
  // Mas pra DISPUTED, é uma forma de E (duelando pela ponta).
  let code: RunStyleCode = "U";
  if (hasAny(lower, DISPUTED_PATTERNS) || hasAny(lower, EARLY_PATTERNS)) {
    code = "E";
  } else if (hasAny(lower, EARLY_PRESS_PATTERNS)) {
    code = "EP";
  } else if (hasAny(lower, PRESS_PATTERNS)) {
    code = "P";
  } else if (hasAny(lower, STALK_PATTERNS)) {
    code = "S";
  }

  return {
    code,
    made_all: lower.includes("made all") || lower.includes("made virtually all"),
    held_up: lower.includes("held up"),
    kept_on: lower.includes("kept on"),
    hung: lower.includes("hung "), // "hung left/right" — espaço evita "hung up"
    disputed_lead: hasAny(lower, DISPUTED_PATTERNS),
    weakened: lower.includes("weakened"),
    rallied: lower.includes("rallied"),
  };
}

/**
 * Encoding numérico pro modelo (one-hot resolvido).
 * U vira [0,0,0,0,0] — sem viés.
 */
export interface RunStyleEncoded {
  is_E: 0 | 1;
  is_EP: 0 | 1;
  is_P: 0 | 1;
  is_S: 0 | 1;
}

export function encodeRunStyle(code: RunStyleCode): RunStyleEncoded {
  return {
    is_E: code === "E" ? 1 : 0,
    is_EP: code === "EP" ? 1 : 0,
    is_P: code === "P" ? 1 : 0,
    is_S: code === "S" ? 1 : 0,
  };
}
