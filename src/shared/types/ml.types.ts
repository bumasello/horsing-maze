/**
 * Tipos compartilhados do módulo de ML
 */

export interface ModelConfig {
  version: number;
  features: string[];
  normalization: {
    mean: number[];
    std: number[];
    median: number[];
    iqr: number[];
  };
  metrics: {
    trainAccuracy: number;
    valAccuracy: number;
    trainLoss: number;
    valLoss: number;
    valBrier?: number;
    valEce?: number;
    timestamp: string;
  };
  training: {
    epochs: number;
    batchSize: number;
    learningRate: number;
    samplesUsed: number;
    classWeights: { [key: number]: number };
  };
  optimalThreshold: number;
  // Curva isotonic ajustada no val set: mapeia P(win) bruto → P(win) calibrado.
  // x e y têm o mesmo tamanho, formam uma escada monótona não-decrescente.
  // Aplicação por horse: y(p) = interpolação linear nos knots; renormalizar dentro da corrida.
  calibration?: {
    method: "isotonic";
    knots: { x: number[]; y: number[] };
    fittedOn: number; // n de pares usados pro fit (n_horses do val set)
  };
  // Se true, a curva acima fica salva pra análise mas NÃO é aplicada na predição.
  // Setado em v53 após eval histórica mostrar -4.66pp ROI vs raw — renormalização
  // pós-isotonic alterava ranking de outsiders e custava lay picks.
  disableCalibration?: boolean;
}
