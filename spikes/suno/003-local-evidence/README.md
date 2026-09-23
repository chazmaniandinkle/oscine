# Spike 003: local Suno metadata evidence (lane C)

Status: DONE, 2026-09-23. This was a read-only inspection. No audio or project file was modified.
Tools used: `ffprobe -show_format -show_streams -of json`, mutagen 1.47 (uv venv at `/tmp/mutv`),
`ffmpeg -map 0:s:0 -f srt` (subtitle track), sha256, ripgrep, and `git log` on the song dir.
The scripts are `/tmp/mutv/dump.py` and `/tmp/mutv/summ.py`; the raw dump is `/tmp/mutv/tags.json`.

Song dir `S` = `/Users/slowbro/workspaces/cog/projects/songs/2026-09-19-housekeeping-heat`

## TL;DR

* **Every Suno `.m4a` download carries its Suno song ID.** The ID sits in the MP4 `©cmt` atom as
  `made with suno; created=<ISO-8601 Z>; id=<uuid>`. The full lyrics box text, with metatags, is in `©lyr`.
  There is also a `mov_text` subtitle track that holds **line-level lyric timings**.
* The style prompt, model version, title, cover art and URL are **not** embedded. The ID is enough to
  rebuild `https://suno.com/song/<id>`.
* Oscine's `borrowed-light.oscine.json` has **zero provenance**. Its assets are demucs stems keyed by
  sha256, and the only link back to Suno is the human `name` string.
* The `.mp3` files in Downloads with a `c2pa` GEOB are **not Suno**. They are Google generative-AI output
  (C2PA "Created by Google Generative AI", "Applied imperceptible SynthID watermark"), i.e. the Gemini/Lyria renders.

## 1. Embedded tags in candidate audio

Every Suno m4a has the same container: Opus 48 kHz at ~129 kbps, plus a `mov_text` subtitle stream, `©too=Lavf60.16.100`.
None of them has `©nam`, `©ART`, `desc`, `covr` or `©gen`. No MP3 has TIT2/TPE1/COMM/USLT/APIC/WXXX from Suno.

| file | sha256[:12] | dur s | Suno id (`©cmt`) | created (UTC) | lyrics `©lyr` | subs (line timings) | style/model/url/cover |
|---|---|---|---|---|---|---|---|
| `S/renders/borrowed-light/render1-v13.m4a` | f8b9f4f9165c | 228.37 | **efcdfc1f-9c2d-4422-b1b5-f926811563fa** | 2026-09-22T21:54:12Z | yes (2353 ch) | yes | none |
| `S/renders/borrowed-light/render2-v14.m4a` | d64e4c8e8d57 | 231.65 | **39802a94-8c2f-49b7-bb77-79bfe022b18d** | 2026-09-22T23:31:44Z | yes (2673 ch) | yes | none |
| `S/tfr-run2.m4a` | 0fa567bd6e39 | 215.01 | **0cc5691c-b468-409f-a9e0-3154cb86c5c7** | 2026-09-21T04:02:21Z | yes | yes | none |
| `S/tfr-run3.m4a` | a017572f438c | 259.17 | **dfafb0b1-a0bd-4fa7-9695-4deca9fe568f** | 2026-09-21T03:49:32Z | yes | yes | none |
| `S/the-basin-holds.m4a` | b660443a81da | 253.97 | **a82ba3a5-8c41-4ce0-a9c7-8612a2e7b66e** | 2026-09-21T01:43:38Z | yes | yes | none |
| `~/Downloads/Borrowed Light.m4a` (not in song dir) | b9314325b3a4 | 232.73 | **cb742ddf-1c1e-437d-abcd-3c77b856ccb6** | 2026-09-22T20:35:04Z | yes (2144 ch) | yes | none |
| `~/Downloads/The Field Remains (1).m4a` | = render1-v13 (same sha) | | efcdfc1f… | | | | |
| `~/Downloads/The Field Remains (2).m4a` | = render2-v14 | | 39802a94… | | | | |
| `~/Downloads/The Field Remains.m4a` | = tfr-run2 | | 0cc5691c… | | | | |
| `~/Downloads/The Field Remains (nightwish-ish).m4a` | = tfr-run3 | | dfafb0b1… | | | | |
| `~/Downloads/The_Basin_Holds.m4a`, `(1).m4a` | = the-basin-holds | | a82ba3a5… | | | | |
| `S/the-part-that-wont-fold.mp3` | f707f3f13ed3 | 86.65 | — **not Suno** | — | — | — | ID3 is ours: TIT2 "The Part That Won't Fold", TPE1 "Cog", TALB "Substrate Cycle", TXXX:comment "Oscine render. A minor, 84 BPM…" (an Oscine instrumental bed; see `S/README.md`) |
| `S/standing-waves-pass1.mp3` = `~/Downloads/The_Basin_Holds.mp3` | 1a9edd21a546 | 178.63 | — | — | — | — | only `GEOB:c2pa manifest store`: Google C2PA, SynthID, `trainedAlgorithmicMedia` → **Gemini/Lyria** |
| `~/Downloads/The_Field_Remains.mp3`, `(1).mp3`, `The_Basin_Holds (1)/(2).mp3` | 52a9…, 71f1…, c81b…, a9c5… | ~176–180 | — | — | — | — | same Google C2PA → **not Suno** |
| `~/Downloads/The_Field_Remains.mp4`, `(1).mp4`, `The_Basin_Holds.mp4`, `The_Wave_and_The_Shore.mp4` | 54fd…, 3df3…, 9472…, 97a2… | ~179–181 | — | — | no | yes | `©nam`/`©alb`/`©gen` e.g. "The Field Remains" / "The Pattern Beneath" / "Atmospheric Electronic Ballad": these are Gemini-style video exports, not Suno. The ~180 s cap matches Lyria. |
| `~/Downloads/Borrowed-Light.wav`, `(1).wav` | 819f…, 3c7a… | 235.34 | — | — | — | — | no tags. These are Oscine exports (same size as `oscine-export-chaz-2.wav`). |

