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
});
