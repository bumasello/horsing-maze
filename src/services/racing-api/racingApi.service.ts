// src/service/racing-api/racingApi.service.ts

import dotenv from "dotenv";
import { supabase } from "../..";
import { getDataSchema } from "../../shared/db-config";

dotenv.config();

// ============================================================================
// TYPES
// ============================================================================

interface RacingApiRunner {
	horse: string;
	horse_id: string;
	age: string;
	sex: string;
	sex_code: string;
	colour: string;
	region: string;
	dam: string;
	dam_id: string;
	sire: string;
	sire_id: string;
	damsire: string;
	damsire_id: string;
	trainer: string;
	trainer_id: string;
	owner: string;
	owner_id: string;
	number: string;
	draw: string;
	headgear: string;
	lbs: string;
	ofr: string;
	jockey: string;
	jockey_id: string;
	last_run: string;
	form: string;
}

interface RacingApiResultRunner extends RacingApiRunner {
	position: string;
	weight: string;
	weight_lbs: string;
	or: string;
}

interface RacingApiRacecard {
	race_id: string;
	course: string;
	date: string;
	off_time: string;
	off_dt: string;
	race_name: string;
	distance_f: string;
	region: string;
	pattern: string;
	race_class: string;
	type: string;
	age_band: string;
	rating_band: string;
	sex_restriction: string;
	prize: string;
	field_size: string;
	going: string;
	surface: string;
	runners: RacingApiRunner[];
	race_status: string;
}

interface RacingApiResult {
	race_id: string;
	course: string;
	date: string;
	off: string;
	off_dt: string;
	race_name: string;
	dist_f: string;
	region: string;
	pattern: string;
	class: string;
	type: string;
	age_band: string;
	rating_band: string;
	going: string;
	surface: string;
	runners: RacingApiResultRunner[];
	sex_rest: string;
}

interface RacingApiRacecardsResponse {
	racecards: RacingApiRacecard[];
	total: number;
	limit: number;
	skip: number;
}

interface RacingApiResultsResponse {
	results: RacingApiResult[];
	total: number;
	limit: number;
	skip: number;
}

export interface EnrichmentStats {
	racesFromApi: number;
	racesMatched: number;
	horsesMatched: number;
	horsesNotMatched: number;
	errors: string[];
}

// ============================================================================
// API CLIENT
// ============================================================================

const RACING_API_BASE_URL = "https://api.theracingapi.com/v1";

function getCredentials(): string {
	const username = process.env.RACING_API_USERNAME;
	const password = process.env.RACING_API_PASSWORD;

	if (!username || !password) {
		throw new Error(
			"RACING_API_USERNAME e RACING_API_PASSWORD devem estar configurados no .env",
		);
	}

	return Buffer.from(`${username}:${password}`).toString("base64");
}

async function fetchFromRacingApi<T>(endpoint: string): Promise<T | null> {
	try {
		const credentials = getCredentials();
		const url = `${RACING_API_BASE_URL}${endpoint}`;

		console.log(`🏇 Racing API: GET ${endpoint}`);

		const response = await fetch(url, {
			method: "GET",
			headers: {
				Authorization: `Basic ${credentials}`,
			},
		});

		if (response.status === 429) {
			console.warn("! Racing API: rate limit atingido, aguardando 60s...");
			await new Promise((resolve) => setTimeout(resolve, 60000));
			// Retry uma vez
			const retryResponse = await fetch(url, {
				method: "GET",
				headers: {
					Authorization: `Basic ${credentials}`,
				},
			});
			if (!retryResponse.ok) {
				console.error(`❌ Racing API: retry falhou (${retryResponse.status})`);
				return null;
			}
			return (await retryResponse.json()) as T;
		}

		if (!response.ok) {
			console.error(`❌ Racing API: erro ${response.status} em ${endpoint}`);
			return null;
		}

		return (await response.json()) as T;
	} catch (error) {
		console.error(`❌ Racing API: exceção em ${endpoint}:`, error);
		return null;
	}
}

// ============================================================================
// FETCH FUNCTIONS
// ============================================================================

async function fetchTodayRacecards(): Promise<RacingApiRacecard[]> {
	const data =
		await fetchFromRacingApi<RacingApiRacecardsResponse>("/racecards/free");
	return data?.racecards || [];
}

