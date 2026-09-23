# Queued brief: local audio models spike (for Oscine)

Status: QUEUED. All 3 delegation slots were busy when Chaz asked (2026-09-23).
Dispatch the first time a slot frees.

Goal: a deep, evidence-backed map of LOCAL (open-weight, runnable on our
hardware) models for audio GENERATION, UNDERSTANDING, and MANIPULATION, and of
the ComfyUI audio ecosystem. Output: /Users/slowbro/workspaces/oscine/spikes/local-audio-models/README.md

Hardware: darkstar = Apple M4 Pro, 48 GB unified (MPS / MLX; no CUDA).
Eclipse = Windows, RX 7900 XTX 24 GB, ROCm, LM Studio (skill eclipse-inference-ops;
SSH seat). Prior notes: cog memory search "audio model", tts-mod3-findings,
link-reviews on MiniMax Music 3, skills audiocraft-audio-generation, comfyui,
machine-hearing, audio-hearing-pipeline.

Questions:
1. Generation: full-song with vocals (ACE-Step 1.x, YuE, DiffRhythm, SongBloom,
   Levo/SongGeneration, InspireMusic, whatever is newest in 2026), instrumental and
   loops (Stable Audio Open / Open Small, MusicGen, MAGNeT), SFX, singing voice,
   TTS/voice clone. Per model: license, params, VRAM, speed on M-series vs 7900 XTX,
   max length, lyric alignment, edit abilities (inpaint/extend/repaint/remix, the
   Suno-Studio verbs), and quality evidence (demos, benchmarks, community verdicts).
2. Understanding: Whisper variants / word timestamps, music captioning and tagging
   (Qwen2-Audio / Qwen3-Omni, MU-LLaMA, LP-MusicCaps, CLAP), beat/tempo/key/chord/
   structure (madmom, beat_this, All-In-One, Essentia), lyric-to-audio alignment,
   and "machine hearing" for critique.
3. Manipulation: stem separation (Demucs, BS-RoFormer / Mel-RoFormer, MDX,
   audio-separator / UVR models), voice conversion (RVC, Seed-VC), audio
   super-resolution (AudioSR, and codec restoration), mastering (Matchering, and any
   neural mastering), stretch/pitch, MIDI transcription (basic-pitch, MT3), and neural codecs
   (EnCodec, DAC, SNAC).
4. ComfyUI on audio: has anyone built a full audio-in-ComfyUI stack? Core
   audio types/nodes, ACE-Step native support, Stable Audio nodes, custom node packs
   (separation, TTS, RVC, whisper, audio analysis), workflows people share, and
   gaps. Is ComfyUI a viable headless generation backend for Oscine (its API/queue)?
5. For Oscine: a ranked stack (one model per job), how each plugs in (sidecar
   subprocess / ComfyUI API / MCP), which Suno-Studio verbs (generate into a
   selection, takes, extend, stems, replace-section) we can reproduce locally, and
   what can't be done yet.
Method: primary sources (model cards, repos, papers, ComfyUI registry), with a
citation on every claim. Optionally run ONE small local smoke test (e.g.
stable-audio-open-small or a Demucs/RoFormer separation on MPS) in a uv venv,
under oscine/spikes/local-audio-models/, if it fits in 20 minutes.
Verdict + ranked table + a 12-line report.
