# Spike: local audio models + ComfyUI audio, for Oscine

Date: 2026-09-23. Brief: [BRIEF.md](BRIEF.md). Evidence lives in `evidence/`: repo metadata snapshot
(`github-repos.tsv`), READMEs and model cards as fetched (`readmes/`, `cards/`), ComfyUI core node source
and official templates (`comfy/`), a registry dump of audio node packs (`comfy/registry-audio-packs.tsv`),
and smoke-test outputs (`smoke-*`). Every claim below cites one of those files or a URL. Weights and
binaries are gitignored (`weights/`, `bin/`). `scripts/` rebuilds everything.

Hardware: darkstar = M4 Pro, 48 GB unified (Metal/MPS/MLX). Eclipse = RX 7900 XTX 24 GB (ROCm/HIP,
Vulkan), described from docs only; I didn't touch it.

## 12-line report

1. **The biggest finding is audio.cpp** (0xShug0/audio.cpp, 2.9k★, v0.8.1 2026-09-17). It's llama.cpp for audio: one C++/ggml binary plus GGUFs, with Metal, HIP/ROCm, Vulkan and CUDA, and an HTTP server. It already runs ACE-Step 1.5 (every edit route), Stable Audio 3, YuE2, MiniMax Music 3, HeartMuLa, HTDemucs, BS/Mel-RoFormer, Seed-VC, RVC, AudioSR, SheetSage2, Qwen3-ASR and ForcedAligner (`readmes/0xShug0_audio.cpp.md`, `evidence/audiocpp-families.md`).
2. **Smoke test passed on darkstar:** HTDemucs (Q8 GGUF, SHA verified) split a 30 s excerpt of *The Field Remains* into 4 stems in 21.1–21.5 s warm (1.42× realtime), with 36.2 dB reconstruction SNR and a 588 MB peak footprint (`evidence/smoke-htdemucs-*`). There are no Python wheels or torch installs to break. More in the log below.
3. **Full song with vocals, best open weights:** YuE2-3B (2026-09-09) tops WildSongBench, ahead of Suno v5 on SongBench Avg. But its weights are CC BY-NC with a creator carve-out, and the official path is Linux + NVIDIA 24 GB. MiniMax Music 3 (8B + 0.6B + 2.4B flow, Apache-listed on the Comfy repack, community license upstream) runs at 1.35× realtime in 9.8 GB at Q4 on a 5090.
4. **Best fit for Oscine: ACE-Step 1.5 (MIT).** It's the only open model with the whole Suno-Studio verb set: text2music, cover, **repaint** (replace a span), **lego** (add a layer/track to existing audio), **extract** (pull a track), **complete** (extend), plus LRC timestamps and LoRA. It runs on Mac (MLX), ROCm and CUDA. Quality sits below YuE2/MiniMax (6.01 vs 6.73 SongBench) but the phoneme error rate is good (7.5%).
5. **Instrumental, loops and SFX: Stable Audio 3** (2026-05). Small-Music and Small-SFX are 433M, 120 s, CPU/CoreML-capable. Medium is 1.4B, 380 s. All have inpaint/continuation and audio-to-audio, and LoRA trains on Mac via MLX. The license is free under $1M annual revenue. MusicGen/MAGNeT are CC BY-NC and outclassed, so retire them.
6. **Stems:** Mel-/BS-RoFormer beat HTDemucs on vocals (the community consensus; UVR/audio-separator model lists); HTDemucs is the 4-stem workhorse. Both run in audio.cpp; `python-audio-separator` is the Python fallback (MPS needs torch ≥ 2.13).
7. **Understanding:** keep whisper for words. Add **Qwen3-ForcedAligner-0.6B** (lyrics → exact word times, ≤5 min) and **beat_this** (MIT beats/downbeats) + **All-In-One** (sections, MIT). Music captioning: Qwen3-Omni (Apache) or Music Flamingo (non-commercial). ACE-Step's LM also extracts BPM/key/caption.
8. **Manipulation:** Seed-VC (zero-shot *singing* VC, GPL-3.0, Mac-supported) is the path to "his voice on the vocal". RVC (MIT) is for a trained voice. AudioSR and Matchering (GPL) handle upscaling and reference mastering. basic-pitch (Apache, CoreML) does audio→MIDI. SheetSage2 does audio→ABC score (NC).
9. **ComfyUI is serious about audio now.** Core has native nodes for ACE-Step 1/1.5, Stable Audio 1/3, **YuE2**, **MiniMax Music 3**, SheetSage2 and LTX-AV audio, plus trim/concat/merge/EQ/record. There are 29 official audio templates, including ACE m2m editing (whole-clip audio-to-audio via VAEEncode + denoise, *not* a windowed repaint), YuE2 cover and RoFormer separation (`comfy/`).
10. **ComfyUI gaps:** no core stem node (separation is a custom pack), no timeline or selection concept, and MPS bugs live in the tracker (#16433, #16458). Its REST/WS queue (`POST /prompt`, `/history`, `/view`) works fine as a headless backend, but it's a 2–5 GB Python install to keep alive for things audio.cpp does in one binary.
11. **Verdict:** Oscine's generation backend should be **an audio.cpp sidecar** (spawned like whisper is today, or `audiocpp_server` on a port), with ACE-Step 1.5 + Stable Audio 3 + RoFormer as the default stack. Keep ComfyUI as an *optional* adapter for YuE2 and graph experiments, and run it on Eclipse, not darkstar.
12. **Can't do locally yet:** Suno-grade vocals in *Chaz's* voice end to end (that needs VC as a second pass), stem-exact generation (models output a mix; "stems" means separating afterwards, except ACE lego/extract), and anything YuE2 on Mac without audio.cpp's port. Commercial use of the top-quality weights (YuE2, SheetSage2, Music Flamingo) is non-commercial.

## Ranked stack (one model per job)

| Job | Pick | Why | License | darkstar | Eclipse 7900 XTX | Plug-in |
|---|---|---|---|---|---|---|
| Song with vocals, editable | **ACE-Step 1.5** turbo (2B) → XL-sft (4B) | Only open model with repaint/lego/extract/complete/cover; 10 s–10 min; LRC out | MIT (`hf/ACE-Step_Ace-Step1.5.json`) | MLX launcher (README); audio.cpp GGUF 6.2 GB Q8 | ROCm launch scripts; XL fits ≥20 GB w/o offload (README VRAM table) | audio.cpp `--family ace_step --task-route …` |
| Song, max quality | **YuE2-3B** | SongBench 6.73 / 6.96 (bo8), > Suno v5 on avg (`readmes/…YuE.md` table) | CC BY-NC 4.0 + creator permission (personal monetized use OK) | audio.cpp 0.8.0 port (BF16/Q8/Q4); official = NVIDIA 24 GB | ComfyUI core fixed AMD issues (#16293) | ComfyUI template or audio.cpp |
| Song, alt | MiniMax Music 3 | 5 min, 32 kHz stereo, Q4 9.8 GB, 1.35× RT on 5090 (`cards/audio-cpp_MiniMax-Music3-GGUF.md`) | MiniMax community (commercial OK < $20M rev, must display name; `cards/minimax-music3-LICENSE.txt`) | mlx-audio + audio.cpp | ComfyUI core | audio.cpp |
| Instrumental / loop / bed | **Stable Audio 3 Small-Music** (433M) / Medium (1.4B) | inpaint + continuation + a2a; Mac CoreML 30 s in 0.63 s (`readmes/Stability-AI_stable-audio-3.md`) | Stability Community (< $1M rev free) | CPU/CoreML/MLX | Medium: CUDA+FlashAttn officially; audio.cpp Vulkan/HIP | audio.cpp `--family stable_audio` |
| SFX | Stable Audio 3 Small-SFX | same as above | same | same | same | audio.cpp |
| Stems (4) | **HTDemucs** | measured here: 1.42× RT, 36 dB recon | MIT | ✅ measured | audio.cpp HIP/Vulkan | audio.cpp `--task sep` |
| Vocal/inst split | **Mel-Band RoFormer** / BS-RoFormer | higher vocal SDR (ZFTurbo/UVR model lists) | MIT code; weights vary | audio.cpp GGUF | same | audio.cpp |
| Words + timings | whisper (already in sidecar) → **Qwen3-ForcedAligner-0.6B** when lyrics known | aligns known text instead of guessing; kills pad-tail hallucinations | Apache-2.0 | mlx-audio / audio.cpp | audio.cpp | swap in `/transcribe` |
| Beats / downbeats | **beat_this** | SOTA general beat tracker, MIT weights | MIT | torch CPU fine | – | Python sidecar |
| Sections | **All-In-One** (allin1) | beats+downbeats+segment labels in one pass; macOS auto-installs NATTEN | MIT | Python | – | Python sidecar |
| Caption / critique ear | Qwen3-Omni (30B-A3B) or ACE-Step LM "understanding" | music analysis cookbook | Apache-2.0 | MLX 4-bit fits 48 GB | LM Studio | MCP/tool call |
| Voice → Chaz | **Seed-VC** (singing, zero-shot) ; RVC if trained | Mac requirements file; real-time | GPL-3.0 / MIT | ✅ + audio.cpp | ✅ | audio.cpp `--task vc/svc` |
| Upscale / restore | AudioSR | any → 48 kHz | MIT | audio.cpp GGUF, MLX 8-bit | ✅ | audio.cpp |
| Master to reference | Matchering 2 | reference match, 4 GB RAM | GPL-3.0 | ✅ | – | Python subprocess |
| Audio → MIDI | basic-pitch (poly) / SOME (singing) / SheetSage2 (→ABC) | CoreML model ships | Apache / MIT / NC | ✅ | ✅ | subprocess → pattern clips |
| Codec | DAC 44 kHz (already cached as MLX) / HeartCodec 48 kHz | tokenization if we ever edit in token space | MIT / Apache | ✅ | ✅ | not needed yet |

## Suno-Studio verbs, locally

| Verb | Local route | Status |
|---|---|---|
| Generate into a selection | ACE `repaint --repaint-start/--repaint-end` on the bounced range; SA3 `inpaint_mask_start/end_seconds` for instrumental | ✅ doable now |
| Takes | seeds × batch (ACE batch 8; SA3 `batch_size`) → assets with `variants`, `asset.preferred` picks | ✅ maps onto 2.3.0 variants exactly |
| Extend | ACE `complete` / SA3 continuation | ✅ |
| Add layer ("add drums") | ACE `lego --request-option track_name=drums` | ✅ (base/xl-base DiT only, not turbo/sft — Model Zoo table) |
| Stems | HTDemucs/RoFormer after the fact; ACE `extract` per track | ✅ |
| Replace section w/ new lyrics | ACE repaint with lyric edit | ⚠️ works, lyric adherence in a short window is unmeasured |
| Cover / restyle | ACE `cover`; YuE2 cover (SheetSage2 score → new style), HeartMuLa MuLaCover | ✅ (YuE2 NC) |
| Sing it in Chaz's voice | generate → Seed-VC / RVC on the extracted vocal | ⚠️ two-pass, quality unmeasured |
| Stem-native generation (true multitrack) | none; closest is ACE lego track by track | ❌ |

## ComfyUI on audio — state as of v0.37.0 (2026-09-21)

- **Core audio type + nodes** (`comfy/nodes_audio.py`): Load/Record/Save (FLAC/MP3/Opus/Advanced)/Preview, Trim,
  Split/Join channels, Concat, Merge, AdjustVolume, EQ3, VAEEncode/DecodeAudio(+Tiled). torchaudio dependency
  removed 2026-09-22.
- **Native model support in core:** ACE-Step 1 + 1.5 (`nodes_ace.py`, reference-timbre audio), Stable Audio 1 + 3,
  YuE2 (`nodes_yue2.py`: GenerateABC → GenerateMusic, CFG added 2026-09-17), MiniMax Music 3 (2026-08-13),
  SheetSage2 AudioToABC, LTX-2 audio VAE. README lists "ACE-Step 1.5, Stable Audio 3, MiniMax Music 3 and Yue 2".
- **Official templates (29 audio):** ACE 1.5 (turbo/sft/base/XL, split/LLM), ACE m2m editing, Stable Audio 3 medium,
  MiniMax Music 3, YuE2 text2music + cover, Chatterbox TTS/VC, MelBandRoFormer separation (kijai pack),
  htdemucs separation (`AudioStemSeparate`, from a custom pack).
- **Custom packs by downloads** (`comfy/registry-audio-packs.tsv`): audio-separation-nodes (361k), TTS-Audio-Suite
  (160k; ~20 TTS engines + RVC + training), yvann audio-reactive (49k), old ACE-Step pack (43k), HeartMuLa (12k),
  MMAudio, Step-Audio-EditX, Whisper packs, Qwen-Omni.
- **Gaps:** no timeline or region primitive (repaint windows are plain seconds widgets); no beat/key/structure
  analysis in core; separation isn't in core; MPS correctness bugs are live (#16433: a VAE round-trip at 6.6 dB PSNR on
  MPS). The Mac is a second-class citizen.
- **As Oscine's backend:** workable. `POST /prompt` with an API-format graph, WS progress, `/view` fetch. But
  each verb means a pinned graph JSON, a Python/torch stack, and model folders. audio.cpp gives the same models
  behind one CLI/HTTP binary with Metal. **Use ComfyUI on Eclipse as an optional provider**; don't depend on it.

## Integration shape for Oscine

Follow the whisper `/transcribe` pattern already in `plugin/server/oscine-mcp.mjs` (a `run(cmd,args)` subprocess,
cache keyed by input sha, outputs into `<song>/assets/<sha>.wav` plus `asset.source = {kind:'derived', by, …}`):

- `POST /separate {asset, model:'htdemucs'|'mel_band_roformer'}` → 4 (or 2) assets, derived.
- `POST /generate {route:'text2music'|'repaint'|'lego'|'complete'|'extract'|'cover', asset?, from?, to?, text, lyrics?, n}` →
  n takes as variants of one asset. `from/to` come straight from the Range inspector.
- `OSCINE_AUDIOCPP` / `OSCINE_AUDIOCPP_MODELS` env like `OSCINE_WHISPER`, so Eclipse can serve instead
  (`audiocpp_server --backend hip`).
- MCP tools `separate` and `generate` fall out of the catalog for free.

## Smoke-test log (what actually ran)

Input: `out/input30.wav` = 60–90 s of `cog/projects/songs/2026-09-19-housekeeping-heat/the-field-remains-final.wav`, 44.1 kHz stereo.
Binary: audio.cpp v0.8.1 macos-arm64-metal release (`audiocpp_cli --version`: backends cpu,metal).

| Test | Result |
|---|---|
| HTDemucs Q8 (sha256 b0f532ac…4388 = HF X-Linked-ETag) on Metal | cold 31.0 s; warm 21.5 s / 21.1 s (RTF 0.70–0.72); peak footprint 588 MB; 4 stems, 30.000 s, 44.1 kHz stereo |
| Stem check (`scripts/stem_check.py`) | vocals −21.1, bass −22.0, other −27.9, drums −39.8 dBFS RMS; sum vs mix residual −54.1 dB → **36.2 dB reconstruction SNR** |
| Mel-Band RoFormer Q8 (sha256 2dd898ce…38fd = HF X-Linked-ETag, 252 MB) on Metal | cold 25.5 s, warm 20.4 s (RTF 0.85 / 0.68, 1.18–1.47× RT); peak footprint 0.61 GB; `vocals.wav` + `instrumental.wav` |
| RoFormer stem check | vocals −21.0, instrumental −20.8 dBFS; residual −100.6 dB. So *instrumental = mix − vocals* (subtractive); the 82.8 dB figure is by construction, not quality |
| Cross-model vocal agreement (RoFormer vocals vs HTDemucs vocals) | **18.9 dB SNR**: two independent architectures extract substantially the same vocal. This shows both work; it does not rank them (no ground-truth stems, no listening test) |
| Stable Audio 3 Small-Music Q8 (1.68 GB) generation | **not run.** The HF link sustained ~0.5–1 MB/s (~45 min for this file), over the 20-minute budget, so I stopped it. Command ready: `audiocpp_cli --task gen --family stable_audio --model weights/Stable-Audio-3-Small-Music-GGUF --backend metal --text "…" --duration-seconds 30 --out out/sa3.wav` |

Weights on disk: 62 MB + 252 MB = **0.31 GB** (budget 5 GB). No Python venv was needed: audio.cpp is a native binary, so the "uv venv" route in the brief wasn't used.

Evidence: `evidence/smoke-htdemucs-{timing.txt,stemcheck.json}`, `evidence/smoke-melroformer-{timing.txt,stemcheck.json}`, `evidence/smoke-vocals-agreement.json`.


Pitfalls hit: the release binaries unpack without the exec bit (`chmod +x`, clear quarantine). Two concurrent curls
to the same file silently produced an oversized GGUF that still *ran*. Fetch one writer per file and verify the
sha256 against HF's `X-Linked-ETag` (`scripts/fetch-weights.sh` does this now).


## Older / superseded (for completeness)

- **YuE 1** (2025-01, Apache): WSB 4.92, PER 36 %. Replaced by YuE2 in the same repo (`readmes/multimodal-art-projection_YuE.md`).
- **SongBloom** (2025): WSB 4.24. The upstream GitHub/HF repos 404 today; only mirrors and ComfyUI ports remain, so the license is unverifiable.
- **LeVo 2 / SongGeneration v2** (Tencent, HF 2026-02-15): WSB 6.32 but PER 26 %. Upstream repo 404s; HF card license `unknown`.
- **DiffRhythm 2** (2025-10, Apache): WSB 5.24. **InspireMusic** moved to `QwenAudio/FunMusic`, 21★, dormant since 2025-05.
- **Stable Audio Open 1.0 / Open Small** (2024-05 / 2025-05): replaced by Stable Audio 3 (2026-05).
- **MusicGen / MAGNeT** (2023–24, CC BY-NC weights). **MU-LLaMA** (GPL, 2023), **LP-MusicCaps** (2023), **Qwen2-Audio** (2024): replaced by Qwen3-Omni / Music Flamingo for captioning.
- **MT3** (JAX/T5X, heavy) → basic-pitch or MuScriptor for MIDI. **madmom** → beat_this.
- Note on #16433: that MPS bug is in Qwen-Image's VAE, not an audio node. It's cited as evidence that ComfyUI's MPS numerics are checked per model, not guaranteed.
