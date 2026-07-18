# PROJECT: `evolve` — Shapes Discovering Aerodynamics

A browser app. Lattice-Boltzmann fluid solver in WebGL2. A genetic algorithm evolves 2D shapes
inside the flow. Nothing is designed — random blobs discover camber, streamlining, or bluffness
depending on what you select for.

Ships as static files on GitHub Pages. No build step if avoidable. Vanilla JS + WebGL2. No frameworks.

---

## 0. READ THIS FIRST — HOW TO WORK ON THIS

### Token discipline (hard rules)

This runs on a shared $20 plan. Waste is theft from classmates. Obey:

1. **Never restate this spec back to me.** Don't summarize what you're about to do. Build it.
2. **Never paste a full file back after editing.** Show the diff or the changed function only.
3. **Do not re-read files already in context.** Track what you've read.
4. **No "would you like me to..." checkpoints.** Every decision in §2 is locked. If something is
   genuinely underspecified, pick the simpler option, add a `// SPEC-GAP:` comment, and continue.
5. **No apologies, no preamble, no recap.** Code and a one-line status.
6. **When a phase is done, stop.** Print `PHASE N COMPLETE` + what to verify visually. Wait.
7. **Do not refactor across phase boundaries.** Later phases only touch their own files plus the
   integration points named in §1.
8. Comments explain *why*, not *what*. No comment on every line.

### Multi-agent workflow

Work in **separate sessions, one per role.** Each role gets: this spec's §1 (contracts) + §2
(locked decisions) + its own phase section + only the files it owns. Roles never read each other's
internals — they talk through the interfaces in §1. That is the whole point: it means no session
ever has to hold the entire project.

| Role | Owns | Never touches |
|---|---|---|
| **SOLVER** | `lbm.js`, `shaders/lbm_*.glsl` | GA, UI, genome |
| **GENOME** | `genome.js`, `raster.js` | shaders, fluid internals |
| **GA** | `ga.js`, `fitness.js` | shaders, rendering |
| **RENDER** | `render.js`, `shaders/draw_*.glsl`, `ui.js` | solver internals, GA internals |
| **INTEGRATOR** | `main.js` only | everything else's internals |

Start each session with:
> You are the **SOLVER** agent for the `evolve` project. Read §0, §1, §2, §3 of EVOLVE_SPEC.md.
> You own only `lbm.js` and `shaders/lbm_*.glsl`. Obey the token rules in §0. Begin Phase 1.

---

## 1. INTERFACE CONTRACTS (frozen — no agent may change these)

```js
// genome.js
export function seedGenome(rng)                 -> Float32Array(21)
export function mutate(genome, sigmaScale, rng) -> Float32Array(21)
export function radiusAt(genome, theta)         -> float
export function normalizeArea(genome, targetArea) -> Float32Array(21)  // in-place ok

// raster.js
export function rasterize(genomes, cfg)         -> Uint8Array(W*H)  // 255 = solid, 0 = fluid
                                                   // full-domain mask, all tiles, walls included

// lbm.js
export class LBM {
  constructor(gl, cfg)
  setSolidMask(uint8Array)     // uploads mask, resets force accumulators
  reset()                      // reinit f to equilibrium at (rho=1, u=(U_IN,0))
  step(n = 1)                  // advance n lattice steps
  readLiftHistory()            // -> Float32Array(N_SAMPLES * 16)  ONE readback, end of gen only
  readDragHistory()            // -> Float32Array(N_SAMPLES * 16)
  get velocityTexture()        // for RENDER
  get vorticityTexture()       // for RENDER
}

// fitness.js
export function score(liftHist, dragHist, mode, cfg) -> Float32Array(16)
// mode ∈ {'drag', 'ld', 'shedding'}

// cfg — single frozen object, defined in main.js, passed everywhere
{
  TILE_W: 256, TILE_H: 192, GRID_X: 4, GRID_Y: 4,   // domain = 1024 x 768
  U_IN: 0.05, TAU_PLUS: 0.56, MAGIC: 0.25,
  CHORD: 40, TARGET_AREA: /* area of a 40-diameter circle */ Math.PI * 400,
  N_HARMONICS: 10,
  WARMUP_STEPS: 4000, EVAL_STEPS: 6000, SAMPLE_EVERY: 20,  // N_SAMPLES = 300
  POP: 16, ELITE: 1, KEEP: 4, SIGMA0: 0.05
}
```

**Rule: no agent adds a field to `cfg` without it being listed here.**

---

## 2. LOCKED DECISIONS (do not relitigate; do not "improve")

- **D2Q9. TRT collision, NOT BGK.** τ⁺ = 0.56 is unstable under BGK. This is not negotiable and it
  is the single most common failure mode of this project.
