
# Oscine
![Oscine Logo](https://raw.githubusercontent.com/chazmaniandinkle/oscine/refs/heads/main/styles/brand/oscine-master.svg)
[![CI](https://github.com/chazmaniandinkle/oscine/actions/workflows/ci.yml/badge.svg)](https://github.com/chazmaniandinkle/oscine/actions/workflows/ci.yml)

A synth composer that runs entirely in the browser. No build step, no
dependencies, no samples: every sound is synthesized live with Web Audio,
and a whole song saves as a few KB of JSON.

The part that matters is underneath. Everything Oscine can do is one command
in one catalog, and that catalog is the product. Five surfaces drive it: the
UI, the browser console, the bundled Claude plugin over MCP, an OSC gateway,
and live MIDI. So Oscine is two things at once. It is a synth you play with
your hands, and it is a performance bridge that an agent or a controller can
play through, on any surface that speaks MCP, OSC, or MIDI. The synth is the
concrete part you can hear. The bridge is the point.

Because the catalog is the contract, the agent surface is not bolted on, it
is the same surface you use. Claude can compose, sound-design, mix, switch
patterns, and play notes in your live session. The architecture is shaped so
the larger parts (an arrangement timeline, audio clips, automation, and a
performance ledger the agent reads back from) bolt on without a rewrite. See
"Where it's going" below.

## Run it

Four ways:

1. Hosted: https://chazmaniandinkle.github.io/oscine/ . The app is static
   files, so the repo serves it directly via GitHub Pages. Projects autosave
   to your browser's localStorage; export/import JSON for real files. If the
   Oscine sidecar (from the Claude plugin) is running on your machine, the
   hosted page connects to it automatically, which lights up MCP and OSC
   control of the page you are looking at. (Chrome, Edge, and Firefox let a
   secure page reach 127.0.0.1; Safari blocks it, so use another option there.)
2. Claude plugin: add this repo as a marketplace, then install it.
   `claude plugin marketplace add chazmaniandinkle/oscine`, then
   `claude plugin install oscine@oscine`. Claude runs the sidecar, which
   serves the app at `http://127.0.0.1:7321/`. Ask Claude to "open oscine",
   or open the URL yourself. Update later with `npm run release:local`.
3. Claude Code preview: with the repo open in Claude Code, the built-in
   preview hosts the app from `.claude/launch.json` (the `oscine` launch
   config). It is a real browser context, so Web Audio, WebMIDI, and the
   sidecar bridge all work, and the previewed app is agent-drivable inline.
4. Dev server: `./start.sh` (or `python3 -m http.server 8443`) from the repo,
   then open the printed URL. Any static server works; one is required because
   native ES modules do not load over `file://`.

The sidecar only accepts bridge connections from localhost plus origins in
`OSCINE_ALLOWED_ORIGINS` (the plugin pre-allows this repo's Pages URL), so
arbitrary websites cannot reach your session.

First open loads a small demo song ("First Light"). Press Space. Click once
anywhere first if you hear nothing: browsers keep audio suspended until a
user gesture.

## Using it

Transport bar: play/stop, tempo (drag the bpm number), swing, metronome,
pattern slots A-D, bar length per slot, undo/redo, song name, File menu (copy
share link, export audio WAV, export/import JSON, new project), master level.

Two ways to get a song out. "Copy share link" packs the whole project into
the URL itself (a few KB of pattern data, no upload), so a link is the song;
open that link and Oscine loads it before the UI draws. "Export audio (.wav)"
bounces the active slot through the full mix and master FX with an
OfflineAudioContext and downloads a 16-bit WAV. Both run through the same
command catalog as everything else, so Claude can trigger them over MCP
(`oscine_share`, `oscine_export_wav`) too.

Pattern slots are four independent pattern sets sharing the same tracks, like
scenes. Click a slot (or keys 1-4) to switch; while playing, the switch queues
and lands exactly on the next loop boundary. Copy moves the active slot's
patterns to another slot.

Tracks: "+ Add" creates a Poly Synth, FM Synth, or Drum Kit track. Select a
track to edit it; double-click the name to rename; M/S to mute/solo. The
editor in the middle follows the selected track's type.

Piano roll (synth tracks): click to add a note and drag to set its length;
drag notes to move, drag the right edge to resize; alt+drag for velocity
(brightness shows it); shift+drag for marquee select; right-click or
double-click deletes; Delete clears the selection; cmd/ctrl+A selects all;
ctrl/cmd+wheel zooms time; the left key gutter auditions pitches.

Step grid (drum tracks): click toggles a step, drag paints, shift+click cycles
velocity soft/med/hard. Lane labels audition the sound.

Keyboard footer: play the selected synth track with the mouse or with A-row
keys (A W S E D F T G Y H U J ...), Z/X shifts octave. On a drum track the
footer becomes pads on A-K. You can also play a hardware MIDI controller; see
"Where it's going" for velocity shaping, record, and the OSC bridge that works
even where WebMIDI is blocked.

Inspector (right): every instrument parameter as knobs, rendered from the
instrument's own schema, plus presets, pan, and FX sends per track.

Mixer (bottom): fader, meter, pan, delay/reverb sends, mute/solo per track;
the master strip carries the shared delay (tempo-synced) and reverb plus the
master fader.

Everything autosaves to localStorage; File > Export writes the song as JSON
you can commit, share, or re-import.

## Architecture

```
src/
  core/          no DOM, no audio. Importable from node.
    bus.js         event bus: the only channel between layers
    store.js       single source of truth + all mutations + undo
    schema.js      project format, factories, demo song
    persist.js     autosave + JSON import/export
    util.js        helpers
  engine/        audio only. Never mutates the project.
    engine.js      track channel strips, FX buses, master chain, scheduling
    transport.js   lookahead scheduler, beat clock, swing, loop/slot logic
    context.js     lazy AudioContext
    effects/       delay, reverb (send buses)
    instruments/   registry + poly synth, FM synth, drum kit
  api/           the programmatic surface (the catalog is the contract)
    commands.js    command catalog: names, descriptions, JSON Schemas
    api.js         CommandAPI: binds the catalog to store/engine/transport
    bridge.js      WebSocket client that links the app to the MCP sidecar
    crosstab.js    BroadcastChannel + Web Locks cross-tab coordination
  ui/            DOM only. Never touches audio nodes.
    app.js         layout shell, editor routing, the single rAF loop
    pianoroll.js   canvas note editor
    stepgrid.js    drum grid
    midi.js        WebMIDI input, velocity shaping, record, cross-tab owner
    mixer.js  inspector.js  tracklist.js  transportbar.js  keyboard.js
    widgets.js     knob/fader/meter/menu primitives
  main.js        wires everything; exposes window.oscine for console work
plugin/          the Claude plugin (see below)
tools/           sync-plugin.mjs keeps plugin/app identical to the repo;
                 midi-osc-bridge.mjs forwards a controller into Oscine over OSC
```

The data flow is one-directional and event-driven:

```
UI gesture ----\
console call ---\
MCP tool --------> store action -> mutation + bus event -> engine mirrors audio
OSC message ----/                                      -> UI re-renders
MIDI in -------/
```

The engine and UI never call each other directly; both react to the store
through the bus. Undo, import, and autosave fall out of that: any project
replacement emits one event and every layer rebuilds itself.

## The catalog is the contract

`src/api/commands.js` is the contract: 20 commands covering everything the UI
can do (transport, project ops, tracks, instrument params and presets,
piano-roll notes, drum steps, mixer, master FX, pattern slots, preview, and
live MIDI). Each command carries a JSON Schema; `CommandAPI` validates,
clamps, resolves tracks by name or id, and returns JSON. The UI, the browser
console, MCP, OSC, and MIDI are five consumers of the same surface:

```js
// browser console
await oscine.api.execute('status')
await oscine.api.execute('set_notes', { track: 'Bass', mode: 'replace',
  notes: [{ start: 0, pitch: 33, dur: 0.5, vel: 0.9 }] })
```

The test suite executes every command headlessly, so catalog, handlers, and
store cannot drift apart.

## Claude plugin (MCP)

`plugin/` is a complete Claude plugin; `oscine.plugin` is its packaged form.
Its sidecar is one zero-dependency node process that Claude starts and stops
via the plugin's `.mcp.json`:

- MCP server over stdio: `oscine_open_app`, `oscine_sessions`, plus one
  `oscine_*` tool per catalog command (22 total), schemas taken directly from
  the catalog
- HTTP server on `127.0.0.1:7321` (next free port if busy) serving the bundled
  app from `plugin/app/`
- WebSocket bridge at `/bridge` that the app connects back through; the green
  dot in the transport bar shows the link is up. With several tabs open, the
  sidecar tracks each as an addressable session and routes commands to the
  active one (`oscine_sessions` lists and switches).

So the full loop is: Claude calls a tool, the sidecar forwards it over the
socket, the app executes it against the same store the UI uses, and you hear
and see the result live. The plugin also bundles a composing skill so Claude
knows the conventions (beats, MIDI, lanes, slots).

The sidecar also runs an OSC gateway (`udp://127.0.0.1:7340`), mapping the
`/oscine/*` address space onto the same catalog: TouchOSC, Max/MSP, Pd,
SuperCollider, Sonic Pi, and friends can fade tracks, tweak params, play notes,
switch slots, and feed in MIDI (`/oscine/midi/in`), and subscribers get
position, meters, tempo, and slot feedback back. Address table in
`plugin/README.md`. OSC, MCP, MIDI, the UI, and the console are five consumers
of one contract.

After changing the app, run `node tools/sync-plugin.mjs` and repackage; the
tests fail if the bundled copy drifts.

Timing uses the standard lookahead pattern: a 25ms JS timer schedules the next
120ms of events at sample-accurate AudioContext time. The transport walks beats
and emits scheduling windows that are segmented at loop boundaries, which is
what makes queued pattern-slot switches land exactly on the 1. Notes are stored
in beats (floats), so finer grids and triplets are a UI option later, not a
format change.

## Extending it

New instrument: create `src/engine/instruments/yoursynth.js`, subclass
`BaseInstrument`, implement `noteOn/noteOff` (or `trigger` for kits), call
`defineInstrument({...})` with a param schema, and import the file from
`instruments/index.js`. It then appears in the Add menu, gets a generated
inspector, presets, mixer strip, and sequencing for free. `fmsynth.js` is the
template: a complete instrument in ~150 lines.

New effect: follow `effects/delay.js` (an input/output node pair), add it to
the engine's bus wiring, and surface params via `store.setFx`.

New editor or panel: subscribe to bus events, render from the store, call store
actions on input. Nothing else to hook up.

Project format: plain JSON, versioned (`version: 1`), shape defined in
`core/schema.js`.

## Verifying

```sh
node test/smoke.mjs      # zero-dep: import graph, store, scheduler math,
                         # every API command headless, plugin integrity
node test/e2e-mcp.mjs    # full chain: real MCP stdio -> sidecar -> WS ->
                         # headless Chromium running the app
                         # (needs playwright-core + CHROME_BIN)
```

UI pixels and audio output are exercised in the browser; the suites cover
everything below that line, including the entire MCP path.

## Where it's going

The synth is the reference instrument. The direction is to make the bridge
underneath it do more, while the larger DAW parts bolt on as they earn their
place.

Already shipped:

- MIDI input: plug in a MIDI controller, enable MIDI from the transport bar,
  and play the selected track. Record-arm captures the notes (or drum steps)
  quantized to the grid, and you can map knobs to instrument params. Incoming
  velocity is shaped in software so stiff mini-keys still play loud: set a floor
  (the loudness of the softest press), a curve (gamma; below 1 makes soft
  presses more sensitive), or an optional fixed velocity that ignores the
  controller entirely. A velocity monitor reports the raw values you play back
  (last, min, max, count, and the recent run) so you can match the curve to
  your controller by feel. Only one tab owns the hardware at a time: enable
  MIDI in one tab and a second tab defers, offering a "Take over" control that
  claims ownership for itself. Autosave is per-tab keyed now, so two open tabs
  no longer clobber each other's work in localStorage. Also drivable through
  the `midi` command (`set` takes floor/curve/fixed, `monitor` reads the raw
  spread, and `claim` takes MIDI ownership for the current tab) and the
  `/oscine/midi/*` OSC addresses (including `/oscine/midi/floor` and
  `/oscine/midi/curve`).

  MIDI over OSC (works where WebMIDI is blocked): some surfaces deny the WebMIDI
  permission outright (the Claude Code preview is one), so there is a second
  path in. `npm run midi-bridge` (after a one-time `npm i @julusian/midi`) reads
  a connected controller and forwards its raw messages to Oscine over OSC at
  `/oscine/midi/in <status> <d1> [d2]`. Those bytes feed the same input pipeline
  WebMIDI uses, so velocity shaping (floor/curve/fixed), the velocity monitor,
  record-arm, and drum-lane mapping all apply identically. The bridge takes
  `--list` to print available input ports, `--device <substring>` to pick one
  by name, and `--host`/`--port` to target a sidecar elsewhere (default
  `127.0.0.1:7340`, the OSC gateway). `@julusian/midi` is an optional install,
  not a runtime dependency: the app and sidecar stay zero-dependency, and the
  bridge prints an install hint if the module is absent. Any OSC source can
  play Oscine the same way by sending `/oscine/midi/in`, so a controller on any
  surface, including a phone over the local network, becomes an input.

Planned, roughly in order of effort (see `ROADMAP.md` for the full picture):

- Song arrangement: a timeline view that sequences slot patterns into a song.
  The transport already segments scheduling windows; an arrangement is a map of
  bar -> slot per track.
- Per-step locks, probability, ratchets: a step-schema extension plus scheduler
  support, and a new vocabulary for an agent to drive.
- Per-track insert effects and automation: the channel strip is already a node
  chain; inserts are an array between gain and panner, and automation lanes are
  time-indexed param events scheduled in the same windows as notes.
- A performance ledger: an always-on, beat-stamped log of what you play that an
  agent reads and acts on after the fact (grab that riff, clean it up, drop it
  on a track). This is the observer half of the agent surface, and it makes the
  jam loop real.
- Audio/sample tracks: a new instrument kind whose patterns hold clip
  references; `decodeAudioData` + `AudioBufferSourceNode` slots into the
  existing channel strip unchanged.
- Worker clock and OSC timetag scheduling: move the timer into a Worker so
  background tabs keep steady time, and honor OSC bundle timetags for
  sample-tight external sequencing.

New features land as catalog commands first, UI second; OSC, MCP, and MIDI then
consume them for free.

## Notes

- Param knob tweaks are intentionally outside undo history; structural edits
  (notes, steps, tracks, slots, presets) are undoable.
- Shortening a slot's bar count keeps note/step data beyond the loop end in the
  file; it just does not play until you lengthen the loop again.
- Chrome, Firefox, and Safari current versions all work. Safari needs one
  interaction before sound starts (autoplay policy), same as the others, and
  has no WebMIDI (use the OSC bridge for hardware there).
