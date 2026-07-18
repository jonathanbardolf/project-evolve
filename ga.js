import { mutate, seedGenome } from './genome.js';
import { rasterize } from './raster.js';
import { score } from './fitness.js';

const MODES = new Set(['drag', 'ld', 'shedding']);
const INITIAL_SIGMA_SCALE = 30;
const MIN_SIGMA_SCALE = 18;
const MAX_SIGMA_SCALE = 80;
const MEANINGFUL_IMPROVEMENT = 0.002;
const CHILD_MUTATION_MULTIPLIERS = [0.5, 1, 2, 4];

export class GeneticAlgorithm {
  constructor(solver, cfg, rng = Math.random) {
    this.solver = solver;
    this.cfg = cfg;
    this.rng = rng;
    this.mode = 'drag';
    // Coefficients are lattice-scale (a circle has a0 ~= 20), so single-digit multipliers
    // make the frozen 0.05/n mutation too small to escape the initially selected seed family.
    this.sigmaScale = INITIAL_SIGMA_SCALE;
    this.bestScoreSeen = -Infinity;
    this.stagnationGenerations = 0;
    this.generation = 0;
    this.genomes = Array.from({ length: cfg.POP }, () => seedGenome(rng));
    this.lineage = [];
    this.generationActive = false;
    this.stepsRemaining = 0;
  }

  adaptMutationStrength(bestScore) {
    if (!Number.isFinite(bestScore)) return;

    if (!Number.isFinite(this.bestScoreSeen)) {
      this.bestScoreSeen = bestScore;
      return;
    }

    const threshold = Math.max(1e-7, Math.abs(this.bestScoreSeen) * MEANINGFUL_IMPROVEMENT);
    if (bestScore > this.bestScoreSeen + threshold) {
      this.bestScoreSeen = bestScore;
      this.stagnationGenerations = 0;
      this.sigmaScale = Math.max(MIN_SIGMA_SCALE, this.sigmaScale * 0.8);
      return;
    }

    this.stagnationGenerations += 1;
    if (this.stagnationGenerations >= 2) {
      this.sigmaScale = Math.min(MAX_SIGMA_SCALE, this.sigmaScale * 1.5);
    }
  }

  setFitnessMode(mode) {
    if (!MODES.has(mode)) throw new Error(`Unknown fitness mode: ${mode}`);
    if (mode === this.mode) return;
    this.mode = mode;
    this.sigmaScale = INITIAL_SIGMA_SCALE;
    this.bestScoreSeen = -Infinity;
    this.stagnationGenerations = 0;
  }

  reseed() {
    this.genomes = Array.from({ length: this.cfg.POP }, () => seedGenome(this.rng));
    this.generation = 0;
    this.lineage = [];
    this.generationActive = false;
    this.stepsRemaining = 0;
    this.sigmaScale = INITIAL_SIGMA_SCALE;
    this.bestScoreSeen = -Infinity;
    this.stagnationGenerations = 0;
  }

  beginGeneration() {
    if (this.generationActive) throw new Error('A generation is already active.');
    const mask = rasterize(this.genomes, this.cfg);
    this.solver.setSolidMask(mask);
    this.solver.reset();
    this.stepsRemaining = this.cfg.WARMUP_STEPS + this.cfg.EVAL_STEPS;
    this.generationActive = true;
  }

  stepGeneration(maxSteps) {
    if (!this.generationActive) throw new Error('No generation is active.');
    if (!Number.isFinite(maxSteps) || maxSteps < 1) {
      throw new Error('Generation step budget must be at least one step.');
    }

    const steps = Math.min(this.stepsRemaining, Math.floor(maxSteps));
    this.solver.step(steps);
    this.stepsRemaining -= steps;
    return this.stepsRemaining === 0;
  }

  finishGeneration() {
    if (!this.generationActive) throw new Error('No generation is active.');
    if (this.stepsRemaining !== 0) throw new Error('Generation stepping is not complete.');

    const lift = this.solver.readLiftHistory();
    const drag = this.solver.readDragHistory();
    const scores = score(lift, drag, this.mode, this.cfg);
    const ranked = Array.from({ length: this.cfg.POP }, (_, index) => index)
      .sort((a, b) => scores[b] - scores[a]);
    const best = ranked[0];
    const samplesPerTile = drag.length / this.cfg.POP;
    let bestMeanDrag = 0;
    for (let sample = 0; sample < samplesPerTile; sample += 1) {
      bestMeanDrag += drag[best * samplesPerTile + sample];
    }
    const bestCd = (bestMeanDrag / samplesPerTile)
      / (0.5 * this.cfg.U_IN * this.cfg.U_IN * this.cfg.CHORD);
    this.lineage.push({ genome: new Float32Array(this.genomes[best]), score: scores[best] });
    this.adaptMutationStrength(scores[best]);

    const next = [];
    for (let k = 0; k < this.cfg.KEEP; k += 1) {
      const parent = this.genomes[ranked[k]];
      for (let child = 0; child < this.cfg.POP / this.cfg.KEEP; child += 1) {
        const mutationScale = this.sigmaScale * CHILD_MUTATION_MULTIPLIERS[child];
        next.push(mutate(parent, mutationScale, this.rng));
      }
    }
    for (let i = 0; i < this.cfg.ELITE; i += 1) {
      next[i] = new Float32Array(this.genomes[ranked[i]]);
    }
    this.genomes = next;
    this.generation += 1;
    this.generationActive = false;

    return {
      scores,
      bestIndex: best,
      bestScore: scores[best],
      bestCd,
      sigmaScale: this.sigmaScale,
      stagnationGenerations: this.stagnationGenerations,
      mutationScales: CHILD_MUTATION_MULTIPLIERS.map((scale) => scale * this.sigmaScale),
    };
  }

  runGeneration() {
    this.beginGeneration();
    this.stepGeneration(this.stepsRemaining);
    return this.finishGeneration();
  }
}
