// src/services/features/pipeline/update_race_results.ts

import { supabase } from "../../..";
import { getDataSchema, getOutputSchema } from "../../../shared/db-config";

interface TopPick {
	pick_rank: number;
	race_horse_id: number;
	horse_name: string;
	predicted_probability: number;
	market_odd: number | null;
	model_version: string;
}

interface HorseResult {
	id: number;
	position: number | null;
	non_runner: number | null;
	horse: string;
}

/**
 * Atualiza resultados por corrida para LAY betting (métrica honesta).
 * Para cada corrida finalizada com top 3 picks gerados:
 *   - RED se qualquer um dos 3 picks venceu (position = 1)
 *   - GREEN se nenhum dos 3 venceu
 *   - VOID se todos os 3 foram non-runners
 *
 * Também identifica o pick operacional (cascading: pick1 → pick2 se NR → pick3)
 * e calcula P&L baseado nesse pick.
 */
export async function updateRaceResults(): Promise<void> {
	console.log("\n" + "=".repeat(50));
	console.log("📊 ATUALIZAÇÃO DE RESULTADOS POR CORRIDA");
	console.log("=".repeat(50));

	// 1. Buscar corridas finalizadas que ainda não têm resultado processado
	const { data: pendingRaces, error: pendingError } = await supabase
		.schema(getDataSchema())
		.from("racecards_hr_enriched")
		.select("id, date, course, title")
		.eq("finished", 1)
		.eq("canceled", 0)
		.gte("date", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

	if (pendingError) {
		console.error("❌ Erro ao buscar corridas finalizadas:", pendingError);
		return;
	}

	if (!pendingRaces || pendingRaces.length === 0) {
		console.log("i Nenhuma corrida finalizada para processar");
		return;
	}

	console.log(
		`📊 ${pendingRaces.length} corridas finalizadas dos últimos 7 dias`,
	);

	// 2. Filtrar apenas as que ainda não têm resultado processado
	const racecardIds = pendingRaces.map((r) => r.id);
	const { data: existingResults, error: existingError } = await supabase
		.schema(getDataSchema())
		.from("lay_betting_race_results")
		.select("racecard_id")
		.in("racecard_id", racecardIds)
		.neq("race_result", "PENDING");

	if (existingError) {
		console.error("❌ Erro ao buscar resultados existentes:", existingError);
		return;
	}

	const processedIds = new Set(
		(existingResults || []).map((r) => r.racecard_id),
	);
	const racesToProcess = pendingRaces.filter((r) => !processedIds.has(r.id));

	console.log(
		`📊 ${racesToProcess.length} corridas para processar (${processedIds.size} já processadas)`,
	);

	if (racesToProcess.length === 0) return;

	let greenCount = 0;
	let redCount = 0;
	let voidCount = 0;
	let errorCount = 0;

	for (const race of racesToProcess) {
		try {
			const result = await processRaceResult(race);
			if (result === "GREEN") greenCount++;
			else if (result === "RED") redCount++;
			else if (result === "VOID") voidCount++;
		} catch (error) {
			console.error(`❌ Erro ao processar corrida ${race.id}:`, error);
			errorCount++;
		}
	}

	console.log("\n" + "=".repeat(50));
	console.log("📊 RESUMO");
	console.log("-".repeat(50));
	console.log(`✅ GREEN: ${greenCount}`);
	console.log(`❌ RED: ${redCount}`);
	console.log(`⚪ VOID: ${voidCount}`);
	console.log(`! Erros: ${errorCount}`);

	if (greenCount + redCount > 0) {
		const winRate = (greenCount / (greenCount + redCount)) * 100;
		console.log(`📈 Win rate: ${winRate.toFixed(1)}%`);
	}
	console.log("=".repeat(50));
}

/**
 * Processar resultado de uma corrida individual
 */
async function processRaceResult(race: {
	id: number;
	date: string;
	course: string;
	title: string;
}): Promise<"GREEN" | "RED" | "VOID" | null> {
	// 1. Buscar top 3 picks desta corrida
	const { data: topPicks, error: picksError } = await supabase
		.schema(getOutputSchema())
		.from("lay_betting_top_picks")
		.select(
			"pick_rank, race_horse_id, horse_name, predicted_probability, market_odd, model_version",
		)
		.eq("racecard_id", race.id)
		.order("pick_rank", { ascending: true });

	if (picksError) {
		console.error(
			`  ❌ Erro ao buscar picks da corrida ${race.id}:`,
			picksError,
		);
		return null;
	}

	if (!topPicks || topPicks.length === 0) {
		// Sem picks gerados para esta corrida — ignorar
		return null;
	}

	if (topPicks.length < 3) {
		console.warn(
			`  ! Corrida ${race.id} tem apenas ${topPicks.length} picks (esperado 3)`,
		);
	}

	// 2. Buscar resultado de cada cavalo dos picks
	const horseIds = topPicks.map((p) => p.race_horse_id);
	const { data: horseResults, error: horsesError } = await supabase
		.schema(getDataSchema())
		.from("race_horses_hr_enriched")
		.select("id, position, non_runner, horse")
		.in("id", horseIds);

	if (horsesError) {
		console.error(`  ❌ Erro ao buscar resultados dos cavalos:`, horsesError);
		return null;
	}

	if (!horseResults || horseResults.length === 0) {
		console.warn(`  ! Sem resultados de cavalos para corrida ${race.id}`);
		return null;
	}

	// 3. Mapear resultado por pick_rank
	const resultByRank = new Map<number, { pick: TopPick; horse: HorseResult }>();
	for (const pick of topPicks as TopPick[]) {
		const horse = horseResults.find((h) => h.id === pick.race_horse_id);
		if (horse) {
			resultByRank.set(pick.pick_rank, { pick, horse: horse as HorseResult });
		}
	}

	const pick1 = resultByRank.get(1);
	const pick2 = resultByRank.get(2);
	const pick3 = resultByRank.get(3);

	if (!pick1) {
		console.warn(`  ! Corrida ${race.id} sem pick rank 1`);
		return null;
	}

	// 4. Determinar resultado da corrida (RED se qualquer um venceu)
	const winners: number[] = [];
	let raceResult: "GREEN" | "RED" | "VOID" = "GREEN";

	if (pick1?.horse.position === 1) winners.push(1);
	if (pick2?.horse.position === 1) winners.push(2);
	if (pick3?.horse.position === 1) winners.push(3);

	// VOID: todos os 3 picks foram non-runners
	const pick1NR = pick1?.horse.non_runner === 1;
	const pick2NR = pick2?.horse.non_runner === 1;
	const pick3NR = pick3?.horse.non_runner === 1;

	if (pick1NR && pick2NR && pick3NR) {
		raceResult = "VOID";
	} else if (winners.length > 0) {
		raceResult = "RED";
	}

	const winnerPickRank = winners.length > 0 ? winners[0] : null;
	const winnerData = winnerPickRank ? resultByRank.get(winnerPickRank) : null;

	// 5. Determinar pick operacional (cascading: pick1 → pick2 se NR → pick3)
	let operationalPick: { pick: TopPick; horse: HorseResult } | null = null;
	let operationalRank: number | null = null;
	let operationalIsNR = false;

	if (pick1 && !pick1NR) {
		operationalPick = pick1;
		operationalRank = 1;
	} else if (pick2 && !pick2NR) {
		operationalPick = pick2;
		operationalRank = 2;
		operationalIsNR = true; // pick original (1) era NR
	} else if (pick3 && !pick3NR) {
		operationalPick = pick3;
		operationalRank = 3;
		operationalIsNR = true; // picks 1 e 2 eram NR
	}

	// 6. Calcular P&L baseado no pick operacional
	const stake = 100;
	let profitLoss: number | null = null;

	if (operationalPick && raceResult !== "VOID") {
		const operationalWon = operationalPick.horse.position === 1;
		const odd = operationalPick.pick.market_odd || 0;

		if (operationalWon && odd > 0) {
			// LAY perdeu: pagamos stake × (odd - 1)
			profitLoss = -stake * (odd - 1);
		} else if (!operationalWon) {
			// LAY ganhou: recebemos o stake (descontando comissão de 5%)
			profitLoss = stake * 0.95;
		}
	}

	// 7. Upsert na tabela de resultados
	const record = {
		racecard_id: race.id,
		race_date: race.date,
		course: race.course,
		race_title: race.title,
		model_version: pick1.pick.model_version,
		race_result: raceResult,
		winner_pick_rank: winnerPickRank,
		winner_horse_name: winnerData?.horse.horse || null,
		winner_position: winnerData?.horse.position || null,
		operational_pick_rank: operationalRank,
		operational_horse_name: operationalPick?.horse.horse || null,
		operational_odd: operationalPick?.pick.market_odd || null,
		operational_is_nr: operationalIsNR,
		stake,
		profit_loss: profitLoss,
		pick1_horse: pick1?.horse.horse || null,
		pick1_probability: pick1?.pick.predicted_probability || null,
		pick1_position: pick1?.horse.position || null,
		pick1_is_nr: pick1NR,
		pick2_horse: pick2?.horse.horse || null,
		pick2_probability: pick2?.pick.predicted_probability || null,
		pick2_position: pick2?.horse.position || null,
		pick2_is_nr: pick2NR,
		pick3_horse: pick3?.horse.horse || null,
		pick3_probability: pick3?.pick.predicted_probability || null,
		pick3_position: pick3?.horse.position || null,
		pick3_is_nr: pick3NR,
		resolved_at: new Date().toISOString(),
	};

	const { error: upsertError } = await supabase
		.schema(getDataSchema())
		.from("lay_betting_race_results")
		.upsert(record, { onConflict: "racecard_id,model_version" });

	if (upsertError) {
		console.error(
			`  ❌ Erro ao salvar resultado da corrida ${race.id}:`,
			upsertError,
		);
		return null;
	}

	// 8. Log do resultado
	const emoji =
		raceResult === "GREEN" ? "✅" : raceResult === "RED" ? "❌" : "⚪";
	console.log(
		`  ${emoji} ${race.course} (${race.id}): ${raceResult}` +
			(winnerData
				? ` — vencedor: ${winnerData.horse.horse} (pick ${winnerPickRank})`
				: "") +
			(operationalIsNR ? ` [usou pick ${operationalRank} por NR]` : "") +
			(profitLoss !== null ? ` | P&L: ${profitLoss.toFixed(2)}` : ""),
	);

	return raceResult;
}

/**
 * Análise agregada de performance baseada em race_results
 */
export async function analyzeRaceResultsPerformance(days = 30): Promise<void> {
	console.log(`\n📊 PERFORMANCE LAY (últimos ${days} dias)`);
	console.log("=".repeat(50));

	const startDate = new Date(
		Date.now() - days * 24 * 60 * 60 * 1000,
	).toISOString();

	const { data, error } = await supabase
		.schema(getDataSchema())
		.from("lay_betting_race_results")
		.select("*")
		.gte("race_date", startDate)
		.neq("race_result", "PENDING");

	if (error || !data || data.length === 0) {
		console.log("Sem dados suficientes");
		return;
	}

	const green = data.filter((d) => d.race_result === "GREEN");
	const red = data.filter((d) => d.race_result === "RED");
	const voids = data.filter((d) => d.race_result === "VOID");

	const totalDecided = green.length + red.length;
	const winRate = totalDecided > 0 ? (green.length / totalDecided) * 100 : 0;

	const totalProfit = data.reduce((sum, d) => sum + (d.profit_loss || 0), 0);
	const avgStake = 100;
	const roi =
		totalDecided > 0 ? (totalProfit / (totalDecided * avgStake)) * 100 : 0;

	console.log(`Total: ${data.length} corridas`);
	console.log(`✅ GREEN: ${green.length}`);
	console.log(`❌ RED: ${red.length}`);
	console.log(`⚪ VOID: ${voids.length}`);
	console.log(`📈 Win rate: ${winRate.toFixed(1)}%`);
	console.log(`💰 P&L total: ${totalProfit.toFixed(2)}`);
	console.log(`📊 ROI: ${roi.toFixed(1)}%`);

	// Breakdown por modelo
	const flat = data.filter((d) => d.model_version?.includes("flat"));
	const jump = data.filter((d) => d.model_version?.includes("jump"));

	if (flat.length > 0 && jump.length > 0) {
		console.log("\n--- Por modelo ---");
		const flatGreen = flat.filter((d) => d.race_result === "GREEN").length;
		const flatRed = flat.filter((d) => d.race_result === "RED").length;
		const jumpGreen = jump.filter((d) => d.race_result === "GREEN").length;
		const jumpRed = jump.filter((d) => d.race_result === "RED").length;

		console.log(
			`Flat: ${flatGreen}G / ${flatRed}R = ${flatGreen + flatRed > 0 ? ((flatGreen / (flatGreen + flatRed)) * 100).toFixed(1) : "N/A"}%`,
		);
		console.log(
			`Jump: ${jumpGreen}G / ${jumpRed}R = ${jumpGreen + jumpRed > 0 ? ((jumpGreen / (jumpGreen + jumpRed)) * 100).toFixed(1) : "N/A"}%`,
		);
	}

	// Cascading impact
	const cascaded = data.filter((d) => d.operational_is_nr === true);
	if (cascaded.length > 0) {
		const cascadedGreen = cascaded.filter(
			(d) => d.race_result === "GREEN",
		).length;
		const cascadedRed = cascaded.filter((d) => d.race_result === "RED").length;
		console.log(`\n--- Cascading (pick 1 era NR) ---`);
		console.log(
			`${cascaded.length} corridas: ${cascadedGreen}G / ${cascadedRed}R`,
		);
	}

	console.log("=".repeat(50));
}
