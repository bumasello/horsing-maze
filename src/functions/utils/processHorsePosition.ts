import type { IHorse_Hr } from "../../models/modelHr/horseHrModel";

// Lista de siglas que indicam que o cavalo participou mas não terminou (Green para Lay)
const didNotFinishCodes = ["PU", "UR", "F", "BD", "RO", "DSQ", "SU", "REF"];

// Lista de siglas que indicam void/anulação
const voidCodes = ["VO", "NR"];

export const processHorsePosition = (hr: IHorse_Hr, raceId: number): void => {
  // Converter position para string para análise
  const positionStr = String(hr.position || "")
    .toUpperCase()
    .trim();

  // Primeiro, verificar se é explicitamente non_runner
  // Aceitar tanto string quanto number para non_runner
  if (hr.non_runner === "1" || hr.non_runner === 1) {
    hr.position = 0;
    hr.non_runner = 1;
    hr.distance_beaten = "VOID";
    return;
  }

  // Verificar se position contém código de void (não participou)
  if (voidCodes.includes(positionStr)) {
    hr.position = 0;
    hr.non_runner = 1;
    hr.distance_beaten = "VOID";
    return;
  }

  // A partir daqui, o cavalo participou da corrida (non_runner = 0)

  // Verificar se é um número válido (posição final na corrida)
  const positionNum = Number(hr.position);
  if (!Number.isNaN(positionNum) && positionNum > 0 && positionNum <= 50) {
    hr.position = positionNum;
    hr.non_runner = 0;
    hr.distance_beaten = hr.distance_beaten || "0";
    return;
  }

  // Verificar se position contém código de não terminou (mas participou)
  if (didNotFinishCodes.includes(positionStr)) {
    hr.position = 99;
    hr.non_runner = 0;
    hr.distance_beaten = "DNF";
    return;
  }

  // Position vazia, nula ou desconhecida
  // Assumir que participou mas não terminou
  if (
    !hr.position ||
    positionStr === "" ||
    positionStr === "NULL" ||
    positionStr === "0"
  ) {
    hr.position = 99;
    hr.non_runner = 0;
    hr.distance_beaten = "DNF";
    return;
  }

  // Valor completamente desconhecido
  console.warn(
    `! Posição não reconhecida: "${hr.position}" para cavalo ${hr.id_horse} na corrida ${raceId}`,
  );
  hr.position = 99;
  hr.non_runner = 0;
  hr.distance_beaten = "UNK"; // Unknown
};
