# AGENTS.md

Guidance for AI agents and humans working in the Oscine codebase. Oscine
is itself agent-controllable at runtime (MCP + OSC); this file is about
editing its *source*. Read `README.md` for what the app is and
`docs/landscape.md` for where it's headed.

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
node test/smoke.mjs      # zero-dep: import graph, store, scheduler math,
                         # every API command headless, OSC codec+routing,
                         # plugin bundle integrity
node test/e2e-mcp.mjs    # full chain: real MCP stdio -> sidecar -> WS ->
                         # OSC UDP -> headless Chromium running the app.
                         # Needs playwright-core + CHROME_BIN; skips
                         # cleanly if absent.
```

Add coverage when you add behavior. The smoke suite is the contract guard:
new commands get a headless execution check, new OSC addresses get a
routing-table entry.

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

- **Versioning**: bump `plugin/.claude-plugin/plugin.json` and
  `SERVER_VERSION` in `plugin/server/oscine-mcp.mjs` on any plugin/sidecar
  change, then resync and repackage
  (`cd plugin && zip -r oscine.plugin . -x "*.DS_Store"`).
- **Undo model**: a gesture calls `store.checkpoint()` once before
  mutating; continuous param/mixer tweaks deliberately stay out of
  history. Structural edits (notes, steps, tracks, slots, presets) are
  undoable.
- **Instruments**: one file in `src/engine/instruments/`, subclass
  `BaseInstrument`, `defineInstrument({...})` with a param schema, import
  it from `instruments/index.js`. It then gets an inspector, presets,
  mixer strip, sequencing, and full API/MCP/OSC control for free.
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
