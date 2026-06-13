# Oscine

A synth composer that runs entirely in the browser. No build step, no
dependencies, no samples: every sound is synthesized live with Web Audio,
and a whole song saves as a few KB of JSON.

It is API-first and deliberately structured like a small DAW. Every UI
feature is a command in a single catalog, and the bundled Claude plugin
exposes that catalog as MCP tools, so Claude can compose, sound-design,
and mix in your live session. The architecture is shaped so the bigger
DAW parts (arrangement timeline, audio clips, automation) bolt on
without a rewrite. See "Growing it into a DAW" below.

## Run it

Three ways:

1. Hosted: https://chazmaniandinkle.github.io/oscine/ -- the app is
   static files, so the repo serves it directly via GitHub Pages.
   Projects autosave to your browser's localStorage; export/import JSON
   for real files. If the Oscine sidecar (from the Claude plugin) is
   running on your machine, the hosted page connects to it
   automatically, which lights up MCP and OSC control of the page
   you're looking at. (Chrome/Edge/Firefox allow a secure page to reach
   127.0.0.1; Safari blocks it, so use option 2 or 3 there.)
2. Claude plugin: install `oscine.plugin`. Claude Desktop runs the
   sidecar, which serves the app at `http://127.0.0.1:7321/`. Ask
   Claude to "open oscine", or open the URL yourself.
3. Dev server: `./start.sh` (or `python3 -m http.server 8443`) from the
   repo, then open the printed URL. Any static server works; one is
   required because native ES modules don't load over `file://`.

The sidecar only accepts bridge connections from localhost plus origins
in `OSCINE_ALLOWED_ORIGINS` (the plugin pre-allows this repo's Pages
URL), so arbitrary websites can't reach your session.

First open loads a small demo song ("First Light"). Press Space. Click
once anywhere first if you hear nothing: browsers keep audio suspended
until a user gesture.

## Using it

Transport bar: play/stop, tempo (drag the bpm number), swing, metronome,
pattern slots A-D, bar length per slot, undo/redo, song name, File menu
(export/import JSON, new project), master level.

Pattern slots are four independent pattern sets sharing the same tracks,
like scenes. Click a slot (or keys 1-4) to switch; while playing, the
switch queues and lands exactly on the next loop boundary. Copy moves the
active slot's patterns to another slot.

Tracks: "+ Add" creates a Poly Synth, FM Synth, or Drum Kit track.
Select a track to edit it; double-click the name to rename; M/S to
mute/solo. The editor in the middle follows the selected track's type.

Piano roll (synth tracks): click to add a note and drag to set its
length; drag notes to move, drag the right edge to resize; alt+drag for
velocity (brightness shows it); shift+drag for marquee select;
right-click or double-click deletes; Delete clears the selection;
cmd/ctrl+A selects all; ctrl/cmd+wheel zooms time; the left key gutter
auditions pitches.

Step grid (drum tracks): click toggles a step, drag paints, shift+click
cycles velocity soft/med/hard. Lane labels audition the sound.

Keyboard footer: play the selected synth track with the mouse or with
A-row keys (A W S E D F T G Y H U J ...), Z/X shifts octave. On a drum
track the footer becomes pads on A-K.

Inspector (right): every instrument parameter as knobs, rendered from
the instrument's own schema, plus presets, pan, and FX sends per track.

Mixer (bottom): fader, meter, pan, delay/reverb sends, mute/solo per
track; the master strip carries the shared delay (tempo-synced) and
reverb plus the master fader.

Everything autosaves to localStorage; File > Export writes the song as
JSON you can commit, share, or re-import.

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
  api/           the programmatic surface (API-first)
    commands.js    command catalog: names, descriptions, JSON Schemas
    api.js         CommandAPI: binds the catalog to store/engine/transport
    bridge.js      WebSocket client that links the app to the MCP sidecar
  ui/            DOM only. Never touches audio nodes.
    app.js         layout shell, editor routing, the single rAF loop
    pianoroll.js   canvas note editor
    stepgrid.js    drum grid
    mixer.js  inspector.js  tracklist.js  transportbar.js  keyboard.js
    widgets.js     knob/fader/meter/menu primitives
  main.js        wires everything; exposes window.oscine for console work
plugin/          the Claude plugin (see below)
tools/           sync-plugin.mjs keeps plugin/app identical to the repo
```

The data flow is one-directional and event-driven:

```
UI gesture ----\
console call ---> store action -> mutation + bus event -> engine mirrors audio
MCP tool ------/                                       -> UI re-renders
```

The engine and UI never call each other directly; both react to the
store through the bus. Undo, import, and autosave fall out of that: any
project replacement emits one event and every layer rebuilds itself.

## API-first

`src/api/commands.js` is the contract: 17 commands covering everything
the UI can do (transport, project ops, tracks, instrument params and
presets, piano-roll notes, drum steps, mixer, master FX, pattern slots,
preview). Each command carries a JSON Schema; `CommandAPI` validates,
clamps, resolves tracks by name or id, and returns JSON. The UI, the
browser console, and MCP are three consumers of the same surface:

```js
// browser console
await oscine.api.execute('status')
await oscine.api.execute('set_notes', { track: 'Bass', mode: 'replace',
  notes: [{ start: 0, pitch: 33, dur: 0.5, vel: 0.9 }] })
