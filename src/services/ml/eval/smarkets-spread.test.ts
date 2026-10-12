import { describe, expect, it } from "vitest";
import { ehUkIre } from "./smarkets-spread";

// Regressão do bug de 2026-09-13: `ehUkIre` lia `slug.split("/")[4]`, que no
// slug real do Smarkets é o ANO, não a pista. Como "2026" nunca está na lista
// de sufixos estrangeiros, o filtro devolvia true para TUDO — 36% das cotações
// de 2026-08-20 eram AUS/USA/FRA, e o spread mediano publicado (8,7%) era o de
// um livro contaminado. Com o filtro certo, o mesmo dia dá 7,6%.
//
// Estes casos FALHAM na implementação antiga. É o critério do próprio projeto:
// um verificador que nunca falhou não foi verificado.
describe("ehUkIre", () => {
	const slug = (venue: string) =>
		`/sport/horse-racing/${venue}/2026/08/21/14-20`;

	it("aceita pista de UK/IRE, que não tem sufixo de país", () => {
		for (const v of ["brighton", "bath", "york", "leopardstown"]) {
			expect(ehUkIre(slug(v))).toBe(true);
		}
	});

	it("aceita pista de UK/IRE com hífen no nome", () => {
		// O sufixo aqui é "abbot", que não é país: o hífen sozinho não exclui.
		expect(ehUkIre(slug("newton-abbot"))).toBe(true);
	});

	it("rejeita pista estrangeira — o caso que o bug deixava passar", () => {
		for (const v of ["beaudesert-aus", "del-mar-usa", "deauville-fra"]) {
			expect(ehUkIre(slug(v))).toBe(false);
		}
	});

	it("não depende da posição da pista no caminho", () => {
		// Ancorado em "horse-racing", então um prefixo a mais não quebra.
		expect(ehUkIre("/x/sport/horse-racing/cairns-aus/2026/08/22/03-40")).toBe(
			false,
		);
	});

	// Regressão de 2026-10-06, achada pelo `reprodutor`: a lista de sufixos
	// tinha "ger" e os slugs reais usam "-de"; "-ksa" e "-mu" nem estavam nela.
	// 9.308 das 212.373 cotações publicadas (117 de 1.089 corridas) eram da
	// Alemanha, da Arábia Saudita e de Maurício. Estes casos FALHARAM na
	// implementação de 13/09 antes do conserto.
	it("rejeita os sufixos que a lista de 13/09 deixava passar", () => {
		for (const v of ["taif-ksa", "baden-baden-de", "mauritius-mu"]) {
			expect(ehUkIre(slug(v))).toBe(false);
		}
	});

	it("aceita pista de UK/IRE cujo fim parece sufixo de país", () => {
		for (const v of ["ffos-las", "bangor-on-dee", "epsom-downs"]) {
			expect(ehUkIre(slug(v))).toBe(true);
		}
	});

	it("separa a homônima estrangeira pelo sufixo", () => {
		expect(ehUkIre(slug("warwick"))).toBe(true);
		expect(ehUkIre(slug("warwick-aus"))).toBe(false);
		expect(ehUkIre(slug("warwick-farm-aus"))).toBe(false);
	});

	it("recusa decidir sobre pista que não conhece", () => {
		// O defeito das duas versões anteriores foi o mesmo: o que a lista não
		// previa virava UK/IRE em silêncio. Pista nova tem de parar a medição.
		expect(() => ehUkIre(slug("pista-nova-xyz"))).toThrow(/desconhecida/);
	});
});
