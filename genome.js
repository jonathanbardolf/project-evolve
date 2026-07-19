const N_HARMONICS = 10;
const CHORD = 40;
const TARGET_AREA = Math.PI * 400;
const EPSILON = 1e-6;
const MIN_RADIUS_RATIO = 0.05;
const POSITIVITY_SAMPLES = 2048;

function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function areaOf(genome) {
  let harmonics = 0;
  for (let n = 1; n <= N_HARMONICS; n += 1) {
    const a = genome[n];
    const b = genome[N_HARMONICS + n];
    harmonics += a * a + b * b;
  }
  return Math.PI * (genome[0] * genome[0] + 0.5 * harmonics);
}

function repairPositiveRadius(genome) {
  let sampledMin = Infinity;
  let derivativeBound = 0;

  for (let n = 1; n <= N_HARMONICS; n += 1) {
    derivativeBound += n * Math.hypot(genome[n], genome[N_HARMONICS + n]);
  }
  for (let sample = 0; sample < POSITIVITY_SAMPLES; sample += 1) {
    const theta = (2 * Math.PI * sample) / POSITIVITY_SAMPLES;
    let radius = genome[0];
    for (let n = 1; n <= N_HARMONICS; n += 1) {
      radius += genome[n] * Math.cos(n * theta);
      radius += genome[N_HARMONICS + n] * Math.sin(n * theta);
    }
    sampledMin = Math.min(sampledMin, radius);
  }

  // The derivative margin covers the unsampled half-step between angular probes.
  const lowerBound = sampledMin - derivativeBound * Math.PI / POSITIVITY_SAMPLES;
  const offsetForRatio = (MIN_RADIUS_RATIO * genome[0] - lowerBound)
    / (1 - MIN_RADIUS_RATIO);
  const offsetForPositiveMean = EPSILON - genome[0];
  genome[0] += Math.max(0, offsetForRatio, offsetForPositiveMean);
  return genome;
}

export function normalizeArea(genome, targetArea) {
  const area = areaOf(genome);
  if (!(area > EPSILON) || !(targetArea > 0)) return genome;

  const scale = Math.sqrt(targetArea / area);
  for (let i = 0; i < genome.length; i += 1) genome[i] *= scale;
  return genome;
}

export function seedGenome(rng) {
  const genome = new Float32Array(1 + 2 * N_HARMONICS);
  const base = CHORD / 2;
  genome[0] = base * (0.8 + 0.4 * rng());
  for (let n = 1; n <= N_HARMONICS; n += 1) {
    const amplitude = base / n;
    genome[n] = gaussian(rng) * amplitude;
    genome[N_HARMONICS + n] = gaussian(rng) * amplitude;
  }
  repairPositiveRadius(genome);
  return normalizeArea(genome, TARGET_AREA);
}

export function mutate(genome, sigmaScale, rng) {
  const child = new Float32Array(genome);
  for (let n = 1; n <= N_HARMONICS; n += 1) {
    const sigma = (0.05 / n) * sigmaScale;
    // Pure additive noise on high harmonics random-walks upward over many generations
    // (no selection pressure opposes it) and shows up as jagged, lumpy edges even after
    // camber (low harmonics) has converged. Shrink n>3 toward zero each mutation so noise
    // there decays instead of accumulating; low harmonics (camber/thickness) are untouched.
    const shrink = n <= 3 ? 1 : Math.max(0.85, 1 - 0.03 * (n - 3));
    child[n] = child[n] * shrink + gaussian(rng) * sigma;
    child[N_HARMONICS + n] = child[N_HARMONICS + n] * shrink + gaussian(rng) * sigma;
  }
  child[0] += gaussian(rng) * 0.05 * sigmaScale;
  repairPositiveRadius(child);
  return normalizeArea(child, TARGET_AREA);
}

export function radiusAt(genome, theta) {
  let radius = genome[0];
  for (let n = 1; n <= N_HARMONICS; n += 1) {
    radius += genome[n] * Math.cos(n * theta);
    radius += genome[N_HARMONICS + n] * Math.sin(n * theta);
  }
  // Safety for malformed external genomes; seed/mutate repair this before normalization.
  return Math.max(radius, Math.max(EPSILON, MIN_RADIUS_RATIO * Math.abs(genome[0])));
}
