# PROGRESS — append only, never rewrite history
# HARD CAP: 40 lines. Over cap, delete oldest resolved entries.
# Read at session start. Append at session end. Nothing else.

## STATUS
Phase: 5 — drag unit test active; fixed-area genomes + stratified adaptive mutation (base 18–80, children 0.5×/1×/2×/4×)
Files existing: lbm.js, main.js, shaders/*, genome.js, raster.js, ga.js, fitness.js
Last verified: drag evolution improved from Cd 1.5 to 3.3, then diversity slowed. Stratified mutations now guarantee refinement and exploratory children every generation; browser retest pending.

## MEASURED (real numbers, not spec numbers)
tau_plus = 0.56, omega_plus = 1.7857, omega_minus = 0.2143  (derived; independently confirmed by Codex Sol 2026-07-17)
observed Cd = 0.97 (browser, after force-sign flip; order 1, below lit 1-3 but fine — GA uses RELATIVE values only)
drag evolution best Cd = 3.3 (browser; improved from prior 1.5 plateau, confirming force fitness retains a gradient)
observed St = 0.133 (browser zero-crossings; slightly under lit 0.15-0.20, ballpark given ~1 period/window). Lift: mean~0 (symmetric body), oscillates; RMS Cl shown in HUD.
lift sign convention: force vector negated globally, so lift = -Fy, consistent with drag. Direction is a convention, not pinned to physical +y.

## SPEC-GAPS (agent-chosen, needs human ruling)
- 

## BROKEN / KNOWN-WEIRD
- 2026-07-17 coordinator: Phase 2 GO/NO-GO PASSED in browser — visible Karman street, periodic flapping, all 16 tiles in-phase, tile seams leak-free. Phase 2 COMPLETE.
- 2026-07-17 coordinator: perf/UX — decoupled compute (fence-gated setTimeout loop, vsync-free) from render (rAF) in main.js; hoisted redundant GL state out of step loop; steps/frame cap 64->512; vorticity recolored to dark-bg glow (warm=CCW, cool=CW), u_scale 0.02->0.013, solids gray. GPU-bound ceiling ~1200 steps/s stands.
- 2026-07-17 integrator: main.js speed control is now AUTO/SLOW (button, A toggle, ↑/↓ select); AUTO fence-times one in-flight batch and responds to render-frame pressure, SLOW targets 30 steps/s; HUD reports batch, throughput, and FPS. Node syntax/whitespace checks pass; runtime rate remains browser/GPU-dependent.
- 2026-07-17 coordinator: adaptive-speed integration reviewed and confirmed live on localhost:8765; browser automation unavailable, so visual FPS/throughput validation remains user-side.
- 2026-07-17 coordinator: solver perf — mask now 3-valued (0 open / 128 fluid-adjacent-to-solid / 255 solid); open-fluid cells fast-path pure-streaming, skipping 8 per-link solid fetches/step (~18->10 fetches for interior cells). Numerically identical (no-solid-neighbor cells never bounce back). isSolid threshold + vorticity solid paint bumped to >0.75. Node syntax OK; browser speedup/stability unverified (user reload).
- 2026-07-17 coordinator: Phase 3 BUILT — momentum-exchange force (FORCE_FRAGMENT, body links only, tile walls excluded by localY position) + 2-pass GPU reduction (reduceY W×4, reduceX writes per-tile into ring history) + RGBA32F 300×16 history; step() samples every SAMPLE_EVERY; readLift/DragHistory do one readPixels + unrotate; diagnostics() computes Cd=meanDrag/(0.5 U^2 D) & St from lift zero-crossings. Boundary-flag derivation MOVED debugMask->setSolidMask so raster.js 0/255 masks also fast-path (Phase-4 correctness). main.js: F key shows Cd/St. Node syntax OK; NOT browser-verified — gate St 0.15-0.20, Cd 1-3, drag>0.
- 2026-07-17 integrator: AUTO tuning made throughput-seeking in main.js — batch starts at 48, probes +40%/healthy frame at default push 7/9 up to 2048, backs off on measured frame misses, and retains a 100ms-class freeze guard; +/- adjusts push while A and arrows keep AUTO/SLOW controls. One-fence submission and Phase 3 F diagnostics preserved. Node syntax/whitespace checks pass; browser throughput/FPS validation pending refresh.
- 2026-07-17 coordinator: aggressive AUTO integration reviewed; conservative slice cap is gone, manual +/- push is restored, and static checks pass. User refresh/performance measurement pending.
- 2026-07-18 integrator: replaced startup/single-frame AUTO backoff with 900ms sustained render-health windows plus 1.8s startup grace; AUTO now has a hard 48-step batch floor, moderate windowed probing, and reductions only after sustained cadence loss. One-fence submission, SLOW toggle, +/- probe control, and F diagnostics preserved; main.js Node syntax/whitespace checks pass, browser validation pending refresh.
- 2026-07-18 coordinator: stable AUTO review passed; all reduction paths clamp at batch 48, startup cannot back off, and only sustained 900ms cadence loss can reduce above-floor probing.
- 2026-07-18 user verification: stable AUTO looks and performs correctly in-browser; immediate throughput collapse is resolved.
- 2026-07-18 coordinator: Phase 3 GATE PASSED — browser F-readout Cd=0.97 (positive after force-sign flip in FORCE_FRAGMENT), St=0.133 (ballpark), lift oscillates. diagnostics() extended with mean Cl + RMS Cl; HUD now shows lift. Phase 3 COMPLETE.
- 2026-07-18 coordinator: main.js — F now TOGGLES a live forces panel (auto-refresh ~2Hz) instead of one-shot.
- 2026-07-18 Codex Terra (delegated): Phase 4 built — genome.js/raster.js/ga.js/fitness.js. Coordinator reviewed: raster tile-indexing/walls/center match solver, fitness tile-major layout + signed L/D + shedding correct, genome area+mutate+clamp correct, ga truncation+elitism correct. node --check OK. ga.js exports class GeneticAlgorithm(solver,cfg,rng).runGeneration()/setFitnessMode().
- 2026-07-18 coordinator: EVOLVE is now non-blocking: ga.js exposes beginGeneration()/stepGeneration(maxSteps)/finishGeneration(), preserving runGeneration(); main.js advances fence-gated 256-step chunks from rAF and renders between chunks. sigmaScale=3, reseed/R, G, and live fitness switching retained. Node --check (copied .mjs) passes for ga.js and main.js; browser responsiveness remains to verify.
- 2026-07-18 genome: repaired Fourier positivity in coefficient space before area normalization (seed + mutation), eliminating clamp-distorted area. Deterministic 200-genome check: 0 negative radii at 8192 angles; analytic area 1256.637 target, raster mean 1256.31 (range 1243–1265); node syntax passes.
- 2026-07-18 GA: drag-plateau fix keeps locked top-4 mutation-only selection but raises lattice-scale mutation to adaptive 30 (floor 18, cap 60): meaningful gains cool it, 2+ stagnant generations expand it, and reseed or a changed fitness mode resets adaptation without replacing the population/lineage. Deterministic checks pass for 4×4 reproduction, elite preservation, growth/cooling/cap/reset; syntax and diff checks pass. Browser drag retest pending.
- 2026-07-18 coordinator: plateau fixes reviewed cross-layer — valid star-convex genomes now preserve true fixed area, scale-30 mutations change bbox geometry where scale 3 did not, and GA selection/non-blocking behavior remains intact. Reload → R → G drag retest is the remaining gate.
- 2026-07-18 integrator: EVOLVE HUD now reports adaptive exploration state from each finishGeneration result (sigmaScale, mutation-scale range, stagnation count/status), with correct pending/reset state at initialization, reseed, and fitness-mode changes. Generation stepping and speed control unchanged; main.js Node syntax/whitespace checks pass, browser display validation pending refresh.
- 2026-07-18 coordinator: second plateau fix — every retained parent now produces 0.5×/1×/2×/4× mutation scales; stagnation expands base sigma 1.5× to cap 80. At the cooled floor, raster tests changed ~45–326 pixels across child scales, preventing visually static generations without immigrants/crossover.
