import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Teste ESTRUTURAL, e assumidamente isso: ele lê o fonte em vez de executar a
// função, porque `fetchHistoricalDataForHorses` não é exportada e exportá-la só
// para testar mudaria a superfície do módulo.
//
// A propriedade que ele protege não é comportamento, é FORMA: o corte
// ponto-no-tempo nunca pode voltar a ser condicional. Foi assim que ele viveu
// até 2026-09-16 — `beforeDate?: string` com `if (beforeDate)` em volta do
// `.lt()` —, e um chamador que esquecesse a data recebia a carreira inteira do
// cavalo, incluindo corridas POSTERIORES à que se está prevendo, sem nenhum
// aviso. É o erro que este projeto já reverteu quatro vezes.
//
// Se um dia alguém precisar mesmo de histórico sem corte, que crie uma função
// com outro nome e escreva no commit por quê — não que afrouxe esta.
const ARQ = path.join(__dirname, "feature-orchestrator.ts");
const fonte = fs.readFileSync(ARQ, "utf-8");

describe("corte ponto-no-tempo", () => {
	it("`beforeDate` é obrigatório em fetchHistoricalDataForHorses", () => {
		const assinatura = fonte.slice(
			fonte.indexOf("async function fetchHistoricalDataForHorses"),
			fonte.indexOf("Promise<Map<number, HistoricalRaceData[]>>"),
		);
		expect(assinatura).toContain("beforeDate: string");
		expect(assinatura).not.toContain("beforeDate?:");
	});

	it("a função morre sem a data, e não segue sem corte", () => {
		expect(fonte).toContain("fetchHistoricalDataForHorses: `beforeDate` é obrigatório");
	});

	it("nenhum corte de data vive dentro de um `if`", () => {
		// ⚠️ Sem tirar os comentários, este teste falha pela PRÓPRIA documentação
		// acima, que cita `if (beforeDate)` para explicar o bug antigo. Um teste
		// que acusa a descrição do problema em vez do problema é ruído, e ruído
		// treina a gente a ignorar teste vermelho.
		const codigo = fonte
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		const condicionais = [...codigo.matchAll(/if\s*\(\s*beforeDate\s*\)/g)];
		expect(condicionais, "corte de data condicional voltou ao arquivo").toHaveLength(0);
	});
});
