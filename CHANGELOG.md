# Changelog

## 2.2.0 · 2026-09-23 · "Same hands"

Claude can now edit an arrangement, not just open one, and automation reaches every parameter the engine supports.

### Arrangement in the catalog
- Nine commands (so nine MCP tools): `arrangement` (get), `clip` (get/set/split/duplicate/move/remove/place), `lane` (add/remove/rename/set/reorder), `marker` (list/add/move/rename/remove), `cycle` (get/set/clear), `range` (cut/ripple_delete), `insert` (list/add/set/remove/move), `automation` (list/set_points/add_point/remove_point/clear), `words` (get/set).
- The edits live in `src/core/arrangement.js` behind store actions: each is one undo step and emits the same events the UI does, so the open app updates live. A bad input throws before touching history.
- `test/arrangement.mjs`: 192 checks, every action, undo/redo, events, ripple math, error paths.
- Verified through the real MCP path on *Borrowed Light*: markers, lane gain, an EQ insert with a hold envelope on its high band (in the live chain during playback), cycle over the bridge, a lyrics query, a clip split; ten edits undone back to the start; 0 page errors.

### Automation UI
- The **A** button opens a picker: Gain, Pan, and every numeric param of every insert on the lane. Each opens its own sub-lane with its own axis (dB, −1..1, or the param's range; log for frequencies). × closes one; an amber dot on A means hidden envelopes.
- Right-click a point: Linear / Hold / Exponential. Exponential is disabled where Web Audio can't do it (anything that reaches zero). Hold draws a step, exponential a curve.
- Measured: an EQ low-gain hold envelope (−18 dB then +18 dB) moved the band below 150 Hz by −11.1 / +11.9 dB in the render; above 2 kHz stayed within 0.9 dB.

### Also
- Marker names are edited inline on the strip (Enter, Esc, or click away), no browser prompt.
- Fixed (found in review): pitch analysis 40× faster via an FFT NSDF, so all sources are profiled about 28 s after load (it never finished before); mixer strips show their names, fit the panel, and master is a proper strip; gutter names get the full width; CI's end-to-end job is green again.

### Still open
- The timeline, mixer and inspectors still mutate the project themselves rather than calling the new store actions. That rewiring is next.
- Master-gain and clip envelopes have no drawing UI (the `automation` command writes them).

## 2.1.0 · 2026-09-23 · "Morning after"

Everything from the first morning of real use, plus the top five gaps from the cross-DAW research (`cog://mem/semantic/research/daw/`). Every item verified headless against *Borrowed Light*; numbers in the commit messages.

### Fixed (from Chaz, first hour of use)
- Playback stops at the song's end and parks the playhead there.
- Mixer is resizable (drag its handle; 120 px … 60 % of the window; remembered). Default is compact.
- Lyrics bar follows **one** lane: picker on the left; follows lane/source selection.
- Lanes scroll vertically (wheel); ⇧-wheel / sideways swipe scrolls time. Ruler stays pinned.
- Lanes reorder: drag a lane's **name** in the gutter. The dB bar below it stays the gain drag.
- Lane names ellipsize before the A/M/S buttons.

### New
- **Transcripts**: on a source or a clip: *Transcribe* (whisper, locally, through the sidecar; a clip transcribes only its span), *Export…* (SRT / WebVTT / word-JSON), *Import…* (those, or whisper JSON; phrase subtitles split evenly and flagged). Clip export/import is clip-local time.
- **Drag clips between lanes**: body drag follows the pointer vertically.
- **⌥-drag duplicates**: the copy follows the pointer; the original stays. (REAPER scheme: ⌘-drag.)
- **Markers & sections**: a strip under the ruler ticks. M adds at the playhead; double-click adds/renames; drag to move; click a section to jump; ⇧-click a section to select it; ⌥, / ⌥. prev/next; ⌫ deletes.
- **Cycle region, independent of the range**: C toggles (created from the range if none); ⌘U sets it from the range; click the yellow bar to toggle, drag its edges/middle. Gapless: the next pass is scheduled in the audio thread at the boundary.
- **Ripple delete**: ⇧⌫ (or *Ripple* in the toolbar) cuts the range from every lane and closes the gap: clips, markers, cycle and automation all move left together.
- **Automation engine**: targets `lane:<id>:gainDb|pan`, `master:gainDb`, `lane:<id>:insert:<n>:<param>` (effect params, ranges from the effects registry), `clip:<id>:gainDb` (clip-local, travels with the clip, stacks with clip gain). Per-point shapes linear / hold / exp (exp refused on anything that reaches zero, since Web Audio no-ops it). eq3 exposes AudioParams for sample-accurate automation; other effects are sampled at ~30 Hz. *(UI for the new targets is next: param picker on the A button.)*

### Keymap
- Scheme bindings now cite the manual page they came from. Corrected: Ableton slip ⌘⇧; Logic loses three bindings that aren't in Logic (slip-drag, ⌘T split, Enter/0 transport) and inherits defaults; REAPER stretch is plain ⌥, no-snap ⇧, duplicate ⌘. New: M marker, C cycle, ⌘U cycle-from-range, ⌥-drag duplicate, ⇧⌫ ripple.

### Research
- Primary-source corpus (manuals for Logic, Ableton, REAPER, Pro Tools, Bitwig, Studio One; DAWproject XSD; Ardour; RPP; AAF; ALS; Web Audio) and three corpus-cited reports (UX conventions, automation, project formats) in `cog/.cog/mem/semantic/research/daw/`.

## 2.0.0 · 2026-09-23 · "Borrowed Light"

The first release where a song lives in Oscine as a *project*: stems on lanes, words on the vocal, decisions as numbers, and a render that is the song. Built in one night around *Borrowed Light*; everything below was verified against that project, headless, with measurements rather than impressions.

### Open it
File → **Open project…** → *Borrowed Light*. Or reload; the last project comes back. ⌘S saves. The dev sidecar serves the cog workspace at `http://127.0.0.1:7351/`.

### Project format v2
- **Assets by content hash** (`assets/<sha256>.wav`), clips as references (`sourceOf, in, out`), placements as pointers (`track, clip, at`). Zero bytes cut.
- Clips carry `gainDb, fadeIn, fadeOut, stretch, semitones, rate, detune, name`.
- Lanes carry `name, color, gainDb, mute, solo, pan, inserts[]`; `arrangement.master.inserts[]`.
- `arrangement.automation[]`: breakpoint envelopes (`lane:<id>:gainDb`, `lane:<id>:pan`, `master:gainDb`).
- `assets[].words[{s,e,t}]`: word timings (whisper), mapped through placements to song time.
- `baseUrl` is injected on load and stripped on save; project files are portable.

### Arrangement timeline
- Lanes with waveforms (async decode, cached peaks), clip boxes, ruler with playhead handle + time label.
- **Move** (drag) · **trim** (edges) · **slip** (⇧-drag body; drag right = earlier audio) · **time-stretch** (⌥-drag right edge, pitch preserved) · **split** (S, at playhead or range edges) · **remove** (⌫) · pitch ∓1 st (`[` `]`) · gain ∓1 dB (⇧`[` ⇧`]`).
- **Snap**: sticky to clip edges, playhead, range edges, and the beat grid; ⌘ bypasses momentarily; N toggles; Snap button + grid picker in the toolbar. White guide line at the target.
- **Range**: ⇧-drag on the ruler, or click then ⇧-click; edges draggable (ruler or through the lanes); click a lane inside it to select its slice; S splits at both edges; ⌫ cuts the slice (head/tail/middle/drop); Esc clears; ⇧Space plays from range start.
- **Playhead**: draggable anywhere (ruler or the line itself), wins over a range edge it sits on; scrub while playing stops/resumes.
- **Overlaps** are first-class: hatched, selectable, editable as crossfades (fade out under / fade in over, or trim either clip).
- **Follow** mode pages the view during play (L toggles). Fit (F), zoom (= −, ⌘-wheel), scroll bounded to the song.
- Hit-testing: bodies win over neighbours' edge halos (a stretch on A never trims B); tiny clips keep a grab zone.
- Undo is one step per gesture; a click-to-select burns nothing; ⌫ then ⌘Z re-selects.

### Panels
- **Sources** (left): every asset with duration/hash/lane swatches; drag onto a lane to place; `+` places at the playhead; click for details.
- **Inspector** (right), one target at a time: **clip** (position, time & pitch, level, words), **lane** (name, gain, M/S, color, clips, remove), **source** (name, clips using it, full word list; click a word to seek), **overlap** (crossfade), **insert** (any effect's params from its schema), **range** (the ear).
- **Timeline gutter**: A / M / S, dB drag bar, name to select, `+ lane`.
- **Mixer**: one strip per lane (pan, insert chain with bypass/reorder/remove, dB fader, meter, M/S) + master with its own chain. `+ insert` menu grouped by effect type.
- **Toolbar**: undo/redo · split/remove/clear-range · pitch/gain nudges · snap · fit/zoom/follow/lyrics · **Keys** scheme picker. Tooltips show the live binding.
- **Lyrics bar** under the timeline: the song's words in song time, current word lit, click to seek.
- **Status bar**: position · range · selection · ear progress · saved/unsaved · sidecar.

### The ear
- `engine/ear.js`: pitch (McLeod NSDF), level (RMS/peak/crest), tone (spectral centroid), pace (words/sec from timings). `analyzeSpan`, `compareSpans`, `describe`: numbers a mixer would say out loud.
- Runs in a **worker**; every source is profiled in the background at load; a range inside one un-stretched clip answers from cache in ~36 ms.
- Select a range on a lane → the inspector listens: *E4 median, F3–B5, 56 % voiced, centroid 4740 Hz, 1.06 w/s, longest "changed" 3.38 s*. Pin as A; the next range shows the deltas.

### Effects (11, insert-style)
eq3 · resofilter · saturator · stereodelay (tempo-synced) · algoreverb · chorus · phaser · compressor · limiter · gate · utility. Registry contract (`defineEffect`, `BaseEffect`, `InsertChain`); click-free bypass; presets; each with a node test. Live and offline paths share the chain, so an export sounds like the mix.

### Automation
- Gain envelopes per lane: **A** in the gutter opens a sub-lane; click adds a point, drag moves, ⌥-click removes. Linear in dB, held flat outside the points, compiled to `setValueCurveAtTime` per play.

### Keymap
- Every shortcut and modifier-gesture is a named action; schemes (**oscine**, ableton, logic, reaper) bind keys with inheritance; per-action overrides persist. `oscine.keymap.use('ableton')` tonight; a settings panel later.

### Time-stretch / pitch
- Phase vocoder (`engine/stretch.js`), decoupled: `stretch` (length, pitch preserved) and `semitones` (pitch, length preserved) are two numbers on a reference; derived buffers cached by `sha256:s<stretch>:p<semitones>`. Measured: 1.5× holds 219.8 Hz; +7 st → 329.8 Hz.

### Sidecar
- `GET /projects.json`, `GET/PUT /project-doc/<rel>` (range requests on assets), audio MIME types, traversal guard. `?p=<rel>` in the URL opens a project.

### Known gaps (honest)
- No ripple delete, no vertical drag between lanes, no ⌥-drag duplicate, no markers/sections, loop range = selection range. (These are the top five from the cross-DAW audit and are next.)
- Automation: gain only in the UI (pan/master exist in the engine); no per-clip envelopes; no effect-param targets yet.
- Limiter is a WaveShaper ceiling, not true-peak; gate's hold is approximated by release.
- Pattern-side chrome (A/B/C/D, swing, click) is hidden on arrangements rather than unified; the v3 schema RFC covers the merge.
- The dev sidecar is launched by hand (`scripts/dev-sidecar.sh`); a registered plugin path is the next infra step.

### Under the hood
26 commits on `feat/schema-v2-segments`, 201 smoke tests + keymap (28) + ear (11) + automation (15) + 11 effect suites, all green.
