# SDD Analysis — gemini-3.6-reasoning

Reviewed: `sdd.txt` (single 3.3 KB document). Delivered code: `worms.html` (single file).

## Strengths

- The terrain technique is exactly right and precisely described: offscreen canvas buffer, `destination-out` carving, alpha-channel collision — the correct architecture that deepseek's heightmap spec missed.
- Concrete physics constants (gravity 0.25 px/f², wind ∈ [-0.15, 0.15], grenade restitution e = 0.5) and an explicit knockback impulse formula — the only spec in the batch to write the falloff math down.
- The 6-step game flow includes a **PHYSICS_SETTLE** state before the victory check — a subtlety most of the other specs omitted, and the source of real soft-locks when missing.
- Clean weapon table with distinct, quantified profiles (bazooka: wind-affected, impact; grenade: bouncy, wind-immune, 3 s fuse).

## Challenges

1. **This is not a Kiro SDD.** The prompt required requirements, design, and tasks. This document is design-only: there are no user stories, no acceptance criteria, no testable requirements, and no task list at all. Nothing here says what "done" means, and nothing is traceable.
2. **The deliverable violates the 3-file rule — and the spec never restates the constraint.** A spec's first job is to pin the non-negotiables; because the constraint was never written down, the implementation shipped a single `worms.html` instead of html + js + css. This is the clearest demonstration in the repo of why constraints belong in the spec.
3. **The specified collision method is a performance trap.** §2.1 prescribes `getImageData(x, y, 1, 1).data[3] > 0` *per query*. Pixel readback from a canvas per sample, potentially hundreds of times per frame, is one of the slowest operations available in the 2D API. The fix (cache the alpha buffer once per destruction) is cheap, but the spec institutionalizes the slow path.
4. **Frame-rate–dependent physics.** All constants are in px/frame² and there is no mention of a timestep strategy. On a 144 Hz monitor the same shot flies a visibly different arc than at 60 Hz, and the game literally plays faster. No delta clamp for backgrounded tabs either.
5. **The turn system is a sketch.** A 30 s duration is "assigned" but nothing says what happens when it expires (auto-fire? forfeit?), there is no retreat window after firing, no rule for the active worm dying mid-turn, and no draw condition — CHECK_VICTORY only "checks if a team is wiped out."
6. **Large scope silently absent**: no title/restart screens, no fall damage, no AI opponent, no camera (fixed 1000×600), no ammo economy, only 2 weapons. None of these cuts is stated as a decision; they are simply not mentioned, so a reader cannot tell scope from oversight.
7. **No testing strategy of any kind** — not even a manual checklist.
8. Cosmetic but telling: raw LaTeX (`0.25\text{ px/f}^2`, `35\text{px}`) pasted into a plain-text file suggests the document was generated and never proof-read.

## Verdict

A technically literate design fragment — its terrain and settle-phase choices are better than several full SDDs here — but as an SDD it fails the assignment: no requirements, no tasks, no constraints, and the shipped single-file deliverable is the direct, predictable consequence of that missing requirements layer.
