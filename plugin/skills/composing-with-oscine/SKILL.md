---
name: composing-with-oscine
description: Compose and produce music in the Oscine synth composer through its oscine_* MCP tools. Use when the user asks to compose music, make a beat, write a melody, bassline, chords or drums, design a synth sound, mix tracks, or control Oscine playback ("make a beat", "write a bassline", "open oscine", "make the pad warmer").
---

# Composing with Oscine

Oscine is a live browser app. Tools act on the user's actual session: they hear results immediately and see every edit land in the UI.

## Session start

1. `oscine_status` — if `appConnected: false`, call `oscine_open_app`, then re-check.
2. Audio unlock: browsers mute Web Audio until the user interacts once with the tab. If `audioState` is not `running`, ask the user to click anywhere in the Oscine tab.
3. `oscine_list_instruments` before creating tracks or setting params — it returns every param key, range, preset, and drum lane id.

## Data conventions

- Time is in beats (quarter notes). A slot loops `bars * 4` beats. 16th note = 0.25 beats.
- Pitch is MIDI (60 = C4, 69 = A4 = 440Hz). Velocity 0-1.
- Drum lanes are 16th-step velocity arrays: 1 bar = 16 values, 2 bars = 32. `[1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0]` is kick on beats 1 and 3.
- Tracks are addressed by name ("Bass") or id. Slots are 'A'-'D'.

## Composing workflow

- Keep notes inside the loop: check `bars` from `oscine_get_notes`/`oscine_slots list` first, or set length with `oscine_slots set_bars`.
- `oscine_set_notes mode:replace` is the main composing move — write whole patterns, not note-by-note edits.
- Vary velocity (0.5-1.0) and note lengths; straight max-velocity grids sound mechanical. A little `swing` (0.1-0.2) via `oscine_transport` helps grooves.
- Use slots as song sections: A groove, B variation/breakdown, C build, D drop. `oscine_slots copy` then mutate the copy. Switching slots while playing queues to the next loop boundary — switch live for the user.
- Sound design: start from a preset (`oscine_set_params preset:"Acid Bass"`), then nudge params. `oscine_preview` auditions a pitch or drum hit without editing patterns.
- Mixing: `oscine_set_mix` for level/pan/mute/solo and delay/reverb sends; `oscine_set_master` for the shared FX character.
- Everything structural is undoable (`oscine_project action:undo`), so edit boldly.
- Sharing the result: `oscine_share action:"link"` returns a URL with the whole song packed into it (no upload), good for handing the user something to open or post. `oscine_export_wav` bounces the active slot to a downloaded WAV (set `loops` for length, `slot` to pick a section).

## Caveats

- If a tool errors with "Oscine isn't open", use `oscine_open_app` — never tell the user it failed without trying that first.
- `oscine_transport action:play` loops the active slot from its top; there is no song arrangement yet.
- Param tweaks are not in undo history (matches the UI); patterns, tracks, slots, and presets are.
