import { LBM } from './lbm.js';
import { GeneticAlgorithm } from './ga.js';

export const cfg = Object.freeze({
  TILE_W: 256,
  TILE_H: 192,
  GRID_X: 4,
  GRID_Y: 4,
  U_IN: 0.05,
  TAU_PLUS: 0.56,
  MAGIC: 0.25,
  CHORD: 40,
  TARGET_AREA: Math.PI * 400,
  N_HARMONICS: 10,
  WARMUP_STEPS: 4000,
  EVAL_STEPS: 6000,
  SAMPLE_EVERY: 20,
  POP: 16,
  ELITE: 1,
  KEEP: 4,
  SIGMA0: 0.05,
});

const style = document.createElement('style');
style.textContent = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #05070a; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  #flow { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
  #status {
    position: fixed; top: 16px; left: 16px; z-index: 1; max-width: min(680px, calc(100vw - 32px));
    padding: 10px 12px; border: 1px solid #ffffff26; border-radius: 6px;
    background: #05070acc; color: #d9e2ec; font-size: 12px; line-height: 1.55;
    white-space: pre-wrap; pointer-events: none; backdrop-filter: blur(6px);
  }
  #status.error { color: #ffb4a9; border-color: #ff6b5e66; }
  #speed-mode {
    position: fixed; top: 16px; right: 16px; z-index: 2; min-width: 132px;
    padding: 9px 12px; border: 1px solid #78dce866; border-radius: 6px;
    background: #0b1118dd; color: #b9f4fa; font: inherit; font-size: 12px;
    letter-spacing: 0.04em; cursor: pointer; backdrop-filter: blur(6px);
  }
  #speed-mode:hover, #speed-mode:focus-visible { border-color: #78dce8cc; background: #111b25ee; }
  #speed-mode[data-mode="slow"] { color: #d9e2ec; border-color: #ffffff38; }
  #evolve-mode, #fitness-mode {
    position: fixed; right: 16px; z-index: 2; min-width: 132px;
    padding: 9px 12px; border: 1px solid #c792ea66; border-radius: 6px;
    background: #0b1118dd; color: #ead8ff; font: inherit; font-size: 12px;
    letter-spacing: 0.04em; backdrop-filter: blur(6px);
  }
  #evolve-mode { top: 60px; cursor: pointer; }
  #fitness-mode { top: 104px; cursor: pointer; }
  #evolve-mode:hover, #evolve-mode:focus-visible, #fitness-mode:hover, #fitness-mode:focus-visible {
    border-color: #c792eacc; background: #171025ee;
  }
  #evolve-mode[data-active="true"] { color: #a6e3a1; border-color: #a6e3a166; }
