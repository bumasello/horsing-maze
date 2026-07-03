// Smoke test pra topKListMLELoss
// Roda com: npx ts-node src/oneTimeScript/test_listmle_loss.ts

import * as tf from "@tensorflow/tfjs-node";

const MAX_HORSES = 30;
const K = 5;
const DNF = 99;

// Reimplementação local (cópia exata da do training_final.ts pra teste isolado)
function topKListMLELoss(
  scores: tf.Tensor2D,
  finishOrder: tf.Tensor2D,
  validRanks: tf.Tensor2D,
  mask: tf.Tensor2D,
  K: number,
): tf.Scalar {
  return tf.tidy(() => {
    const sortedScores = tf.gather(scores, finishOrder, 1, 1) as tf.Tensor2D;
    const sortedMask = tf.gather(mask, finishOrder, 1, 1) as tf.Tensor2D;
    const M_dim = scores.shape[1];

    const stepLosses: tf.Tensor1D[] = [];
    const stepWeights: tf.Tensor1D[] = [];

    for (let k = 0; k < K; k++) {
      const posMaskArr = new Float32Array(M_dim);
      for (let i = k; i < M_dim; i++) posMaskArr[i] = 1;
      const posMask = tf.tensor1d(posMaskArr);
      const denomMask = sortedMask.mul(posMask) as tf.Tensor2D;
      const adjusted = sortedScores.add(
        denomMask.sub(1).mul(1e9),
      ) as tf.Tensor2D;
      const logSumExp_k = tf.logSumExp(adjusted, -1) as tf.Tensor1D;

      const score_k = sortedScores
        .slice([0, k], [-1, 1])
        .squeeze([1]) as tf.Tensor1D;
      const valid_k = validRanks
        .slice([0, k], [-1, 1])
        .squeeze([1]) as tf.Tensor1D;

      stepLosses.push(
        score_k.sub(logSumExp_k).neg().mul(valid_k) as tf.Tensor1D,
      );
      stepWeights.push(valid_k);
    }

    const stacked = tf.stack(stepLosses) as tf.Tensor2D;
    const stackedW = tf.stack(stepWeights) as tf.Tensor2D;
    return stacked.sum().div(stackedW.sum().add(1e-9)) as tf.Scalar;
  });
}

// Gera dados sintéticos: races com field sizes variados (3-15), alguns DNFs
function buildSyntheticBatch(B: number, featureDim: number) {
  const xBuf = new Float32Array(B * MAX_HORSES * featureDim);
  const yBuf = new Float32Array(B * MAX_HORSES);
  const finBuf = new Int32Array(B * MAX_HORSES);
  const valBuf = new Float32Array(B * MAX_HORSES);
  const maskBuf = new Float32Array(B * MAX_HORSES);

  for (let r = 0; r < B; r++) {
    const N = 3 + Math.floor(Math.random() * 13); // 3-15 cavalos
    // ~5% chance de algum DNF
    const positions: number[] = [];
    const dnfMask: boolean[] = [];
    for (let i = 0; i < N; i++) {
      dnfMask.push(Math.random() < 0.05);
    }
    let nextPos = 1;
    for (let i = 0; i < N; i++) {
      if (dnfMask[i]) positions.push(DNF);
      else positions.push(nextPos++);
    }
    // Shuffle a ordem original (cavalos não chegam na ordem em que estão no array)
    const indices = positions.map((p, i) => ({ p, i }));
    indices.sort(() => Math.random() - 0.5);
    const shuffledPositions = indices.map((x) => x.p);
    const originalIndexes = indices.map((x) => x.i);

    // Preenche features (random), winner one-hot, mask
    for (let h = 0; h < MAX_HORSES; h++) {
      const idx = r * MAX_HORSES + h;
      if (h < N) {
        for (let f = 0; f < featureDim; f++) {
          xBuf[(r * MAX_HORSES + h) * featureDim + f] = Math.random() * 2 - 1;
        }
        maskBuf[idx] = 1;
        yBuf[idx] = shuffledPositions[h] === 1 ? 1 : 0;
      } else {
        maskBuf[idx] = 0;
        yBuf[idx] = -1;
      }
    }

    // finishOrder: índices ordenados pelo finishPosition
    const sortedByPos = originalIndexes
      .map((origIdx, sortedIdx) => ({ origIdx, pos: shuffledPositions[sortedIdx] }))
      .sort((a, b) => a.pos - b.pos);
    const realFinishers = sortedByPos.filter((x) => x.pos < DNF).length;
    const Keff = Math.min(K, realFinishers);

    for (let k = 0; k < MAX_HORSES; k++) {
      const idx = r * MAX_HORSES + k;
      if (k < N) {
        // sortedByPos[k] tem o cavalo (na ordem original do array) que terminou em k-ésimo
        // Mas finishOrder espera o índice DENTRO do slot da corrida (que é igual à ordem original aqui)
        finBuf[idx] = originalIndexes.indexOf(sortedByPos[k].origIdx);
      } else {
        finBuf[idx] = k;
      }
      valBuf[idx] = k < Keff ? 1 : 0;
    }
  }

  return {
    x: tf.tensor3d(xBuf, [B, MAX_HORSES, featureDim]),
    y: tf.tensor2d(yBuf, [B, MAX_HORSES]),
    finishOrder: tf.tensor2d(finBuf, [B, MAX_HORSES], "int32"),
    validRanks: tf.tensor2d(valBuf, [B, MAX_HORSES]),
    mask: tf.tensor2d(maskBuf, [B, MAX_HORSES]),
  };
}

