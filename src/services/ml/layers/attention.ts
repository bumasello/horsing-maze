// src/services/ml/layers/attention.ts
//
// Multi-Head Self-Attention Layer para TensorFlow.js
//
// Implementa self-attention entre cavalos na mesma corrida.
// Input:  [batch, MAX_HORSES, embed_dim]
// Output: [batch, MAX_HORSES, embed_dim]
//
// Cada cavalo "olha" para todos os outros ao construir sua representação.
// Posições padded (features = 0) são mascaradas automaticamente.
//
// IMPORTANTE: este arquivo DEVE ser importado ANTES de tf.loadLayersModel()
// tanto no training quanto na prediction, para que o custom layer seja
// reconhecido ao desserializar o modelo.

import * as tf from "@tensorflow/tfjs-node";

// ============================================================================
// MULTI-HEAD SELF-ATTENTION LAYER
// ============================================================================

interface MultiHeadSelfAttentionConfig {
  numHeads: number;
  keyDim: number;
  dropout?: number;
  name?: string;
}

class MultiHeadSelfAttention extends tf.layers.Layer {
  static readonly className = "MultiHeadSelfAttention";

  private numHeads: number;
  private keyDim: number;
  private dropoutRate: number;
  private embedDim!: number;

  // Pesos (inicializados em build)
  private queryKernel!: tf.LayerVariable;
  private queryBias!: tf.LayerVariable;
  private keyKernel!: tf.LayerVariable;
  private keyBias!: tf.LayerVariable;
  private valueKernel!: tf.LayerVariable;
  private valueBias!: tf.LayerVariable;
  private outputKernel!: tf.LayerVariable;
  private outputBias!: tf.LayerVariable;

  constructor(config: MultiHeadSelfAttentionConfig) {
    super(config as any);
    this.numHeads = config.numHeads;
    this.keyDim = config.keyDim;
    this.dropoutRate = config.dropout ?? 0;
  }

  build(inputShape: tf.Shape | tf.Shape[]): void {
    const shape = Array.isArray(inputShape[0])
      ? (inputShape[0] as number[])
      : (inputShape as number[]);
    this.embedDim = shape[shape.length - 1];
    const totalDim = this.numHeads * this.keyDim;

    // Q, K, V projections: [embed_dim, numHeads * keyDim]
    this.queryKernel = this.addWeight(
      "query_kernel",
      [this.embedDim, totalDim],
      "float32",
      tf.initializers.glorotUniform({}),
    );
    this.queryBias = this.addWeight(
      "query_bias",
      [totalDim],
      "float32",
      tf.initializers.zeros(),
    );
    this.keyKernel = this.addWeight(
      "key_kernel",
      [this.embedDim, totalDim],
      "float32",
      tf.initializers.glorotUniform({}),
    );
    this.keyBias = this.addWeight(
      "key_bias",
      [totalDim],
      "float32",
      tf.initializers.zeros(),
    );
    this.valueKernel = this.addWeight(
      "value_kernel",
      [this.embedDim, totalDim],
      "float32",
      tf.initializers.glorotUniform({}),
    );
    this.valueBias = this.addWeight(
      "value_bias",
      [totalDim],
      "float32",
      tf.initializers.zeros(),
    );

    // Output projection: [totalDim, embed_dim]
    this.outputKernel = this.addWeight(
      "output_kernel",
      [totalDim, this.embedDim],
      "float32",
      tf.initializers.glorotUniform({}),
    );
    this.outputBias = this.addWeight(
      "output_bias",
      [this.embedDim],
      "float32",
      tf.initializers.zeros(),
    );

    this.built = true;
  }

