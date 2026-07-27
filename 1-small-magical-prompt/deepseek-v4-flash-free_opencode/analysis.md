# SDD Analysis — deepseek-v4-flash-free_opencode

Reviewed: `spec/requirements.md`, `spec/design.md`, `spec/tasks.md` (proper 3-file Kiro structure).

## Strengths

- Real EARS discipline: every requirement has a stable ID (`REQ-TERRAIN-1`…), and tasks carry full traceability back to those IDs — the cleanest ID hygiene in the whole batch.
- A dedicated **Edge Cases** section (EC-1…EC-4) — most competing specs have none.
- Decision records with options and rationale (Canvas vs DOM, instant vs simulated AI).
- Only spec besides the design-only ones to actually *require* a computer opponent with wind compensation (REQ-AI-1…4), and the shipped `game.js` does contain an `AI` class.

## Challenges

1. **The terrain data model contradicts the destruction requirement.** REQ-TERRAIN-2 demands circular destruction, but the design stores terrain as `heights[]` — one y-value per x column. A heightmap cannot represent a circular hole punched into the side of a cliff, an overhang, or a tunnel; carving can only *lower columns*. Either the requirement is unachievable as written or the visual result is a rectangular notch pretending to be a crater. A pixel/alpha bitmap (as gemini, kimi, opus specify) was needed.
2. **Implementation leaks into requirements.** REQ-TERRAIN-1 mandates "generated using sine waves" — that is a design choice, not a user-observable behavior, and it locks the design into the flawed heightmap before design even starts.
3. **REQ-WEAPON-5 (ricochet once, explode on second impact) invents a weapon that is neither a bazooka nor a grenade**, and it is the *only* weapon — there is no weapon selection at all. For a Worms-inspired game, a one-weapon arsenal misses the genre's core tactical choice.
4. **Turn-end semantics are underspecified.** REQ-TURN-3: "WHEN timer expires OR weapon is fired THEN turn SHALL end." Read literally, the turn ends at the moment of firing — before the projectile lands. There is no settle phase in the state machine between EXPLODING and SWITCH_TURN for falling worms, no retreat window, and no rule for what happens if the active worm kills itself.
5. **No fall damage and no knockback.** Explosions deal proximity damage only (REQ-WEAPON-4). Knockback is a signature Worms mechanic — its absence removes shove-into-water tactics entirely, even though EC-2 (drowning) exists.
6. **Tab as the jump key is a footgun.** Tab moves browser focus; the spec never mentions `preventDefault`, so the first jump can silently defocus the game.
7. **Hard-coded asymmetry: red team is always the CPU (REQ-AI-1).** There is no 2-player hot-seat mode and no mode selection — a scope cut that is never stated as a decision.
8. **No robustness requirements.** No projectile timeout, no maximum settle time, no delta-time clamp, no draw rule when *both* teams die (EC-1 only covers one team surviving). Any of these can soft-lock a match.
9. **Testing strategy is five one-line manual bullets** with no pass criteria and no mapping to the requirement IDs the spec otherwise maintains so carefully.

## Verdict

Structurally the most disciplined lightweight spec in the batch, but the heightmap-vs-circular-destruction contradiction is a genuine architectural defect baked in at requirements level, and the single-weapon, no-knockback, no-retreat scope makes the specified game a minimal artillery demo rather than a Worms game.
