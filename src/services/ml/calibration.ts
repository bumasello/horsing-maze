// src/services/ml/calibration.ts
//
// Isotonic Regression via Pool Adjacent Violators (PAV).
// Dado pares (probabilidade bruta, label 0/1), ajusta uma função monótona
// não-decrescente f tal que f(p) é a probabilidade calibrada.
//
// Uso esperado no HorsingMaze:
//   1. Após restaurar best weights, roda evaluateModel no val set.
//   2. Para cada cavalo válido: x = P(win) bruto, y = label (1 se vencedor, 0 cc).
//   3. fitIsotonic(pares) → IsotonicCurve (knots monotônicos).
//   4. Salva curve em config.calibration.
//   5. Predição aplica applyIsotonic(curve, p) por cavalo + renormaliza dentro da corrida.
//
// Referência: Niculescu-Mizil & Caruana 2005; Zadrozny & Elkan 2002.

export interface IsotonicCurve {
  x: number[]; // breakpoints (monótono não-decrescente)
  y: number[]; // valores calibrados nos breakpoints (monótono não-decrescente)
}

/**
 * Pool Adjacent Violators puro (sem deps).
 *
 * Implementação clássica O(n): mantém blocos (sum_y, weight). Quando o próximo
 * bloco viola monotonia com o anterior (mean_anterior > mean_atual), funde os dois
 * e propaga pra trás enquanto necessário.
 *
 * @param pairs lista de pares (x, y). x = probabilidade bruta, y = label (geralmente 0/1).
 *              Não precisa estar ordenado por x; ordenamos internamente.
 * @param weights opcional, pesos por par. Default = 1 cada.
 * @returns IsotonicCurve com breakpoints ordenados por x.
 */
export function fitIsotonic(
  pairs: Array<{ x: number; y: number }>,
  weights?: number[],
): IsotonicCurve {
  if (pairs.length === 0) {
    return { x: [0, 1], y: [0, 1] };
  }

  // Indexa antes de ordenar pra alinhar weights
  const idxs = pairs.map((_, i) => i);
  idxs.sort((a, b) => pairs[a].x - pairs[b].x);

  const xs = idxs.map((i) => pairs[i].x);
  const ys = idxs.map((i) => pairs[i].y);
  const ws = weights ? idxs.map((i) => weights[i]) : new Array(pairs.length).fill(1);

  // Blocos: cada um é { sumY, sumW, maxIndex } onde maxIndex aponta pro último ponto coberto
  interface Block {
    sumY: number;
    sumW: number;
    lastIdx: number;
  }
  const blocks: Block[] = [];

  for (let i = 0; i < xs.length; i++) {
    let curBlock: Block = { sumY: ys[i] * ws[i], sumW: ws[i], lastIdx: i };
    // Funde com blocos anteriores enquanto violar monotonia
    while (blocks.length > 0) {
      const prev = blocks[blocks.length - 1];
      const prevMean = prev.sumY / prev.sumW;
      const curMean = curBlock.sumY / curBlock.sumW;
      if (prevMean <= curMean) break;
      // Funde
      blocks.pop();
      curBlock = {
        sumY: prev.sumY + curBlock.sumY,
        sumW: prev.sumW + curBlock.sumW,
        lastIdx: curBlock.lastIdx,
      };
    }
    blocks.push(curBlock);
  }

  // Expande blocos pra ter um y_i monótono por ponto
  const ysCalibrated = new Array<number>(xs.length);
  let cursor = 0;
  for (const b of blocks) {
    const mean = b.sumY / b.sumW;
    while (cursor <= b.lastIdx) {
      ysCalibrated[cursor] = mean;
      cursor++;
    }
  }

  // Compacta knots: pontos consecutivos com mesmo y viram um único knot
  // (mantém primeiro e último de cada plateau pra interpolação linear funcionar)
  const knotsX: number[] = [];
  const knotsY: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (i === 0) {
      knotsX.push(xs[i]);
      knotsY.push(ysCalibrated[i]);
      continue;
    }
    if (i === xs.length - 1) {
      knotsX.push(xs[i]);
      knotsY.push(ysCalibrated[i]);
      continue;
    }
    // Ponto intermediário: só inclui se o y MUDA aqui (boundary entre blocos)
    if (ysCalibrated[i] !== ysCalibrated[i - 1]) {
      // Inclui o último ponto do bloco anterior (i-1) pra deixar o plateau visível
      if (
        knotsX.length === 0 ||
        knotsX[knotsX.length - 1] !== xs[i - 1]
      ) {
        knotsX.push(xs[i - 1]);
        knotsY.push(ysCalibrated[i - 1]);
      }
      knotsX.push(xs[i]);
      knotsY.push(ysCalibrated[i]);
    }
  }

  return { x: knotsX, y: knotsY };
}

/**
 * Aplica a curva isotonic a um valor x (interpolação linear entre knots).
 * Pontos fora do range são clampados ao boundary (extrapolação plana).
 */
export function applyIsotonic(curve: IsotonicCurve, x: number): number {
  const { x: xs, y: ys } = curve;
  if (xs.length === 0) return x;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[xs.length - 1];

  // Busca binária pelo intervalo
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const x0 = xs[lo];
  const x1 = xs[hi];
  const y0 = ys[lo];
  const y1 = ys[hi];
  if (x1 === x0) return y0;
  const t = (x - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

/**
 * Aplica isotonic em todos os cavalos válidos de uma corrida e renormaliza
 * a distribuição pra somar 1.
 *
 * Renormalização é necessária porque applyIsotonic não preserva soma=1
 * (cada cavalo é calibrado independentemente). Sem renormalizar, P(win)
 * deixa de ser uma distribuição válida.
 *
 * @param curve curva ajustada
 * @param rawProbs P(win) brutas de cada cavalo válido da corrida
 * @returns P(win) calibradas que somam 1
 */
export function applyIsotonicToRace(
  curve: IsotonicCurve,
  rawProbs: number[],
): number[] {
  const calibrated = rawProbs.map((p) => applyIsotonic(curve, p));
  const sum = calibrated.reduce((s, p) => s + p, 0);
  if (sum <= 0) {
    // fallback: distribuição uniforme se tudo zerou (improvável)
    const n = rawProbs.length;
    return rawProbs.map(() => 1 / n);
  }
  return calibrated.map((p) => p / sum);
}
