# Spike: Suno Studio UI & interaction pattern study

Status: DONE (2026-09-23). Primary evidence added: Chaz's logged-in screenshots (`evidence/chaz-screens/`, see "Chaz's three patterns"). Public materials only: no login, no cookies,
no bundle decompilation, no private endpoints. Evidence in `evidence/`, every
URL in `evidence/sources.txt`. Video citations are `URL @ mm:ss`.

## Questions
1. Layout map: regions (track list, timeline, clip, inspector, generation panel, mixer, transport), ASCII sketch.
2. Generative workflow: generate into region/track, prompt box placement, stem/section generation, variation takes, how alternatives are shown/picked, accept/replace/comp.
3. Track & stem model: song → stems, per-stem regenerate, MIDI extract, source/lineage representation.
4. Editing primitives: split, trim, move, loop, crossfade, snap, tempo/key, documented shortcuts.
5. Mixing & effects: EQ, FX, volume/pan, anything notable.
6. Lyrics & vocals: lyrics on the timeline, editing sung words.
7. Export & import: formats, what round-trips.
8. Friction & complaints (Reddit/YouTube comments) → Oscine opportunities.
9. PATTERNS FOR OSCINE: ranked adopt/adapt/avoid table.

## Findings
Citations: `H<id>` = `https://help.suno.com/en/articles/<id>`; videos are Suno's official channel, `YT:<id> @mm:ss` = `https://www.youtube.com/watch?v=<id>&t=<s>`; frames in `evidence/frames/<id>_00MMSS.jpg`. Transcripts in `evidence/subs/`, comments in `evidence/comments/`.

### Evidence log (docs pass, 2026-09-23)
Help-center articles fetched once each to `evidence/help/a_<id>.{html,txt}`; `H<id>` below = `https://help.suno.com/en/articles/<id>`.
- Studio 2.0 (Aug 2026): Premier-only, browser, Chrome recommended, ≥768 px. Old "context bar" became the **Chat Bar**; transport moved to ABOVE the timeline "to observe a more conventional display hierarchy" (H13670529).
- **Take lanes**: every generation yields 2 takes; one stacked set of take lanes per track, shown in the bottom dock's take-lanes view (key 3). Click lane = solo it in place (bright stripe, others dim); first take auto-auditions; thumbs up/down with a "What was off?" (Sound quality / Bad timing / Multiple stems → offers Stem Separator); commit (Enter) lifts take clips to the main track non-destructively; "Replace section" writes the ORIGINAL into a take lane (H13670913). On-clip footer: commit / dismiss preview / up-down arrows to cycle takes (H13670529). v1 allowed comping across takes then "Copy to Main Track" (H7940161).
- **Chat Bar** (beta): sparkle pill over the timeline + docked left chat panel, one conversation (toggle key 1); Enter summons, Esc dismisses in a cascade; context = focused track, selection, tempo; edits via "the same operations you would", Cmd+Z undoes them; answers carry buttons ("Audition Take 2" → flips to "Commit"; "Add to track"); ambiguity → poll with tappable options; history persists per project (H13670721).
- **Clip editor** (double-click → bottom dock "Arrangement Editor"): waveform/piano roll, ruler, warp + transient markers, loop flags; footer: Loop, Reverse, Stretch (warp), Quantize, Pitch stepper, Formant, Speed (.5x/2x), Volume; Info side panel tabs **Styles / Lyrics / Metadata** incl. "clip lineage"; Cmd+E split, 0 disables clips (H13670977).
- **Stems**: right-click clip → Split Stems → Auto (≤12 stems, 50 cr) / Split from Mix (one stem + complement) / Advanced (choose from ~100 instruments, Premier); stems land on new, time-aligned tracks, mute the original yourself (H13925185, H13670529, evidence of v1 12702337 in ../suno/002). Remove FX: dry version lands as a new take lane, auto-auditions (H13671105).
- **Cover vs Recreate** (v1.1): Cover always references the ORIGINAL source audio the clip was first generated from; Recreate uses the current audio (H9819905) → lineage is modelled.
- **Automation**: Shift+A; right-click knob → Automate; automated knob locks with green outline showing live value; drag segment to bend curve; arrow-nudge points (H13674305).
- **Effects**: Compressor (sidechain), EQ, Reverb, Convolution, Delay, Distortion, Gate; ordered chain, drag reorder, bypass, presets; chat-authored custom plugins saved to a personal library; no VST/AU (H13670785). v1 EQ: 6 bands, 6 filter shapes, graph + Freq/Gain/Res dials (H8935873).
- **Shortcuts** (full table H13680385): Space play; Cmd+E split; Cmd+D dup; Cmd+Shift+D duplicate time; Cmd+Shift+⌫ delete time; Shift+F fade; Shift+S/M solo/mute; Shift+T add track; Shift+R record; Shift+C metronome; Cmd+L loop; Alt+Space play from selection; 1 chat / 2 bottom panel / 3 lanes / 4 library; Shift+Tab swap bottom panels; Shift+1/2 grid density; Enter = Ask Studio AND promote take; ←/→ move selection, ↑/↓ focus track.
- **Tempo**: v1 "Follow Track" vs "Manual Tempo" (conforms regions); tempo-drift fix = set Manual BPM then export Multitrack (H8121281, H8363457). Time signature is grid/metronome only, "not yet sent to generative models" (H10625089).
- **Export**: dropdown top-right above timeline: Full Song / Selected Time Range / Multitrack; clip right-click → Download .WAV; stem → Get MIDI (10 cr); 32-bit/48 kHz WAV or MP3; import WAV/MP3/MIDI; no DAW sync (H13925249, H13670529, suno.com/studio FAQ).
- **Library dock** (right, key 4): audition by arrow keys, Song Details with Stems tab + "Insert all", drag to timeline or into chat as a prompt attachment; mini-player can play alongside the timeline (H13670849).

