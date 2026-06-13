# The landscape: where Oscine sits and where it can go

Researched June 2026. Method: parallel source sweeps over each category
below, primary sources (repos, manufacturer pages, official
announcements) preferred over coverage, with a verification pass on the
claims this document leans on. Anything we could not confirm from a
primary source is marked as such.

The question this document answers: what do people already expect from
a tool in Oscine's class, and what can Oscine do that nobody else
ships?

## 1. Category map

### Browser DAWs and sequencers

| Tool | License / model | Status (mid-2026) |
|---|---|---|
| [openDAW](https://opendaw.org/) ([repo](https://github.com/andremichelle/openDAW)) | AGPL v3 + commercial dual license | Prototype live; 1.0 targeted Q3 2026; 18 stock plugins; privacy and education positioning. By Andre Michelle (Audiotool). The serious entrant. |
| [GridSound](https://gridsound.com/daw/) ([repo](https://github.com/gridsound/daw)) | AGPL v3 client, hosted account service, Patreon-funded | Long-running, v1.58.x, steady but small |
| [Signal](https://signal.vercel.app/) ([repo](https://github.com/ryohey/signal)) | MIT | Active; deliberately a MIDI sequencer, not a DAW (no audio engine of its own) |
| [AudioMass](https://audiomass.co/) | open source | Waveform editor, not a sequencer |
| Soundtrap, BandLab, Amped Studio | commercial, account-based cloud | The mainstream web option; collaboration and cloud libraries are the pitch |

[Web Audio Modules 2](https://github.com/webaudiomodules/api) (the
would-be VST-of-the-web): spec exists, repo quiet since 2023, no
central registry, adoption thin. A WAM host is a future option for
Oscine, not a near-term ecosystem to ride.

What the field is converging on: privacy/local-first talk, no-install
onboarding, conventional DAW UX recreated in the browser. What none of
them ship: any programmatic surface. No command API, no agent
integration, no OSC. The browser DAWs are GUIs all the way down.

### Grooveboxes and pattern instruments (hardware)

Surveyed from manufacturer pages: Elektron
[Digitakt II](https://www.elektron.se/explore/digitakt-ii) and
[Syntakt](https://www.elektron.se/product/syntakt), Polyend
[Tracker](https://polyend.com/tracker/) and
[Play+](https://polyend.com/play-plus/), Novation
[Circuit Tracks](https://novationmusic.com/products/circuit-tracks),
Akai [MPC One+](https://www.akaipro.com/mpc-one-plus), NI
[Maschine+](https://www.native-instruments.com/en/products/maschine/production-systems/maschine-plus/).

This class defines the workflow vocabulary Oscine borrows (patterns,
scenes, queued switching). Its near-universal features, ranked by
ubiquity across the surveyed devices:

1. Per-step parameter locks (every surveyed device)
2. Live record with quantize (every device)
3. Per-step velocity (every device)
4. Per-pattern length / polymeter (every device)
5. MIDI I/O (every device)
6. Pattern chaining / song mode (every device)
7. Sample playback (every device, even synth-focused ones)
8. Per-track inserts plus send FX (every device)

Close behind (most devices): per-track microtiming/swing, step
probability and conditional trigs, ratchets/retrigs, scale lock,
automation recording, stems export.

### Pattern paradigms in software

[Ableton Live 12](https://www.ableton.com/en/live/) Session view
(scenes, clips, follow actions, the queued-launch model Oscine's slots
echo), [FL Studio](https://www.image-line.com/fl-studio/features)
patterns + playlist, [Renoise](https://www.renoise.com/) and the
tracker lineage (per-step effect columns are parameter locks avant la
lettre). Live 12 added scale awareness throughout. FL ships CLAP
hosting natively.

### Live-coding and code-music

[Strudel](https://strudel.cc/) (TidalCycles in the browser, moved to
Codeberg in 2025, active), [Sonic Pi](https://sonic-pi.net/) (11.9k
stars, active, desktop), [Glicol](https://glicol.org/) (Rust + browser,
experimental), Gibber (dormant). All are MIDI/OSC-capable within their
own worlds and all require programming literacy. None have shipped
LLM/agent integration as of June 2026, which is striking given that
they are command-driven by construction.

The big lesson from Strudel: patterns as compact shareable text, with
a URL as the unit of distribution. It proves song-as-link works; it
just only works for coders.

### Desktop FOSS baseline

[Ardour 9.7](https://ardour.org/whatsnew.html) (June 2026) is the
mature anchor: full audio+MIDI recording, comping, automation, plugin
hosting. [LMMS](https://lmms.io/) stable line still 1.2.x. Zrythm,
Stargate, and Qtractor showed weak or unverifiable activity signals in
this sweep (sites unreachable or stale). The pattern: desktop FOSS DAWs
compete on completeness against commercial tools, on a decade-plus
timescale, with mixed momentum.

Commercial expectation-setters: Ableton Live 12, FL Studio (rolling
releases, rent-to-own), [Reaper 7.74](https://www.reaper.fm/) (one-time
license, VST3/LV2/CLAP/AU hosting). CLAP is now a credible third
plugin standard ([526+ entries tracked](https://clapdb.tech/)) without
displacing VST3 anywhere.

### Agent and AI control of music tools

The active frontier, and it is all retrofits:

- [ahujasid/ableton-mcp](https://github.com/ahujasid/ableton-mcp):
  2,642 stars, 341 forks, active. MCP server talking to a MIDI Remote
  Script inside Live over a TCP socket. Real session control (tracks,
  clips, tempo, devices), bounded by what the Remote Script API exposes.
  Forks (e.g. LofiFren's) add tool batches and arrangement support.
- DAWZY ([arXiv](https://arxiv.org/pdf/2512.03289)): research prototype,
  human-in-the-loop co-creation in REAPER via MCP and ReaScripts.
- Anthropic shipped official creative-software connectors on April 28,
  2026, including
  [Ableton](https://www.anthropic.com/news/claude-for-creative-work):
  documentation grounding for Live and Push only, no project access and
  no session control (confirmed across
  [coverage](https://www.gearnews.com/claude-ai-ableton-live-tech/)).
- Logic, FL, Bitwig, Pro Tools: scattered experiments, nothing with
  ableton-mcp's traction.

Verified claim, with one honest nuance: **no open-source DAW or
groovebox-style sequencer is agent-native at the architecture level.**
Everything in the GUI lineage bolts agent control on through whatever
scripting seam the host happens to have. The nuance is the live-coding
family: Strudel and SuperCollider are command-driven by construction
and an LLM can write for them fluently, but they offer no GUI, no
session model, no mixer; they are languages, not instruments with
faces. The combination (a visual instrument whose every feature is a
schema'd command an agent can call) is shipped by nobody we could find
except Oscine.

## 2. Feature expectations by tier

Tier 1, pattern composer / groovebox (Oscine's class). Users arriving
from the hardware above expect: step grid with velocity, piano roll,
per-step parameter locks, probability/conditions, ratchets, swing and
microtiming, scale lock, live record with quantize, per-pattern length
and polymeter, scenes/pattern chaining into a song, sample playback,
per-track inserts plus sends, automation recording, MIDI I/O, WAV/stem
export.

Tier 2, small DAW. Everything above plus: audio tracks and recording,
arrangement timeline, automation lanes, plugin hosting (VST3/CLAP on
desktop; WAM on the web), takes/comping, time-stretch, per-track
metering, project interchange.

Tier 3, full DAW (Ableton/Reaper/Ardour territory): comping, video,
surround, hardware control surfaces, MPE, networked sync, the lot. Not
Oscine's fight and should never be.

## 3. Oscine against the matrix

Has today: synthesis-first instruments (poly, FM, 8-lane drum kit),
piano roll, velocity step grid, four pattern slots with queued
switching (a scenes primitive), global swing, per-track delay/reverb
sends, master compressor, mixer with gain/pan/mute/solo and meters,
undo, KB-scale JSON projects, localStorage autosave plus file
export/import, a command API covering every feature, MCP tools, OSC
in/out with a feedback stream, hosted static deployment, playable
keyboard/pads.

Partial: swing is global, not per-track; pattern slots chain by hand
(no song list); selection-based editing but no automation.

Missing against Tier 1 expectations, none of which are
architecturally hard given the command catalog: WAV export, song mode,
MIDI I/O, live record/quantize, per-step locks, probability, ratchets,
per-track microtiming, scale lock, sample playback, per-track inserts,
automation.

## 4. Baseline gaps, ranked by how loudly the absence is felt

1. **WAV export.** The universal exit ramp. Every tool in every tier
   has it; its absence reads as "toy" within minutes. OfflineAudioContext
   makes this a contained build (render the schedule, encode, download).
2. **Song mode.** Pattern chaining is in every groovebox since the
   90s. A simple ordered slot list with repeat counts covers the
   expectation; the transport already segments scheduling windows, so
   an arrangement is a map from window to slot.
3. **MIDI input + live record with quantize.** Hardware-keyboard entry
   is how most pattern-tool users actually play. WebMIDI works on the
   hosted page with no sidecar, which makes this the cheapest
   credibility win per line of code.
4. **Per-step locks, probability, ratchets.** The defining vocabulary
   of the modern groovebox class (universal or near-universal on
   surveyed hardware). For Oscine these are step-schema extensions plus
   scheduler support, and they compound with agent control: an LLM
   setting probabilities and locks per step is a genuinely new way to
   drive this vocabulary.
5. **Per-track inserts + automation.** The channel strip is already a
   node chain; inserts are an array between fader and panner with an
   effect registry mirroring the instrument registry. Automation is
   time-indexed param events in the same scheduling windows as notes.
6. **Sample playback.** Last of the table stakes, and the one that
   trades against the KB-project/song-in-URL story. The honest design:
   a sample track kind that references files by hash with projects
   staying tiny when synthesis-only. Defer until the five above exist.

## 5. Push-past bets, checked against what competitors ship

1. **Agent-native architecture.** Verified white space (section 1).
   The retrofits are ceilinged by host scripting APIs; Anthropic's own
   Ableton connector stops at documentation. Oscine's catalog means the
   agent surface grows with every feature by construction. The bet:
   first instrument where "jam with the model" is a designed workflow,
   not a hack. Tightest version: agent reads the OSC feedback stream
   while writing patterns, a feedback loop nobody else has.
2. **Interop trifecta: MCP + OSC + MIDI.** No browser DAW ships any of
   the three as a control surface; hardware ships MIDI (and sometimes
   OSC) but no agent surface; live-coding ships OSC but no GUI. All
   three speaking to one catalog is unoccupied ground. MIDI input
   (gap 3) completes it.
3. **Song-in-URL.** Strudel proved the unit of distribution can be a
   link, for coders. No GUI music tool does it because sample-based
   projects are too heavy. Oscine's synthesis-only projects are a few
   KB, which compresses into a URL fragment. Combined with Pages
   hosting, a finished groove becomes a tweetable artifact that opens
   in the editor. Nobody ships this.
4. **Readable, zero-build codebase as pedagogy.** openDAW positions as
   education by being a usable product; Oscine can position as
   education by being readable source: one instrument per file, no
   framework, no build step, view-source-and-learn. These are
   complementary, not competing, claims.
5. **Local-first without accounts.** Shared with openDAW's positioning
   (and the field's direction), so this is alignment rather than
   differentiation. State it, don't lead with it.
6. **Exploratory: pattern-to-code export.** The live-coding world's
   pattern-as-text insight, bridged for non-coders: export an Oscine
   pattern as Strudel code. Cheap experiment, interesting cross-
   community signal, unproven demand.

## 6. Sequence

Close gaps 1 through 4 in order (each is small against this
architecture), shipping one push-past bet alongside each cycle:
WAV export with song-in-URL; song mode with the agent-jam feedback
loop; MIDI input completing the trifecta; step locks/probability as
both UI and agent vocabulary. Defer samples, inserts-as-plugins, and
WAM hosting until the class table stakes are met. Decline Tier 3
entirely.

The one-line positioning this research supports: the browser DAWs
have no API, the agent tools have no DAW, the grooveboxes have no
web, and the live coders have no GUI. Oscine is the only project
positioned at the intersection, and against this architecture the
remaining table stakes are contained builds, not rewrites.