- **Magic parameter Λ = 1/4.** (`(1/ω⁺ − 1/2)(1/ω⁻ − 1/2) = Λ` → derive ω⁻ from ω⁺.) This choice
  makes halfway bounce-back walls land where they're supposed to.
- **Population is TILED, not sequential.** All 16 individuals live on one 1024×768 lattice, in a
  4×4 grid of independent sub-domains separated by solid walls. One shader pass advances all 16.
  Sequential evaluation is ~15× slower and makes the project infeasible. This is the load-bearing
  architectural decision.
- **Genome = radial Fourier descriptor.** `r(θ) = a₀ + Σₙ₌₁¹⁰ [aₙcos(nθ) + bₙsin(nθ)]`, 21 floats.
  Star-convex only — no slots, no biplanes. Accepted limitation.
- **Orientation is FIXED at zero.** Angle of attack is NOT a gene. The shape must discover camber
  to make lift. If AoA is a gene the GA finds it in ten generations and the project has no result.
- **Area is a HARD constraint, not a penalty.** After mutation, compute enclosed area analytically
  and rescale all coefficients by `sqrt(TARGET_AREA / A)`. Degenerate shrink-to-zero must be
  *unrepresentable*, not merely discouraged.
- **Mutation only. No crossover.** Gaussian creep on every coefficient every generation,
  `sigma_n ∝ SIGMA0 / n` (low harmonics move a lot, high harmonics whisper).
- **Truncation selection: keep top 4, each spawns 4. Elitism: best individual passes unmutated.**
  Without elitism the gallery visibly regresses and looks broken.
- **Seeding: random coefficients with amplitude ∝ 1/n**, then area-normalized. Smooth lumpy
  asymmetric blobs. No circles. Do not rig the start.
- **Force = momentum exchange over boundary links.** Not pressure integration.
- **Shedding frequency = zero-crossing count of the lift signal.** Not an FFT.
- **ONE GPU readback per generation.** Lift/drag are accumulated into a small history texture on
  the GPU (`N_SAMPLES × 16`); read it once when the generation ends. Per-step readback stalls the
  pipeline and throws away the entire tiling win.
- **View is decoupled from compute.** All 16 tiles always simulate. The UI shows ONE tile at a
  time, full-screen, arrow-keys to navigate. Rendering is a crop.

### Physics sanity (already derived — don't redo it)
```
ν = (1/3)(τ⁺ − 1/2) = 0.02
Re = U·L/ν = 0.05 · 40 / 0.02 = 100
Ma = 0.05 / 0.577 ≈ 0.09          ✓
```
Re must stay **> 47** or there is no vortex shedding at all and the Phase 2 go/no-go silently
fails for physics reasons that look exactly like bugs. Blockage is ~21% (chord 40 in a 192 tile) —
high, so everything evolves for a *duct*, not free flight. This is fine: every individual is
handicapped identically, so the comparison is fair. It is a caveat for the writeup, not a bug.

---

## 3. PHASE 1 — SOLVER CORE (agent: SOLVER)

Build `lbm.js` + `shaders/lbm_collide.glsl`.

- State: 9 distribution functions per cell, packed into **3 × RGBA32F textures** (12 slots, 9 used).
  Ping-pong: read A, write B, swap.
- One fragment shader per step doing **stream-gather then collide**. Gather (pull `f_i` from
  neighbor at `x − c_i`) not scatter — a fragment shader can only write its own pixel.
- D2Q9 velocities `(0,0), (±1,0), (0,±1), (±1,±1)`; weights `4/9, 1/9×4, 1/36×4`; `cs² = 1/3`.
- TRT: split into symmetric/antisymmetric parts about the opposite direction,
  `f_i^± = (f_i ± f_ī)/2`, relax each with ω⁺ / ω⁻.
- Inlet: fixed velocity `(U_IN, 0)` at each tile's left column (equilibrium BC is fine).
  Outlet: zero-gradient at each tile's right column.
- No obstacles yet. Add a debug render of |u| straight to canvas.

**Verify:** uniform flow, no NaNs after 50k steps. If ρ drifts or goes NaN, the collision is wrong
— check ω⁻ derivation first, it's almost always that.

`PHASE 1 COMPLETE` → stop.

---

## 4. PHASE 2 — BOUNCE-BACK + THE GO/NO-GO (agent: SOLVER)

- Add solid mask texture (R8). Halfway bounce-back: at a solid cell, `f_i ← f_ī`.
- Tile walls: solid rows/columns between sub-domains so tiles cannot leak into each other.
- Hardcode a **cylinder of diameter 40** in each tile, centered, ~⅓ back from the inlet.

**GO/NO-GO — Saturday dinner.** You must see a Kármán vortex street: alternating vortices peeling
off the cylinder. Render vorticity (`∂ᵥu − ∂ᵤv`) with a diverging blue/white/red colormap — the
street is nearly invisible in a speed plot and obvious in a vorticity plot.

