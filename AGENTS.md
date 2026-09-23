# AGENTS.md

Guidance for AI agents and humans working in the Oscine codebase. Oscine
is itself agent-controllable at runtime (MCP + OSC); this file is about
editing its *source*. Read `README.md` for what the app is,
`docs/north-star.md` for what it's for, `ROADMAP.md` for what's next, and
`CHANGELOG.md` for what shipped when.

## The one rule that matters

**The command catalog is the contract. Features land as catalog commands
first, UI second.**

`src/api/commands.js` is the single source of truth for every
programmatic capability. The MCP tools and the OSC address space are
*derived* from it, and the UI calls the same store actions the catalog
handlers do. If you add a feature to the UI without a corresponding
command, you have broken the project's core promise (UI/console/MCP/OSC
parity). Add the command, then wire the UI to it.

To add a command: define it in `src/api/commands.js` (name, description,
JSON Schema), implement `cmd_<name>` in `src/api/api.js`. It then surfaces
automatically as an `oscine_<name>` MCP tool and, if you add a route, in
`plugin/server/osc-gateway.js`. The smoke tests fail if a catalog command
has no handler.

**Known debt:** the arrangement side (clips, lanes, markers, cycle, inserts,
automation, transcripts) was built UI-first in v2.0 and v2.1 and has no
catalog commands yet. Don't add to that debt: new arrangement features get a
command. Paying it back is the first item in `ROADMAP.md`.

## Architecture invariants

Data flow is one-directional and event-driven. Do not shortcut it.

```
UI gesture / console / MCP / OSC
        -> store action (the ONLY place project state mutates)
        -> bus event
        -> engine mirrors audio, UI re-renders
```

Layer boundaries, enforced by discipline (and partly by tests):

- `src/core/` has no DOM and no audio. It must stay importable from node
  (the tests import it). Bus, store, schema, persistence, utils.
- `src/engine/` is audio only and **never mutates the project**. It
  reacts to bus events and mirrors state into Web Audio nodes.
- `src/ui/` is DOM only and never touches audio nodes directly; it calls
  store actions and reads state.
- `src/api/` is the programmatic surface (catalog + handlers + bridge).

The engine and UI never call each other. Both react to the store through
the bus. This is what makes undo, load, and autosave fall out for free,
and it's why the agent surface can exist at all.

## Don't hand-edit the plugin's app copy

`plugin/app/` is a generated mirror of the repo's `index.html` + `styles/`
+ `src/`. After changing the app, run:

```sh
node tools/sync-plugin.mjs
```

The smoke suite fails if `plugin/app/` has drifted from the source. Never
edit files under `plugin/app/` directly; edit the real sources and resync.

## Tests (run before committing)

```sh
node test/smoke.mjs        # zero-dep: import graph, store, scheduler math,
                           # every API command headless, OSC codec+routing,
                           # plugin bundle integrity
node test/keymap.mjs       # scheme bindings (each cites its manual page)
node test/automation.mjs   # envelope grammar, shapes, scheduling math
node test/ear.mjs          # analysis vs synthetic ground truth
node test/timedtext.mjs    # transcript formats round-trip
node test/stretch.mjs      # phase vocoder
node test/fx-<name>.mjs    # one per effect (shared fake AudioContext in
                           # test/fx-fake-ctx.mjs)
node test/e2e-mcp.mjs      # full chain: real MCP stdio -> sidecar -> WS ->
                           # OSC UDP -> headless Chromium running the app.
                           # Needs playwright-core + CHROME_BIN; skips
                           # cleanly if absent.
```

Add coverage when you add behavior. The smoke suite is the contract guard:
new commands get a headless execution check, new OSC addresses get a
routing-table entry.

**UI changes are verified by gesture, not by parse.** Drive a headless
Chrome over the DevTools protocol against the dev sidecar
(`scripts/dev-sidecar.sh`), dispatch real mouse and key events at
coordinates computed from `window.oscine.app.timeline` geometry, and read
the result back from `window.oscine.store.project`. For audio behavior,
render with `render.js` in the page and measure (RMS in a window is usually
enough). Undo after mutating tests, and never save the user's project from a
test. Put the numbers in the commit message.

## Automation that enforces this

- **CI** (`.github/workflows/ci.yml`) runs the syntax sweep, smoke suite
  (on node 20 and 22), and the full MCP+OSC e2e on every push and PR. A
  red build means a broken contract; fix it rather than merging past it.
