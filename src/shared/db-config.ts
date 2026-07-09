// Indireção de schema/namespace por ambiente (Fase 1 do plano prd/hml,
// 2026-07-08 — ver memória project-ambientes-prd-hml).
//
// Arquitetura: DADOS COMPARTILHADOS + SAÍDAS ISOLADAS.
// - DATA_SCHEMA: tabelas de ingestão (racecards, race_horses, odds, spb,
//   horse_stats, rpscrape) — escritas só pelo serviço de PROD, lidas por todos.
// - OUTPUT_SCHEMA: tabelas produzidas pelo ML (features, predictions, picks,
//   all_eligible, results de picks, metrics) — cada ambiente escreve no seu.
// - MODEL_NAMESPACE: prefixo dos paths de modelo/logs no bucket de storage.
//
// Defaults = "hml" (comportamento histórico inalterado). O serviço prod
// futuro seta DATA_SCHEMA=prd OUTPUT_SCHEMA=prd MODEL_NAMESPACE=prd; o
// serviço de teste seta DATA_SCHEMA=prd OUTPUT_SCHEMA=hml MODEL_NAMESPACE=hml.

export function getDataSchema(): string {
	return (process.env.DATA_SCHEMA || "hml").trim();
}

export function getOutputSchema(): string {
	return (process.env.OUTPUT_SCHEMA || "hml").trim();
}

/**
 * Prefixo de namespace pros paths no bucket de modelos. Com default vazio
 * mantém os paths históricos (ex: "horse_probability_model/..."); com
 * MODEL_NAMESPACE=prd vira "prd/horse_probability_model/...".
 */
export function modelPath(path: string): string {
	const ns = (process.env.MODEL_NAMESPACE || "").trim();
	return ns ? `${ns}/${path}` : path;
}