---

## 1. Layout map

Studio 2.0 is a conventional horizontal-timeline DAW with an AI chat surface floating over the timeline and one switchable bottom dock. From frame `35AzcYYucHs_000712.jpg` (YT:35AzcYYucHs @07:12) and H13670529:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ SUNO  [Project ▾ …] ↶ ↷      [|||| ● ▶ ⟲  ⇥ 00:00.000 001.1.1]   133 BPM 4/4  Export▾  Library │  ← top bar: transport CENTER, tempo/meter + Export + Library RIGHT
├──────────────┬───────────────────────────────────────────────────────────────┤
│ ☰        ›‹  │ 1  3  5  7  9 … (bar ruler, blue cycle flags)                 │
│ 1 MIDI Track │ [MIDI] Jul 31 12:27:37 │ [MIDI] …                             │
│  🔊 S A ▾    │                                                               │
│  ─fader─ pan │                                                               │
│ 3 Audio Track│ ███ Synth (orange = take being auditioned) ████████████████   │
│  🔊 S E ▾    │        [✓ commit] [✕ dismiss] [▲][▼ cycle takes]  ← on-clip footer
│ + Add New Track                          ┌──────────────────────────────────┐ │
│              │                          │ assistant reply + [Audition Take 1] [Commit Take 2] │
│              │                          │ [+] (Audio Track ×) ← context chip │ │
│              │                          │ Ask me to generate…     v5.5 ▾  ↑ │ │  ← Chat Bar (Enter)
│ Main 🔊 fader│                          └──────────────────────────────────┘ │
│              │ 00:00   00:15   00:30 …  (time ruler under lanes)             │
├──────────────┴───────────────────────────────────────────────────────────────┤
│ ((·)) ◐ ⋮ ≡   [ Bottom dock: Arrangement/Clip editor | Effects chain | Take lanes | Automation ]  [+ Add Track Effects]   ▸ ⌂ 🔍 ›‹ │
└──────────────────────────────────────────────────────────────────────────────┘
      left chat panel (key 1) docks at left;  Library dock (key 4) at right
