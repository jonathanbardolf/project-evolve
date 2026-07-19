export function score(liftHist, dragHist, mode, cfg) {
  const samples = cfg.EVAL_STEPS / cfg.SAMPLE_EVERY;
  const tiles = cfg.GRID_X * cfg.GRID_Y;
  const scores = new Float32Array(tiles);

  for (let t = 0; t < tiles; t += 1) {
    const start = t * samples;
    let meanLift = 0;
    let meanDrag = 0;
    for (let i = 0; i < samples; i += 1) {
      meanLift += liftHist[start + i];
      meanDrag += dragHist[start + i];
    }
    meanLift /= samples;
    meanDrag /= samples;

    if (mode === 'drag') {
      scores[t] = meanDrag;
    } else if (mode === 'ld') {
      // Require genuine POSITIVE drag above a floor. The naive meanLift/meanDrag lets the GA
      // game L/D by driving drag toward 0 (or slightly negative), exploding the ratio to ~1e4
      // — a measurement singularity, not an airfoil. Below the floor, fall back to lift minus a
      // large penalty: cheaters can't win, but there's still a gradient pushing drag up over
      // the floor. DRAG_FLOOR ~= Cd 0.08 at q = 0.5*U^2*D = 0.05; tune if airfoils read too draggy.
      const DRAG_FLOOR = 0.004;
      scores[t] = meanDrag > DRAG_FLOOR ? meanLift / meanDrag : meanLift - 1000;
    } else if (mode === 'lift') {
      // Warm-up: reward sustained lift in either direction to force camber/asymmetry,
      // breaking the shallow-gradient stall of 'ld' where symmetric blobs make ~0 lift.
      scores[t] = Math.abs(meanLift);
    } else if (mode === 'shedding') {
      let crossings = 0;
      let previous = 0;
      for (let i = 0; i < samples; i += 1) {
        const centered = liftHist[start + i] - meanLift;
        const sign = centered > 0 ? 1 : centered < 0 ? -1 : 0;
        if (sign !== 0) {
          if (previous !== 0 && sign !== previous) crossings += 1;
          previous = sign;
        }
      }
      scores[t] = (crossings / 2) / (samples * cfg.SAMPLE_EVERY);
    } else {
      throw new Error(`Unknown fitness mode: ${mode}`);
    }
  }
  return scores;
}