async function fetchTodayResults(): Promise<RacingApiResult[]> {
	const data = await fetchFromRacingApi<RacingApiResultsResponse>(
		"/results/today/free",
	);
	return data?.results || [];
}

// ============================================================================
// MATCHING LOGIC
// ============================================================================

/**
 * Normalizar nome de cavalo para matching
 * Racing API: "Mephisto (IRE)", API atual: "Mephisto"
 */
function normalizeHorseName(name: string): string {
	return name
		.replace(/\s*\([A-Z]{2,3}\)\s*$/i, "") // Remove (IRE), (GB), (FR), etc.
		.replace(/[''`']/g, "")
		.trim()
		.toLowerCase();
}

/**
 * Normalizar nome de pista para matching
 * Racing API: "Kempton (AW)", API atual: "Kempton"
 * Racing API: "Ballinrobe (IRE)", API atual: "Ballinrobe"
 */
function normalizeCourseName(name: string): string {
	return name
		.replace(/\s*\([A-Z]{2,3}\)\s*$/i, "") // Remove (AW), (IRE), etc.
		.replace(/\s*\(aw\)\s*$/i, "") // Remove (aw) case insensitive
		.trim()
		.toLowerCase();
}

// ============================================================================
// ENRICHMENT: RACECARDS (antes das corridas)
// ============================================================================

/**
 * Buscar racecards da Racing API e enriquecer dados no Supabase
 * Chamada: no pipeline, ANTES de gerar prediction features
 */
export async function enrichRacecardsFromRacingApi(): Promise<EnrichmentStats> {
	console.log("\n🏇 [Racing API] Iniciando enriquecimento de racecards...");

	const stats: EnrichmentStats = {
		racesFromApi: 0,
		racesMatched: 0,
		horsesMatched: 0,
		horsesNotMatched: 0,
		errors: [],
	};

	// 1. Fetch da Racing API
	const racecards = await fetchTodayRacecards();
	stats.racesFromApi = racecards.length;

	if (racecards.length === 0) {
		console.log("  i Nenhum racecard retornado pela Racing API");
		return stats;
	}

	console.log(`  📥 ${racecards.length} corridas recebidas da Racing API`);

	// 2. Buscar corridas de hoje no Supabase (não finalizadas)
	const today = new Date().toISOString().split("T")[0];
	const { data: supabaseRaces, error: racesError } = await supabase
		.schema(getDataSchema())
		.from("racecards_hr_enriched")
		.select("id, id_race, course, date, off_time_br, off_time_uk")
		.eq("finished", 0)
		.eq("canceled", 0)
		.gte("date", today);

	if (racesError) {
		console.error("  ❌ Erro ao buscar corridas do Supabase:", racesError);
		stats.errors.push(`Supabase races error: ${racesError.message}`);
		return stats;
	}

	if (!supabaseRaces || supabaseRaces.length === 0) {
		console.log("  i Nenhuma corrida futura encontrada no Supabase");
		return stats;
	}

	console.log(`  📊 ${supabaseRaces.length} corridas futuras no Supabase`);

	// 3. Match Racing API ↔ Supabase por course + date
	for (const apiRace of racecards) {
		const apiCourse = normalizeCourseName(apiRace.course);
		const apiDate = apiRace.date;

		const matchedRace = supabaseRaces.find((spbRace) => {
			const spbCourse = normalizeCourseName(spbRace.course);
			const spbDate = spbRace.date?.split("T")[0];
			const spbTime = spbRace.off_time_uk?.trim();
			const apiTime = apiRace.off_time?.trim();
			return (
				spbCourse === apiCourse && spbDate === apiDate && spbTime === apiTime
			);
		});

		if (!matchedRace) continue;
		stats.racesMatched++;

		// 4. Atualizar corrida com type e surface
		const { error: raceUpdateError } = await supabase
			.schema(getDataSchema())
			.from("racecards_hr_enriched")
			.update({
				race_type: apiRace.type || null,
				surface:
					apiRace.surface ||
					(apiRace.course.toLowerCase().includes("(aw)") ? "AW" : "Turf"),
			})
			.eq("id", matchedRace.id);

		if (raceUpdateError) {
			stats.errors.push(
				`Race update ${matchedRace.id_race}: ${raceUpdateError.message}`,
			);
			continue;
		}

		// 5. Buscar cavalos desta corrida no Supabase
		const { data: supabaseHorses, error: horsesError } = await supabase
			.schema(getDataSchema())
			.from("race_horses_hr_enriched")
			.select("id, horse, id_horse")
			.eq("racecard_id", matchedRace.id);

		if (horsesError || !supabaseHorses) {
			stats.errors.push(
				`Horses fetch ${matchedRace.id_race}: ${horsesError?.message}`,
			);
			continue;
		}

		// 6. Match cavalos por nome e atualizar
		for (const apiRunner of apiRace.runners) {
			const apiHorseName = normalizeHorseName(apiRunner.horse);

			const matchedHorse = supabaseHorses.find(
				(spbHorse) => normalizeHorseName(spbHorse.horse) === apiHorseName,
			);

			if (!matchedHorse) {
				stats.horsesNotMatched++;
				continue;
			}

			const drawValue = apiRunner.draw
				? Number.parseInt(apiRunner.draw, 10)
				: null;

			const { error: horseUpdateError } = await supabase
				.schema(getDataSchema())
				.from("race_horses_hr_enriched")
				.update({
					draw: Number.isNaN(drawValue as number) ? null : drawValue,
					headgear: apiRunner.headgear || null,
					sex_code: apiRunner.sex_code || null,
					damsire: apiRunner.damsire || null,
					damsire_id: apiRunner.damsire_id || null,
				})
				.eq("id", matchedHorse.id);

			if (horseUpdateError) {
				stats.errors.push(
					`Horse update ${matchedHorse.horse}: ${horseUpdateError.message}`,
				);
			} else {
				stats.horsesMatched++;
			}
		}
	}

	// 7. Salvar raw response
	await saveRawResponse("racecards/free", today, racecards, stats);

	// 8. Log resumo
	console.log("  ✅ Enriquecimento concluído:");
	console.log(
		`     Corridas: ${stats.racesMatched}/${stats.racesFromApi} matched`,
	);
	console.log(
		`     Cavalos: ${stats.horsesMatched} matched, ${stats.horsesNotMatched} não encontrados`,
	);
	if (stats.errors.length > 0) {
		console.log(`     ! ${stats.errors.length} erros:`);
		stats.errors.slice(0, 5).forEach((e) => console.log(`       - ${e}`));
	}

	return stats;
}

// ============================================================================
// ENRICHMENT: RESULTS (após as corridas)
// ============================================================================

/**
 * Buscar resultados da Racing API e enriquecer dados no Supabase
 * Chamada: no pipeline, APÓS updateRacecardsAndDetails
 */
export async function enrichResultsFromRacingApi(): Promise<EnrichmentStats> {
	console.log("\n🏇 [Racing API] Iniciando enriquecimento de resultados...");

	const stats: EnrichmentStats = {
		racesFromApi: 0,
		racesMatched: 0,
		horsesMatched: 0,
		horsesNotMatched: 0,
		errors: [],
	};

	// 1. Fetch da Racing API
	const results = await fetchTodayResults();
	stats.racesFromApi = results.length;

	if (results.length === 0) {
		console.log("  i Nenhum resultado retornado pela Racing API");
		return stats;
	}

	console.log(`  📥 ${results.length} resultados recebidos da Racing API`);

	// 2. Buscar corridas de hoje no Supabase (finalizadas)
	const today = new Date().toISOString().split("T")[0];
	const { data: supabaseRaces, error: racesError } = await supabase
		.schema(getDataSchema())
		.from("racecards_hr_enriched")
		.select("id, id_race, course, date, off_time_br, off_time_uk")
		.eq("finished", 1)
		.gte("date", today);

	if (racesError) {
		console.error("  ❌ Erro ao buscar corridas do Supabase:", racesError);
		stats.errors.push(`Supabase races error: ${racesError.message}`);
		return stats;
	}

	if (!supabaseRaces || supabaseRaces.length === 0) {
		console.log("  i Nenhuma corrida finalizada hoje no Supabase");
		return stats;
	}

	console.log(
		`  📊 ${supabaseRaces.length} corridas finalizadas hoje no Supabase`,
	);

	// 3. Match e enriquecimento (mesma lógica dos racecards)
	for (const apiResult of results) {
		const apiCourse = normalizeCourseName(apiResult.course);
		const apiDate = apiResult.date;

		const matchedRace = supabaseRaces.find((spbRace) => {
			const spbCourse = normalizeCourseName(spbRace.course);
			const spbDate = spbRace.date?.split("T")[0];
			const spbTime = spbRace.off_time_uk?.trim();
			const apiTime = apiResult.off?.trim();
			return (
				spbCourse === apiCourse && spbDate === apiDate && spbTime === apiTime
			);
		});

		if (!matchedRace) continue;
		stats.racesMatched++;

		// Atualizar corrida
		const { error: raceUpdateError } = await supabase
			.schema(getDataSchema())
			.from("racecards_hr_enriched")
			.update({
				race_type: apiResult.type || null,
				surface:
					apiResult.surface ||
					(apiResult.course.toLowerCase().includes("aw") ? "AW" : "Turf"),
			})
			.eq("id", matchedRace.id);

		if (raceUpdateError) {
			stats.errors.push(
				`Race update ${matchedRace.id_race}: ${raceUpdateError.message}`,
			);
		}

		// Buscar cavalos
		const { data: supabaseHorses, error: horsesError } = await supabase
			.schema(getDataSchema())
			.from("race_horses_hr_enriched")
			.select("id, horse, id_horse")
			.eq("racecard_id", matchedRace.id);

		if (horsesError || !supabaseHorses) {
			stats.errors.push(
				`Horses fetch ${matchedRace.id_race}: ${horsesError?.message}`,
			);
			continue;
		}

		// Match cavalos por nome
		for (const apiRunner of apiResult.runners) {
			const apiHorseName = normalizeHorseName(apiRunner.horse);

			const matchedHorse = supabaseHorses.find(
				(spbHorse) => normalizeHorseName(spbHorse.horse) === apiHorseName,
			);

			if (!matchedHorse) {
				stats.horsesNotMatched++;
				continue;
			}

			const drawValue = apiRunner.draw
				? Number.parseInt(apiRunner.draw, 10)
				: null;

			const { error: horseUpdateError } = await supabase
				.schema(getDataSchema())
				.from("race_horses_hr_enriched")
				.update({
					draw: Number.isNaN(drawValue as number) ? null : drawValue,
					headgear: apiRunner.headgear || null,
					sex_code: apiRunner.sex || null, // Results endpoint usa "sex" em vez de "sex_code"
					damsire: apiRunner.damsire || null,
					damsire_id: apiRunner.damsire_id || null,
				})
				.eq("id", matchedHorse.id);

			if (horseUpdateError) {
				stats.errors.push(
					`Horse update ${matchedHorse.horse}: ${horseUpdateError.message}`,
				);
			} else {
				stats.horsesMatched++;
			}
		}
	}

	// Salvar raw response
	await saveRawResponse("results/today/free", today, results, stats);

	console.log("  ✅ Enriquecimento de resultados concluído:");
	console.log(
		`     Corridas: ${stats.racesMatched}/${stats.racesFromApi} matched`,
	);
	console.log(
		`     Cavalos: ${stats.horsesMatched} matched, ${stats.horsesNotMatched} não encontrados`,
	);

	return stats;
}

// ============================================================================
// RAW STORAGE
// ============================================================================

async function saveRawResponse(
	endpoint: string,
	raceDate: string,
	data: any,
	stats: EnrichmentStats,
): Promise<void> {
	try {
		const { error } = await supabase
			.schema(getDataSchema())
			.from("racing_api_raw")
			.upsert(
				{
					endpoint,
					race_date: raceDate,
					response_data: data,
					races_count: stats.racesFromApi,
					matched_count: stats.racesMatched,
					fetched_at: new Date().toISOString(),
				},
				{ onConflict: "endpoint,race_date" },
			);

		if (error) {
			console.warn(`  ! Erro ao salvar raw response: ${error.message}`);
		} else {
			console.log(`  💾 Raw response salvo (${endpoint}, ${raceDate})`);
		}
	} catch (err) {
		console.warn("  ! Exceção ao salvar raw response:", err);
	}
}
