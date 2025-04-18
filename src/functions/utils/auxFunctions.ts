// Função para calcular a média de um array de números
export const average = (numbers: number[]): number =>
  numbers.reduce((sum, n) => sum + n, 0) / (numbers.length || 1);

// Função para calcular a variância
export const variance = (numbers: number[], avg: number): number =>
  numbers.reduce((sum, n) => sum + (n - avg) ** 2, 0) / (numbers.length || 1);

// Função para contar vitórias (posição == 1)
export const countWins = (positions: number[]): number =>
  positions.filter((pos) => pos === 1).length;

// Função para contar colocados (posição <= 3)
export const countPlaces = (positions: number[]): number =>
  positions.filter((pos) => pos <= 3).length;

// Função para converter distância (ex: "5f") para metros (1f ≈ 201.168 meters)
export const convertFurlongsToMeters = (distanceStr: string): number => {
  // Constantes de conversão
  const FURLONG_TO_METERS = 201.168;
  const YARD_TO_METERS = 0.9144;
  const MILE_TO_FURLONGS = 8;

  // Remover espaços e converter para minúsculas
  const cleanStr = distanceStr.toLowerCase().trim();

  // Caso 1: formato "1m4f" (milhas e furlongs)
  const mileAndFurlongMatch = cleanStr.match(/(\d+)m(\d+)f/);
  if (mileAndFurlongMatch) {
    const miles = Number.parseInt(mileAndFurlongMatch[1], 10);
    const furlongs = Number.parseInt(mileAndFurlongMatch[2], 10);
    return Math.round(
      (miles * MILE_TO_FURLONGS + furlongs) * FURLONG_TO_METERS,
    );
  }

  // Caso 2: formato "6f" (apenas furlongs)
  const furlongMatch = cleanStr.match(/(\d+(\.\d+)?)f/);
  if (furlongMatch) {
    return Math.round(Number.parseFloat(furlongMatch[1]) * FURLONG_TO_METERS);
  }

  // Caso 3: formato "6f110y" (furlongs e jardas)
  const furlongYardMatch = cleanStr.match(/(\d+)f(\d+)y/);
  if (furlongYardMatch) {
    const furlongs = Number.parseInt(furlongYardMatch[1], 10);
    const yards = Number.parseInt(furlongYardMatch[2], 10);
    return Math.round(furlongs * FURLONG_TO_METERS + yards * YARD_TO_METERS);
  }

  // Caso 4: formato "1m" (apenas milhas)
  const mileMatch = cleanStr.match(/(\d+(\.\d+)?)m$/);
  if (mileMatch) {
    return Math.round(
      Number.parseFloat(mileMatch[1]) * MILE_TO_FURLONGS * FURLONG_TO_METERS,
    );
  }

  // Caso 5: formato numérico simples (assumindo que são furlongs)
  const numericMatch = cleanStr.match(/^(\d+(\.\d+)?)$/);
  if (numericMatch) {
    return Math.round(Number.parseFloat(numericMatch[1]) * FURLONG_TO_METERS);
  }

  // Se chegou aqui, não conseguiu interpretar o formato
  console.warn(`Formato de distância não reconhecido: ${distanceStr}`);
  return 0;
};

export const cleanDateString = (dateStr: string): string => {
  return dateStr
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/[\/\.]/g, "-");
};

export const convertHorseWeightToKg = (weightStr: string): number => {
  // Constantes de conversão
  const POUND_TO_KG = 0.45359237;
  const STONE_TO_POUNDS = 14;

  // Remover espaços
  const cleanStr = weightStr.trim();

  // Formato "11-12" (11 stones e 12 pounds)
  const stonePoundMatch = cleanStr.match(/(\d+)-(\d+)/);
  if (stonePoundMatch) {
    const stones = Number.parseInt(stonePoundMatch[1], 10);
    const pounds = Number.parseInt(stonePoundMatch[2], 10);

    // Converter stones para pounds e adicionar aos pounds extra
    const totalPounds = stones * STONE_TO_POUNDS + pounds;

    // Converter pounds para kg com precisão de 2 casas decimais
    return Number.parseFloat((totalPounds * POUND_TO_KG).toFixed(2));
  }

  // Caso tenha apenas stones (ex: "11")
  const stonesOnlyMatch = cleanStr.match(/^(\d+)$/);
  if (stonesOnlyMatch) {
    const stones = Number.parseInt(stonesOnlyMatch[1], 10);
    return Number.parseFloat(
      (stones * STONE_TO_POUNDS * POUND_TO_KG).toFixed(2),
    );
  }

  // Caso tenha apenas pounds (ex: "165lb" ou "165")
  const poundsMatch = cleanStr.match(/^(\d+)(?:lb)?$/);
  if (poundsMatch) {
    const pounds = Number.parseInt(poundsMatch[1], 10);
    return Number.parseFloat((pounds * POUND_TO_KG).toFixed(2));
  }

  // Se chegou aqui, não conseguiu interpretar o formato
  console.warn(`Formato de peso não reconhecido: ${weightStr}`);
  return 0;
};
