import { mutate, seedGenome } from './genome.js';
import { rasterize } from './raster.js';
import { score } from './fitness.js';

const MODES = new Set(['drag', 'ld', 'lift', 'shedding', 'auto']);
const STRATEGIES = new Set(['population', 'single']);
const INITIAL_SIGMA_SCALE = 30;
const MIN_SIGMA_SCALE = 1.75;
const ANNEALING_RATE = 0.75;
const MEANINGFUL_IMPROVEMENT = 0.002;
const CHILD_MUTATION_MULTIPLIERS = [0.5, 1, 2, 4];

// Heterogeneous population: a handful of offspring slots each generation are "explorers" —
// they mutate at a much larger effective sigma than the stratified refiners above, drawing
// from the same top keepers as parents, so the population always keeps hard exploratory
// pressure to break plateaus even after the annealer has cooled sigmaScale way down.
const EXPLORER_COUNT = 5;
const EXPLORER_AGGRESSION_FACTOR = 8;

// Random immigrants: explorers above are still MUTATED FROM the top keepers, so once the
// population converges (all keepers near-identical after many generations) even an
// aggressive mutation just perturbs an already-narrow basin — there's no genuinely new
// genetic material to try. Immigrants are freshly seeded from scratch (seedGenome), fully
// independent of the current population, injected every generation. The count escalates
// the longer the run has been stagnant, so long plateaus get progressively harder resets.
const IMMIGRANT_BASE_COUNT = 2;
const IMMIGRANT_STAGNATION_THRESHOLD = 40;
const IMMIGRANT_STAGNATION_BONUS = 3;

// AUTO curriculum: warm up scoring on |mean lift| (forces camber, avoids the ~0-gradient
// symmetric-blob stall of raw L/D from a cold start), then switch to 'ld' once camber is
// established. Whichever trigger fires first wins; once switched, never switches back.
const AUTO_CL_SWITCH_THRESHOLD = 1.0;
const AUTO_CL_STREAK_REQUIRED = 2;
const AUTO_WARMUP_CAP = 15;
const AUTO_MACH_GUARD = 0.2;

export class GeneticAlgorithm {
  constructor(solver, cfg, rng = Math.random) {
    this.solver = solver;
    this.cfg = cfg;
    this.rng = rng;
    // 'auto' is the recommended default: a fresh EVOLVE run warms up on lift then refines
    // on L/D with no user action required.
    this.mode = 'auto';
    // Population preserves the original truncation-selection behavior. Single evolves one
    // parent lineage while retaining an exact elite copy in every evaluated generation.
    this.strategy = 'population';
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
    this.autoPhase = 'warmup-lift';
    this._autoWarmupGenerations = 0;
    this._autoClStreak = 0;
  }