`;
document.head.append(style);

const canvas = document.createElement('canvas');
canvas.id = 'flow';
canvas.setAttribute('aria-label', 'Lattice-Boltzmann velocity view');
document.body.append(canvas);

const status = document.createElement('output');
status.id = 'status';
status.setAttribute('aria-live', 'polite');
document.body.append(status);

const speedButton = document.createElement('button');
speedButton.id = 'speed-mode';
speedButton.type = 'button';
speedButton.title = 'Toggle simulation speed (A)';
document.body.append(speedButton);

const evolveButton = document.createElement('button');
evolveButton.id = 'evolve-mode';
evolveButton.type = 'button';
evolveButton.title = 'Toggle evolution mode (G)';
document.body.append(evolveButton);

const fitnessSelect = document.createElement('select');
fitnessSelect.id = 'fitness-mode';
fitnessSelect.title = 'Evolution fitness mode';
for (const mode of ['drag', 'ld', 'shedding']) {
  const option = document.createElement('option');
  option.value = mode;
  option.textContent = `FITNESS · ${mode.toUpperCase()}`;
  fitnessSelect.append(option);
}
document.body.append(fitnessSelect);

const SLOW_STEPS_PER_SEC = 30;
const AUTO_BATCH_FLOOR = 48;
const MAX_AUTO_BATCH = 2048;
const AUTO_STARTUP_GRACE_MS = 1800;
const AUTO_CONTROL_WINDOW_MS = 900;
const EVOLVE_BATCH_STEPS = 256;
let paused = false;
let view = 'vorticity';
let speedMode = 'auto';
let autoBatch = AUTO_BATCH_FLOOR;
let autoAggression = 7;
let totalSteps = 0;
let stepsSinceMark = 0;
let stepsPerSec = 0;
let markStart = performance.now();
let renderedSinceMark = 0;
let framesPerSec = 0;
let previousFrameAt = 0;
let refreshPeriodMs = 0;
let autoStartupUntil = performance.now() + AUTO_STARTUP_GRACE_MS;
let autoWindowStartedAt = 0;
let autoWindowFrames = 0;
let autoWindowLongFrames = 0;
let nextSlowStepAt = performance.now();
let pendingSync = null;
let diagLine = '';
let gl;
let solver;
let ga;
let evolveMode = false;
let evolveGenerationReady = false;
let evolveBestScore = null;
let evolveBestTile = 0;
let evolveBestCd = null;
let evolveSigmaScale = null;
let evolveStagnationGenerations = 0;
let evolveMutationScaleMin = null;
let evolveMutationScaleMax = null;

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(innerWidth * dpr));
  const height = Math.max(1, Math.round(innerHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function updateStatus() {
  if (evolveMode) {
    const best = evolveBestScore === null
      ? 'best awaiting generation'
      : `best ${evolveBestScore.toFixed(4)} · Cd ${evolveBestCd.toFixed(2)} (tile ${evolveBestTile + 1})`;
    const explorationState = evolveStagnationGenerations >= 2
      ? 'EXPANDING'
      : evolveStagnationGenerations === 1 ? 'STALLED' : 'ACTIVE';
    const mutationRange = evolveMutationScaleMin === null
      ? 'pending'
      : `${evolveMutationScaleMin.toFixed(1)}–${evolveMutationScaleMax.toFixed(1)}`;
    const sigma = evolveSigmaScale === null ? 'pending' : evolveSigmaScale.toFixed(1);
    status.textContent = `${paused ? 'EVOLVE PAUSED' : 'EVOLVING'}  |  ${view}\nGeneration ${ga.generation}  |  fitness ${ga.mode}  |  ${best}\nExplore ${explorationState}  ·  σ ${sigma}  ·  mutations ${mutationRange}  ·  stagnant ${evolveStagnationGenerations}g\nSpace pause/resume  ·  G EVOLVE on/off  ·  Fitness menu switches mode without reseeding  ·  V view  ·  F forces`;
    evolveButton.dataset.active = 'true';
    evolveButton.textContent = 'EVOLVE · ON';
    evolveButton.setAttribute('aria-pressed', 'true');
    fitnessSelect.value = ga.mode;
    return;
  }

  const modeDetail = speedMode === 'auto'
    ? `AUTO · ${autoBatch}/batch · probe ${autoAggression}/9`
    : `SLOW · ${SLOW_STEPS_PER_SEC} target steps/s`;
  status.textContent = `${paused ? 'PAUSED' : 'RUNNING'}  |  ${view}  |  ${modeDetail}  |  step ${totalSteps.toLocaleString()}\n${Math.round(stepsPerSec).toLocaleString()} steps/s  |  ${Math.round(framesPerSec)} fps\nSpace pause/resume  ·  A speed mode  ·  +/- AUTO probe  ·  . single step  ·  V view  ·  F forces  ·  R reset${diagLine ? '\n' + diagLine : ''}`;
  speedButton.dataset.mode = speedMode;
  speedButton.textContent = `SPEED · ${speedMode === 'auto' ? 'AUTO' : 'SLOW'}`;
  speedButton.setAttribute('aria-pressed', String(speedMode === 'auto'));
  evolveButton.dataset.active = 'false';
  evolveButton.textContent = 'EVOLVE · OFF';
  evolveButton.setAttribute('aria-pressed', 'false');
  fitnessSelect.value = ga ? ga.mode : 'drag';
}

function fail(error) {
  paused = true;
  status.classList.add('error');
  status.textContent = `EVOLVE COULD NOT START\n${error instanceof Error ? error.message : String(error)}\n\nOpen this project through its launcher, not directly as a file.`;
  console.error(error);
}

function reset() {
  solver.reset();
  totalSteps = 0;
  stepsSinceMark = 0;
  if (speedMode === 'auto') resetAutoControlWindow(performance.now(), true);
  updateStatus();
}

function setSpeedMode(mode) {
  speedMode = mode;
  if (mode === 'auto') {
    autoBatch = Math.max(AUTO_BATCH_FLOOR, autoBatch);
    resetAutoControlWindow(performance.now(), true);
  } else {
    nextSlowStepAt = performance.now();
  }
  updateStatus();
}

function toggleSpeedMode() {
  setSpeedMode(speedMode === 'auto' ? 'slow' : 'auto');
}

function adjustAutoAggression(delta) {
  autoAggression = Math.max(1, Math.min(9, autoAggression + delta));
  if (delta > 0) autoBatch = Math.min(MAX_AUTO_BATCH, Math.ceil(autoBatch * 1.12));
  else autoBatch = Math.max(AUTO_BATCH_FLOOR, Math.floor(autoBatch * 0.9));
  setSpeedMode('auto');
}

function render() {
  if (view === 'vorticity') solver.renderVorticity();
  else solver.renderDebug();
}

function resetEvolutionExplorationState() {
  evolveSigmaScale = ga ? ga.sigmaScale : null;
  evolveStagnationGenerations = ga ? ga.stagnationGenerations : 0;
  evolveMutationScaleMin = null;
  evolveMutationScaleMax = null;
}

function setFitnessMode(mode) {
  ga.setFitnessMode(mode);
  evolveBestScore = null;
  evolveBestCd = null;
  resetEvolutionExplorationState();
  fitnessSelect.value = mode;
  updateStatus();
}

// EVOLVE shares the free-run fence discipline: submit one small chunk, then let a later display
// frame observe its completion before submitting more work or doing the generation readback.
function driveEvolution() {
  try {
    if (!evolveMode) return;
    if (pendingSync) {
      const state = gl.clientWaitSync(pendingSync, 0, 0);
      if (state === gl.TIMEOUT_EXPIRED) {
        return;
      }
      if (state === gl.WAIT_FAILED) throw new Error('GPU synchronization failed.');
      gl.deleteSync(pendingSync);
      pendingSync = null;
    }

    if (evolveGenerationReady) {
      const result = ga.finishGeneration();
      evolveBestScore = result.bestScore;
      evolveBestTile = result.bestIndex;
      evolveBestCd = result.bestCd;
      evolveSigmaScale = result.sigmaScale;
      evolveStagnationGenerations = result.stagnationGenerations;
      evolveMutationScaleMin = Math.min(...result.mutationScales);
      evolveMutationScaleMax = Math.max(...result.mutationScales);
      evolveGenerationReady = false;
      updateStatus();
    }
    if (paused) return;

    if (!ga.generationActive) ga.beginGeneration();
    const steps = Math.min(EVOLVE_BATCH_STEPS, ga.stepsRemaining);
    evolveGenerationReady = ga.stepGeneration(steps);
    totalSteps += steps;
    stepsSinceMark += steps;
    pendingSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!pendingSync) throw new Error('Could not create GPU synchronization fence.');
    gl.flush();
  } catch (error) {
    fail(error);
  }
}

function toggleEvolveMode() {
  evolveMode = !evolveMode;
  if (evolveMode) {
    paused = false;
    if (!ga) {
      ga = new GeneticAlgorithm(solver, cfg);
      resetEvolutionExplorationState();
    }
  }
  updateStatus();
}

function reseedEvolution() {
  if (!ga) return;
  ga.reseed();
  evolveBestScore = null;
  evolveBestCd = null;
  evolveBestTile = 0;
  evolveGenerationReady = false;
  resetEvolutionExplorationState();
  updateStatus();
}

function singleStep() {
  solver.step(1);
  totalSteps += 1;
  render();
  updateStatus();
}

let forcesLive = false;

// Phase 3 gate: read back force history and report Cd / St for the cylinder. All 16 tiles
// are identical here, so tile 0 stands in and the spread shows measurement noise.
function showDiagnostics() {
  const d = solver.diagnostics();
  // Mean lift is ~0 for the symmetric cylinder; the shed load lives in the RMS amplitude.
  diagLine = `Cd ${d.cd[0].toFixed(2)}  ·  Cl ${d.cl[0].toFixed(2)} ±${d.clRms[0].toFixed(2)} rms  ·  St ${d.st[0].toFixed(3)}`;
  console.log('[evolve] Phase 3 diagnostics', d);
}

function handleKey(event) {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.code === 'Space') {
    paused = !paused;
    if (!paused && speedMode === 'slow') nextSlowStepAt = performance.now();
    event.preventDefault();
  } else if (event.key.toLowerCase() === 'g') {
    toggleEvolveMode();
  } else if (event.key.toLowerCase() === 'a') {
    toggleSpeedMode();
  } else if (event.code === 'ArrowUp') {
    setSpeedMode('auto');
    event.preventDefault();
  } else if (event.code === 'ArrowDown') {
    setSpeedMode('slow');
    event.preventDefault();
  } else if (event.key === '+' || event.key === '=') {
    adjustAutoAggression(1);
  } else if (event.key === '-' || event.key === '_') {
    adjustAutoAggression(-1);
  } else if (event.key === '.') {
    if (paused && !evolveMode) singleStep();
  } else if (event.key.toLowerCase() === 'r') {
    if (evolveMode) reseedEvolution();
    else reset();
  } else if (event.key.toLowerCase() === 'v') {
    view = view === 'vorticity' ? 'speed' : 'vorticity';
    render();
  } else if (event.key.toLowerCase() === 'f') {
    forcesLive = !forcesLive;
    if (forcesLive) showDiagnostics();
    else diagLine = '';
  }
  updateStatus();
}

function resetAutoControlWindow(now, includeStartupGrace = false) {
  autoWindowStartedAt = now;
  autoWindowFrames = 0;
  autoWindowLongFrames = 0;
  if (includeStartupGrace) autoStartupUntil = now + AUTO_STARTUP_GRACE_MS;
}

function updateAutoControl(now, frameMs) {
  if (speedMode !== 'auto') return;
  if (paused) {
    resetAutoControlWindow(now);
    return;
  }
  if (!autoWindowStartedAt) resetAutoControlWindow(now);

  const frameBudget = refreshPeriodMs || 16.67;
  autoWindowFrames += 1;
  if (frameMs > frameBudget * 1.5) autoWindowLongFrames += 1;

  // Shader compilation, texture allocation, and refresh-rate discovery make startup timings noisy.
  // The known-good floor is held until those costs are out of the measurement window.
  if (now < autoStartupUntil) {
    resetAutoControlWindow(now);
    return;
  }

  const elapsed = now - autoWindowStartedAt;
  if (elapsed < AUTO_CONTROL_WINDOW_MS) return;

  const expectedFrames = elapsed / frameBudget;
  const cadence = expectedFrames > 0 ? autoWindowFrames / expectedFrames : 1;
  const longFrameShare = autoWindowFrames > 0
    ? autoWindowLongFrames / autoWindowFrames
    : 0;

  if (cadence < 0.86 || longFrameShare > 0.2) {
    const severity = Math.max(0, 1 - cadence);
    const reduction = Math.min(0.35, 0.12 + severity * 0.5);
    autoBatch = Math.max(AUTO_BATCH_FLOOR, Math.floor(autoBatch * (1 - reduction)));
  } else if (cadence >= 0.95 && longFrameShare <= 0.05) {
    const growth = 0.04 + autoAggression * 0.012;
    autoBatch = Math.min(
      MAX_AUTO_BATCH,
      autoBatch + Math.max(4, Math.ceil(autoBatch * growth)),
    );
  }

  resetAutoControlWindow(now);
}

// Exactly one fence-bounded batch may be outstanding. Render timing adjusts future batches.
function computeTick() {
  try {
    if (evolveMode) {
      setTimeout(computeTick, 32);
      return;
    }
    if (paused) {
      setTimeout(computeTick, 32);
      return;
    }
    if (pendingSync) {
      const state = gl.clientWaitSync(pendingSync, 0, 0);
      if (state === gl.TIMEOUT_EXPIRED) {
        setTimeout(computeTick, 0); // GPU still draining the last batch — yield, retry
        return;
      }
      if (state === gl.WAIT_FAILED) throw new Error('GPU synchronization failed.');
      gl.deleteSync(pendingSync);
      pendingSync = null;
    }

    const now = performance.now();
    if (speedMode === 'slow' && now < nextSlowStepAt) {
      setTimeout(computeTick, Math.min(16, nextSlowStepAt - now));
      return;
    }

    const batchSteps = speedMode === 'auto' ? autoBatch : 1;
    solver.step(batchSteps);
    totalSteps += batchSteps;
    stepsSinceMark += batchSteps;
    if (speedMode === 'slow') nextSlowStepAt = now + 1000 / SLOW_STEPS_PER_SEC;
    pendingSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!pendingSync) throw new Error('Could not create GPU synchronization fence.');
    gl.flush();
    setTimeout(computeTick, 0);
  } catch (error) {
    fail(error);
  }
}

// Render loop: display-synced, independent of how many steps the compute loop landed.
function renderTick(now) {
  try {
    if (previousFrameAt) {
      const frameMs = now - previousFrameAt;
      if (!refreshPeriodMs) refreshPeriodMs = frameMs;
      else if (frameMs < refreshPeriodMs * 1.25) {
        refreshPeriodMs = refreshPeriodMs * 0.9 + frameMs * 0.1;
      }
      updateAutoControl(now, frameMs);
    }
    previousFrameAt = now;
    renderedSinceMark += 1;
    resizeCanvas();
    if (evolveMode) driveEvolution();
    render();
    const elapsed = now - markStart;
    if (elapsed >= 500) {
      stepsPerSec = stepsSinceMark * 1000 / elapsed;
      framesPerSec = renderedSinceMark * 1000 / elapsed;
      stepsSinceMark = 0;
      renderedSinceMark = 0;
      markStart = now;
      if (forcesLive) showDiagnostics();
      updateStatus();
    }
    requestAnimationFrame(renderTick);
  } catch (error) {
    fail(error);
  }
}

try {
  gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('This browser or GPU does not provide WebGL2.');

  solver = new LBM(gl, cfg);
  solver.setSolidMask(LBM.debugMask(cfg));
  ga = new GeneticAlgorithm(solver, cfg);
  resetEvolutionExplorationState();
  resizeCanvas();
  updateStatus();
  addEventListener('keydown', handleKey);
  speedButton.addEventListener('click', toggleSpeedMode);
  evolveButton.addEventListener('click', toggleEvolveMode);
  fitnessSelect.addEventListener('change', () => setFitnessMode(fitnessSelect.value));
  computeTick();
  requestAnimationFrame(renderTick);
} catch (error) {
  fail(error);
}
