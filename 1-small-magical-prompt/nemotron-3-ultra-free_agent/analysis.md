# SDD Analysis — nemotron-3-ultra-free_agent

Reviewed: `SPEC.md` (single file containing Requirements / Design / Tasks sections — a compact take on the Kiro structure; acceptable, though separate files would match the convention better).

## Strengths

- All three Kiro sections are present and coherent, with 6 user stories, 12 EARS criteria, an architecture diagram, concrete data models, and a phased task list.
- The weapons table is the third-best in the batch: three genuinely distinct profiles including a hitscan shotgun with pellets and spread — a weapon class kimi and mimo both lack — expressed as data (`WEAPONS = [...]`), which is the right shape.
- Terrain is specified correctly as an alpha-channel pixel array with circular destruction and feathered edges — no heightmap trap.
- The error-handling section (context loss, out-of-bounds cleanup, division-by-zero guards) is brief but real.

## Challenges

1. **This is a 1v1 duel, not a Worms game — and the spec never says so.** Every criterion speaks of "the worm"/"the other player"; criterion 11 ends the game "WHEN a worm's health reaches 0"; the shipped code (verified) creates exactly 2 worms total. Teams of worms — the roster management that defines Worms — is absent, and no decision record acknowledges the cut. US-1's "control a worm" quietly presupposes it.
2. **There is no turn timer.** Nothing in requirements, design, or tasks bounds a turn (verified: no countdown in the shipped code either). A player who never presses fire stalls the match forever. Every other full SDD in the batch specified 30–45 s.
3. **The input model has an unresolved mode conflict.** Criterion 2: up arrow = jump when on ground. Criterion 3: up/down = aim "WHILE aiming." What puts the player in the aiming state? Nothing defines the mode switch, so as specified, pressing up is simultaneously a jump and an aim adjustment. This is exactly the kind of ambiguity acceptance criteria exist to kill.
4. **No wind.** A bazooka with gravity-only ballistics and a flat 600×400 field reduces aiming to memorizing one arc. (Same core-loop damage as mimo, minus mimo's trajectory preview at least.)
5. **Internal inconsistency between sections**: task 5.1 calls the bazooka a "timed projectile" while criterion 6 makes it impact-detonated (the grenade is the timed one). The `EXPLOSION_FORCE = 8` constant and task 4.3 promise knockback physics, but no requirement covers knockback — untraceable scope.
6. **The stated file constraint contradicts the exercise**: "Single HTML file with embedded or linked CSS/JS" — the prompt fixed three files. (The implementation shipped three files anyway, so the *delivery* is compliant; the *spec* is what's wrong.)
7. **Missing survival rules**: no fall damage, no water/drowning (the terrain algorithm mentions "underwater areas" that then do nothing), no draw condition, no retreat window, no settle phase before the win check.
8. **Testing strategy is three one-liners** ("Unit: terrain generation, collision, damage") in a project with no test harness and no stated way to run any of it.

## Verdict

A tidy, readable mini-spec that specifies a competent 1v1 artillery duel — but roughly half of what makes Worms *Worms* (teams, turn clock, wind, drowning, knockback-as-requirement) is either missing or contradicted between sections, and none of the cuts is documented as a choice. Good skeleton, undersized ambition.