```

| region | what it holds | evidence |
|---|---|---|
| Top bar | project name/menu, undo/redo; transport CENTER (metronome, record, play, loop, follow, time + bars:beats); BPM, meter, **Export** dropdown, **Library** RIGHT | frame 35Az…_000712; transport moved above the timeline in 2.0 "to observe a more conventional display hierarchy" (H13670529) |
| Track list (left) | number, name, speaker, S, arm button (A = MIDI, E/B = audio input), ▾ menu; mini fader + pan per header; **Main** master strip pinned at the bottom | frame 35Az…_000712; YT:N2HJUmWIbvc @01:09 (arm "A") |
| Timeline | bar ruler top, time ruler bottom; clips named by generation/prompt or timestamp (`[MIDI] Jul 31 12:27:37`) | frame 35Az…_000712 |
| Clip | waveform/notes; while a take auditions, a floating footer under it: ✓ commit, ✕ dismiss, ▲▼ cycle takes | frame 35Az…_000712; H13670529 |
| Bottom dock | ONE panel, swapped by keys: 2 = editor/effects, 3 = take lanes/automation, Shift+Tab swaps; pill switcher in the bottom center (`Wavetable · Reverb · Delay · Distortion · Compressor · EQ · +` in effects mode) | frame GZHp…_000535; H13680385; YT:GZHp3WFc9Ps @12:34 |
| Generation panel | the **Chat Bar**: sparkle pill over the timeline, Enter summons; context **chip** of the focused track/clip (removable ×), `+` to attach, model picker `v5.5 ▾`, send ↑; replies render ABOVE the bar with action buttons; can dock left as a panel (key 1) | frames 35Az…_000712, GZHp…_000535, ordered_sheet; H13670721 |
| Library | right dock (key 4): songs, audition by arrows, Song Details → Stems tab → "Insert all", drag to timeline or INTO chat as an attachment | H13670849; YT:35AzcYYucHs @17:57 |
| Mixer | **no separate mixer window**: volume/pan live in track headers; FX chain lives in the bottom dock. Users ask for busses/aux/groups (see §8) | frame 35Az…_000712; comments (§8) |

## 2. Generative workflow

- **Where you prompt**: always the Chat Bar. There is no per-region "generate" form. You make a time selection or put the playhead on a clip, focus a track, press Enter, and type ("add an ambient synth stem drone … accompany what's already on the timeline", YT:35AzcYYucHs @05:46). The focused track and selection are sent as context and shown as a chip (H13670721; frame 35Az…_000712). Right-click actions (Get Stems, Remove FX, Get MIDI) are the non-chat path (H13670529).
- **Generate-into-selection**: the reply names the span it filled ("Added 2 … takes across the full 72-beat range", frame 35Az…_000712). "Replace section" regenerates a selected range in place (H13670913).
- **Takes**: every generation yields **2 takes** (H13670913). The first auto-auditions *in place on the track* (orange clip). You pick in three places that mirror each other: (a) the on-clip footer ✓ ✕ ▲▼, (b) chat buttons "Audition Take 1 / Commit Take 2", where the button flips from Audition to Commit (H13670721), (c) the take-lanes view (key 3): stacked lanes under the track, click one to solo it in place, others dim (H13670913).
- **Accept / replace / comp**: Commit (Enter) promotes the take's clips to the main track **non-destructively**. "Replace section" writes the **original** into a take lane, so nothing is lost (H13670913). Comping across lanes (select part of take 1, part of take 2, add fades) is shown for recorded vocals (YT:G-3G0-fE8Eg @05:01–05:47) and was in v1 ("Copy to Main Track", H7940161). A user keeps both takes by committing one and pasting the other to a new track (YT:35AzcYYucHs @07:08), so the only way to keep an alternative is manual.
- **Feedback loop**: thumbs up/down per take; 👎 asks "What was off?" (Sound quality / Bad timing / Multiple stems), and "Multiple stems" offers the Stem Separator (H13670913).
- **Chat does edits too**: it renames tracks and adds EQ, compressor, reverb and delay on request (YT:35AzcYYucHs @11:45–12:08), converts MIDI to audio ("turn this MIDI clip into … a string quartet", YT:GZHp3WFc9Ps @04:12), writes MIDI (YT:N2HJUmWIbvc @05:42) and builds plugins (H13670785). Its edits are ordinary operations, so Cmd+Z undoes them. When the request is ambiguous it replies with a tappable poll (H13670721).

## 3. Track and stem model

- **Song → stems**: right-click clip → Get Stems: **Auto** (≤12), **Split from Mix** (one stem + complement), **Advanced** (type or choose instruments from ~100; the product team "always" uses it for fidelity, YT:GZHp3WFc9Ps @09:54–10:39) (H13925185; YT:GmZTKZWv1BA @01:12). The "Extract Stems and MIDI" modal lists the stems as colored waveforms with per-stem Insert, "Insert all", and Download (MP3/WAV/MIDI) (frame ordered_sheet, row 3; YT:GmZTKZWv1BA @01:35). Stems land on **new time-aligned tracks** and you mute the original yourself (H13670529).
- **Per-stem regenerate**: select a stem and ask the chat ("keep the lyrics the same but cover this into a new lead vocal performance", YT:GZHp3WFc9Ps @08:05), or use Replace section/Cover/Recreate. **Remove FX** gives 2 dry takes in take lanes (YT:GmZTKZWv1BA @06:00–06:45; H13671105).
- **MIDI extract**: "Get MIDI" on a selected audio span writes to a MIDI track (YT:N2HJUmWIbvc @04:11–04:33; 10 credits, H13670529). The reverse direction, MIDI to audio, goes through the chat (YT:N2HJUmWIbvc @03:26–03:49).
- **Lineage**: the clip Info panel has tabs **Styles / Lyrics / Metadata**, including "clip lineage" (H13670977). Cover always references the **original source audio the clip was first generated from**; Recreate uses the current audio (H9819905). Lineage exists in the data model but is shown only in an inspector tab. It is not drawn on the timeline.

## 4. Editing primitives

| primitive | Suno | evidence |
|---|---|---|
| split | Cmd+E at playhead | H13670977, H13680385 |
| trim / move | drag edges / body (standard) | frame ordered_sheet row 4 (resize cursor on clip) |
| duplicate | Cmd+D; Cmd+Shift+D duplicate time | H13680385 |
| delete time (ripple) | Cmd+Shift+⌫ | H13680385 |
| disable clip | 0 (dims) | H13670977 |
| loop | Cmd+L loop region; clip-editor loop flags | H13680385, H13670977 |
| fades | Shift+F; drag the fade icon from the clip end, or select part of a clip | YT:GmZTKZWv1BA @07:40 |
| crossfade | none documented as such; comping "smooths edges" with fades | YT:G-3G0-fE8Eg @05:47 |
| snap / grid | Shift+1/2 grid density; Shift+Q quantize notes | H13680385, H13670593 |
| warp / stretch | clip-editor warp + transient markers; Stretch, Pitch, Formant, Speed (.5x/2x), Reverse | H13670977 |
| tempo | drag BPM in the top bar (YT:35AzcYYucHs @01:58); library drops "automatically tempo adjusted" (@17:57); v1 Follow-Track vs Manual tempo | H8121281, H8363457 |
| key | Key/Scale assist in the piano roll; meter is grid-only, "not yet sent to generative models" | H13670977, H10625089 |
| keyboard nav | ←/→ move selection, Shift+←/→ extend, ↑/↓ focus track, Enter = Ask Studio AND Promote take, Esc cascade-dismisses | H13680385 |

## 5. Mixing and effects

- Insert chain per track in the bottom dock: Compressor (with **sidechain**, YT:GZHp3WFc9Ps @14:05–14:27), EQ (graph + nodes; v1 had 6 bands and 6 shapes, H8935873), Reverb, Convolution, Delay, Distortion, Gate. Chains can be reordered by drag, bypassed, and saved as presets. No VST/AU (H13670785; YT:59rEQZmGF24).
- **Chat-authored plugins**: describe an effect and Studio builds one ("Rotor Glow … Saved to My Plugins", with an Export JSON option). It behaves like the factory effects (presets, automation, MIDI Learn) (frame ordered_sheet row 3; H13670529; YT:lGvyrEkZ6ZU).
- Automation: Shift+A, or right-click a knob → Automate / MIDI Learn (frame ordered_sheet, last tile). An automated knob locks with a green outline that shows the live value (H13674305).
- Missing: busses, aux sends, groups, a mixer view (user requests in §8).

## 6. Lyrics and vocals

- Lyrics are **clip metadata** (Info → Lyrics tab, H13670977). I found no lyrics lane, word timeline, or word-level editing in any doc or video.
- You edit sung words by regenerating: select a span, then Replace section, or ask the chat to "keep the lyrics the same but cover this into a new lead vocal" (YT:GZHp3WFc9Ps @08:05). Comping recorded takes is word-granular only by hand (YT:G-3G0-fE8Eg @05:47 "take that word gravity from take one").
- Vocal recording: latency calibration, count-in/pre-roll, up to 2 inputs (YT:G-3G0-fE8Eg @01:40, @04:15; YT:35AzcYYucHs @08:06). No pitch correction, which is the top vocal request (§8).

## 7. Export and import

- Export dropdown: **Full Song / Selected Time Range / Multitrack** (stems); clip right-click → Download .WAV; stems modal → MP3/WAV/MIDI; 32-bit/48 kHz WAV or MP3 (H13925249, H13670529). "Export full song" saves to the Suno **library**, not disk (YT:35AzcYYucHs @16:48).
- Import: WAV/MP3/MIDI; drag from library. No project-file export and no DAW sync (suno.com/studio FAQ in `evidence/suno.com_studio.html`; H13670529). Plugins export as JSON (frame ordered_sheet).
- What round-trips: audio and MIDI. **The project itself (arrangement, takes, lineage, automation, lyrics) does not leave Suno.** Downloads are capped per month (comments, §8).

## 8. Friction and complaints (opportunities)

Sources: top-liked comments on the official videos (`evidence/comments/*.info.json`). The Reddit search JSON fetch returned an HTML block page, so there is no Reddit evidence (`evidence/reddit/search_studio20.json`).

| complaint | source | Oscine opportunity |
|---|---|---|
| Download caps (20–60/mo) and "why pay if the music can't be ours" | YT:GmZTKZWv1BA comments (13 likes), YT:GZHp3WFc9Ps comments | ownership is Oscine's thesis (north-star: "can't re-export it from a DAW") |
| Credits drain on iteration ("4000 credits for two guitar stems") | YT:GZHp3WFc9Ps top comment | local ear-scored iteration before spending generation calls |
| Replacing phrases in a vocal stem with your own recording: "the assistant … made things incredibly complicated", 2 hours | YT:GZHp3WFc9Ps comments | word-addressed splice (Oscine already has word timings) |
| No auto-tune / pitch correction | YT:GZHp3WFc9Ps, YT:35AzcYYucHs comments | the ear already measures pitch |
| Quality drops after ~3 min; can't set duration; can't set key per section | YT:GmZTKZWv1BA, YT:35AzcYYucHs comments | section-scoped generation over markers |
| No busses, aux, groups, or full mixer | YT:35AzcYYucHs comments ("Aux tracks, group tracks, bus inserts") | schema v3 busses (north-star) |
| Mute parts of a track (clip mute) | YT:35AzcYYucHs comment | Suno has `0` = disable; Oscine lacks it (not in CHANGELOG) |
| Generated names don't follow the user's names | YT:35AzcYYucHs comment | name clips from the spec/stage |
| Studio 2 "moved away from simplicity"; v1 cover workflow harder | YT:GZHp3WFc9Ps comment | keep a direct path next to the chat |

## 9. PATTERNS FOR OSCINE

Ranked by leverage for the north-star pipeline (generation API, lane regenerate, ear-verified).

| # | pattern | verdict | Suno evidence | Oscine today | concrete change |
|---|---|---|---|---|---|
| 1 | **Takes as lanes under a track, audition in place, commit non-destructively; replacement keeps the original as a take** | ADOPT | H13670913; frame 35Az…_000712 | `asset.variants` + `asset.preferred` with a Prefer button in the inspector (CHANGELOG 2.3.0; `src/ui/sourcepanel.js:88`), so alternatives exist per **asset**, not per **time span** | add a `takes` group on a lane span: `{span, takes:[clipId…], active}`; render collapsed under the lane; click = solo in place; Enter = commit (one undo). `oscine_generate` writes N takes, never overwrites. Reuse variants for same-span renders of one asset |
| 2 | **Generate-into-selection with the selection as a visible context chip** | ADOPT | H13670721; frames 35Az…_000712, GZHp…_000535 | range select exists (the ear listens on it, north-star); no generate command | `generate({stage, lane, range, spec})` defaults `range` and `lane` from the UI selection; the MCP call echoes the chip (lane + bars) so Claude and Chaz see the same target |
| 3 | **Commit/dismiss/cycle footer on the clip plus mirrored buttons in the assistant reply** | ADAPT | frame 35Az…_000712; H13670721 | none | the footer appears on any pending take group; Claude's reply links resolve to the same store action (`take.commit`), which fits 2.3's "UI and Claude share store actions" |
| 4 | **Lineage as data (Cover references the original source, Recreate the current audio)** | ADAPT, make it visible | H9819905; H13670977 (lineage only in an Info tab) | `asset.source` = Suno song or `derived` (CHANGELOG 2.3.0; `docs/sources.md`) | draw lineage: stems carry `derivedFrom` (already in `src/core/schema.js:49`); show a thin "from: <song> · demucs" tag on stem clips; in the take group, show which spec/prompt produced each take; regenerate always has an explicit "against original / against current" choice |
| 5 | **Stem split lands on new aligned lanes with per-stem Insert, and the source stays** | ADOPT | H13925185; frame ordered_sheet r3; YT:GmZTKZWv1BA @01:35 | Borrowed Light was split by hand with demucs (north-star) | `stems` command: pick stems (the Advanced mode shows the named choice wins on quality) → new lanes grouped under the source; auto-mute the source (Suno leaves this manual, a small papercut) |
| 6 | **One bottom dock, number keys swap panes (1 chat, 2 editor/FX, 3 lanes/automation, 4 library)** | ADAPT | H13680385; YT:GZHp3WFc9Ps @12:34 | resizable mixer panel + inspectors + lyrics bar (CHANGELOG 2.1.0) | add keymap actions `pane.editor/lanes/library`; keep the mixer (Suno users ask for one) |
| 7 | **Thumbs down with reason chips on a take** | ADAPT | H13670913 | the ear: `compareSpans` (north-star) | replace the vibe rating with the ear's diff: each take shows spec-vs-measured deltas; 👎 reasons map to spec axes (timing → pace, "multiple stems" → split). This is the practice-loop eval data |
| 8 | **Chat does ordinary edits that undo like any other edit** | ADOPT (already) | H13670721 | MCP commands through store actions, one undo per gesture (CHANGELOG 2.2.0/2.3.0) | nothing new; keep parity as generation lands |
| 9 | **Remove FX → dry takes** | ADAPT | H13671105; YT:GmZTKZWv1BA @06:00 | none | later: a `derive` stage writes derived variants into a take group |
| 10 | **Lyrics as clip metadata only; word edits by regenerating** | AVOID | H13670977; comment on 2-hour phrase replacement | lyrics bar + word timings mapped through placements, SRT/VTT/JSON (CHANGELOG 2.1.0) | go further: "replace these words" = select words on the lyrics bar → range + lane → generate takes for that span only |
| 11 | **Project locked in, export to library, download caps** | AVOID | YT:35AzcYYucHs @16:48; comments | `.oscine.json` + bounce (north-star) | keep takes/lineage in the project file; export must carry take groups |
| 12 | **Chat as the only generation entry** | AVOID | 2.0 "moved far from simplicity" comment | MCP + UI | every chat-reachable generation also gets a direct gesture (right-click lane span → Generate…) |

**How the AI panel coexists with the timeline (Suno's answer, and ours):** Suno floats a small bar over the timeline that can dock left, takes context from the selection, and returns results as **pending takes on the timeline** with buttons. The timeline stays the source of truth and the chat never holds audio. Oscine's version: Claude is external over MCP, so the "chip" is the selection state it reads, and pending take groups are the shared visible state both hands act on.

## Chaz's three patterns (primary evidence: his logged-in session)

Evidence: `evidence/chaz-screens/01..05-*.png` (Chaz's own Studio 2.0 session, suno.com/studio, "Untitled Project", 120 BPM 4/4), each read by vision. Cited as `S01`…`S05`. The official playlist is in `evidence/playlist.txt`. Also: what else the screens show.

- **Add track menu** (S03, left gutter above "+ Add new track"): `Audio A` / `MIDI M` / `Upload U`, each a colored icon plus a one-letter accelerator. Shift+T opens it, then A/M chooses the type (YT:35AzcYYucHs @00:47).
- **Learning Center** (S04, a modal from the 💡 **Learn** pill at bottom right, with "Search topics"): GUIDES 1–7: *Generate music with the assistant · Record your voice or an instrument · Select part of the timeline · Move, split, and trim clips · Loop a section while you work · Audition and commit takes · Split a clip into stems*. Guide 1 reads: "The assistant generates parts right into your project. **Select a span of time** on the track you want filled, then describe the part — "add a bass line under my loop", "a 4-bar drum loop". New takes audition in place: step through them and keep the one you like. Asking for a complete new song works too." It ends with a `Toggle chat [1]` hint and a **"Show me: Take lanes"** button. The guide *drives the UI*; it doesn't just describe it.
- **Keyboard** (S05, a bottom-center docked panel titled "Keyboard" with pop-out/expand/collapse): QWERTY-mapped piano (W E T Y U O P black, A…; white), ◂ ▸ range arrows, steppers `− 4 +` (octave) and `− ±2 +` (transpose), an `● Arpeggiator` toggle. Cmd+K toggles it (H13670529). Chord mode is documented (H13670593) but not visible in S05.
- **Plugins** (relevant to Vroku's VST question): Studio 2.0 has **seven factory effects plus chat-authored "My Plugins"** (YT:lGvyrEkZ6ZU @00:51, @02:21: "it'll always live in … my plugins"; YT:GZHp3WFc9Ps @16:06–19:11 "Rotor Glow"). **No VST/AU/AAX hosting** ("Suno Studio does not support VST, AU or AAX plugins", suno.com/studio FAQ; H13670785). Plugins can't leave Suno. They plan sharing/trading "someday" (YT:lGvyrEkZ6ZU @05:21), and a commenter wants to download them for other DAWs (GZHp3WFc9Ps comments, 5 likes). So "Suno has plugins" means an in-house effect format with an LLM authoring it, not a plugin host.

### A. The Library panel (right dock)

What it is (S01, S03, S04, S05; H13670849; YT:35AzcYYucHs @17:57–18:40, frames `35AzcYYucHs_001805.jpg`, `_001840.jpg`):
- **Hub view** (S03): header "Library" + search; a 2×2 grid of colored tiles **All Songs** (blue) · **Liked songs** (purple) · **Stems** (green) · **Uploads** (pink); then **Workspaces** (`+ New workspace`, `My Workspace · 52 songs`); then **Studio Projects** (`Untitled Project · 2d, 17h ago`). Projects and song collections live in one navigator.
- **Drill-in list** (S01/S02 "‹ Liked songs"; S04/S05 "‹ My Workspace"): back arrow + title + search; a filter row `Filter (1) ▾` · `New ▾` (sort) · 👍 (liked toggle) · **In Project** · **Stems**; songs grouped under **date headers** (Yesterday / Sep 21, 2026 / Sep 20, 2026), each collapsible.
- **Song card**: thumbnail (a ⏸ overlay when playing), title, one line of **style text** ("Electronic ballad, C# minor at 103 BPM with…", "Electronic ballad; airy female vocalist, close-mic'd…"), and a **model/task badge**: `V6-MINI COVER` vs plain `V6-MINI` (S01), or `Alpha / Cover / 133 BPM`, `v5.5 / Cover / 132 BPM` in the video (frame `35AzcYYucHs_001805.jpg`). The badge is the lineage line: model, task (cover vs original), and tempo. Eight versions of "The Field Remains" show as siblings and are told apart only by style text and thumbnail (S04). There is no grouping by parent song.
- **Mini-player** pinned at the bottom of the dock: thumbnail, title, style line, 👍 👎 ⋯, ⏸, a **section-colored waveform** (S01: nine flush, rounded segments: green, magenta, maroon, green, orange, magenta, orange, yellow, magenta; a white playhead line; `0:35 … 3:48`), which "can play alongside the main timeline, so you can preview how a clip sits against your project before committing" (H13670849).
- **Audition by keyboard**: ↓/↑ audition next/previous, Enter replays (H13680385 "Library Panel").
- **Drag and drop**: pull a song onto the timeline to add it to an audio track, "automatically tempo adjusted to fit the grid" (YT:35AzcYYucHs @17:57), or **drop it into the chat to attach it to a prompt** (H13670849). Song Details (double-click) → Stems tab → per-stem Insert / "Insert all" → stems arrive time-aligned (YT:35AzcYYucHs @19:32; frame `_001950.jpg` shows lanes "Bad Moment 2 (Bass)/(Lead Vocal)/(Drum Kit)/(Guitar)/(Piano)"). Not captured: I found no frame of a drag ghost mid-flight from the library. The drag is documented in H13670849 and the transcript only.

### B. The central assistant text entry (BETA)

What it is (S01, S02, S03, S05; H13670721; frames `35AzcYYucHs_000712.jpg`, `GmZTKZWv1BA_000615.jpg`):
- **Placement**: floats bottom-center over the timeline, above the dock, with a pink **BETA** tag. It is a panel with two rows. Row 1: `+` (attach), then **context chips**, then a split/dock toggle ▯▯ and ✕. Row 2: the prompt, a **Tab** hint, a **model picker** `v6-mini ▾` (v5.5 in the July videos), and send ↑.
- **Context chips = the selection, made visible.** With nothing selected: `〰 New track ×` (S01). With a bar range dragged on the empty timeline (blue flags on the ruler, gray box): `〰 6 bars · New tra… ×` (S02, S05). With a clip/track focused: `Audio Track ×`, `Guitar outro ×`, `Main Midi pad ×` (frames `35Az…_000712`, `GmZT…_000615`, `GZHp…_001258`). The chip states *where* the result will land (span length plus target track) before you type.
- **The placeholder changes with state**: empty = "Select a spot on the timeline and ask me to add a part" (S01, S03); with a range = "Generate an 8-bar drum loop and drop it here" (S02, S05); with a track = "Add a warm reverb to this track" / "Make a variation of this MIDI…" (frames `35Az…_001815`, `GZHp…_001258`). The placeholder is a context-sensitive example. It teaches what's possible from where you are.
- **Tab**: shown as a key hint in the empty prompt (S01). I infer it accepts the suggested example (the video: "you can even see that it's suggesting it right here", YT:35AzcYYucHs @05:46), but I haven't verified this.
- **Split/dock toggle**: moves the conversation to a full-height left panel (key **1**), so there is "one conversation, two surfaces" (H13670721; YT:GZHp3WFc9Ps @17:13).
- **Results come back as takes, in place**: "Added 2 lush ambient synth drone takes across the full 72-beat range — the first is auditioning now. Swap to the second take if you'd like a different texture." with buttons **[Audition Take 1] [Commit Take 2]**. The clip carries a footer ✓ ✕ ▲ ▼ (frame `35Az…_000712`, YT:35AzcYYucHs @07:12). The Learning Center guide calls this "step through them and keep the one you like" (S04). Take lanes are the fuller view (key 3; H13670913).
- **Scope**: it reads the project (tracks, selection, tempo), edits with the same undoable operations as the user, generates audio/MIDI, builds plugins, navigates panels, and asks polls when a request is ambiguous (H13670721).

### C. Sections: colored song sections and hover descriptions

What the evidence shows:
- **Section-colored waveform**: the library mini-player draws the song as flush colored segments, each with its own waveform (S01: nine; S04/S05 the same palette for another take: green, pink, orange, purple, yellow). The segment count and colors differ per song, and colors repeat (for example, magenta three times in S01), which fits **one color per section type** (verse/chorus/…) rather than one per segment. I infer that; it isn't confirmed.
- **Hover shows that section's description from the prompt**: this is **reported by Chaz** (a logged-in user) and consistent with the data model. Suno's lyrics field carries section metatags (`[Verse 1] [Chorus] [Verse 2] [Bridge] [Chorus] [Outro]` in `../suno/002-public-surface/evidence/song_538ab4ae-….clip.json`, `metadata.prompt`), and Oscine's own m4a reader already sees them as ~0-length tx3g cues (`src/core/suno.js:126`, "metatag lines ([Verse], [Intro ...]) ride on ~zero-length cues: drop them"). **Not captured**: none of S01–S05 and none of my 30+ video frames (including `frames/ordered_sheet.jpg`, `sheetC.jpg`) shows the hover tooltip open, so I have no verbatim tooltip text. **To close this gap**, Chaz can take one screenshot of the mini-player with the hover open.
- **Not on the Studio timeline**: in Studio the arrangement shows clips and a bar ruler with loop flags. I saw no section strip on the timeline in any frame. Sections are a *library/player* affordance, not an arrangement object. That is a gap Oscine can fill, because Oscine's markers ARE on the timeline.

### PATTERNS for A/B/C (Oscine specifics)

| # | pattern | verdict | Suno evidence | Oscine today | concrete change |
|---|---|---|---|---|---|
| A1 | **Library dock: hub (All/Liked/Stems/Uploads/Workspaces/Projects) → filtered, date-grouped song list** | ADOPT | S03, S01; H13670849 | Sources bin = assets already *in the project* (`src/ui/assetbin.js`); the Suno library is data only: `.oscine/suno-library.json` via the `suno` command (`library/scan/import/fetch/link`, `src/api/commands.js:484`; CHANGELOG 2.3.0) | add a **Library** tab to the sidebar next to Sources, listing `suno action:library` entries grouped by `created` date, with filters `In project` (asset.source.id matches) / `Has local file` / `Liked`; one-line style text + badge `model · task` (fields already stored: model, task, style) |
| A2 | **Drag a library song onto a lane** | ADOPT | H13670849; YT:35AzcYYucHs @17:57 | assetbin drag-to-place exists for project assets (`assetbin.js:143` onDragStart → `tl.dropHint`) | the same gesture from Library rows: on drop, if the song has a local file (scan found it), import it as an asset (sha256, `asset.source` = the Suno record), then `clip place` at the drop point, all as one undo. No local file → the row is greyed with "no audio on disk" (Oscine never fetches audio) |
| A3 | **Card badge = lineage (model + task + BPM)** | ADOPT | S01 `V6-MINI COVER`; frame `35Az…_001805` `Alpha / Cover / 133 BPM` | `asset.source` has model/task/created (docs/sources.md) | show the badge in both Library and Sources rows; **improve on Suno** by grouping siblings (8 × "The Field Remains", S04) under their parent song/cover chain instead of a flat list |
| A4 | **Mini-player that plays alongside the timeline** | ADAPT | H13670849; S01 | click a source row = audition? (not in CHANGELOG) | preview bus: ↑/↓ audition Library rows through a separate gain node that doesn't touch the arrangement's transport; Enter = replay (Suno's exact keys) |
| B1 | **Assistant bar fed by selection chips** | ADOPT | S01/S02/S05; frames `35Az…_000712`, `GmZT…_000615` | Claude is external over MCP; the store holds selection (range, lane, clip) but no command bar; MCP has 11 catalog commands | a **command bar** (Enter summons, Esc dismisses, a keymap action). Its chips come straight from store selection: `6 bars · Vocal lane`, `clip "Verse 2 vox"`, `range 1:12–1:31`. Submit posts `{text, context:{lane, range, clip, playhead, markers in range}}` to the sidebar, and Claude reads it through a new MCP resource/tool `selection get` (or the prompt arrives with the context attached). The chip text and the MCP payload are the same object, so Chaz and Claude see one target |
| B2 | **Context-sensitive placeholder as teaching** | ADOPT | S01 vs S02 placeholders | none | the placeholder is generated from the selection kind: nothing → "Select a span, then ask for a part"; range on a lane → "Regenerate these 6 bars / measure this span"; words selected → "Replace these words…" |
| B3 | **Model picker in the bar** | ADAPT | S01 `v6-mini ▾` | n/a (pipeline stages) | the picker selects the *stage/engine* (Suno cover, MusicGen, local SVS, "just measure (ear)") rather than a model version |
| B4 | **Results as pending takes, stepped with ▲▼, kept with ✓** | ADOPT | S04 guide text; frame `35Az…_000712` | variants per asset (2.3.0) | see pattern #1 above; the command bar's reply carries the same Audition/Commit actions as the clip footer |
| B5 | **Learning Center guides that drive the UI ("Show me: Take lanes")** | ADAPT | S04 | README/docs | later: a `?` palette whose entries run keymap actions and highlight the target region |
| C1 | **Song shown as colored sections** | ADOPT, put it on the TIMELINE | S01 mini-player | markers + sections strip under the ruler, click to jump, ⇧-click to select (CHANGELOG 2.1.0); `[Verse]` tags dropped at import (`src/core/suno.js:126`) | on Suno import, **turn the metatag cues into markers** instead of dropping them: `[Verse 1]` at its cue time → marker "Verse 1". Color the section strip by *type* (all Verses one color, Choruses another), matching Suno's repeated colors; also tint the Sources/Library mini-waveform the same way |
| C2 | **Hover a section → its description from the prompt** | ADOPT | Chaz's report (hover not captured on screen) | markers carry `{id,t,name}` only | extend the marker to `{id,t,name,desc?,kind?}`. `desc` = the style/section text from what Oscine sent (`asset.source.sent` style/lyrics files) or the lyric lines inside that section (from `asset.words`). Hover on the section strip shows `name · desc · first lyric line`, and the Range inspector for that section shows the ear's numbers next to the *intent* text. That turns the hover into a spec-vs-measured card, which is the north-star practice loop |
| C3 | **Sections only in the player, not the arrangement** | AVOID | S01–S05: no section strip on the Studio timeline | Oscine already has them on the timeline | keep one fact in one place: sections live as markers; the library preview *reads* them |

## Summary

1. Studio 2.0 is a standard left-headers/center-timeline DAW: transport top-center, one swappable bottom dock, and a right-side **Library** (All/Liked/Stems/Uploads/Workspaces/Projects, date-grouped cards with `V6-MINI COVER` badges, drag onto a lane or into the chat) (S01–S05).
2. All generation goes through a floating BETA assistant bar; the selection becomes a chip (`6 bars · New track`), the placeholder changes with context, and there is a model picker (`v6-mini`) (S01/S02).
3. Every generation yields 2 takes that audition in place; commit (Enter) is non-destructive.
4. Alternatives appear three ways at once: an on-clip ✓✕▲▼ footer, chat Audition/Commit buttons, and stacked take lanes.
5. Replace section saves the original as a take, so the original is never lost.
6. Stems come from Auto, Split-from-Mix or Advanced split and land on new aligned lanes; Get MIDI goes audio → MIDI; chat goes MIDI → audio.
7. Lineage is modeled (Cover uses the original source) but only shown in an Info tab and a card badge; songs appear as colored sections in the mini-player only, with a section hover that Chaz reported but I didn't capture.
8. Lyrics are clip metadata. There is no word timeline, and sung words are changed by regenerating.
9. Exports are audio/MIDI/stems only. The project, takes and lineage do not leave, and downloads are capped.
10. Users complain about ownership, credit burn, phrase replacement, the lack of pitch correction and busses, and the chat-first complexity.

**Verdict:** Adopt Suno's take-group mechanics (2 takes, audition in place, non-destructive commit, original kept as a take) and generate-into-selection. Put them on Oscine's existing variants and store-action base. Make lineage visible on the timeline, and score takes with the ear instead of thumbs. Avoid Suno's closed project and lyrics-as-metadata. Oscine's word timings are the opening Suno leaves: "replace these words" as a span-scoped generation.

**Verdict, Chaz's three (A/B/C):** build them in this order. **C1** (turn Suno `[Verse]` cues into markers instead of dropping them in `src/core/suno.js`, and color the strip by section type) is a small change that makes every imported song navigable. **B1** (Enter command bar with selection chips = the same context object Claude reads over MCP) is the seam that lets generate-into-selection work with Claude as the assistant. **A1/A2** (a Library tab over `.oscine/suno-library.json`, drag a song with a local file onto a lane as one undo) closes the loop from Suno to lane. Improve on Suno in two places: sections belong on the timeline, not only in the player, and sibling covers group under their parent. Plugins: Suno builds its own effects with an LLM and hosts no VSTs, so Oscine's effects registry (`defineEffect`) is the same design choice.
