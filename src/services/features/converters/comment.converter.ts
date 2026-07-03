// Parser de Racing Post in-running comments → códigos de run-style.
//
// Códigos clássicos (Brisnet/BRIS):
//   E   = early speed / led / made all (front-runner)
//   EP  = early-pressed / prominent / tracked leaders (presser)
//   P   = mid-pack / midfield (pace setter mid)
//   S   = stalker / closer / held up / in rear (closer)
//
// RP comments são texto livre mas usam vocabulário padronizado.
// Exemplos reais (do scrape):
//   "Made all - ridden over 1f out - ran on well"           → E
//   "Towards rear - smooth headway 2f out - hung left"      → S
//   "Prominent - outpaced and lost position over 2f out"    → EP
//   "Held up in rear - outpaced 2f out - kept on final"     → S
//   "Led - headed 2f out - hung right and weakened"         → E
//
// Estratégia: scan na PRIMEIRA frase (delimitador " - "). É onde RP descreve
// o posicionamento inicial. Resto do comment é progressão da corrida.

export type RunStyleCode = "E" | "EP" | "P" | "S" | "unknown";

// Ordenado por especificidade — primeira match wins.
// Cada entrada: [regex, code]
// IMPORTANTE: "in rear" deve ser checado ANTES de "in touch with leaders"
// pra não dar falso EP em "settled in rear of leaders".
// E "in touch with leaders" é específico → EP, mas "in touch" sozinho → P.
const RUN_STYLE_PATTERNS: Array<[RegExp, RunStyleCode]> = [
  // E (front-runner): led / made all / soon led / set the pace
  [
    /\b(led|made all|set the pace|soon led|set off in front|on the lead|disputed (?:the )?lead)\b/i,
    "E",
  ],

  // S (closer / held up) — checa ANTES de EP/P pra evitar falsa match em "in touch"
  [
    /\b(held up|in rear|in (?:the )?rear|towards (?:the )?rear|always (?:behind|towards rear)|raced in rear|patient ride|settled (?:in|towards) (?:the )?rear|never (?:better than )?(?:close|prominent)|never threatened|tailed off)\b/i,
    "S",
  ],

  // EP (presser): prominent / tracked leaders / in touch with leaders / chased / pressed
  [
    /\b(prominent|prom\b|chased leaders?|tracked? leaders?|in touch with leaders?|sat (?:second|2nd)|raced prominently|close up|sat handy|just behind leaders?|disputed|pressed leaders?|pressed (?:the )?pace|soon in touch (?:with leaders?)?|behind leaders?)\b/i,
    "EP",
  ],

  // P (mid-pack): midfield / mid-division / in touch (sem "with leaders")
  [
    /\b(midfield|mid[- ]division|in touch\b(?! with leaders?)|in (?:the )?middle|chasing group|raced midfield|in mid|mid pack|never better than mid)\b/i,
    "P",
  ],
];

// Prefixos "ruído" que aparecem ANTES do posicionamento real. Devem ser pulados.
// Ex: "Took keen hold - in touch with leaders - ..." → posicionamento é "in touch with leaders"
const NOISE_PREFIX_PATTERNS: RegExp[] = [
  /^took keen hold$/i,
  /^steadied (?:at )?(?:the )?start$/i,
  /^slowly away$/i,
  /^slowly into stride$/i,
  /^missed (?:the )?break$/i,
  /^awkward start$/i,
  /^didn'?t (?:always )?jump (?:with )?fluency$/i,
  /^jumped (?:awkwardly|slowly|deliberately|left|right)$/i,
  /^hampered (?:early|at start)$/i,
  /^bumped (?:at start|early)$/i,
  /^reared (?:at )?(?:the )?start$/i,
  /^under pressure$/i,
  /^raced (?:freely|keenly|near side|wide|on (?:the )?(?:rail|outer|outside))$/i,
  /^taken down early( and walked to post)?$/i,
  /^walked to post$/i,
  /^stumbled (?:start|at the start|into stride)( and (?:slowly|slowly into stride))?$/i,
  /^dwelt (?:at )?(?:the )?start$/i,
  /^pulled hard$/i,
];