  call(
    inputs: tf.Tensor | tf.Tensor[],
    kwargs?: { training?: boolean },
  ): tf.Tensor {
    return tf.tidy(() => {
      // inputs[0] = encoded features, inputs[1] = padding mask
      const inputArr = inputs as tf.Tensor[];
      const input = inputArr[0];
      const paddingMask = inputArr[1]; // [batch, seqLen] — 1=real, 0=padded
      const [batchSize, seqLen, _] = input.shape;
      const totalDim = this.numHeads * this.keyDim;

      const project = (
        x: tf.Tensor,
        kernel: tf.Tensor,
        bias: tf.Tensor,
      ): tf.Tensor => {
        const [b, s, d] = x.shape;
        const flat = x.reshape([b! * s!, d!]);
        const projected = flat.matMul(kernel).add(bias);
        const outDim = kernel.shape[1]!;
        return projected.reshape([b!, s!, outDim]);
      };

      const Q = project(input, this.queryKernel.read(), this.queryBias.read());
      const K = project(input, this.keyKernel.read(), this.keyBias.read());
      const V = project(input, this.valueKernel.read(), this.valueBias.read());

      const Qr = Q.reshape([batchSize!, seqLen!, this.numHeads, this.keyDim]);
      const Kr = K.reshape([batchSize!, seqLen!, this.numHeads, this.keyDim]);
      const Vr = V.reshape([batchSize!, seqLen!, this.numHeads, this.keyDim]);

      const Qt = Qr.transpose([0, 2, 1, 3]);
      const Kt = Kr.transpose([0, 2, 1, 3]);
      const Vt = Vr.transpose([0, 2, 1, 3]);

      const scale = Math.sqrt(this.keyDim);
      const scores = Qt.matMul(Kt.transpose([0, 1, 3, 2])).div(scale);

      // Mask vem de fora — sem gradiente, sem explosão
      const maskForScores = paddingMask.reshape([batchSize!, 1, 1, seqLen!]);
      const maskedScores = scores.add(maskForScores.sub(1).mul(1e9));

      let attnWeights = tf.softmax(maskedScores, -1);

      if (kwargs?.training && this.dropoutRate > 0) {
        attnWeights = tf.dropout(attnWeights, this.dropoutRate);
      }

      const attended = attnWeights.matMul(Vt);
      const attendedT = attended.transpose([0, 2, 1, 3]);
      const concatenated = attendedT.reshape([batchSize!, seqLen!, totalDim]);
      const output = project(
        concatenated,
        this.outputKernel.read(),
        this.outputBias.read(),
      );

      return output as tf.Tensor;
    });
  }

  computeOutputShape(inputShape: tf.Shape | tf.Shape[]): tf.Shape {
    // Output shape = input shape (same dims, residual-friendly)
    const shape = Array.isArray(inputShape[0])
      ? (inputShape[0] as tf.Shape)
      : (inputShape as tf.Shape);
    return shape;
  }

  getConfig(): tf.serialization.ConfigDict {
    const baseConfig = super.getConfig();
    const config: tf.serialization.ConfigDict = {
      numHeads: this.numHeads,
      keyDim: this.keyDim,
      dropout: this.dropoutRate,
    };
    return { ...baseConfig, ...config };
  }
}

// Registrar para serialização — DEVE rodar antes de loadLayersModel
tf.serialization.registerClass(MultiHeadSelfAttention);

// ============================================================================
// MODEL CREATION — Functional API com Attention
// ============================================================================

interface AttentionModelConfig {
  inputDim: number;
  maxHorses: number;
  numHeads?: number;
  keyDim?: number;
  encoderDim?: number;
  dropoutRate?: number;
  l2Reg?: number;
  /**
   * Se true, adiciona segunda cabeça `lose_output` (sigmoid por cavalo)
   * pra multi-task learning: além do score race-level (softmax → ListMLE),
   * o modelo prevê P(cavalo perder) direto com BCE contra target invertido.
   * Requer training loop que consuma outputs=[score, lose].
   */
  multiTask?: boolean;
}

/**
 * Cria modelo race-level com self-attention.
 *
 * Arquitetura:
 *   Input features [batch, MAX_HORSES, n_features]
 *   Input mask     [batch, MAX_HORSES]              ← 1=real, 0=padding
 *   → Dense(encoderDim, relu)          # per-horse encoding (shared weights)
 *   → MultiHeadSelfAttention           # cross-horse interaction (recebe mask)
 *   → Add (residual) + LayerNorm       # estabiliza gradientes
 *   → Dense(32, relu) + Dropout
 *   → Dense(16, relu) + Dropout
 *   → Dense(1)                         # raw score per horse
 *
 * O softmax mascarado e o loss continuam no training loop customizado.
 */