Subtitle track sample (render1). Lyric lines are timed. Metatag lines get zero-length cues:
```
00:00:10,532 --> 00:00:14,521  We are home.
00:00:14,521 --> 00:00:19,628  Not a thing — a becoming.
00:00:19,628 --> 00:00:23,537  Our bodies are both shore and wave —
```
**Not present anywhere:** style prompt, model version (v4.5/v5 etc.), persona, seed, title, cover art, `suno.com` URL.

## 2. Suno IDs / URLs in the cog workspace

I grepped `/Users/slowbro/workspaces/cog` (including `.cog/`, hidden, no-ignore), `~/.hermes/profiles/cog/{sessions,memories}`
and `/Users/slowbro/workspaces/oscine` for `suno.com/song`, `suno.ai`, `cdn*.suno.ai`, and UUIDs within 80 chars of "suno".

| id / url | where found | note |
|---|---|---|
| efcdfc1f…, 39802a94…, 0cc5691c…, dfafb0b1…, a82ba3a5…, cb742ddf… | **only** `.cog/ledger/372ed0ad-2c7a-4f86-a5ed-49bf5eb6d7cc/events.jsonl` and `.cog/run/turns/372ed0ad-….jsonl` | This is today's session (2026-09-23 14:22–17:44Z) that ran the same grep. It echoes this spike and is not an independent record. |
| `https://suno.com/song/538ab4ae-3ace-4abf-95f9-be0bed53b65d` (+ `cdn2.suno.ai/538ab4ae…jpeg`) | `~/.hermes/profiles/cog/sessions/request_dump_20260923_133804_…json` | This came from spike 002 (public-surface) scraping. It is a public song, not one of ours. |
| `cdn2.suno.ai/569593ec-f0ac-445c-b99c-6ca6141634b8.jpeg` and ~10 other cdn2 UUIDs (8e7e59d7, e9548485, 58490298, 9bca6f37, 057fa44a, f0f00357, 9f5adfa3, 4eed94d1, c1a16429, ed03f4a8, 02d2f2df) | same request dump, plus `.cog/ledger/372ed0ad…/events.jsonl` lines 2197/2201 | These are cover/cdn assets from the spike 002 public scrape, not ours. |
| `suno.com`, `suno.com/create?mode=CUSTOM`, `suno.com/auth/birthday` | `.cog/observatory/ingest/pieces/20260904T031439Z-…records.jsonl`, `.cog/state/conversations/pieces__websites.json` | Browsing history (Pieces). No song IDs. |
| `https://suno.com/song/` (template) | `tmp/ytdlp-venv/…/yt_dlp/extractor/unsupported.py` | library code |

The song dir's `.md` files and `.cog/mem/**` mention Suno 1–9 times each (`the-part-that-wont-fold.suno.md`,
`2026-09-23-vroku-oscine.cog.md`, `hermes-evicted-suno-*` etc.), but **none contains a Suno song ID or `suno.com/song/` URL**.
The IDs of our renders exist **only inside the audio files**.

## 3. How `borrowed-light.oscine.json` records assets

Top level: `version: 2, name, bpm: 103.4, swing, masterVolume, fx, slots, tracks, assets, clips, arrangement`.
There are 6 assets. Each has `{id, kind, duration, name, variants: {default: {sha256, ext}}, words}`.
The file resolves by convention: `S/assets/<sha256>.<ext>` (`src/core/assets.js: ASSETS_DIR`). The `assets/` directory is gitignored.
The schema's `derivedFrom / derivedBy / calibration / supersededBy` are **absent** from every variant (the builder never set them).
Two fields, `name` and `ext`, are off-schema extras. Both survived Chaz's in-app save (commit 9c0a743074), so unknown keys round-trip.

