# SDD Analysis — opus-5_claude-code

Reviewed: `spec/requirements.md`, `spec/design.md`, `spec/tasks.md` (proper 3-file Kiro structure; tasks checked off with traceability; Playwright smoke test and screenshots shipped alongside).

## Strengths

- The most complete and most *measurable* spec in the batch: 10 requirements with quantified criteria throughout (90 px spawn spacing, ±85° aim, 70 px safe-fall with a 35-point cap, 1.2 s charge, 45 s clock, 12 s projectile life cap), a spawn-failure regeneration rule (R1.4), and a dedicated Robustness requirement (R10) that no one else matched.
- Several genuinely sharp rules others missed: clock-expiry-while-charging fires at current power (R3.4) instead of eating the turn; off-world projectiles are kept *while they can still return* (R10.1) rather than discarded at the edge; worm death detonations with resolved chain reactions (R7.4/7.5) — a signature Worms behavior absent from every other spec.
- Design decisions are argued, not asserted: three terrain options weighed with the collision hot path as the deciding criterion; fixed timestep with 3 px sub-steps justified by tunneling; the `tryWalk` probe order (`0, -1…-5, +1…+5`) getting slope-climb and wall-block "with no special cases" is an elegant, honest mechanism description.
- Ammo economy per team (R6.1/6.3/6.4) and a six-weapon arsenal including airstrike targeting — the richest specified game by a wide margin. WebAudio synthesis is specified so sound exists without violating the 3-file rule.

## Challenges

1. **The retreat rule breaks fuse weapons as written.** R3.6 grants the 5 s retreat window only after "all projectiles, explosions and worm motion have settled," and the design's FSM confirms it: `FLIGHT → SETTLE → RETREAT`. For dynamite (5 s fuse dropped at your own feet) the explosion is *part of* settling — so the spec, read literally, makes the placer stand beside their dynamite until it detonates and only then offers retreat. Grenades have the same inversion. Kimi's construction (the fuse itself is the retreat clock) is the correct one; here the flagship robustness spec contains its most consequential sequencing bug. Whether the implementation quietly fixed it is beside the point — the spec is the contract, and the contract is wrong.
2. **No CPU opponent.** The target-user line admits "one person experimenting solo," but nothing plays back. For the prompt's "best game" framing, this is the largest scope gap — and unlike most of this spec's other boundaries, it isn't recorded as a decision with a rationale.
3. **Maximalism with no priority order.** Six weapons, caves, parallax, DPR-aware resize, synthesized audio, chain reactions — and no MoSCoW/priority marking anywhere. If the implementing agent runs out of budget mid-list, the spec gives no guidance on what the minimum playable core is. It happened to land (the shipped `game.js` is the largest in the repo), but the spec gambled.
4. **Turn-clock coverage has a hole.** R3.3 runs the clock only "WHILE the state is AIM." TARGET (airstrike click-designation) is "a sub-state of AIM" in the design — but if an implementer models it as a sibling state, the clock freezes and targeting mode becomes a stall exploit. One sentence ("the clock runs in TARGET") would close it.
5. **Dual aiming inputs, one crosshair.** R5.2 (keyboard rotate) and R5.3 (aim follows mouse-over) are both mandatory with no arbitration rule — a stray mouse movement silently overwrites a carefully keyed angle. Precedence or an activation gesture needed specifying.
6. **Shotgun's second shot vs. the clock and retreat is unspecified.** R6.8 grants a second shot "and only then end the turn" — during which the clock is presumably expired or paused (unstated), and whether a retreat window follows a hitscan weapon at all is unaddressed.
7. **No stalemate guard.** With 45 s turns and two evasive players, a match can run forever; classic Worms answers this with sudden death. Shared by every spec in the batch, but the spec that wrote R10 "so that a match can be finished" was the one positioned to notice.

## Verdict

The best SDD in the folder — most measurable, most defensively specified, and the only one whose decisions read like they were argued before being written down. Its flaws are correspondingly instructive: one real sequencing defect (retreat-after-settle inverts fuse-weapon tactics), one large silent scope cut (no AI), and an unprioritized maximal scope that a weaker implementing agent could not have landed.
