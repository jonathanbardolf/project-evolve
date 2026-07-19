# PROGRESS — append only, never rewrite history
# HARD CAP: 40 lines. Over cap, delete oldest resolved entries.
# Read at session start. Append at session end. Nothing else.

## STATUS
Phase: 6 IN PROGRESS (visual polish landed; long-run stagnation fix just added, retest pending)
Files: lbm.js, main.js, shaders/*, genome.js, raster.js, ga.js, fitness.js
Phase 6 landed: single-tile fullscreen view (T key + on-screen VIEW button top-right, defaults ON at load) with </>/on-screen arrows to navigate 16 tiles (arrows had a rendering bug — root cause not yet confirmed, revisit if still broken); lineage gallery (L, canvas-thumbnail filmstrip from genome radiusAt, click to inspect, caps render at 100 gens); colormap legend (C); vivid warm/cool vorticity recolor + textbook jet-style speed colormap (blue->cyan->green->yellow->red, was grayscale) + HUD accent color pass.
GA: user ran AUTO 500 generations with NO improvement — root cause: population converges (top-4 keepers go near-identical), so explorer mutation (derived FROM those keepers) can't escape. Fix: random immigrants added to ga.js — 2/gen always, escalating to 5/gen after 40 stagnant gens (IMMIGRANT_BASE_COUNT/IMMIGRANT_STAGNATION_THRESHOLD/BONUS), fully fresh seedGenome() not mutate(), elite slot 0 still protected. Syntax OK; browser long-run retest pending — this is the open item.
Also live: genome.js mutate() shrinks harmonics n>3 toward zero each mutation (fixes jagged/lumpy edges, camber n<=3 untouched); LBM.getMaxMach() + HUD row; fp16 flag (default OFF, ?fp16 or cfg.FP16_DISTRIBUTIONS); non-blocking EVOLVE. Deploy: Cloudflare Pages, bundle at ~/Desktop/evolve-deploy (STALE — missing all Phase 6 + immigrant work, regenerate before next deploy). Codex paused per user; all recent work is Claude-only (Sonnet/Haiku agents + coordinator direct edits).

## MEASURED (real numbers, not spec numbers)
tau_plus = 0.56, omega_plus = 1.7857, omega_minus = 0.2143  (derived; independently confirmed by Codex Sol 2026-07-17)
observed Cd = 0.97 (browser, after force-sign flip; order 1, below lit 1-3 but fine — GA uses RELATIVE values only)
drag evolution best Cd = 3.74 (browser; improved from prior 1.5 plateau, validating force/selection direction)
observed St = 0.133 (browser zero-crossings; slightly under lit 0.15-0.20, ballpark given ~1 period/window). Lift: mean~0 (symmetric body), oscillates; RMS Cl shown in HUD.
lift sign convention: force vector negated globally, so lift = -Fy, consistent with drag. Direction is a convention, not pinned to physical +y.
AIRFOIL RESULT (browser, ld/auto): L/D ~28.5, CL 2.29, Cd 0.08, MaxMach 0.18 — genuine cambered airfoil, camber DISCOVERED from random blobs. HEADLINE RESULT. (L/D 46837 earlier was a drag->0 exploit; fixed.)
NOTE: negative drag on extreme/ballooned shapes = regime breakdown (gap velocity -> Ma>0.2), not a discrete bug; auto-curriculum MaxMach guard keeps shapes in-regime.
NOTE: 500-gen stagnation observed AFTER the L/D~28.5 result — likely population convergence (see immigrants fix above), not a new regression of the airfoil result itself.

## SPEC-GAPS (agent-chosen, needs human ruling)
- 

## BROKEN / KNOWN-WEIRD
- Single-tile arrow-key nav buttons (‹ › on-screen, left/right canvas edges) reportedly not rendering as of 2026-07-19; root cause not confirmed (checked DOM/CSS wiring, looked clean — next suspect was render() throwing before updateStatus() unhides them). New top-right VIEW button (T-equivalent) added as a workaround entry point; on-screen prev/next arrows themselves still unverified in browser.
- Launchers: `OPEN_EVOLVE.command` (macOS) and `OPEN_EVOLVE.bat` (Windows) both present, serve localhost:8765.
- Deploy: Cloudflare Pages set up (git-connect or direct-upload); GitHub Pages workflow also exists (`.nojekyll` + deploy-pages.yml) as a fallback. Desktop bundle at ~/Desktop/evolve-deploy is STALE (predates Phase 6 + immigrants) — regenerate before sharing a link.
- 2026-07-18 coordinator: Phase 3 GATE PASSED — browser F-readout Cd=0.97, St=0.133, lift oscillates. Phase 3 COMPLETE.
- 2026-07-18 Codex Terra (delegated): Phase 4 built — genome.js/raster.js/ga.js/fitness.js, coordinator-reviewed clean against frozen contracts.
- 2026-07-18 coordinator: EVOLVE made non-blocking (begin/step/finishGeneration chunking); genome Fourier positivity repaired pre-normalization; GA moved to explore->exploit sigma annealing (30 -> floor 1.75) with stratified 0.5x/1x/2x/4x children; drag evolution reached Cd 3.74, validating force/selection pipeline.
- 2026-07-19 coordinator: fitness 'ld' regularized (DRAG_FLOOR 0.004) to kill a drag->0 exploit (L/D was hitting ~46,837); heterogeneous explorer mutation added (EXPLORER_COUNT 5 @ 8x sigma from top keepers, elite protected) — together these produced the L/D~28.5 airfoil headline result.
- 2026-07-19 coordinator: random-immigrant fix for long-run (500-gen) stagnation — see STATUS/MEASURED above, this is the current open verification item.
- 2026-07-19 Codex: added selectable GA strategy (`population` default / `single`) with a POOL/SINGLE UI selector and EVOLVE HUD row. Single retains an exact elite and fills the other 15 slots with 0.5x/1x/2x/4x cyclic mutations of the current best; no immigrants by design. `node --check` passed for ga.js and main.js; mocked generation smoke test passed both strategies.