Wake steady and symmetric → Re is too low → check U_IN and τ. Everything explodes → BGK snuck in,
or ω⁻ is wrong. **No street by Saturday dinner: the project is over, fall back to a Physarum
slime-mold sim.** Do not spend Sunday debugging a solver.

`PHASE 2 COMPLETE` → stop.

---

## 5. PHASE 3 — FORCES (agent: SOLVER)

- Momentum exchange: for every fluid cell adjacent to solid, for each link `i` pointing into solid,
  accumulate `c_i · (f_i(x) + f_ī(x))`. Sum over the boundary → force on that tile's body.
- GPU reduction: per-tile sum via log-reduction passes down to a 4×4 texture (one value per tile).
- Every `SAMPLE_EVERY` steps, append the per-tile lift and drag into a **history texture**
  (`N_SAMPLES × 16`, RG32F: R = lift, G = drag).
- `readLiftHistory()` / `readDragHistory()` do exactly one `readPixels` and only when called.

**Verify against known values:** a cylinder at Re=100 should give `St ≈ 0.15–0.20` and `Cd` of
order 1–3 (confinement pushes both up — don't chase exact literature numbers, check the ballpark).
If drag is negative or lift doesn't oscillate, the link accounting is wrong.

`PHASE 3 COMPLETE` → stop.

---

## 6. PHASE 4 — GENOME + GA (agents: GENOME, then GA)

**GENOME** builds `genome.js` + `raster.js`:
- `radiusAt` evaluates the Fourier sum. Guard `r > 0` — clamp coefficients so the radius can't go
  negative (an inside-out shape is not a shape).
- Analytic area: `A = ½∫₀²ᵖ r(θ)² dθ`, which for this series is
  `A = π(a₀² + ½Σₙ(aₙ² + bₙ²))`. Use it. Don't integrate numerically.
- `rasterize`: for each lattice cell, `solid = |p − tileCenter| < radiusAt(θ)`. Plus tile walls.

**GA** builds `ga.js` + `fitness.js`:
- `score(liftHist, dragHist, mode, cfg)`:
  - `'drag'` → mean drag over the window.
  - `'ld'` → mean(lift) / mean(drag). **Signed lift, not absolute** — so the whole gallery cambers
    the same way and reads as a coherent lineage.
  - `'shedding'` → zero-crossings of lift / 2 / window duration.
- Generation loop: `rasterize → setSolidMask → reset → step(WARMUP) → step(EVAL) → read → score →
  select → mutate`.
- **Store every generation's best genome + its score.** The lineage gallery is the artifact that
  makes the writeup. Trivial now, painful to retrofit.

`PHASE 4 COMPLETE` → stop.

---

## 7. PHASE 5 — THE UNIT TEST (agent: INTEGRATOR)

Run mode `'drag'`. Fixed area, fixed orientation, maximize drag → **the answer is a flat plate
broadside to the flow.** It should emerge in roughly 10 generations.

**If a flat plate does not emerge, the force measurement is wrong and everything downstream is
fiction.** This is not a result; it is a test. It costs ten generations. Run it before anything else.

Then switch to `'ld'` — the real experiment, where camber has to be discovered.

*Known risk:* the L/D gradient is shallow at generation 1 (random blobs at zero AoA make almost no
lift). If it stalls, warm up on `|lift|` alone for ~10 generations to force camber, then switch to
`'ld'` to clean it up.

---

## 8. PHASE 6 — MAKE IT BEAUTIFUL (agent: RENDER)

This phase is the grade. The physics is a means.

- **Vorticity, diverging colormap**, one tile full-screen. Arrow keys walk the population.
  The other 15 keep simmering off-screen.
- **Fitness selector: dropdown, prominent, switchable MID-RUN.** This is the best feature in the
  project and it's nearly free — fitness is re-scored every generation anyway, so switching just
  changes which number you sort by. No reset, no reseed. Let someone spend 40 generations perfecting
  an airfoil and then flip to max-drag and watch the lineage *disassemble itself*. That's the demo.
- **Lineage gallery**: a filmstrip of best-shape-per-generation. Click to inspect.
- Generation counter, current fitness, a toggleable legend explaining the colormap.
- Read `/mnt/skills/public/frontend-design/SKILL.md` before styling. Restraint. Dark background,
  the flow is the only color on screen, type stays out of the way.

---

## 9. IF SHORT ON TIME, CUT IN THIS ORDER

1. Shedding-frequency mode (keep drag + L/D)
2. Fixed-chord toggle (fixed-area only)
3. Lineage gallery → static list of thumbnails
4. **Never cut:** the vorticity view, mid-run fitness switching, the drag unit test.