- **Required checks**: those three CI jobs are required status checks on
  `main`, so a PR cannot merge until they pass. Admins can still push to
  `main` directly (`enforce_admins` is off) for the current solo
  workflow; tighten this when contributors arrive.
- **Claude review** (`.github/workflows/claude-review.yml`) reviews each
  PR against this contract and reads CI results. It is advisory: the
  action cannot submit a formal approval, so CI is the gate and the
  review is the intelligence on top. **@claude**
  (`.github/workflows/claude.yml`) answers questions and makes changes
  on demand in issues and PRs. Both authenticate with the repo's
  `CLAUDE_CODE_OAUTH_TOKEN` secret (a Claude Pro/Max token from
  `claude setup-token`); they no-op on fork PRs by design.
- **Memory**: `CLAUDE.md` imports this file via `@AGENTS.md`, so the
  contract loads automatically. Path-scoped reinforcements live in
  `.claude/rules/` and load only when Claude touches matching files, for
  both the PR reviewer and local Claude Code.

## Conventions

- **Versioning**: bump `version` in `package.json`,
  `plugin/.claude-plugin/plugin.json`, and `SERVER_VERSION` in
  `plugin/server/oscine-mcp.mjs` together, add a `CHANGELOG.md` entry,
  then resync and repackage
  (`cd plugin && zip -r ../oscine.plugin . -x "*.DS_Store"`). Tag releases
  `vX.Y.Z`.
- **Releasing**: after a version bump merges to `main`, update the local
  install with `npm run release:local` (refreshes the marketplace and runs
  `claude plugin update oscine`). The repo root is itself a plugin
  marketplace (`.claude-plugin/marketplace.json`, plugin `source: ./plugin`);
  install via `claude plugin marketplace add chazmaniandinkle/oscine` rather
  than uploading the `.plugin` (uploads can't be updated). See
  `plugin/README.md` > Installing & updating locally.
- **Undo model**: a gesture calls `store.checkpoint()` once before
  mutating; continuous param/mixer tweaks deliberately stay out of
  history. Structural edits (notes, steps, tracks, slots, presets) are
  undoable.
- **Instruments**: one file in `src/engine/instruments/`, subclass
  `BaseInstrument`, `defineInstrument({...})` with a param schema, import
  it from `instruments/index.js`. It then gets an inspector, presets,
  mixer strip, sequencing, and full API/MCP/OSC control for free.
- **Effects**: one file in `src/engine/effects/`, `defineEffect({...})`
  with a param schema and at least five presets, subclass `BaseEffect`,
  build between `wetIn` and `wetOut`, implement `applyParam` with short
  `setTargetAtTime` ramps, call `applyAll()` last in the constructor, and
  import it from `effects/index.js`. Implement `paramNode(key)` when a param
  maps to a real AudioParam so automation can schedule it exactly. Add
  `test/fx-<type>.mjs`.
- **Keys and drag modifiers live in `core/keymap.js`.** UI code asks
  `keymap.action(e, scopes)` or `keymap.gesture(name, e)`; it never tests
  `e.code`, `e.shiftKey` and friends directly. Scheme bindings for other DAWs
  cite the manual page they came from, or say they're not in that DAW.
- **Arrangement time is seconds.** Placements, markers, the cycle and
  lane automation are in song seconds; clip envelopes are in clip-local
  seconds so they travel with the clip; asset words are in source seconds.
  Pattern notes stay in beats.
- **Clip gain and clip automation stack.** An envelope is relative to the
  clip's own `gainDb`, as in every major DAW.
- **Zero runtime dependencies.** The app ships no bundler and no npm deps;
  the sidecar uses only node built-ins. Keep it that way. Dev-only tools
  (playwright for e2e) are fine but must never be required to run.
- **Security**: the sidecar bridge accepts localhost plus
  `OSCINE_ALLOWED_ORIGINS` only. Don't widen this casually; a hosted page
  reaching a local sidecar is a real attack surface.

## Voice for human-facing docs

README, landscape doc, public-facing copy, commit messages: write like a
person. No em-dashes (use commas, parentheses, or a rewrite). Avoid
AI-tell vocabulary (leverage, robust, seamless, cutting-edge, delve,
tapestry). Internal code comments and technical specs can be as precise
as they need to be.

## Working agreements

- Prefer editing the real source over generated/bundled copies.
- When a change spans layers, keep each layer's job intact rather than
  reaching across boundaries for convenience.
- If you're unsure whether something belongs in core/engine/ui/api, the
  test "could core/ still import in node?" usually decides it.