function isNoiseClause(clause: string): boolean {
  const trimmed = clause.trim();
  return NOISE_PREFIX_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Parse Racing Post comment string → run_style code.
 * Foca na primeira frase (até o primeiro " - ") pra extrair o posicionamento inicial.
 *
 * @example
 *   parseRunStyle("Made all - ridden over 1f out - ran on well") → "E"
 *   parseRunStyle("Held up in rear - kept on final") → "S"
 *   parseRunStyle("") → "unknown"
 */
export function parseRunStyle(comment: string | null | undefined): RunStyleCode {
  if (!comment || typeof comment !== "string") return "unknown";

  // Examina as PRIMEIRAS frases (até 3) pulando prefixos de ruído tipo
  // "Took keen hold", "Steadied start", etc.
  const clauses = comment.split(" - ").map((c) => c.trim()).filter(Boolean);
  for (let i = 0; i < Math.min(clauses.length, 3); i++) {
    if (isNoiseClause(clauses[i])) continue;
    for (const [pattern, code] of RUN_STYLE_PATTERNS) {
      if (pattern.test(clauses[i])) return code;
    }
    // Primeira frase NÃO-ruído sem match → assume "unknown" (não vasculha mais)
    break;
  }

  return "unknown";
}

/**
 * Mapeia run-style code → integer (pra features numéricas no modelo).
 * Ordem reflete "agressividade" do estilo: 0=unknown, 1=S (mais conservador), 4=E (mais agressivo).
 */
export function runStyleToInt(code: RunStyleCode): number {
  switch (code) {
    case "unknown":
      return 0;
    case "S":
      return 1;
    case "P":
      return 2;
    case "EP":
      return 3;
    case "E":
      return 4;
  }
}

/**
 * Detecta no comment se o cavalo teve performance "limpa" ou problemática.
 * Flags ajudam o modelo a entender se o resultado foi representativo do potencial.
 *
 * `keptOn`/`stayedOn`: terminou forte → positivo
 * `weakened`/`faded`: cansou → negativo
 * `hung`/`hangedLeft|Right`: drift → comportamento
 * `awkwardStart|stumbled|slowAway`: problema na largada
 */
export interface CommentFlags {
  kept_on: boolean; // 1 se "kept on", "ran on well", "stayed on"
  weakened: boolean; // 1 se "weakened", "faded", "tired"
  hung: boolean; // 1 se "hung left/right", "drifted"
  awkward_start: boolean; // 1 se "slowly away", "missed break", "stumbled start"
  bumped: boolean; // 1 se "hampered", "bumped"
}

const FLAG_PATTERNS: Record<keyof CommentFlags, RegExp> = {
  kept_on: /\b(kept on|ran on well|stayed on|finished well|battled on|rallied)\b/i,
  weakened: /\b(weakened|faded|tired|emptied|stopped|out the back)\b/i,
  hung: /\b(hung (?:left|right|both)|drifted (?:left|right))\b/i,
  awkward_start: /\b(slowly away|missed (?:the )?break|stumbled (?:start|at the start)|slow away|tardy)\b/i,
  bumped: /\b(hampered|bumped|impeded|brushed aside|baulked)\b/i,
};

export function parseCommentFlags(comment: string | null | undefined): CommentFlags {
  const empty: CommentFlags = {
    kept_on: false,
    weakened: false,
    hung: false,
    awkward_start: false,
    bumped: false,
  };
  if (!comment) return empty;
  const result = { ...empty };
  for (const [flag, pattern] of Object.entries(FLAG_PATTERNS) as Array<
    [keyof CommentFlags, RegExp]
  >) {
    result[flag] = pattern.test(comment);
  }
  return result;
}
