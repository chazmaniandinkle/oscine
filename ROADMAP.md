# Roadmap

Where Oscine is headed. `docs/north-star.md` says what it's for; this file
says what's next, in order. The contract still holds: every capability lands
as a catalog command first, UI second (see `AGENTS.md`). The arrangement work
below broke that rule to move fast, and paying it back is item one.

## The arc

Oscine started as a pattern composer and is now a small DAW. The three jumps
this file used to plan for have all been taken:

1. **Time.** A linear timeline with lanes, clips and markers (v2.0, v2.1).
2. **Inserts and automation.** Eleven insert effects on every lane and the
   master; an automation engine with lane, master, effect and clip targets
   (v2.0, v2.1). The drawing UI only covers lane gain so far.
3. **Audio as data.** Assets addressed by content hash, clips as references
   into them, time-stretch and pitch-shift, word-level transcripts (v2.0).

What's left is to make those parts one system (a single clip model), to put
them in the catalog so agents can use them, and then to generate projects
instead of importing them.

Tier 3 (comping, video, surround, MPE, control surfaces) is still not Oscine's
fight.

## Shipped

Pattern side (v1.x): poly synth, FM synth and 8-lane drum kit; piano roll and
velocity step grid; four pattern slots with queued switching; mixer with shared
delay/reverb and a master compressor; undo; KB-scale projects; WAV export and
song-in-URL sharing; the command catalog as MCP tools and an OSC gateway;
multi-tab sessions; MIDI input with record-arm, knob mapping, velocity shaping,
single-tab ownership, and an OSC bridge for surfaces without WebMIDI; the
performance ledger.

Arrangement side:

- **v2.0.0 "Borrowed Light".** Project format v2 (assets by hash, clips,
  placements, lanes); the timeline (move, trim, slip, stretch, split, snap,
  ranges, overlaps as crossfades, scrub, follow); inspectors for every
  selectable thing; a sources panel; a phase vocoder; the analysis panel
  (pitch, level, brightness, pace) in a worker; eleven insert effects and
  per-lane insert chains; lane gain automation; the central keymap with
  Ableton, Logic and REAPER schemes; toolbar, status bar and lyrics bar;
  opening and saving project files through the sidecar.
- **v2.0.1.** Playback stops at the song's end; resizable mixer; the lyrics bar
  follows one lane.
- **v2.1.0 "Morning after".** Vertical lane scroll; lane reorder; transcripts
  (transcribe with a local whisper, import and export SRT, WebVTT and JSON, per
  source or per clip); dragging clips between lanes; ⌥-drag duplicate;
  markers and sections; a cycle region independent of the selection; ripple
  delete; automation targets for pan, master, effect params and clips, with
  linear, hold and exponential curves; keymap schemes corrected against the
  DAW manuals.

## Now

1. **Arrangement commands in the catalog.** Clips, placements, lanes, markers,
   cycle, inserts, automation and transcripts get catalog commands (and so MCP
   tools and OSC addresses). Until this lands Claude can open an arrangement
   but not edit it, which is backwards for a tool whose point is that agents
   and people share one surface. The UI then calls the commands instead of
   mutating directly.
2. **Automation UI for the new targets.** A parameter picker on the A button
   (lane gain and pan, each insert's params), one sub-lane per open
   parameter, a shape menu on points, and clip envelopes drawn on the clip.
   Latch and Write recording from the mixer; Touch and Trim only matter with a
   control surface. The research behind these calls is in the automation
   report (see "Research" below).
3. **Small UX debts.** An inline editor for marker names instead of the browser
   prompt; true-peak metering on the master; a real hold stage in the gate
   (needs an AudioWorklet).

## Next: schema v3, one clip model

From the project-formats report, in this order:

- **One clip map with a `kind`.** `clips[id] = {kind: 'audio' | 'pattern', ...}`
  on one lane list. A pattern clip references a pattern and an instrument
  lane; the four slots become a scratch bin you drag from; "loop the active
  slot" becomes the cycle region. Every v2 file must load unchanged.
- **A tempo map and time signatures,** with seconds staying the canonical time
  unit (the DAWproject precedent) and beats derived. Markers already exist and
  gain an optional section end.
- **Busses and sends** replacing the two hardcoded send scalars, modelled on
  DAWproject's channel and send graph.
- **Interchange:** DAWproject import and export first (open and XSD-defined),
  then MIDI files for pattern clips.

## Later: generating projects

The north star in practice. Each stage writes into the schema, stays editable,
and the analysis panel checks the result against the spec:

structure (sections, tempo, key) → lyrics (with syllable and pace targets) →
melody and harmony (pattern clips) → per-lane audio (local models such as
MusicGen or Stable Audio, conditioned per section) → vocal (local singing
synthesis, eventually in Chaz's own voice) → mix (gains, inserts, automation).

First milestone: regenerate one lane of an existing song from its clip's spec
and have the analysis panel confirm it hit the target. The practice loop
(generate, measure, adjust, never played aloud) runs on the same parts, and
across several models it's an eval: which kind of prompt each model follows
best, per musical dimension.

This is also where Oscine and Mod³ meet: one shared core (schema, analysis,
render, keymap), Mod³ as the realtime voice, Oscine as the persistent editor.

## Later: pattern side

- Per-step locks, probability and ratchets.
- MIDI as a full control surface: any control bound to any catalog command,
  with learn, plus visual feedback when a control moves. Mappings are user
  config, not song data.
- Pattern-to-code export (Strudel), as an experiment.

## Decision gates

Questions that need an answer before the work they block. Decided ones are
kept, with what was decided, so the reasoning isn't lost.

1. **Asset storage**: *decided (v2.0).* Hash-addressed files next to the
   project (`assets/<sha256>.<ext>`), referenced by hash, bytes never in the
   JSON; the sidecar serves them. Pattern-only projects are unchanged.
2. **Share links with audio**: *open.* Song-in-URL assumes a few KB. Leaning:
   pattern-only links keep working; arrangement links carry hashes plus a
   fetch hint, or fall back to a WAV.
3. **Scenes vs a linear timeline**: *decided (v2.0 + v3 plan).* The linear
   timeline shipped; v3 folds slots into it as a scratch bin rather than
   running two models side by side.
4. **Recording scope**: *open.* Import first; capture (monitoring, latency
   compensation) later; comping out of scope.
5. **Background-tab timing**: *open.* The pattern clock is a `setInterval`
   lookahead that drifts in throttled tabs; arrangement playback is scheduled
   in the audio thread and doesn't. Move the pattern clock to a Worker when
   pattern clips land on the timeline.
6. **MIDI map scope**: *open.* Leaning: global user config.
7. **Takes**: *open, now easier.* Ledger slices can become clips on the
   timeline once v3 has pattern clips.
8. **Ledger window**: *decided (shipped).* Always-on while the app is open,
   bounded, local, never saved.
9. **Catalog coverage for arrangements**: *decided.* Required; it's item one
   under "Now".

## Research

Primary sources (manuals for Logic, Ableton, REAPER, Pro Tools, Bitwig and
Studio One; the DAWproject XSD; Ardour and REAPER project files; AAF; Ableton's
format; the Web Audio spec) and three reports written from them, each claim
cited to a file: UX conventions, automation, and project formats. They live in
the cog workspace at `.cog/mem/semantic/research/daw/`. `docs/landscape.md` is
the older competitive survey from the pattern-composer era.
