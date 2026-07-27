# SDD Analysis — mimo-v2.5-free_opencode

Reviewed: `SPEC.md`, `DESIGN.md`, `TASKS.md` (proper 3-document Kiro structure, at folder root).

## Strengths

- Broad, well-organized coverage: 10 user stories, 26 numbered EARS criteria, explicit constraints and out-of-scope list, decision records with options, a phase-dependency graph in TASKS, and a 10-point success-criteria checklist.
- Floating damage numbers, turn indicators, and explosion animation are required (criteria 24–26) — feedback is treated as a requirement, not garnish.
- Performance considerations section (terrain as cached ImageData, effect pooling, spatial hashing) shows awareness of the hot paths.

## Challenges

1. **The design contradicts itself about file structure.** "Component Responsibilities" names nine separate files — `renderer.js`, `input.js`, `terrain.js`, `physics.js`, `entities.js`, `turns.js`, `weapons.js`, `collision.js`, `game.js` — while the File Structure section and the single-file decision record say everything goes in one `game.js`. An implementer must guess which half of the document to believe. (The decision record wins, but a design shouldn't need adjudication.)
2. **Wind does not exist in this spec.** No requirement, no design element, no task mentions wind — the mechanic that makes Worms artillery aiming a skill. Combined with criterion 15's **mandatory trajectory preview**, the specified game has aim assistance *and* nothing to compensate for: shots become point-and-click. This pair of choices guts the genre's core skill loop, and neither is recorded as a decision.
3. **AI is contradictory.** SPEC's out-of-scope list excludes "complex AI opponents," but DESIGN's overview promises "simple AI for single-player." No requirement, no task, and (verified) no AI in the shipped `game.js`. The design line is dead text.
4. **The constraint that matters most is left to preference.** "Single HTML file with embedded CSS/JS OR separate files (user preference)" — the prompt fixed exactly three files; a spec whose job is to pin constraints re-opened a settled one.
5. **Broken traceability.** TASKS references `US-014`, `US-015`, `US-017`, `US-020`, `US-021` — user stories only go up to US-010. The intent is clearly acceptance criteria #14/15/17/20/21, but the labels as written point at nothing, defeating the purpose of traceability.
6. **The weapon system is one weapon deep.** Task 5.1 implements the bazooka and defers "weapon selection (future)" — while US-005 promises "different weapons with varying effects" and the design's Weapon model includes types (`projectile | direct | area`) that nothing uses. Speculative generality (a public `WormsGame` API and an event-emitter system are fully specified too) coexists with an unbuilt core feature.
7. **Turn semantics are ambiguous.** Criterion 8: "WHEN player moves worm THEN system SHALL consume turn time (30 seconds max)" — does time run only while moving? Criterion 9 ends the turn "after weapon is used" with no settle rule, no retreat window, and no statement of whether the projectile resolves first. No fall damage. No draw condition when both teams die together.
8. **Effort estimates (22–32 hours) and phase hour ranges** are noise in an agent-executed spec — harmless, but they signal template-filling rather than tailoring to the actual constraints of the exercise.

## Verdict

The most *complete-looking* spec of the weaker half: excellent scaffolding, real EARS criteria, genuine decision records — undermined by internal contradictions (files, AI), broken task-to-requirement links, and two silent design choices (no wind, mandatory trajectory preview) that remove the very skill mechanic that makes a Worms game worth playing.
