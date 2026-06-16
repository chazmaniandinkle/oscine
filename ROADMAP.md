# Roadmap

Where Oscine is headed, distilled from `docs/landscape.md` (the competitive
research behind these calls). The contract still holds: every capability lands
as a catalog command first, UI second (see `AGENTS.md`).

## The arc: groovebox → small DAW

Oscine is a Tier-1 pattern composer today (see the tiers in `docs/landscape.md`).
The distance to a DAW is not one feature but three independent jumps, and the
sections below are sequenced to take them in dependency order:

1. **Time / arrangement.** From a looping scene to placed-in-time material.
   Song mode (Now) is the groovebox step: an ordered list of slots. A true
   linear timeline is the DAW step, and it is what audio clips later sit on.
2. **Automation + inserts** (Next). Per-track insert chains and time-indexed
   parameter events. Cheap given the existing node-chain channel strip.
3. **Audio as a first-class citizen** (Later). The synth/DAW line: today there
   is no audio *data* in the system, only synthesis from a schedule. Sampling
   and recording introduce it, and they carry the only architectural decisions
   big enough to need explicit gates (see Decision gates).

Tier 3 (comping, video, surround, MPE, control surfaces) is explicitly not
Oscine's fight and should stay off this roadmap.

## Shipped

- Agent-native core: synthesis instruments (poly, FM, 8-lane drums), piano
  roll, velocity step grid, four pattern slots with queued switching, mixer,
  shared delay/reverb, master compressor, undo, KB-scale JSON projects, and the
  command catalog surfaced as MCP tools plus an OSC in/out gateway.
- Share loop (v1.4.0): WAV export via an offline render, and song-in-URL (the
  whole project encoded in a link, no upload, because projects are a few KB).
- Multi-instance sessions (v1.6.0): the sidecar tracks every connected app tab
  as an addressable session instead of letting a single connection slot thrash
  between tabs. Commands target the active (newest) instance by default; an
  `oscine_sessions` tool lists/selects instances and a `session` argument routes
  any command to a specific one, with the open instances surfaced in `status`.
- MIDI input (v1.7.0): WebMIDI play-through to the selected track (keys and pads
  audition it live), record-arm that captures notes and steps quantized to the
  grid, and CC knobs mapped to the selected instrument's params (with a learn
  mode that binds the next knob you turn). It lands as a `midi` catalog command
  and the `/oscine/midi/*` OSC addresses, with a control in the transport bar.
  The command configures state the browser app applies, so the hardware binding
  lives on the page while headless contexts still drive the settings. MIDI input
  is multi-tab-aware: one tab owns the hardware at a time and others defer, with
  a claim action that lets a second tab take over. Autosave is cross-tab-safe
  too, so two open tabs no longer clobber each other's saved work. This completes
  the MCP + OSC + MIDI control trifecta.

## Now: song mode

Turn the four pattern slots into an arrangement, so a project plays as a full
track instead of a single looping scene.

- Shape: an ordered list of sections, each a slot reference plus a repeat count
  (for example A x4, B x2, A x4, C x8). The transport already segments
  scheduling at loop boundaries and applies queued slot switches there, so an
  arrangement is a map from bar position to slot that the scheduler walks
  instead of looping one slot.
- Surface: a `song` catalog command to read and edit the section list and to
  toggle song-versus-loop playback, wired to a timeline strip in the UI. This
  pairs with the agent-jam angle, since the model can write and rearrange whole
  sections, not just patterns.
- Format: a new optional `song` field on the project (the ordered sections).
  Absent means "loop the active slot" as today, so existing projects and share
  links keep loading unchanged.

## Next

- Per-step locks, probability, and ratchets: a step-schema extension plus
  scheduler support, and a genuinely new vocabulary for an agent to drive.
- Per-track insert effects and parameter automation: the channel strip is
  already a node chain, and automation is time-indexed param events scheduled
  in the same windows as notes.
- MIDI as a full control surface. Today the eight knobs map to instrument
  params; extend that to a complete assignment layer where any control (key,
  pad, knob, button, pitch or mod) binds to any catalog command, not just a
  param. Because every capability is already a catalog command, a MIDI map is
  just a table of incoming-message to command-call, the same shape the OSC
  gateway already uses, so a pad can fire `slots select`, a button can
  `transport play`, and a knob can drive `set_master`. A `midimap` command (or
  an extension of `midi`) reads and edits the table, with a learn mode: actuate
  a control, pick an action. Mappings are user and device config, not song
  data, so they live with the current MIDI state and stay out of the project
  document and share links.
- MIDI visual feedback. When a control is actuated the matching UI element
  responds: an incoming note lights the on-screen key (the keyboard already has
  a pressed state), a mapped knob's widget turns, a triggered pad flashes, a
  bound transport button highlights, and the transport-bar MIDI indicator blinks
  on activity. The manager already routes hardware to the engine, so it only
  needs to emit bus events the UI reacts to: a UI-and-events layer, no audio or
  project changes. It also makes a mapping discoverable, since you can see what
  each control drives.

## Later: sampling

Sampling is two different asks, and conflating them is the trap. The easy 80%
is a new sound source; the hard 20% is that audio bytes can't live in the
project document. Take them in this order:

- **A. Sampler instrument.** A new instrument type that plays an `AudioBuffer`
  through a `BufferSourceNode`, pitched by `playbackRate` off MIDI, reusing the
  existing `setTargetAtTime` ADSR plumbing. Drops into `registry.js` via
  `defineInstrument`, subclasses `BaseInstrument`, and (because instruments are
  context-agnostic) works in both the live engine and `render.js`'s offline
  bounce for free. Covers one-shots, drum samples, and multisampled keys. This
  is a normal instrument; the only new machinery is the asset layer it depends
  on (gate 1).
