# Project coordination rules

These rules apply to every agent working anywhere in this repository.

1. Read `breadcrumb.md` before inspecting or changing implementation files.
2. Treat `EVOLVE_INITIAL_SPEC.md` as the source of truth for contracts, ownership, and phase gates.
3. Before ending any session that changes files, verification state, measurements, blockers, or phase state, append one concise dated entry to `breadcrumb.md`.
4. Never silently leave the breadcrumb stale. If no project state changed, do not add noise.
5. Do not rewrite history. At the 40-line cap, remove only the oldest entries that are clearly resolved.
6. Record measured values as measured values; never substitute values copied from the specification.
7. Do not mark a phase complete until its stated verification gate has actually passed.

The coordinating agent is responsible for checking the breadcrumb after delegated work and adding the integration-level entry when needed.