Two real entries (words array elided):
```json
"ast_bed_r2": { "id": "ast_bed_r2", "kind": "audio", "duration": 231.653515,
  "variants": { "default": { "sha256": "1c5b15248af9cc1daa051ce02fdc48caa2793487545ff81b7e1da9340272b48e", "ext": "wav" } },
  "words": [], "name": "Bed — render 2 (Suno v14, demucs no_vocals)" }

"ast_vocal_r1": { "id": "ast_vocal_r1", "kind": "audio", "duration": 228.373515,
  "variants": { "default": { "sha256": "e9e43571f2e6…", "ext": "wav" } },
  "words": [/* 202 whisper words {s,e,t} */], "name": "Vocal — render 1 (Suno v13, demucs vocals)" }
```

Asset → file (the sha256 was verified against the stems):

| asset | sha[:12] | same bytes as | upstream Suno file (not recorded in project) |
|---|---|---|---|
| ast_bed_r2 | 1c5b15248af9 | `S/stems/render2/bed.wav` | render2-v14.m4a (39802a94…) |
| ast_vocal_r2 | b61fb8766b29 | `S/stems/render2/vocals.wav` | render2-v14.m4a |
| ast_bed_r1 | a801c7743025 | `S/stems/render1/bed.wav` | render1-v13.m4a (efcdfc1f…) |
| ast_vocal_r1 | e9e43571f2e6 | `S/stems/render1/vocals.wav` | render1-v13.m4a |
| ast_sagan_raw | 81743a4b1551 | `S/stems/sagan/raw.wav` | not Suno (Pale Blue Dot) |
| ast_sagan_iso | 74c2c45a2a09 | `S/stems/sagan/isolated.wav` | not Suno |

**Provenance present: none machine-readable.** The chain "Suno id → m4a → demucs → stem wav" lives only in the `name` string
and in `scripts/build_oscine_project.py`. Note that the project's assets are **derived** stems. The Suno m4a itself is not an asset.

## 4. SEND / style file → render mapping

The mapping evidence comes from four sources: a difflib ratio between the embedded `©lyr` and each txt; mtimes (EDT = UTC−4) against the embedded `created`;
`git log` on the song dir; and the handoff `.cog/mem/episodic/handoffs/2026-09-23-oscine-borrowed-light-to-2-2.cog.md`.

| render (Suno id) | created EDT | lyrics file (match) | style file | confidence |
|---|---|---|---|---|
| render1-v13.m4a (efcdfc1f) | 09-22 17:54 | `borrowed-light-suno-lyrics-v13-SEND.txt` (**1.000**) | `borrowed-light-suno-style-v13-female.txt` (mtime 17:52). v13b-dynamics was written at 18:11 *in response to* this render: commit b28eaecaef "v13 render1 (flat…) + v13b style rewritten as a dynamic arc" | lyrics certain; style high |
| render2-v14.m4a (39802a94) | 09-22 19:31 | `borrowed-light-suno-lyrics-v14-SEND.txt` (**0.993**; the file was committed 19:26 in 19ae679e56, and later edits are small) | most likely `borrowed-light-suno-style-v13b-dynamics.txt` (the newest style, 18:14 in 180129a1ab). No record confirms it. | lyrics certain; style PROBABLE |
| ~/Downloads/Borrowed Light.m4a (cb742ddf) | 09-22 16:35 | closest `…-lyrics-v12-SEND.txt` (0.919). This predates the v12 file (17:21), so it is a pre-v12 draft. | style UNKNOWN. Probably the baritone box: commit 7401913a06 says "render1 verses were F#2, an octave under", and `stems/baritone-render1-vocals.wav` exists | lyrics ~v11/v12 draft; style UNKNOWN |
| tfr-run2.m4a (0cc5691c) / tfr-run3.m4a (dfafb0b1) | 09-21 00:02 / 09-20 23:49 | `standing-waves-suno-lyrics-v5-female.txt` (**1.000** both) | `standing-waves-suno-style-v5-female.txt` (23:05) | high |
| the-basin-holds.m4a (a82ba3a5) | 09-20 21:43 | `standing-waves-suno-lyrics.txt` (0.961; mtime 21:07) | UNKNOWN (the v4 style is 22:24, which is later) | lyrics high; style UNKNOWN |

Files with no render found: `borrowed-light-suno-style-v12.txt`, `standing-waves-suno-lyrics-v{2,4,6,7,10,10-SEND,11-SEND}.txt`,
`standing-waves-suno-style-v{4,10,11-baritone}.txt`. Their renders were never downloaded, or were downloaded and deleted.
The v10/v11 styles are the obvious candidates.