async function main() {
  console.log("🧪 SMOKE TEST — Top-K ListMLE Loss\n");

  const B = 32;
  const featureDim = 8;
  const data = buildSyntheticBatch(B, featureDim);

  console.log("✅ Dados sintéticos gerados:");
  console.log(`   batch: ${B}, max_horses: ${MAX_HORSES}, features: ${featureDim}`);

  // TESTE 1: Loss com scores aleatórios deve ser positiva e finita
  const randomScores = tf.randomNormal([B, MAX_HORSES]) as tf.Tensor2D;
  const loss1 = topKListMLELoss(
    randomScores,
    data.finishOrder,
    data.validRanks,
    data.mask,
    K,
  );
  const lossVal1 = loss1.dataSync()[0];
  console.log(`\n📊 TESTE 1 — Random scores:`);
  console.log(`   loss = ${lossVal1.toFixed(4)} (esperado: positivo, finito, ~log(field_size))`);
  console.assert(Number.isFinite(lossVal1), "Loss não é finita!");
  console.assert(lossVal1 > 0, "Loss deve ser positiva!");

  // TESTE 2: Loss com scores "perfeitos" (alinhados com finishOrder) deve ser próxima de 0
  // Cria scores onde a posição que terminou em 1º tem score alto, 2º um pouco menor, etc.
  const perfectScoresBuf = new Float32Array(B * MAX_HORSES);
  const finBufArr = await data.finishOrder.array();
  const maskBufArr = await data.mask.array();
  for (let r = 0; r < B; r++) {
    for (let k = 0; k < MAX_HORSES; k++) {
      if ((maskBufArr as number[][])[r][k] === 1) {
        // Encontra a posição final deste cavalo (k é o índice do cavalo)
        const finishRank = (finBufArr as number[][])[r].indexOf(k);
        // Score = -finishRank: vencedor (rank 0) tem score 0, 2º tem -1, etc.
        perfectScoresBuf[r * MAX_HORSES + k] = -finishRank * 2;
      }
    }
  }
  const perfectScores = tf.tensor2d(perfectScoresBuf, [B, MAX_HORSES]);
  const loss2 = topKListMLELoss(
    perfectScores,
    data.finishOrder,
    data.validRanks,
    data.mask,
    K,
  );
  const lossVal2 = loss2.dataSync()[0];
  console.log(`\n📊 TESTE 2 — Perfect scores (deve ser MENOR que random):`);
  console.log(`   loss = ${lossVal2.toFixed(4)}`);
  console.assert(lossVal2 < lossVal1, "Perfect scores devem ter loss menor que random!");

  // TESTE 3: Gradiente flui — minimize por algumas iterações
  console.log(`\n📊 TESTE 3 — Gradient descent (deve convergir):`);
  const trainable = tf.variable(tf.randomNormal([B, MAX_HORSES]));
  const opt = tf.train.adam(0.1);

  for (let step = 0; step < 30; step++) {
    const lossVal = opt.minimize(() => {
      return topKListMLELoss(
        trainable as tf.Tensor2D,
        data.finishOrder,
        data.validRanks,
        data.mask,
        K,
      );
    }, true) as tf.Scalar;
    if (step % 5 === 0) {
      console.log(`   step ${step}: loss = ${lossVal.dataSync()[0].toFixed(4)}`);
    }
    lossVal.dispose();
  }

  // TESTE 4: Edge case — corrida com só 1 finisher real (resto DNF)
  console.log(`\n📊 TESTE 4 — Edge case (apenas 1 finisher por corrida):`);
  const edgeFin = new Int32Array(MAX_HORSES);
  const edgeVal = new Float32Array(MAX_HORSES);
  const edgeMask = new Float32Array(MAX_HORSES);
  for (let i = 0; i < 5; i++) {
    edgeFin[i] = i;
    edgeMask[i] = 1;
  }
  for (let i = 5; i < MAX_HORSES; i++) edgeFin[i] = i;
  edgeVal[0] = 1; // só rank 0 conta (K_eff = 1)
  const edgeScores = tf.randomNormal([1, MAX_HORSES]) as tf.Tensor2D;
  const lossEdge = topKListMLELoss(
    edgeScores,
    tf.tensor2d(edgeFin, [1, MAX_HORSES], "int32"),
    tf.tensor2d(edgeVal, [1, MAX_HORSES]),
    tf.tensor2d(edgeMask, [1, MAX_HORSES]),
    K,
  );
  console.log(`   loss = ${lossEdge.dataSync()[0].toFixed(4)} (esperado: finita, positiva)`);

  console.log("\n✅ Todos os testes passaram!");

  // Cleanup
  data.x.dispose();
  data.y.dispose();
  data.finishOrder.dispose();
  data.validRanks.dispose();
  data.mask.dispose();
  randomScores.dispose();
  perfectScores.dispose();
  loss1.dispose();
  loss2.dispose();
  lossEdge.dispose();
  trainable.dispose();
}

main().catch((err) => {
  console.error("❌ FAIL:", err);
  process.exit(1);
});
