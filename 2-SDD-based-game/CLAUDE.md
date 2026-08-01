# Working in this folder

This folder holds a Spec-Driven Development (SDD) exercise: `requirements.md`,
`design.md`, and `tasks.md` define one implementation target (currently a
browser Worms-style game), and each subfolder (`<model-name>_<agent-name>/`)
is an independent implementation of that same spec by a different
model/agent, each on its own branch. Subfolders are sealed rooms — never
read from or write into another agent's subfolder. Everything below is
guidance for working inside *your own* subfolder.

## Read the spec before writing any code

- `requirements.md` — numbered acceptance criteria ("Requirement N,
  criterion M"). These are the actual test oracle. Reference req numbers in
  comments/commits sparingly, but check every criterion off before calling
  the work done.
- `design.md` — the architecture, algorithms, data model, and a "Testing
  Strategy" section. It usually already tells you how to make the thing
  testable (e.g. "expose `window.__game`") — don't reinvent that.
- `tasks.md` — an ordered implementation checklist. It's a good sequencing
  guide, but treat it as *scope*, not as your TDD plan — write tests before
  or alongside each task's code, not after everything is built.
- Constraints are usually strict (exact file count, no dependencies, no
  network, no build step). Re-read the constraints paragraph at the top of
  `requirements.md` before creating any file — "exactly 3 files" means
  exactly 3, full stop; helper/test files go in a `tests/` subfolder, not
  next to the deliverables.

## Architecture that makes TDD actually possible

A single dependency-free deliverable file (e.g. `game.js`) can still be unit
tested without a browser if you split it into two halves in one file:

1. **Pure simulation logic** — no reference to `document`, `window`, or
   `canvas`. Physics, procedural generation, game rules, AI decision-making.
   This is 90% of the interesting bugs and 100% of what you can unit-test
   fast with zero dependencies.
2. **Browser bootstrap** — rendering, audio, input, DOM/HUD, the main loop.
   Wrap this entire section in `if (typeof document !== 'undefined') { ... }`
   so requiring the file under Node is a no-op for this half.

At the bottom of the file, export the pure half through a guarded block:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { /* pure functions/classes only */ };
}
```

This is inert in the browser (`module` is undefined there) and lets
`node --test` exercise the real simulation code — not a reimplementation of
it — with **zero installed dependencies** (Node's built-in `node:test` +
`node:assert/strict` is enough; don't reach for a test framework here).

One gotcha: a value that needs to be called from the pure half but defined
in the browser half (e.g. a `playSound()` function) must be declared with
top-level `let name = null;` above both sections and *assigned* (not
re-declared) inside the browser block — a `function` declaration nested
inside an `if` block is block-scoped in strict mode and won't be visible
outside it.

## Follow real red/green TDD

Write the test first, run it, confirm it fails for the *expected* reason
(missing export, not a typo), then implement until it passes. Keep test
files in `tests/` in your subfolder so the process is reviewable. A few
things this project's tests specifically needed to catch:

- **Procedural generation invariants**: don't eyeball one seed. Loop over
  many seeds (50-300) and assert the invariant (e.g. "at least N standing
  zones") holds for all of them. A single lucky/unlucky seed will hide or
  fabricate a bug.
- **Sign errors in 2D physics**: y grows downward. "Rising water" means
  `waterY` *decreases*. It's easy to write the test with the same sign bug
  as the code — sanity-check the direction in prose before asserting it.
- **AI/CPU scoring must match real physics**: if you simulate a candidate
  shot to score it, the simulation has to model the *actual* resolution
  rule for that action, not a simplified stand-in. E.g. an impact weapon can
  be scored by "closest approach during flight," but a fused weapon that
  bounces and rolls for N seconds must be scored by simulating the *entire*
  bounce sequence and reading the final rest position — scoring it by
  in-flight closest-approach silently produces a competent-looking search
  that fires at essentially random targets.
- **Turn-based / state-machine "always terminates" guarantees**: write an
  explicit test per forced-termination path (timer expiry with and without
  a held action, projectile hard-timeout, out-of-bounds discard, "actor
  dies mid-turn"), not just the happy path. These are exactly the paths
  that produce soft-locks in production if untested.
- **Randomized/statistical tests need a seeded RNG.** If gameplay
  randomness (AI aim error, wind, etc.) comes from unseeded `Math.random()`,
  a statistical assertion like "≥60% of shots land" will be flaky — same
  seed, different run, different result. Derive a dedicated seeded RNG
  stream per match from the match seed and thread it through every
  randomness call; then a fixed test seed reproduces deterministically and
  a real flake means a real bug, not variance.

## Verify in a real browser before calling it done

Unit tests on the pure half will not catch UI wiring bugs. Concretely, this
session's tests were all green while two real bugs shipped:

- A DOM subtree rebuilt from scratch every animation frame — nodes get torn
  down mid-click, so on-screen buttons silently stop working (and it
  violates "update the DOM only when values change" if the design doc says
  that).
- A container `pointer-events: none` (used so the HUD doesn't block canvas
  input) applies to its children too — anything inside that needs clicks
  must opt back in with its own `pointer-events: auto`.

Drive the actual page with Playwright and check: every input path
(keyboard *and* mouse/click), state transitions, no console errors, and —
if the spec says "no network requests" — capture `page.on('request', ...)`
and assert it's empty. `window.__game`-style debug handles (if the design
doc asks for one) make this drastically easier: read state directly with
`page.evaluate()` instead of scraping pixels.

### Using Playwright in this repo

Playwright is preinstalled globally, but there's no local
`package.json`/`node_modules` for the game (by design — the deliverable
must stay dependency-free), so a plain `require('playwright')` from inside
the game folder won't resolve. Fall back to the global root:

```js
function loadPlaywright() {
  try { return require('playwright'); } catch (e) {}
  const { execSync } = require('node:child_process');
  const globalRoot = execSync('npm root -g').toString().trim();
  return require(require('node:path').join(globalRoot, 'playwright'));
}
const { chromium } = loadPlaywright();
```

Or run one-off scripts with `NODE_PATH=$(npm root -g) node -e "..."`. Do
not run `playwright install` — Chromium is already at
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` and `chromium.launch()` finds it
automatically.

## Forbidden context

If the repo contains other exercise folders (e.g. `1-small-magical-prompt/`)
that the task explicitly says are off-limits, do not read them — not for
inspiration, not to "just check." Treat that instruction as absolute.
