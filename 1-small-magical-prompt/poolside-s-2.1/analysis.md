# SDD Analysis — poolside-s-2.1

Reviewed: `spec.md` (single file with Requirements / Design / Tasks sections). A Playwright `test.spec.js` was shipped alongside — beyond what the spec asked for.

## Strengths

- Clean FR/NFR separation with numbered tables — the only spec in the batch to treat non-functional requirements (browser support, frame rate floor, canvas minimum, self-containment) as first-class citizens.
- **Phase 8 (T24–T26) verifies the meta-constraints themselves**: exactly 3 files, no external dependencies, playable from `index.html` alone. No other spec closes the loop on the exercise's own rules; this one makes compliance a task.
- The blast-damage formula is written down (`damage = max(0, BASE_DAMAGE * (1 - distance / BLAST_RADIUS))`) — closed-form and implementable, unlike kimi's ambiguous 1.5× rule.
- Sensible module breakdown of `game.js` into nine numbered logical sections, without pretending they are separate files (the mistake mimo made).

## Challenges

1. **Requirements are one-line assertions, not acceptance criteria.** No EARS, no WHEN/THEN, and almost nothing quantified: no worm count per team, no HP-per-weapon numbers, no blast radius values, no charge time, no fuse. FR-09 says damage is "based on distance" — the formula appears only later, in design. A checklist of seventeen "the game does X" statements cannot be verified item by item, which is the whole point of the requirements layer.
2. **Optionality is written into the requirements.** FR-16: wind "(optional, adds realism)". FR-17: explosions "*can* cause chain reactions *if* nearby projectiles or worms are affected" — untestable weasel wording; there are no nearby projectiles (one projectile exists at a time as designed) and no death explosions to chain. A requirement that cannot fail is not a requirement.
3. **There is no turn timer.** The only turn-bounding mechanism is a manual Skip Turn button (FR-14). A player who never acts stalls the match indefinitely — the same hole as nemotron, in a spec that otherwise thought about robustness enough to bound FPS.
4. **The trajectory preview (NFR-05) removes the game's skill.** A dotted arc showing the predicted landing point, combined with weak wind ("subtle horizontal drift", `vx += wind * 0.01`), turns aiming into cursor placement. Classic Worms is built on judging arcs under wind pressure; this spec assists away exactly that. Never framed as a trade-off.
5. **The arsenal is one weapon.** No grenade, no fuse mechanics, no weapon selection anywhere in FRs, design, or tasks — for a genre whose identity is choosing the right tool. FR-06's "aim by dragging or using angle/power controls" also leaves two incompatible input models open, and the module list mentions only mouse/touch — keyboard players are unserved.
6. **Two collision models are specified for the same event.** §2.5: explode "when projectile y exceeds terrain surface at x" (heightmap thinking); §2.7: sample the pixel array at the projectile position (bitmap thinking). They disagree exactly where Worms terrain gets interesting — overhangs and tunnels carved by earlier blasts. The pixel model is the right one; the spec should not contain the wrong one too.
7. **Frame-rate–dependent physics against its own NFR.** Constants are per-frame (`vy += GRAVITY` at 0.3 px/frame²) while NFR-03 accepts anything ≥30 FPS — so a 30 FPS machine and a 144 Hz monitor play different games, violating the spirit of the NFR that sits ten lines above.
8. **Missing survival mechanics, uncut but unmentioned**: no fall damage, no knockback (explosions damage but never move worms — so no shove-into-water tactics), no retreat window, no settle phase before elimination checks, no draw rule, no AI. As with others, silence rather than decisions.

## Verdict

A tidy, honest document with two genuinely good habits — NFRs as a table and spec-rule self-verification tasks — wrapped around an undersized and under-quantified game: one weapon, no clock, no knockback, assisted aiming, and requirements written as untestable one-liners. The scaffolding outclasses the substance.