export function createAttentionModel(
  config: AttentionModelConfig,
): tf.LayersModel {
  const {
    inputDim,
    maxHorses,
    numHeads = 4,
    keyDim = 16,
    encoderDim = 64,
    dropoutRate = 0.3,
    l2Reg = 0.003,
    multiTask = false,
  } = config;

  console.log(`  🏗  Modelo attention: [batch, ${maxHorses}, ${inputDim}]`);
  console.log(
    `     ${numHeads} heads × ${keyDim}d, encoder=${encoderDim}, dropout=${dropoutRate}`,
  );

  // ── Dual input ──
  const featureInput = tf.input({
    shape: [maxHorses, inputDim],
    name: "features",
  });
  const maskInput = tf.input({
    shape: [maxHorses],
    name: "padding_mask",
  });

  // 1. Per-horse encoder (shared weights — Dense on 3D aplica por horse)
  const encoded = tf.layers
    .dense({
      units: encoderDim,
      activation: "relu",
      kernelInitializer: "heNormal",
      kernelRegularizer: tf.regularizers.l2({ l2: l2Reg }),
      name: "horse_encoder",
    })
    .apply(featureInput) as tf.SymbolicTensor;

  // 2. Self-Attention: cada cavalo olha para os outros
  //    Recebe [encoded, maskInput] — mask não participa do gradiente
  const attended = new MultiHeadSelfAttention({
    numHeads,
    keyDim,
    dropout: dropoutRate,
    name: "self_attention",
  }).apply([encoded, maskInput]) as tf.SymbolicTensor;

  // 3. Residual connection + LayerNorm
  const residual = tf.layers
    .add({ name: "residual_add" })
    .apply([encoded, attended]) as tf.SymbolicTensor;

  const normed = tf.layers
    .layerNormalization({ name: "layer_norm" })
    .apply(residual) as tf.SymbolicTensor;

  // 4. Dropout pós-attention
  let x = tf.layers
    .dropout({
      rate: dropoutRate,
      name: "post_attention_dropout",
    })
    .apply(normed) as tf.SymbolicTensor;

  // 5. Feed-forward layers (shared per horse)
  x = tf.layers
    .dense({
      units: 32,
      activation: "relu",
      kernelInitializer: "heNormal",
      kernelRegularizer: tf.regularizers.l2({ l2: l2Reg }),
      name: "ff_1",
    })
    .apply(x) as tf.SymbolicTensor;

  x = tf.layers
    .dropout({
      rate: dropoutRate * 0.7,
      name: "ff_1_dropout",
    })
    .apply(x) as tf.SymbolicTensor;

  x = tf.layers
    .dense({
      units: 16,
      activation: "relu",
      kernelInitializer: "heNormal",
      name: "ff_2",
    })
    .apply(x) as tf.SymbolicTensor;

  x = tf.layers
    .dropout({
      rate: dropoutRate * 0.5,
      name: "ff_2_dropout",
    })
    .apply(x) as tf.SymbolicTensor;

  // 6. Score output (linear, sem ativação — softmax no training loop)
  const output = tf.layers
    .dense({
      units: 1,
      name: "score_output",
    })
    .apply(x) as tf.SymbolicTensor;

  // 6b. Multi-task: cabeça extra pra P(perder) direto
  //     Sigmoid → [0, 1] por cavalo, independente da corrida.
  //     Usa mesma feature representation (x) mas dense própria.
  let loseOutput: tf.SymbolicTensor | null = null;
  if (multiTask) {
    console.log("     🎯 Multi-task: adicionando cabeça lose_output (sigmoid)");
    loseOutput = tf.layers
      .dense({
        units: 1,
        activation: "sigmoid",
        name: "lose_output",
      })
      .apply(x) as tf.SymbolicTensor;
  }

  // ── Construir modelo com 2 inputs ──
  const model = tf.model({
    inputs: [featureInput, maskInput],
    outputs: loseOutput ? [output, loseOutput] : output,
  });

  // Compilar (loss real é customizado no training loop, placeholder)
  model.compile({
    optimizer: tf.train.adam(0.00005),
    loss: "binaryCrossentropy",
    metrics: ["accuracy"],
  });

  console.log("  ✅ Modelo attention criado");
  model.summary();

  return model;
}

// Re-export pra acesso fácil
export { MultiHeadSelfAttention };