  // The score() mode actually driving selection this generation: 'auto' is a meta-mode
  // that resolves to 'lift' during warm-up and 'ld' once camber is established.
  _currentScoringMode() {
    if (this.mode !== 'auto') return this.mode;
    return this.autoPhase === 'warmup-lift' ? 'lift' : 'ld';
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
    } else {
      this.stagnationGenerations += 1;
    }
    // The stratified 4x child explores while this deterministic schedule steadily hands
    // control to refinement; noisy or flat fitness must never reheat a converging lineage.
    this.sigmaScale = Math.max(MIN_SIGMA_SCALE, this.sigmaScale * ANNEALING_RATE);
  }

  setFitnessMode(mode) {
    if (!MODES.has(mode)) throw new Error(`Unknown fitness mode: ${mode}`);
    if (mode === this.mode) return;
    this.mode = mode;
    this.sigmaScale = INITIAL_SIGMA_SCALE;
    this.bestScoreSeen = -Infinity;
    this.stagnationGenerations = 0;
    this.autoPhase = 'warmup-lift';
    this._autoWarmupGenerations = 0;
    this._autoClStreak = 0;
  }

  setStrategy(strategy) {
    if (!STRATEGIES.has(strategy)) throw new Error(`Unknown evolution strategy: ${strategy}`);
    if (strategy === this.strategy) return;
    this.strategy = strategy;
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
    this.autoPhase = 'warmup-lift';
    this._autoWarmupGenerations = 0;
    this._autoClStreak = 0;
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
    const scoringMode = this._currentScoringMode();
    const scores = score(lift, drag, scoringMode, this.cfg);
    const ranked = Array.from({ length: this.cfg.POP }, (_, index) => index)
      .sort((a, b) => scores[b] - scores[a]);
    const best = ranked[0];
    const samplesPerTile = drag.length / this.cfg.POP;
    let bestMeanLift = 0;
    let bestMeanDrag = 0;
    for (let sample = 0; sample < samplesPerTile; sample += 1) {
      bestMeanLift += lift[best * samplesPerTile + sample];
      bestMeanDrag += drag[best * samplesPerTile + sample];
    }
    const forceScale = 0.5 * this.cfg.U_IN * this.cfg.U_IN * this.cfg.CHORD;
    const bestCl = (bestMeanLift / samplesPerTile) / forceScale;
    const bestCd = (bestMeanDrag / samplesPerTile) / forceScale;
    const bestLd = Math.abs(bestCd) > 1e-8 ? bestCl / bestCd : 0;
    this.lineage.push({ genome: new Float32Array(this.genomes[best]), score: scores[best] });
    this.adaptMutationStrength(scores[best]);

    // Computed once per generation (not per step) for the auto regime guard and the HUD.
    const maxMach = typeof this.solver.getMaxMach === 'function' ? this.solver.getMaxMach() : 0;

    if (this.mode === 'auto' && this.autoPhase === 'warmup-lift') {
      this._autoWarmupGenerations += 1;
      if (Math.abs(bestCl) > AUTO_CL_SWITCH_THRESHOLD) this._autoClStreak += 1;
      else this._autoClStreak = 0;

      const machTripped = maxMach > AUTO_MACH_GUARD;
      const clTripped = this._autoClStreak >= AUTO_CL_STREAK_REQUIRED;
      const capTripped = this._autoWarmupGenerations >= AUTO_WARMUP_CAP;
      if (machTripped || clTripped || capTripped) {
        this.autoPhase = 'refine-ld';
        // Scoring units change from |lift| to L/D; the warm-up phase's stagnation baseline
        // is meaningless in the new units. Reset it, but leave sigmaScale alone — a lineage
        // partway through annealing should not be reheated by this internal switch.
        this.bestScoreSeen = -Infinity;
        this.stagnationGenerations = 0;
      }
    }

    let next;
    let mutationScales;
    let immigrantCount = 0;
    if (this.strategy === 'population') {
      next = [];
      for (let k = 0; k < this.cfg.KEEP; k += 1) {
        const parent = this.genomes[ranked[k]];
        for (let child = 0; child < this.cfg.POP / this.cfg.KEEP; child += 1) {
          const mutationScale = this.sigmaScale * CHILD_MUTATION_MULTIPLIERS[child];
          next.push(mutate(parent, mutationScale, this.rng));
        }
      }
      // Explorer children: overwrite the tail slots of the offspring array with aggressively
      // mutated copies of the top keepers. This runs after the stratified refiners above and
      // before the elite copy below, so elitism still has the final word on slot 0..ELITE-1.
      const explorerCount = Math.min(EXPLORER_COUNT, this.cfg.POP);
      const explorerMutationScale = this.sigmaScale * EXPLORER_AGGRESSION_FACTOR;
      for (let e = 0; e < explorerCount; e += 1) {
        const slot = this.cfg.POP - 1 - e;
        const explorerParent = this.genomes[ranked[e % this.cfg.KEEP]];
        next[slot] = mutate(explorerParent, explorerMutationScale, this.rng);
      }

      // Immigrants take the slots just before the explorer tail, escalating count under
      // sustained stagnation. Elitism (below) still has final say, so slot 0 stays protected.
      immigrantCount = Math.min(
        IMMIGRANT_BASE_COUNT + (this.stagnationGenerations >= IMMIGRANT_STAGNATION_THRESHOLD ? IMMIGRANT_STAGNATION_BONUS : 0),
        Math.max(0, this.cfg.POP - this.cfg.ELITE - explorerCount)
      );
      for (let im = 0; im < immigrantCount; im += 1) {
        const slot = this.cfg.POP - 1 - explorerCount - im;
        next[slot] = seedGenome(this.rng);
      }

      for (let i = 0; i < this.cfg.ELITE; i += 1) {
        next[i] = new Float32Array(this.genomes[ranked[i]]);
      }
      mutationScales = CHILD_MUTATION_MULTIPLIERS.map((scale) => scale * this.sigmaScale);
    } else {
      const parent = this.genomes[best];
      next = [new Float32Array(parent)];
      mutationScales = [];
      // Fifteen descendants repeat the 0.5x/1x/2x/4x ladder (four, four, four, and three
      // slots respectively), preserving a simultaneous refinement-to-exploration gradient.
      // No immigrants here: every non-elite slot is deliberately part of this one lineage.
      for (let slot = this.cfg.ELITE; slot < this.cfg.POP; slot += 1) {
        const multiplier = CHILD_MUTATION_MULTIPLIERS[(slot - this.cfg.ELITE) % CHILD_MUTATION_MULTIPLIERS.length];
        const mutationScale = this.sigmaScale * multiplier;
        next.push(mutate(parent, mutationScale, this.rng));
        mutationScales.push(mutationScale);
      }
    }
    this.genomes = next;
    this.generation += 1;
    this.generationActive = false;

    return {
      scores,
      bestIndex: best,
      bestScore: scores[best],
      bestCd,
      bestCl,
      bestLd,
      sigmaScale: this.sigmaScale,
      stagnationGenerations: this.stagnationGenerations,
      mutationScales,
      autoPhase: this.autoPhase,
      scoringMode,
      maxMach,
      immigrantCount,
    };
  }

  runGeneration() {
    this.beginGeneration();
    this.stepGeneration(this.stepsRemaining);
    return this.finishGeneration();
  }
}