```

The test suite executes every command headlessly, so catalog, handlers,
and store cannot drift apart.

## Claude plugin (MCP)

`plugin/` is a complete Claude plugin; `oscine.plugin` is its packaged
form. Its sidecar is one zero-dependency node process that Claude
Desktop starts and stops via the plugin's `.mcp.json`:

- MCP server over stdio: `oscine_open_app` plus one `oscine_*` tool per
  catalog command (18 total), schemas taken directly from the catalog
- HTTP server on `127.0.0.1:7321` (next free port if busy) serving the
  bundled app from `plugin/app/`
- WebSocket bridge at `/bridge` that the app connects back through; the
  green dot in the transport bar shows the link is up

So the full loop is: Claude calls a tool, the sidecar forwards it over
the socket, the app executes it against the same store the UI uses, and
you hear and see the result live. The plugin also bundles a composing
skill so Claude knows the conventions (beats, MIDI, lanes, slots).

The sidecar also runs an OSC gateway (`udp://127.0.0.1:7340`), mapping
the `/oscine/*` address space onto the same catalog: TouchOSC, Max/MSP,
Pd, SuperCollider, Sonic Pi, and friends can fade tracks, tweak params,
play notes, and switch slots, and subscribers get position, meters,
tempo, and slot feedback back. Address table in `plugin/README.md`.
OSC, MCP, the UI, and the console are four consumers of one contract.

After changing the app, run `node tools/sync-plugin.mjs` and repackage;
the tests fail if the bundled copy drifts.

Timing uses the standard lookahead pattern: a 25ms JS timer schedules
the next 120ms of events at sample-accurate AudioContext time. The
transport walks beats and emits scheduling windows that are segmented at
loop boundaries, which is what makes queued pattern-slot switches land
exactly on the 1. Notes are stored in beats (floats), so finer grids and
triplets are a UI option later, not a format change.

## Extending it

New instrument: create `src/engine/instruments/yoursynth.js`, subclass
`BaseInstrument`, implement `noteOn/noteOff` (or `trigger` for kits),
call `defineInstrument({...})` with a param schema, and import the file
from `instruments/index.js`. It then appears in the Add menu, gets a
generated inspector, presets, mixer strip, and sequencing for free.
`fmsynth.js` is the template: a complete instrument in ~150 lines.

New effect: follow `effects/delay.js` (an input/output node pair), add
it to the engine's bus wiring, and surface params via `store.setFx`.

New editor or panel: subscribe to bus events, render from the store,
call store actions on input. Nothing else to hook up.

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

UI pixels and audio output are exercised in the browser; the suites
cover everything below that line, including the entire MCP path.

## Growing it into a DAW

The bones are placed for these, roughly in order of effort:

- Song arrangement: a timeline view that sequences slot patterns into a
  song. The transport already segments scheduling windows; an
  arrangement is a map of bar -> slot per track.
- Per-track insert effects: the channel strip is already a node chain;
  inserts are an array between chanGain and panner, with an effect
  registry mirroring the instrument registry.
- Automation: params already flow through `store.setTrackParam`;
  automation lanes are time-indexed param events scheduled in the same
  windows as notes.
- WAV export: render the schedule into an OfflineAudioContext instead of
  the live one.
- Audio/sample tracks: a new instrument kind ('audio') whose patterns
  hold clip references; decodeAudioData + AudioBufferSourceNode slots
  into the existing channel strip unchanged.
- MIDI input: WebMIDI -> engine.previewOn; recording is appending to the
  active pattern with transport-quantized timestamps.
- Worker clock: move the setInterval tick into a Worker so background
  tabs keep steady time.
- More automation surfaces: the command catalog is transport-agnostic;
  OSC and MCP already consume it, and a CLI, scripting console, or
  collaborative server reuses it the same way. New features should land
  as catalog commands first, UI second.
- OSC timetag scheduling: the gateway currently executes immediately;
  honoring bundle timetags against the transport's lookahead clock
  would give sample-tight external sequencing.
- Finer grids, triplets, per-note probability/ratchets: format already
  stores beats as floats; these are editor features.

## Notes

- Param knob tweaks are intentionally outside undo history; structural
  edits (notes, steps, tracks, slots, presets) are undoable.
- Shortening a slot's bar count keeps note/step data beyond the loop end
  in the file; it just doesn't play until you lengthen the loop again.
- Chrome, Firefox, and Safari current versions all work. Safari needs
  one interaction before sound starts (autoplay policy), same as the
  others.
