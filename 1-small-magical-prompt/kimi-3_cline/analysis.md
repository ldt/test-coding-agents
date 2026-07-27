# SDD Analysis — kimi-3_cline

Reviewed: `spec/requirements.md`, `spec/design.md`, `spec/tasks.md` (proper 3-file Kiro structure, tasks updated to done-state after verification).

## Strengths

- One of the two strongest SDDs in the batch (with opus-5). It has a glossary, quantified acceptance criteria almost everywhere (6 px step-up, 30 s timer, power charge ~1.3 s, aim range [-75°, +90°], wind [-3, +3], per-weapon radius/damage numbers), and a world model (1600×640 world, 960×540 viewport) that actually implies the camera it then designs.
- **REQ-10.5 is the best single idea in any of these specs**: a `?demo` URL parameter that runs an autoplaying bot through synthetic keyboard events, *required at spec level* as a smoke-test hook. Testability designed in, not bolted on.
- The design is unusually implementation-honest: fixed timestep with a max-steps guard against the spiral of death, terrain as a 2 px cell grid with column-repaint caching, surface-normal estimation for grenade bounces, fall-damage formula with explicit threshold and coefficient.
- Elegant turn mechanics: the timer applies only to aim/charge, and the grenade/dynamite **fuse doubles as the retreat clock** — simpler and more faithful to Worms than a separate retreat timer, and it makes the "no escape from your own dynamite" failure mode (present in opus-5's spec) impossible.
- Spawn quality is a requirement (≥6 distinct standing zones above the waterline), not an accident.

## Challenges

1. **REQ-7.1's damage formula doesn't close.** Damage applies "to every worm within 1.5× blast radius, scaled linearly with distance." Linear from what value to what value, reaching zero where — at R or at 1.5R? As written, a literal reading (falloff reaching 0 at R) gives *negative* damage between R and 1.5R. The design doesn't resolve it either. One sentence would have fixed the only load-bearing formula left ambiguous.
2. **No single-player mode.** The demo bot is a tester, not an opponent; the game is hot-seat only. For "the best game," the absence of any CPU opponent is the largest scope gap — deepseek's otherwise weaker spec beats it here.
3. **Implementation leakage in requirements**: REQ-1.1 mandates "layered sinusoidal noise with random phases" and REQ-1.4 mandates grass on "newly uncovered column tops" — both are design decisions (the second even leaks the column-based terrain representation) stated as user-facing requirements.
4. **The fixed 1 s settle phase is a gamble.** A worm knocked off a high overhang can still be falling when the settle window closes; the victory check could then run against a worm that is about to drown. A condition-based settle ("all at rest") with a time *cap*, rather than a fixed delay, is the safe construction.
5. **Small spec/reality frictions**: the asymmetric aim range [-75°, +90°] is never justified; jump has a key (Enter) but no specified impulse or arc; wind is a unitless [-3, +3] whose px/s² meaning appears only in the design's `vx += wind·35·dt`; floating damage numbers — standard Worms feedback — are absent from REQ-7's otherwise thorough feedback list.
6. **Three-weapon arsenal** (bazooka, grenade, dynamite). Defensible, but no hitscan weapon and no cluster weapon means less variety than the prompt's "best game" ambition invites, and nothing in the spec records this as a conscious cut.
7. Minor: REQ-2.1 fixes teams at 3 worms each while other strong specs chose 4 — fine, but with 3 weapons and 3 worms the match length skews short; no rationale given.

## Verdict

A rigorous, honest, testable spec whose design shows real systems thinking (fuse-as-retreat, cached column repaints, demo-bot hook). Its weaknesses are a handful of unclosed numbers (the 1.5× damage formula), one risky fixed delay, and a deliberate-but-undocumented narrow scope: no AI, three weapons. As a *document*, second only to opus-5; as a *specified game*, mid-sized.