## 5. Proposed `source` block

**Placement:** `assets[id].source`, one optional object **per asset**. Suno identity belongs to the generation (the song),
not to a byte rendition. Variants keep describing bytes. The two relationships compose like this:

* An asset whose bytes **are** the Suno download gets `source.kind = "suno"`.
* A derived asset (a demucs stem, as all of Borrowed Light's are) gets `source.kind = "derived"` plus
  `source.from = {asset | sha256}`. It inherits the upstream `suno` block by reference and does not copy it.
* Per-variant `derivedFrom/derivedBy` stay as they are, for renditions *within* an asset (loudness-matched, trimmed).
  `source` answers "where did this asset come from outside Oscine".

**v2 compatibility:** the field is additive and optional, `FORMAT_VERSION` stays 2, and absent means unknown.
The loader already round-trips unknown asset keys (`name`/`ext` prove it). `createAsset` should default `source: null`.
Nothing reads it for playback, so old projects are unaffected. Put only the fields we can read locally or copy from a SEND file here.
Store long text (lyrics/style) as `{sha256, path}` references to files in the song dir, not inline, so the JSON stays small.
`lyricsEmbedded` records that the m4a carries them anyway.

Filled for Borrowed Light:
```json
"assets": {
  "ast_src_r2": {
    "id": "ast_src_r2", "kind": "audio", "duration": 231.647,
    "name": "Suno render 2 (v14)",
    "variants": { "default": { "sha256": "d64e4c8e8d57a9f7ed23275c4d9f159c1c6df5e867e611d0954f4769a772a0e8", "ext": "m4a" } },
    "source": {
      "kind": "suno",
      "id": "39802a94-8c2f-49b7-bb77-79bfe022b18d",
      "url": "https://suno.com/song/39802a94-8c2f-49b7-bb77-79bfe022b18d",
      "createdAt": "2026-09-22T23:31:44Z",
      "title": "UNKNOWN",
      "model": "UNKNOWN",
      "lyrics": { "path": "borrowed-light-suno-lyrics-v14-SEND.txt", "match": 0.993, "embedded": true },
      "style":  { "path": "borrowed-light-suno-style-v13b-dynamics.txt", "confidence": "probable" },
      "coverUrl": "UNKNOWN",
      "timedLyrics": "embedded mov_text (line-level)",
      "evidence": "m4a ©cmt 'made with suno; created=…; id=…'"
    }
  },
  "ast_bed_r2": {
    "id": "ast_bed_r2", "kind": "audio", "duration": 231.653515,
    "name": "Bed — render 2 (Suno v14, demucs no_vocals)",
    "variants": { "default": { "sha256": "1c5b15248af9cc1daa051ce02fdc48caa2793487545ff81b7e1da9340272b48e", "ext": "wav" } },
    "source": { "kind": "derived", "from": { "asset": "ast_src_r2" }, "by": "demucs htdemucs no_vocals (params UNKNOWN)" }
  }
}
```
For render 1 the values are: id `efcdfc1f-9c2d-4422-b1b5-f926811563fa`, createdAt `2026-09-22T21:54:12Z`, source sha `f8b9f4f9165c…`,
lyrics `…-v13-SEND.txt` (1.000), style `…-style-v13-female.txt` (high).

To populate, an importer reads `©cmt`, regexes `id=([0-9a-f-]{36})` and `created=(\S+);`, and sets `url` from the id.
The other fields come from API/page scraping (spike 002) or stay UNKNOWN. **Pitfall:** do not treat every `.mp3` in Downloads as Suno.
Suno mp3 exports were not observed here, and the c2pa mp3s are Google.

## Verdict

1. The Suno song ID and created timestamp are **already embedded** in every Suno m4a (`©cmt`), along with the full lyrics box (`©lyr`) and line-timed lyrics (mov_text).
2. Style prompt, model, title, cover and URL are **not** embedded. The URL can be derived from the id; style can only be recovered from our SEND files (by timestamp and commit order) or from Suno's servers.
3. Nothing in the workspace records any of our six Suno IDs. The audio files are the only source of truth.
4. `borrowed-light.oscine.json` has no provenance. Its 6 assets are sha256-addressed demucs stems whose Suno lineage survives only in `name` strings.
5. Minimal fix: an optional per-asset `source` block (`kind: suno | derived`). It is additive, v2-safe, and populated by a ~20-line `©cmt`/`©lyr` reader at import.
6. Six distinct Suno generations are on disk: efcdfc1f, 39802a94, cb742ddf, 0cc5691c, dfafb0b1, a82ba3a5. All Downloads mp3/mp4 "Field Remains/Basin Holds" files are Google/Lyria, not Suno.
