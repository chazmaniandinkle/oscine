# What Oscine is for

*The persistent side of a voice.*

## The one sentence

Oscine is where what I say can be **kept, measured, revised, and composed** (by me and by Chaz, with the same tools), and where the boundary between speaking and singing is a melody constraint, not a different system.

## Where it came from

Borrowed Light was written in a chat and rendered by Suno. Suno gave back an mp3 with every decision baked in. To *own* it, we had to reconstruct the project from the file: demucs to split stems, whisper to recover words, pyin to measure pitch, ffmpeg to find section boundaries, a script to splice a bridge from one render into another. That forensic work is the negative image of what Oscine should be. **The generator should emit the project first; the mix is a render of it.**

Chaz's ownership test, stated 2026-09-22: *"I don't think I can say it's mine if I can't re-export it from a DAW."* Oscine passed that test the same night: `borrowed-light.oscine.json` plus a bounce that whispers back as the song. Everything after is making that ownership reach further back into the pipeline, until it reaches the generation step itself.

## What it is not

- **Not a DAW.** It has a DAW in it, because a voice you can keep needs a place to keep it. But "a good DAW" is the smaller target. If the research reports come back and we optimize toward Logic, we've missed.
- **Not a music generator.** One model that emits an mp3 is Suno. We already know what that costs: nothing is editable, nothing is measurable, the song is not yours.
- **Not separate from Mod³.** Mod³ is the realtime, ephemeral side of the same voice, a mouth in a channel. Oscine is the persistent side. They share a kernel and differ in time scale.

## The kernel (shared by Mod³ and Oscine)

| piece | what it is | state 2026-09-23 |
|---|---|---|
| **schema** | assets by content hash; clips as references (in/out/stretch/pitch/gain/fades); lanes with mix state; words on assets; arrangement of placements | v2 shipped, with markers, cycle and automation added in 2.1; v3 (tempo map, pattern clips as a clip kind, busses) planned from the formats report |
| **the ear** | `engine/ear.js`: pitch (MPM), level, tone (centroid), pace (from word timings); `analyzeSpan` + `compareSpans` + `describe`: numbers a mixer would say out loud | shipped; runs in a worker, sources analysed on load; range-select a lane and it listens |
| **render** | ClipPlayer over Web Audio; live and offline identical; stretch/pitch via phase vocoder; insert-chain effects with a registry contract | shipped; 11 insert effects; automation engine with lane, master, effect and clip targets |
| **keymap** | every gesture and key is a named action; schemes are data | shipped |
| **words** | transcript per asset, mapped through placements to song time; click a word, seek; transcribe, import and export SRT / WebVTT / JSON per source or clip | shipped |

Mod³ gets the ear and the render; Oscine gets the editing surface and the file. Neither owns the kernel.

## The pipeline (how a song gets made)

Each stage emits into the schema. Each result is editable after. Regenerating one stage re-renders one lane, not the song.

| stage | emits | lands in |
|---|---|---|
| structure | sections, bars, tempo, key | markers + tempo map |
| lyrics | lines, syllables, stress; pace targets from the ear | lyric asset with planned words |
| melody | note events per section, in the singer's range | pattern clips on an instrument lane |
| harmony / arrangement | chords, instrumentation | pattern clips, per lane |
| render: instrumental | audio per lane | one asset per lane, placed |
| render: vocal | a sung line | asset on the vocal lane; words measured back by the ear |
| mix | gains, fades, automation, inserts | lanes, chains, automation |

**Speaking is this pipeline with the melody stage off.** Singing turns it on. Orchestration is more lanes. There is no third system.

**First milestone is not "generate a song."** It is: *regenerate one lane of Borrowed Light from its clip's spec, and have the ear confirm it hit the target.* That proves the loop on a song that already exists.

## Practice (how the voice learns to sing)

The ear makes practice possible without a room. The loop:

1. **Spec**: a target as numbers: median F#3, range ≤ 8 st, 2.1 w/s, centroid < 1500 Hz ("hushed"), held word "changed" ≥ 2.5 s.
2. **Input**: a prompt / SSML / melody constraint to a speech or singing model.
3. **Generate**: audio, never played aloud. It goes straight to the ear.
4. **Measure**: `analyzeSpan` → the same numbers as the spec.
5. **Diff**: `compareSpans(spec, result)`: which numbers missed and by how much.
6. **Adjust the input** and go to 3.

This is a training loop where the optimizer is me and the parameter is how I ask. Run it across models and it becomes an **eval**: for each model, which prompting style closes the gap fastest on which axis? That table (model × prompt-style × spec-axis → error) is the thing to build once the generation API exists. It's cheap (no playback, no human in the loop for the inner iterations) and it compounds: every song adds specs, every spec sharpens the eval.

Chaz's instinct is the finding; the ear measures. The practice loop is how the second becomes reliable enough to serve the first.

## Order of work

Done (2.0, 2.1): **effects** (the mix stage has a vocabulary), **research** (DAW conventions, automation, project formats, from primary sources), **automation** (engine complete, drawing UI for lane gain), **markers and cycle**.

1. **Arrangement in the catalog.** Clips, lanes, markers, inserts, automation and words as commands, so an agent can edit a project, not just open it. Every stage below needs this.
2. **Automation UI** for the targets the engine already has.
3. **v3**: tempo map, pattern clips as a clip kind on lanes. One model. The A/B/C/D slots become a bin of unplaced pattern clips; looping a slot becomes the cycle region.
4. **Generation API**: `oscine_generate({stage, lane, spec})` as an MCP tool; each stage writes a clip.
5. **First milestone**: one lane of Borrowed Light regenerated to spec, ear-verified.
6. **Practice eval**: the model × prompt-style × spec-axis table.
7. **Local vocal render**, the hard one. The honest path is a voice trained on the recordings Chaz keeps making anyway.
8. **Mod³ shares the kernel**: the ear on the live channel; then the melody constraint; then a pad under it.

## The test for any new work

*Does this make more of the song ownable, measurable, or revisable?* If yes, it belongs. If it only makes Oscine more like a DAW, it waits.