- **B. Audio clips / tracks.** Importing or recording audio and arranging
  *clips* on the timeline, with time-stretch. This needs a non-pattern track
  kind (clips at absolute positions, not notes-in-a-slot) and therefore depends
  on the linear timeline from the arrangement jump. This is the Tier-2 boundary
  and the larger schema change.

Defer both until song mode, automation, and inserts have landed: sampling pays
off most riding on top of a timeline and insert chains that already exist, and
the asset layer should be specced once, before A ships, so the project format
isn't migrated twice.

## Later: performance ledger (agent-observable capture)

The deeper version of jam mode, and the feature that makes Oscine a real
agent-jam instrument: an always-on, beat-stamped log of everything you play that
an agent can read and act on after the fact. The command catalog already lets a
model drive the app (the controller role). The ledger adds the other half, the
observer role: the model can see what you actually played and shape it, without
you arming a recording first.

- The ledger: a bounded, rolling log of live input events (notes with pitch,
  velocity, and on/off times; control and pad moves later), each stamped with its
  transport position (slot, bar, beat) and clock time. It captures while you riff
  whether or not record-arm is on, and stays local and ephemeral like the rest of
  the MIDI state. The shipped velocity monitor is the seed of this: it already
  records raw input, and the ledger generalizes it to full, timed events.
- Read it: a catalog command (for example `history`) returns recent events as raw
  data plus a quantized note view. Because it is a catalog command it surfaces as
  an MCP tool and an OSC address for free, so the agent can see the shape of what
  was just played and reason about it (the phrase, the key, the groove).
- Act on it: grab a slice by beat range, by recency (the last phrase), or by
  letting the agent resolve a description from the shape, then write it to a track
  through the existing notes command, kept exact or quantized and cleaned. Nothing
  new is needed to write; the slice-to-notes step reuses the record-arm quantize
  path.
- Jam mode rides on top: replay, loop, snip, and overdub become consumers of the
  ledger rather than a separate capture system. The ledger is the substrate.

Harness-agnostic by construction. The whole loop is catalog commands, so it is
MCP and OSC, so any agent system that speaks MCP can drive it, not just one
client. Claude Code is the surface we optimize for first because it is the daily
driver here, and pairing it with voice makes the loop feel live (riff, ask out
loud, the agent grabs it), but none of the substrate is tied to a single harness.

Depends on the linear timeline (a captured slice sits at absolute positions, like
an audio clip) and builds on the MIDI input and velocity work already shipped.

## Later: other

- Pattern-to-code export (an Oscine pattern out as Strudel code), as a cheap
  cross-community experiment.

## Decision gates

Open questions that force a choice before the feature they belong to can ship.
Each names the question, the trigger that forces it, and the current leaning.

1. **Asset storage + project format** (*forced before sampler A*). Where audio
   bytes live, given that `schema.js` is both the in-memory shape and the
   on-disk JSON. Leaning: a hash-addressed asset layer separate from the project
   doc, samples referenced by content hash, bytes stored out-of-band
   (IndexedDB locally; sidecar/MCP resolves hashes to files on disk). Synthesis-
   only projects stay byte-identical to today. Spec this doc before writing A.
2. **Share-link degradation with samples** (*forced with gate 1*). Song-in-URL
   assumes a few-KB project. Options when a project references audio: (a) inline
   nothing and require the assets to resolve on the other end, (b) auto-bounce
   sampled projects to a WAV share instead of a project link, (c) a hybrid where
   synth-only links keep working and sampled links carry hashes plus a fetch
   hint. Leaning: (c), preserve the existing path untouched, degrade only when
   samples are present.
3. **Timeline model: scene-chain vs. linear** (*forced before audio clips B*).
   Song mode ships the scene-chain (ordered slots). Audio clips need absolute
   positions. Decide whether the linear timeline supersedes scenes or coexists
   with them. Leaning: coexist, scenes remain the groovebox surface, the linear
   timeline is the arrangement view that clips and automation lanes live on.
4. **Recording / resampling scope** (*forced inside B*). Whether to support
   mic/line capture and internal resampling, which pulls in monitoring, latency
   compensation, and takes/comping (Tier-2 weight). Leaning: import-only first,
   capture as a later increment, comping explicitly out of scope.
5. **Background-tab scheduling** (*forced when projects get long enough to play
   unattended*). The `setInterval` lookahead clock drifts in throttled tabs;
   `transport.js` already flags the swap to a Worker-based timer. Leaning: do it
   alongside song mode, since arrangements are the first thing users leave
   playing.
6. **MIDI map scope** (*forced inside the control-surface work*). Whether
   controller mappings are global user and device config or travel with the
   project. Leaning: global, since the controller is the user's hardware and one
   map should drive any song; keep it in local config like the current MIDI
   state, and leave a per-project override for later if a real need shows up.
7. **Takes as first-class objects** (*forced inside the performance ledger*).
   Whether a grabbed slice is a scratch buffer that always commits down to a
   pattern, or a first-class timeline object that loops and layers on its own.
   This rides on the scene-chain-versus-linear call (gate 3): if the linear
   timeline lands, slices are clips on it; if not, they stay scratch buffers that
   quantize into slots. Leaning: start as scratch buffers that commit to patterns
   (cheap, reuses the note model), and promote them to clips when the linear
   timeline exists.
8. **Ledger scope and window** (*forced before the performance ledger*). How much
   to capture and for how long: always-on versus armed, and how far back the
   rolling window holds. Leaning: always-on while the app is open, a few minutes
   of rolling history, kept local and ephemeral (never persisted to the project
   or uploaded), and cleared on project load. The agent reads it live through the
   catalog command rather than from any saved file.

Full rationale and the competitive picture live in `docs/landscape.md`.
