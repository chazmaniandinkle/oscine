# Voice Box

*A digital instrument for self-expression.* Named by Chaz, 2026-10-13.

## The idea

A Voice Box instrument is played by **gesture curves**, not notes. A note is four numbers fixed at its start (start,
pitch, length, velocity). A player's expression lives between and inside the notes: the scoop into a pitch, how much
bow a stressed syllable gets, the drift toward the fingerboard on a held word, the bow lifting while the string still
rings. Those are continuous curves, and the instrument reads them every sample.

This is the north star's "boundary between speaking and singing is a melody constraint", taken one layer down: the
same phrase shaped like speech (stress, scoop, release) on an instrument that can carry it.

## First evidence (cog `projects/songs/2026-10-13-on-the-shelf/`)

- `gesture_score.py`: the "On the Shelf" chorus phrase played on the modelled bowed string by writing its four control
  curves directly (finger Hz, bow speed, bow pressure, contact point), shaped from the lyric's stresses. Against the
  note translator (`violin_line`): stressed syllables +2-3 dB, weak ones -2-3 dB, and a dropped syllable ("put",
  -37 dB) came back. A string that keeps ringing after the bow lifts (-30 dB) is something MIDI has no event for.
- Not solved: tone colour. Moving the contact point toward the fingerboard on "shelf" made it brighter, not darker,
  because the bow swell outweighed it. The curves interact; the instrument has to be learned, like a real one.
- `talking_violin.py`: formant-filtering the violin into vowels failed (whisper heard "hoo-ooh"). Words stay with a
  voice; the Voice Box carries the *shape* of saying them.

## What it needs in Oscine

1. **Gesture lanes**: automation-style curves (points with shapes) bound to an instrument's control inputs, stored in
   the schema like `arrangement.automation`, at audio rate on render.
2. **The modelled bowed string as an Oscine instrument** (today it is Python + numba in cog). Needs a JS/WASM
   port of `_bowed` + body IR, or a sidecar render provider that returns a buffer for a lane.
3. **Translators as starting points, not the instrument**: notes + lyric stress produce default curves, which are then
   editable by hand or by a performance.
4. **Recorded performance as input**: Chaz's own violin. Pitch, level and brightness curves measured off a recording
   by the ear, mapped onto the model's controls. The player's gesture, the model's sound.
5. **The ear closes the loop**: per-word level and brightness against what the curves asked for.

## Open questions

- Which curves are the right handles for a person (bow speed vs "intensity")?
- Can a performance be recorded straight into gesture lanes from a MIDI controller (MPE, breath, the MPK knobs)?
- Is one bowed string the right first body, or should the voice itself (a singing model driven by the same curves) be?
