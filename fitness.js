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
      scores[t] = Math.abs(meanDrag) > 1e-8 ? meanLift / meanDrag : 0;
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
