import { radiusAt } from './genome.js';

export function rasterize(genomes, cfg) {
  const width = cfg.TILE_W * cfg.GRID_X;
  const height = cfg.TILE_H * cfg.GRID_Y;
  const mask = new Uint8Array(width * height);
  const cx = Math.round(cfg.TILE_W / 3);
  const cy = Math.round(cfg.TILE_H / 2);
  const tiles = cfg.GRID_X * cfg.GRID_Y;

  for (let t = 0; t < tiles; t += 1) {
    const genome = genomes[t];
    const tx = t % cfg.GRID_X;
    const ty = Math.floor(t / cfg.GRID_X);
    const x0 = tx * cfg.TILE_W;
    const y0 = ty * cfg.TILE_H;

    for (let localY = 0; localY < cfg.TILE_H; localY += 1) {
      const y = y0 + localY;
      const row = y * width;
      for (let localX = 0; localX < cfg.TILE_W; localX += 1) {
        const x = x0 + localX;
        if (localY === 0 || localY === cfg.TILE_H - 1) {
          mask[row + x] = 255;
          continue;
        }
        if (!genome) continue;

        const dx = localX - cx;
        const dy = localY - cy;
        if (Math.hypot(dx, dy) < radiusAt(genome, Math.atan2(dy, dx))) mask[row + x] = 255;
      }
    }
  }
  return mask;
}
