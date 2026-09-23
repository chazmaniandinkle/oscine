
# Oscine
![Oscine Logo](https://raw.githubusercontent.com/chazmaniandinkle/oscine/refs/heads/main/styles/brand/oscine-master.svg)
[![CI](https://github.com/chazmaniandinkle/oscine/actions/workflows/ci.yml/badge.svg)](https://github.com/chazmaniandinkle/oscine/actions/workflows/ci.yml)

A browser DAW with no build step and no runtime dependencies. It started as a
synth composer (every sound synthesized live with Web Audio, a whole song in a
few KB of JSON) and now also arranges audio: stems on lanes, clips you can
trim, slip, stretch and repitch, word-level transcripts on the vocals, insert
effects, automation, markers, and an analysis panel that tells you what a
selection actually sounds like.

The song is a project, not a file. A project stores references and numbers
(which source, which slice of it, where it sits, how loud, which words are
sung when), and audio is rendered from that. So a song is yours when you can
reopen it in Oscine, change the bridge, and export again. `docs/north-star.md`
says why that matters and where it goes (generating whole projects, not mp3s,
with the analysis panel closing the loop).

Underneath, everything is one command catalog. The UI, the browser console,
the bundled Claude plugin over MCP, an OSC gateway, and live MIDI are five
consumers of that catalog, so an agent drives the same surface you do. (The
arrangement features are the exception for now; see "Known gaps".)

## Run it

1. **Hosted:** https://chazmaniandinkle.github.io/oscine/ . Static files
   served by GitHub Pages. Pattern projects autosave to localStorage. If the
   Oscine sidecar is running on your machine the page connects to it, which
   turns on MCP and OSC control. (Opening and saving project files needs the
   page served by the sidecar itself, options 2 and 3. Chrome, Edge and
   Firefox let a secure page reach 127.0.0.1; Safari doesn't.)
2. **Claude plugin:** `claude plugin marketplace add chazmaniandinkle/oscine`,
   then `claude plugin install oscine@oscine`. Claude runs the sidecar, which
   serves the app at `http://127.0.0.1:7321/`. Ask Claude to "open oscine".
   Update later with `npm run release:local`.
3. **Dev sidecar against a folder of projects:** `scripts/dev-sidecar.sh`
   starts the sidecar on port 7351 with `OSCINE_PROJECT_ROOT` pointed at your
   workspace, so File > Open project lists every `*.oscine.json` under it and
   ⌘S writes back to disk. Edit the script's defaults for your machine.
4. **Any static server:** `./start.sh` (or `python3 -m http.server 8443`).
   Needed because ES modules don't load over `file://`. No sidecar means no
   project files, transcription, or MCP; everything else works.

The sidecar only accepts bridge connections from localhost plus origins in
`OSCINE_ALLOWED_ORIGINS`, so arbitrary websites can't reach your session.

First open loads a small demo song ("First Light"). Press Space. Click once
first if you hear nothing: browsers keep audio suspended until a gesture.
Reloading reopens the last project file you had open (or pass `?p=<path>` in
the URL, relative to the project root).

## Two kinds of project

**Pattern projects** are the original Oscine: synth and drum tracks, four
pattern slots (A to D) that loop, a piano roll and a step grid. Good for
sketching, and a few KB each, small enough to live in a share link.

**Arrangement projects** are audio on a timeline. They reference audio files
by content hash (`assets/<sha256>.wav` next to the project file) and never
copy or cut the bytes: a clip is a pointer (`source`, `in`, `out`) and a
placement puts a clip on a lane at a time. The two models are separate today;
unifying them (pattern clips on lanes) is the next schema version.

## Using it: arrangements

**Timeline.** Lanes on the left, the ruler and a marker strip on top.

| Do this | To |
|---|---|
| Drag a clip | Move it in time, or up/down to another lane |
| ⌥-drag a clip | Duplicate it (the copy follows the pointer) |
| Drag a clip edge | Trim |
| ⇧-drag a clip body | Slip: move the audio inside the clip, edges stay |
| ⌥-drag the right edge | Time-stretch (pitch preserved) |
| Hold ⌘ while dragging | Bypass snap (snap is on by default; N toggles) |
| Drag the ruler or the playhead | Scrub |
| ⇧-drag the ruler, or click then ⇧-click | Select a time range; drag its edges to resize |
| Click a lane inside a range | Select that lane's slice (for S, ⌫, or the analysis panel) |
| Drag a lane's name in the gutter | Reorder lanes (the dB bar under it is the gain drag) |
| Click the **A** button on a lane | Pick a parameter to automate: Gain, Pan, or any param of the lane's inserts (e.g. EQ · Low Shelf Gain). Each pick opens its own sub-lane under the lane; × in its gutter closes it. A dot on **A** means a closed parameter still has points |
| In an automation sub-lane | Click to add a point, drag to move, ⌥-click to remove. Right-click a point for its shape: Linear, Hold (a step) or Exponential (greyed out where the range reaches zero, such as gain and pan) |
| Wheel / ⇧-wheel / ⌘-wheel | Scroll lanes / scroll time / zoom |

Where two clips overlap on a lane, the shared part is hatched and clickable:
select it to set a crossfade.

**Markers and sections.** M adds a marker at the playhead; double-click the
marker strip to add or rename one (the name is edited in place: Enter or
clicking away keeps it, Esc cancels); drag to move. The stretch between two
markers is a section: click it to jump there, ⇧-click to select it as the
range. ⌥, and ⌥. step between markers.

**Cycle.** A loop region that's separate from the selection (the yellow bar at
the top of the ruler). C turns it on and off, ⌘U sets it to the current range;
drag its ends to resize. Looping is gapless.

**Ripple delete.** ⇧⌫ cuts the selected range out of every lane and closes the
gap. Clips, markers, the cycle and automation all move left together.

**Right panel (inspector)** shows whatever is selected: a clip (position,
trims, stretch, pitch, gain, fades, and its words), a lane, a source, an
overlap (crossfade), an effect, or a range on a lane. Values drag; double-click
to type; names are editable in the header.

**Sources** (left panel) lists every audio file in the project. Drag one onto a
lane to place it. Selecting a source shows its full transcript.

**Transcripts.** On a source or a clip: *Transcribe* runs whisper locally
through the sidecar (a clip transcribes only its own span), *Export…* writes
SRT, WebVTT or word-level JSON, *Import…* reads any of those back (or whisper's
JSON). Words appear in the lyrics bar under the timeline, which follows one
lane at a time (pick it on the left of the bar, or select a lane). Click a word
anywhere to jump there.

**The analysis panel.** Select a range, then click a lane inside it. The panel
measures exactly the audio that lane plays there: pitch (median and range),
level, brightness, and singing pace from the word timings. Pin one as A and the
next range shows the differences. It runs in a background worker, and every
source is analysed once on load, so a selection inside a single clip answers
instantly; one spanning several clips is measured on demand.

**Mixer** (bottom; drag its handle to resize): one strip per lane plus master,
each with pan, fader, meter, mute/solo, and an insert chain. *+ insert* adds any
of eleven effects (EQ, filter, saturator, stereo delay, reverb, chorus, phaser,
compressor, limiter, gate, utility); click one to edit it in the inspector.

**Toolbar and status bar.** The toolbar mirrors the main edit actions and has
the **Keys** picker: shortcut schemes for Oscine, Ableton, Logic and REAPER
(each binding in those schemes cites the manual page it came from, or says it
isn't in that DAW). The status bar shows position, range, selection, analysis
progress, saved state and the sidecar link.

**Files.** File > Open project lists projects under the sidecar's project
root; ⌘S saves in place. Playback stops at the end of the song unless the
cycle is on.

### Keys (default scheme)

| Key | Action | Key | Action |
|---|---|---|---|
| Space | Play / stop | ⇧Space | Play from range start |
| Home | Go to start | Esc | Stop / clear range |
| S | Split at playhead or range | ⌫ | Remove clip, or cut the range from selected clips |
| ⇧⌫ | Ripple delete | [ ] | Pitch −/+1 semitone |
| ⇧[ ⇧] | Clip gain −/+1 dB | N | Snap on/off |
| M | Add marker | ⌥, ⌥. | Previous / next marker |
| C | Cycle on/off | ⌘U | Cycle from range |
| F | Fit song to window | = − | Zoom in / out |
| L | Follow playhead | ⇧L | Lyrics bar on/off |
| ⌘Z ⌘⇧Z | Undo / redo | ⌘S | Save |

## Using it: patterns

Transport bar: play/stop, tempo (drag the bpm number), swing, metronome,
pattern slots A to D, bar length per slot, undo/redo, song name, File menu.

Pattern slots are four independent pattern sets sharing the same tracks, like
scenes. Click a slot (or keys 1 to 4) to switch; while playing, the switch
queues and lands exactly on the next loop boundary.

Tracks: "+ Add" creates a Poly Synth, FM Synth, or Drum Kit track. The editor
in the middle follows the selected track's type. Piano roll: click to add a
note and drag to set its length; drag to move, drag the right edge to resize;
⌥-drag for velocity; ⇧-drag for marquee select; double-click deletes. Step
grid: click toggles a step, drag paints, ⇧-click cycles velocity.

Keyboard footer: play the selected track with the mouse or the A-row keys
(A W S E D F T G Y H U J), Z/X shifts octave. A hardware MIDI controller works
too; see "MIDI" below.

"Copy share link" packs the whole pattern project into the URL (gzip, no
upload), so a link is the song. "Export audio (.wav)" bounces through the full
mix with an OfflineAudioContext.

## Architecture

```
src/
  core/          no DOM, no audio. Importable from node.
    bus.js         event bus: the only channel between layers
    store.js       single source of truth + all mutations + undo
    schema.js      project format (v2), factories, migrations, demo song
    assets.js      content-hash asset cache, word lookup per clip
    keymap.js      every shortcut and drag modifier as a named action; schemes
    timedtext.js   SRT / WebVTT / JSON transcript import and export
    persist.js  share.js  wav.js  util.js
  engine/        audio only. Never mutates the project.
    engine.js      pattern-side channel strips, FX buses, master chain
    transport.js   lookahead scheduler, beat clock, song clock, cycle
    clips.js       arrangement playback: clips -> lane strips -> master
    stretch.js     phase vocoder (time-stretch and pitch-shift, decoupled)
    automation.js  envelopes -> AudioParam schedules
    ear.js         measurement: pitch, level, brightness, pace
    ear-worker.js  runs the measurements off the main thread
    render.js      offline bounce (the export sounds like the mix)
    effects/       registry + eleven insert effects (+ pattern-side delay/reverb)
    instruments/   registry + poly synth, FM synth, drum kit
  api/           the programmatic surface (the catalog is the contract)
    commands.js    command catalog: names, descriptions, JSON Schemas
    api.js         binds the catalog to store/engine/transport
    bridge.js      WebSocket link to the MCP sidecar
    crosstab.js    cross-tab coordination (MIDI ownership, autosave)
  ui/            DOM only. Never touches audio nodes.
    app.js         layout, routing, key dispatch, the single rAF loop
    timeline.js    arrangement canvas: lanes, clips, ruler, markers, cycle
    clipinspector.js  clip / lane / source / overlap / range / effect panels
    assetbin.js  lyricsbar.js  toolbar.js  statusbar.js  fileops.js
    pianoroll.js  stepgrid.js  keyboard.js  midi.js
    mixer.js  inspector.js  tracklist.js  transportbar.js  widgets.js
  main.js        wires everything; exposes window.oscine for console work
plugin/          the Claude plugin: sidecar (MCP + HTTP + OSC) and app copy
tools/           sync-plugin.mjs, midi-osc-bridge.mjs, release-local.sh
docs/            north star, landscape research, platform notes
```

Data flow is one-directional:

```
UI gesture ----\
console call ---\
MCP tool --------> store action -> mutation + bus event -> engine mirrors audio
OSC message ----/                                      -> UI re-renders
MIDI in -------/
```

The engine and UI never call each other; both react to the store through the
bus. Undo, load and autosave fall out of that.

## The catalog is the contract

`src/api/commands.js` holds 21 commands covering the pattern side (transport,
project ops, tracks, instrument params and presets, notes, drum steps, mixer,
master FX, slots, preview, MIDI, the performance ledger, share, WAV export).
Each carries a JSON Schema; the handler validates, clamps, and returns JSON:

```js
// browser console
await oscine.api.execute('status')
await oscine.api.execute('set_notes', { track: 'Bass', mode: 'replace',
  notes: [{ start: 0, pitch: 33, dur: 0.5, vel: 0.9 }] })
```

The test suite runs every command headlessly, so catalog, handlers and store
can't drift apart.

## Claude plugin (MCP)

`plugin/` is a complete Claude plugin. Its sidecar is one zero-dependency node
process:

- MCP over stdio: one `oscine_*` tool per catalog command, plus
  `oscine_open_app`, `oscine_sessions`, `oscine_project_open_file` and
  `oscine_project_save_file`. Bundled skills are exposed as MCP resources.
- HTTP on `127.0.0.1:7321` serving the app, project files under
  `OSCINE_PROJECT_ROOT` (`/projects.json`, `/project-doc/<path>`,
  `/project/<path>` with range requests), and `POST /transcribe` (ffmpeg +
  a local whisper).
- A WebSocket bridge the app connects back through. With several tabs open,
  each is an addressable session.
- An OSC gateway on `udp://127.0.0.1:7340` mapping `/oscine/*` onto the same
  catalog, with position and meter feedback for subscribers.

Details, OSC addresses and configuration in `plugin/README.md`.

## MIDI

Enable MIDI from the transport bar and a controller plays the selected track.
Record-arm captures notes or steps quantized to the grid, and knobs map to
instrument params (with learn). Velocity is shaped in software (floor, curve,
or a fixed velocity) so stiff mini-keys still play loud, and a monitor shows
the raw values you're sending. One tab owns the hardware at a time.

Where WebMIDI is blocked (the Claude Code preview, Safari), `npm run
midi-bridge` (after `npm i @julusian/midi`) forwards a controller into Oscine
over OSC at `/oscine/midi/in`. The performance ledger logs everything you play
live, even with the transport stopped, and the `ledger` command reads it back
so an agent can grab a riff after the fact.

## Extending it

**New effect:** one file in `src/engine/effects/`. Call `defineEffect({...})`
with a param schema and presets, subclass `BaseEffect`, build your graph
between `this.wetIn` and `this.wetOut`, implement `applyParam`, and import the
file from `effects/index.js`. It then shows up in every *+ insert* menu, gets a
generated inspector, bypass and presets, and plays in both live and offline
render. Optionally implement `paramNode(key)` to hand automation a real
AudioParam. `eq3.js` is the template.

**New instrument:** one file in `src/engine/instruments/`, subclass
`BaseInstrument`, `defineInstrument({...})` with a param schema, import it from
`instruments/index.js`. `fmsynth.js` is the template.

**New shortcut or drag modifier:** add a named action (or gesture) to
`core/keymap.js` with a default binding, and handle it in `app.js` (keys) or
`keymap.gesture(name, e)` (drags). Never test `e.shiftKey` or `e.code` in UI
code directly; that's what makes schemes possible.

**Project format:** plain JSON, `version: 2`, shape documented at the top of
`core/schema.js`. Older files are migrated on load.

## Verifying

```sh
node test/smoke.mjs        # import graph, store, scheduler, every catalog
                           # command headless, OSC routing, plugin integrity
node test/keymap.mjs       # every scheme binding, with its citation
node test/automation.mjs   # envelope grammar, shapes, scheduling
node test/ear.mjs          # measurements against synthetic ground truth
node test/timedtext.mjs    # SRT / VTT / JSON round trips
node test/stretch.mjs      # phase vocoder pitch and length
node test/fx-*.mjs         # one per effect
node test/e2e-mcp.mjs      # MCP stdio -> sidecar -> WS -> headless Chromium
                           # (needs playwright-core + CHROME_BIN)
```

UI gestures are verified by driving a headless Chrome over the DevTools
protocol and reading project state back; commit messages carry the numbers.

## Known gaps

- **Arrangement editing isn't in the catalog yet.** Clips, lanes, markers,
  cycle, automation, effects and transcripts are UI-only. Claude can open and
  save arrangement projects over MCP but can't edit them. This breaks the
  catalog-first rule in `AGENTS.md` and is the first thing to fix.
- Master-gain and clip-gain envelopes play but have no UI yet; lane gain, pan
  and insert params do.
- Patterns and arrangements are separate models. v3 unifies them (see
  `ROADMAP.md`).
- The limiter is a sample-peak ceiling, not true-peak. The gate's hold is
  approximated by its release.

## Where it's going

`docs/north-star.md` is the short version: Oscine is the persistent side of a
voice. `ROADMAP.md` has the ordered list. `CHANGELOG.md` has what shipped when.
The DAW research behind recent decisions (manuals, format specs, and three
reports) lives in the cog workspace under `.cog/mem/semantic/research/daw/`.

## Notes

- Param knob tweaks are outside undo history; structural edits are undoable,
  one step per gesture.
- Current Chrome, Firefox and Safari work. Safari has no WebMIDI (use the OSC
  bridge) and can't reach a local sidecar from the hosted page.
