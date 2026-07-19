import { LBM } from './lbm.js';
import { GeneticAlgorithm } from './ga.js';
import { radiusAt } from './genome.js';

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
    position: fixed; top: 16px; left: 16px; z-index: 1;
    width: min(380px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto;
    padding: 12px 14px; border: 1px solid #ffffff1c; border-radius: 8px;
    background: #05070ac2; color: #ccd6e0; font-size: 12px; line-height: 1.45;
    backdrop-filter: blur(6px);
  }
  #status[hidden] { display: none; }
  #status.error { color: #ffb4a9; border-color: #ff6b5e66; }
  .metric-grid {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 18px;
    margin: 0;
  }
  .metric-grid dt { color: #8493a3; text-transform: uppercase; letter-spacing: 0.07em; }
  .metric-grid dd { margin: 0; color: #f0f5fa; text-align: right; overflow-wrap: anywhere; }
  .metric-grid dd.warn { color: #ff6b5e; font-weight: 600; }
  .status-hint {
    margin: 11px 0 0; padding-top: 9px; border-top: 1px solid #ffffff1c;
    color: #8493a3; font-size: 11px;
  }
  #speed-mode {
    position: fixed; top: 16px; right: 16px; z-index: 2; min-width: 132px;
    padding: 9px 12px; border: 1px solid #78dce84d; border-radius: 6px;
    background: #0b1118d0; color: #9fd8e0; font: inherit; font-size: 12px;
    letter-spacing: 0.04em; cursor: pointer; backdrop-filter: blur(6px);
  }
  #speed-mode:hover, #speed-mode:focus-visible { border-color: #78dce899; background: #111b25e6; }
  #speed-mode[data-mode="slow"] { color: #ccd6e0; border-color: #ffffff2e; }
  #evolve-mode, #fitness-mode, #hud-toggle {
    position: fixed; right: 16px; z-index: 2; min-width: 132px;
    padding: 9px 12px; border: 1px solid #c792ea4d; border-radius: 6px;
    background: #0b1118d0; color: #cbb8e0; font: inherit; font-size: 12px;
    letter-spacing: 0.04em; backdrop-filter: blur(6px);
  }
  #evolve-mode { top: 60px; cursor: pointer; }
  #fitness-mode { top: 104px; cursor: pointer; }
  #hud-toggle { top: 148px; cursor: pointer; color: #ccd6e0; border-color: #ffffff2e; }
  #evolve-mode:hover, #evolve-mode:focus-visible, #fitness-mode:hover, #fitness-mode:focus-visible,
  #hud-toggle:hover, #hud-toggle:focus-visible {
    border-color: #c792ea99; background: #171025e6;
  }
  #evolve-mode[data-active="true"] { color: #a6e3a1; border-color: #a6e3a14d; }

  .legend {
    margin: 11px 0 0; padding-top: 9px; border-top: 1px solid #ffffff1c;
  }
  .legend-bar {
    height: 5px; border-radius: 3px; margin-bottom: 4px;
    background: linear-gradient(to right, #2f9fe0 0%, #0d1620 42%, #05070a 50%, #1c1108 58%, #e0821f 100%);
  }
  .legend-labels {
    display: flex; justify-content: space-between; color: #6b7686; font-size: 10px;
    letter-spacing: 0.03em; text-transform: uppercase;
  }

  #lineage-panel {
    position: fixed; left: 16px; right: 16px; bottom: 16px; z-index: 1;
    padding: 10px 12px; border: 1px solid #ffffff1c; border-radius: 8px;
    background: #05070ac2; color: #6b7686; font-size: 11px; backdrop-filter: blur(6px);
  }
  #lineage-panel[hidden] { display: none; }
  #lineage-panel .lineage-title {
    margin: 0 0 7px; color: #8493a3; text-transform: uppercase; letter-spacing: 0.07em; font-size: 10px;
  }
  #lineage-strip {
    display: flex; align-items: flex-end; gap: 6px; overflow-x: auto; padding-bottom: 2px;
  }
  .lineage-thumb {
    flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 2px;
    background: none; border: 1px solid #ffffff14; border-radius: 4px; padding: 3px;
    cursor: pointer; color: #576174; font: inherit; font-size: 9px; line-height: 1;
  }
  .lineage-thumb canvas { display: block; border-radius: 2px; }
  .lineage-thumb:hover, .lineage-thumb:focus-visible { border-color: #78dce866; }
  .lineage-thumb.selected { border-color: #78dce8b3; color: #b9f4fa; }
  .lineage-caption { margin: 7px 0 0; color: #8493a3; }
  @media (max-width: 600px) {
    #status { top: 196px; max-height: calc(100vh - 212px); }
  }
`;
document.head.append(style);

const canvas = document.createElement('canvas');
canvas.id = 'flow';
canvas.setAttribute('aria-label', 'Lattice-Boltzmann velocity view');
document.body.append(canvas);

const status = document.createElement('section');
status.id = 'status';
status.setAttribute('role', 'status');
status.setAttribute('aria-live', 'polite');
document.body.append(status);

const hudButton = document.createElement('button');
hudButton.id = 'hud-toggle';
hudButton.type = 'button';
hudButton.title = 'Show or hide metrics (H)';
hudButton.setAttribute('aria-controls', 'status');
document.body.append(hudButton);

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
for (const mode of ['auto', 'drag', 'ld', 'lift', 'shedding']) {
  const option = document.createElement('option');
  option.value = mode;
  option.textContent = `FITNESS · ${mode.toUpperCase()}`;
  fitnessSelect.append(option);
}
document.body.append(fitnessSelect);

const lineagePanel = document.createElement('section');
lineagePanel.id = 'lineage-panel';
lineagePanel.hidden = true;
lineagePanel.setAttribute('aria-label', 'Best shape per generation');
const lineageTitle = document.createElement('p');
lineageTitle.className = 'lineage-title';
lineageTitle.textContent = 'LINEAGE · best shape per generation';
const lineageStrip = document.createElement('div');
lineageStrip.id = 'lineage-strip';
const lineageCaption = document.createElement('p');
lineageCaption.className = 'lineage-caption';
lineagePanel.append(lineageTitle, lineageStrip, lineageCaption);
document.body.append(lineagePanel);

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
let forceDiagnostics = null;
let hudVisible = true;
let gl;
let solver;
let ga;
let evolveMode = false;
let evolveGenerationReady = false;
let evolveBestScore = null;
let evolveBestTile = 0;
let evolveBestCd = null;
let evolveBestCl = null;
let evolveBestLd = null;
let evolveSigmaScale = null;
let evolveStagnationGenerations = 0;
let evolveMutationScaleMin = null;
let evolveMutationScaleMax = null;
let evolveAutoPhase = null;
let evolveMaxMach = null;
let singleTileView = false;
let selectedTile = 0;
let tileManuallyChosen = false;
let legendVisible = false;
let lineageVisible = false;
let lineageDirty = true;
let lineageSelectedIndex = null;
const LINEAGE_RENDER_CAP = 100;
const LINEAGE_THUMB_ANGLES = 64;

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(innerWidth * dpr));
  const height = Math.max(1, Math.round(innerHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function renderStatusMetrics(rows, hint) {
  const grid = document.createElement('dl');
  grid.className = 'metric-grid';
  for (const [label, value, warn] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    if (warn) detail.classList.add('warn');
    grid.append(term, detail);
  }
  const controls = document.createElement('p');
  controls.className = 'status-hint';
  controls.textContent = hint;
  const children = [grid, controls];
  if (legendVisible) children.push(buildLegend());
  status.replaceChildren(...children);
}

function buildLegend() {
  const legend = document.createElement('div');
  legend.className = 'legend';
  const bar = document.createElement('div');
  bar.className = 'legend-bar';
  const labels = document.createElement('div');
  labels.className = 'legend-labels';
  for (const text of ['CW', 'vorticity', 'CCW']) {
    const span = document.createElement('span');
    span.textContent = text;
    labels.append(span);
  }
  legend.append(bar, labels);
  return legend;
}

function tileViewRow() {
  return singleTileView ? [['Tile view', `${currentTileIndex() + 1}/16`]] : [];
}

function updateHudButton() {
  status.hidden = !hudVisible;
  hudButton.textContent = `HUD · ${hudVisible ? 'HIDE' : 'SHOW'}`;
  hudButton.setAttribute('aria-expanded', String(hudVisible));
}

function toggleHud() {
  hudVisible = !hudVisible;
  updateHudButton();
}

function updateStatus() {
  if (evolveMode) {
    const explorationState = evolveSigmaScale !== null && evolveSigmaScale <= 3.5
      ? 'REFINING'
      : evolveSigmaScale !== null && evolveSigmaScale <= 15 ? 'COOLING' : 'EXPLORING';
    const mutationRange = evolveMutationScaleMin === null
      ? 'pending'
      : `${evolveMutationScaleMin.toFixed(1)}–${evolveMutationScaleMax.toFixed(1)}`;
    const sigma = evolveSigmaScale === null ? 'pending' : evolveSigmaScale.toFixed(1);
    const machValue = evolveMaxMach === null ? 'pending' : evolveMaxMach.toFixed(2);
    const machWarn = evolveMaxMach !== null && evolveMaxMach > 0.2;
    const rows = [
      ['State', paused ? 'PAUSED' : 'EVOLVING'],
      ['Generation', ga.generation.toLocaleString()],
      ['Fitness', ga.mode.toUpperCase()],
    ];
    if (ga.mode === 'auto') {
      rows.push(['Phase', evolveAutoPhase === 'refine-ld' ? 'REFINE · L/D' : 'WARMUP · LIFT']);
    }
    rows.push(
      ['Best score', evolveBestScore === null ? 'awaiting' : evolveBestScore.toFixed(4)],
      ['Cd', evolveBestCd === null ? 'awaiting' : evolveBestCd.toFixed(3)],
      ['Cl', evolveBestCl === null ? 'awaiting' : evolveBestCl.toFixed(3)],
      ['L/D', evolveBestLd === null ? 'awaiting' : evolveBestLd.toFixed(3)],
      ['Best tile', evolveBestScore === null ? 'awaiting' : String(evolveBestTile + 1)],
      ['Max Mach', machWarn ? `${machValue} (LIMIT)` : machValue, machWarn],
      ['Anneal stage', explorationState],
      ['Sigma', sigma],
      ['Mutation range', mutationRange],
      ['Stagnant generations', String(evolveStagnationGenerations)],
      ...tileViewRow(),
    );
    renderStatusMetrics(
      rows,
      'Space pause · G evolution · R reseed · V view · T tile · ←/→ tile nav · '
      + 'L lineage · C legend · F forces · H hide',
    );
    evolveButton.dataset.active = 'true';
    evolveButton.textContent = 'EVOLVE · ON';
    evolveButton.setAttribute('aria-pressed', 'true');
    fitnessSelect.value = ga.mode;
    return;
  }

  const modeDetail = speedMode === 'auto'
    ? `AUTO · batch ${autoBatch} · probe ${autoAggression}/9`
    : `SLOW · batch 1 · ${SLOW_STEPS_PER_SEC} steps/s`;
  const rows = [
    ['State', paused ? 'PAUSED' : 'RUNNING'],
    ['View', view],
    ['Speed', modeDetail],
    ['Step', totalSteps.toLocaleString()],
    ['Steps/s', Math.round(stepsPerSec).toLocaleString()],
    ['FPS', String(Math.round(framesPerSec))],
    ...tileViewRow(),
  ];
  if (forceDiagnostics) {
    const machWarn = forceDiagnostics.maxMach > 0.2;
    rows.push(
      ['Cd', forceDiagnostics.cd.toFixed(2)],
      ['Cl mean', forceDiagnostics.cl.toFixed(2)],
      ['Cl RMS', forceDiagnostics.clRms.toFixed(2)],
      ['St', forceDiagnostics.st.toFixed(3)],
      ['Max Mach', machWarn ? `${forceDiagnostics.maxMach.toFixed(2)} (LIMIT)` : forceDiagnostics.maxMach.toFixed(2), machWarn],
    );
  }
  renderStatusMetrics(
    rows,
    'Space pause · A speed · +/- probe · . step · V view · T tile · ←/→ tile nav · '
    + 'L lineage · C legend · F forces · R reset · H hide',
  );
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
  hudVisible = true;
  updateHudButton();
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

// The tile shown in single-tile mode: the user's manual pick once they've navigated,
// otherwise the current EVOLVE best-scoring tile (falls back to tile 0 outside EVOLVE
// or before a first score exists).
function currentTileIndex() {
  if (!tileManuallyChosen && evolveMode && evolveBestScore !== null) return evolveBestTile;
  return selectedTile;
}

function render() {
  if (singleTileView) {
    const tile = currentTileIndex();
    if (view === 'vorticity') solver.renderVorticityTile(tile);
    else solver.renderDebugTile(tile);
    return;
  }
  if (view === 'vorticity') solver.renderVorticity();
  else solver.renderDebug();
}

function toggleSingleTileView() {
  singleTileView = !singleTileView;
  if (singleTileView && !tileManuallyChosen) selectedTile = currentTileIndex();
  render();
  updateStatus();
}

function navigateTile(delta) {
  if (!singleTileView) return;
  selectedTile = ((currentTileIndex() + delta) % 16 + 16) % 16;
  tileManuallyChosen = true;
  render();
  updateStatus();
}

function toggleLegend() {
  legendVisible = !legendVisible;
  updateStatus();
}

// --- Lineage gallery: static shape-silhouette thumbnails from ga.lineage (Phase 6). ---
// Rendered with 2D canvas from genome.radiusAt — never a live sim — so this stays cheap
// even as generations pile up. Only rebuilt when the panel is visible and new data landed.
function buildLineageThumbnail(genome, generationNumber, score, lineageIndex) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lineage-thumb';
  button.dataset.index = String(lineageIndex);
  button.title = `Generation ${generationNumber} · score ${score.toFixed(4)}`;
  if (lineageIndex === lineageSelectedIndex) button.classList.add('selected');

  const w = 48;
  const h = 36;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, w, h);

  let maxR = 0;
  const points = [];
  for (let k = 0; k < LINEAGE_THUMB_ANGLES; k += 1) {
    const theta = (2 * Math.PI * k) / LINEAGE_THUMB_ANGLES;
    const r = radiusAt(genome, theta);
    maxR = Math.max(maxR, r);
    points.push([r * Math.cos(theta), r * Math.sin(theta)]);
  }
  const pad = 5;
  const scale = maxR > 0 ? Math.min((w - 2 * pad) / (2 * maxR), (h - 2 * pad) / (2 * maxR)) : 1;
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    const px = w / 2 + x * scale;
    const py = h / 2 + y * scale;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fillStyle = '#78dce8';
  ctx.fill();

  const label = document.createElement('span');
  label.textContent = String(generationNumber);
  button.append(canvas, label);
  button.addEventListener('click', () => selectLineageEntry(lineageIndex));
  return button;
}

function updateLineageCaption() {
  if (lineageSelectedIndex === null || !ga || !ga.lineage[lineageSelectedIndex]) {
    lineageCaption.textContent = ga && ga.lineage.length
      ? 'Click a thumbnail to inspect that generation.'
      : 'No generations yet — start EVOLVE (G) to populate the lineage.';
    return;
  }
  const entry = ga.lineage[lineageSelectedIndex];
  lineageCaption.textContent =
    `Inspecting generation ${lineageSelectedIndex + 1} · score ${entry.score.toFixed(4)}`;
}

function selectLineageEntry(lineageIndex) {
  lineageSelectedIndex = lineageIndex;
  for (const child of lineageStrip.children) {
    child.classList.toggle('selected', Number(child.dataset.index) === lineageIndex);
  }
  updateLineageCaption();
}

function rebuildLineageStrip() {
  lineageStrip.replaceChildren();
  if (!ga || ga.lineage.length === 0) {
    updateLineageCaption();
    return;
  }
  const start = Math.max(0, ga.lineage.length - LINEAGE_RENDER_CAP);
  for (let i = start; i < ga.lineage.length; i += 1) {
    const entry = ga.lineage[i];
    lineageStrip.append(buildLineageThumbnail(entry.genome, i + 1, entry.score, i));
  }
  lineageStrip.scrollLeft = lineageStrip.scrollWidth;
  updateLineageCaption();
}

function markLineageDirty() {
  lineageDirty = true;
  if (lineageVisible) {
    rebuildLineageStrip();
    lineageDirty = false;
  }
}

function toggleLineage() {
  lineageVisible = !lineageVisible;
  lineagePanel.hidden = !lineageVisible;
  if (lineageVisible && lineageDirty) {
    rebuildLineageStrip();
    lineageDirty = false;
  }
}

function resetEvolutionExplorationState() {
  evolveSigmaScale = ga ? ga.sigmaScale : null;
  evolveStagnationGenerations = ga ? ga.stagnationGenerations : 0;
  evolveMutationScaleMin = null;
  evolveMutationScaleMax = null;
  evolveAutoPhase = ga ? ga.autoPhase : null;
  evolveMaxMach = null;
}

function setFitnessMode(mode) {
  ga.setFitnessMode(mode);
  evolveBestScore = null;
  evolveBestCd = null;
  evolveBestCl = null;
  evolveBestLd = null;
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
      evolveBestCl = result.bestCl;
      evolveBestLd = result.bestLd;
      evolveSigmaScale = result.sigmaScale;
      evolveStagnationGenerations = result.stagnationGenerations;
      evolveMutationScaleMin = Math.min(...result.mutationScales);
      evolveMutationScaleMax = Math.max(...result.mutationScales);
      evolveAutoPhase = result.autoPhase;
      evolveMaxMach = result.maxMach;
      evolveGenerationReady = false;
      markLineageDirty();
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

function resetLineageView() {
  lineageSelectedIndex = null;
  markLineageDirty();
}

function reseedEvolution() {
  if (!ga) return;
  ga.reseed();
  evolveBestScore = null;
  evolveBestCd = null;
  evolveBestCl = null;
  evolveBestLd = null;
  evolveBestTile = 0;
  evolveGenerationReady = false;
  resetEvolutionExplorationState();
  resetLineageView();
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
  forceDiagnostics = {
    cd: d.cd[0],
    cl: d.cl[0],
    clRms: d.clRms[0],
    st: d.st[0],
    maxMach: d.maxMach,
  };
  console.log('[evolve] Phase 3 diagnostics', d);
}

function handleKey(event) {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.code === 'Space') {
    paused = !paused;
    if (!paused && speedMode === 'slow') nextSlowStepAt = performance.now();
    event.preventDefault();
  } else if (event.key.toLowerCase() === 'h') {
    toggleHud();
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
  } else if (event.code === 'ArrowLeft') {
    if (singleTileView) { navigateTile(-1); event.preventDefault(); }
  } else if (event.code === 'ArrowRight') {
    if (singleTileView) { navigateTile(1); event.preventDefault(); }
  } else if (event.key.toLowerCase() === 't') {
    toggleSingleTileView();
  } else if (event.key.toLowerCase() === 'l') {
    toggleLineage();
  } else if (event.key.toLowerCase() === 'c') {
    toggleLegend();
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
    else forceDiagnostics = null;
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
  updateHudButton();
  updateStatus();
  addEventListener('keydown', handleKey);
  hudButton.addEventListener('click', toggleHud);
  speedButton.addEventListener('click', toggleSpeedMode);
  evolveButton.addEventListener('click', toggleEvolveMode);
  fitnessSelect.addEventListener('change', () => setFitnessMode(fitnessSelect.value));
  computeTick();
  requestAnimationFrame(renderTick);
} catch (error) {
  fail(error);
}
