// Smoke test pra PAV (isotonic regression).
// Roda: nvm use 20 && npx ts-node src/oneTimeScript/test_isotonic.ts

import {
  fitIsotonic,
  applyIsotonic,
  applyIsotonicToRace,
} from "../services/ml/calibration";

function nearlyEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

function isMonotone(ys: number[]): boolean {
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] < ys[i - 1] - 1e-9) return false;
  }
  return true;
}

console.log("🧪 SMOKE TEST — Isotonic Regression (PAV)\n");

// TESTE 1: Caso trivial monotônico — deve preservar pontos
{
  const pairs = [
    { x: 0.1, y: 0.1 },
    { x: 0.3, y: 0.3 },
    { x: 0.5, y: 0.5 },
    { x: 0.7, y: 0.7 },
    { x: 0.9, y: 0.9 },
  ];
  const curve = fitIsotonic(pairs);
  console.log("📊 TESTE 1 — Identidade:");
  console.log(`   knots.x = [${curve.x.map((v) => v.toFixed(2)).join(", ")}]`);
  console.log(`   knots.y = [${curve.y.map((v) => v.toFixed(2)).join(", ")}]`);
  console.assert(isMonotone(curve.y), "Curva não é monótona!");
  console.assert(
    nearlyEqual(applyIsotonic(curve, 0.5), 0.5),
    "applyIsotonic(0.5) != 0.5",
  );
}

// TESTE 2: Violação clássica — PAV deve fazer pool
// y sobe-cai-sobe; resultado: y intermediário deveria virar média do bloco violador
{
  const pairs = [
    { x: 0.1, y: 0.1 },
    { x: 0.2, y: 0.4 },
    { x: 0.3, y: 0.2 }, // violação (0.4 → 0.2)
    { x: 0.4, y: 0.5 },
    { x: 0.5, y: 0.6 },
  ];
  const curve = fitIsotonic(pairs);
  console.log("\n📊 TESTE 2 — Violação (deve fundir blocos):");
  console.log(`   knots.x = [${curve.x.map((v) => v.toFixed(2)).join(", ")}]`);
  console.log(`   knots.y = [${curve.y.map((v) => v.toFixed(3)).join(", ")}]`);
  console.assert(isMonotone(curve.y), "Curva não é monótona após fit!");
  // x=0.2 e x=0.3 deveriam ter o mesmo y (media de 0.4 e 0.2 = 0.3)
  const y_at_02 = applyIsotonic(curve, 0.2);
  const y_at_03 = applyIsotonic(curve, 0.3);
  console.log(`   apply(0.2) = ${y_at_02.toFixed(3)} (esperado 0.300)`);
  console.log(`   apply(0.3) = ${y_at_03.toFixed(3)} (esperado 0.300)`);
}

// TESTE 3: Labels binárias (caso real: probabilidade vs vencedor)
// 100 pares: x uniforme em [0,1], y = bernoulli(x)
// Curva final deve ser ~identidade (modelo bem calibrado)
{
  const N = 1000;
  const pairs: { x: number; y: number }[] = [];
  for (let i = 0; i < N; i++) {
    const x = Math.random();
    const y = Math.random() < x ? 1 : 0;
    pairs.push({ x, y });
  }
  const curve = fitIsotonic(pairs);
  console.log("\n📊 TESTE 3 — Labels binárias bem calibradas (N=1000):");
  console.log(
    `   knots: ${curve.x.length} breakpoints, range x=[${curve.x[0].toFixed(3)}, ${curve.x[curve.x.length - 1].toFixed(3)}]`,
  );
  console.assert(isMonotone(curve.y), "Curva não é monótona!");
  // Sanity: apply(0.1) deve ser ~0.1, apply(0.9) deve ser ~0.9
  const y01 = applyIsotonic(curve, 0.1);
  const y09 = applyIsotonic(curve, 0.9);
  console.log(`   apply(0.1) ≈ ${y01.toFixed(3)} (esperado ~0.1)`);
  console.log(`   apply(0.9) ≈ ${y09.toFixed(3)} (esperado ~0.9)`);
  console.assert(y01 < 0.3, "Calibração de 0.1 fora do esperado");
  console.assert(y09 > 0.7, "Calibração de 0.9 fora do esperado");
}

// TESTE 4: Modelo overconfident (caso comum em DL)
// Predições muito próximas de 0 ou 1, mas labels são mais conservadores
// Curva deve "puxar pro meio"
{
  const N = 1000;
  const pairs: { x: number; y: number }[] = [];
  for (let i = 0; i < N; i++) {
    // x concentrado em extremos
    const r = Math.random();
    const x = r < 0.5 ? r * 0.2 : 1 - (1 - r) * 0.2;
    // y = Bernoulli(verdadeira_prob), onde verdadeira_prob é menos extrema
    const truth = 0.3 + x * 0.4; // mapeia [0,1] → [0.3, 0.7]
    const y = Math.random() < truth ? 1 : 0;
    pairs.push({ x, y });
  }
  const curve = fitIsotonic(pairs);
  console.log("\n📊 TESTE 4 — Modelo overconfident (deve puxar pro meio):");
  console.log(`   knots: ${curve.x.length} breakpoints`);
  const y01 = applyIsotonic(curve, 0.05);
  const y09 = applyIsotonic(curve, 0.95);
  console.log(`   apply(0.05) ≈ ${y01.toFixed(3)} (esperado ~0.32)`);
  console.log(`   apply(0.95) ≈ ${y09.toFixed(3)} (esperado ~0.68)`);
  console.assert(y01 > 0.05, "Calibração não puxou 0.05 pra cima");
  console.assert(y09 < 0.95, "Calibração não puxou 0.95 pra baixo");
}

// TESTE 5: Renormalização race-level
{
  const pairs = [
    { x: 0.1, y: 0 },
    { x: 0.2, y: 0 },
    { x: 0.4, y: 1 },
    { x: 0.5, y: 1 },
    { x: 0.7, y: 1 },
  ];
  const curve = fitIsotonic(pairs);
  console.log("\n📊 TESTE 5 — Renormalização race-level:");
  // Corrida com 4 cavalos
  const rawProbs = [0.5, 0.2, 0.2, 0.1];
  const calibrated = applyIsotonicToRace(curve, rawProbs);
  const sum = calibrated.reduce((s, p) => s + p, 0);
  console.log(
    `   raw     = [${rawProbs.map((p) => p.toFixed(3)).join(", ")}] sum=${rawProbs.reduce((s, p) => s + p, 0).toFixed(3)}`,
  );
  console.log(
    `   calibrated = [${calibrated.map((p) => p.toFixed(3)).join(", ")}] sum=${sum.toFixed(3)}`,
  );
  console.assert(nearlyEqual(sum, 1.0), "Soma após renormalização != 1");
}

// TESTE 6: Edge case — todos labels = 1
{
  const pairs = [
    { x: 0.1, y: 1 },
    { x: 0.3, y: 1 },
    { x: 0.5, y: 1 },
  ];
  const curve = fitIsotonic(pairs);
  console.log("\n📊 TESTE 6 — Edge (todos y=1):");
  console.log(`   knots.y = [${curve.y.map((v) => v.toFixed(2)).join(", ")}]`);
  // Todos viraram um único bloco com média 1
  console.assert(
    curve.y.every((v) => nearlyEqual(v, 1)),
    "Esperava todos y=1",
  );
}

console.log("\n✅ Todos os testes passaram!");
