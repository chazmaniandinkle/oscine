### Speech Generation And Conversation

| Family | Task | Lang | Variants | Runtime |
|---|---|---|---|---|
| **breeze_tts** | TTS, Clone, Design, Ctrl | zh, en | BreezeTTS 2 instruction-conditioned TTS and prompt-audio voice cloning | GGUF BF16/Q8, Stream |
| **chatterbox** | TTS, Clone, VC| ar, da, de, el, en, es, fi, fr, hi, it, ko, ms, nl, no, pl, pt, sv, sw, tr | Chatterbox with 0.5B backbone | GGUF 16/Q8 |
| **confucius4_tts** | Clone | zh, en, ja, ko, de, fr, es, id, it, th, pt, ru, ms, vi | Confucius4-TTS multilingual voice cloning | GGUF F32, Stream |
| **cosyvoice3** | TTS, Clone | zh, en, ja, ko, de, es, fr, it, ru, yue | Fun-CosyVoice3 zero-shot, cross-lingual, and instruction-conditioned TTS | GGUF F32/Q8 |
| **dots_tts** | TTS, Clone, Edit, Ctrl | multilingual | DotTTS SOAR<br>DotTTS MeanFlow<br>DotTTS Edit | GGUF 16/Q8, Stream |
| **dramabox** | TTS, Clone | en | DramaBox expressive TTS and voice cloning | GGUF Q8 |
| **fish_audio** | TTS, Clone, Ctrl | auto, en, zh | Fish Audio S2 Pro | GGUF 16/Q8 |
| **firered_audio** | ASR, TTS, Clone, Design, Ctrl | zh, en | FireRedAudio multimodal speech/audio model with ASR, understanding, cloning, design, and edit paths | GGUF original/Q8 |
| **fireredtts3** | TTS, Clone, Design, Ctrl | 24 langs + 21 zh dialects | FireRedTTS3 Base<br>FireRedTTS3 Instruct/Voicedesign | GGUF original/Q8 |
| **higgs_audio_tts** | TTS, Clone, Ctrl | auto | Higgs Audio v3 TTS 4B | GGUF 16/Q8 |
| **index_tts2** | TTS, Clone, Ctrl | zh, en, ja, es, ar | IndexTTS-2<br>IndexTTS-2.5 | GGUF 16/Q8 |
| **kokoro_tts** | TTS | en-us, en-gb, es, fr, hi, it, ja, pt-br, zh | Kokoro 82M, 54 preset voices | Safetensors, local GGUF BF16/Q8 |
| **irodori_tts** | TTS, Clone, Design, Ctrl | ja | Irodori-TTS-v4.1-Small<br>Irodori-TTS-v4.1-Anime<br>Irodori-TTS-500M-v3<br>Irodori-TTS-600M-v3-VoiceDesign | GGUF 16/Q8 |
| **magpie_tts** | TTS | ar-AE, ar-MSA, ar-SA, de, en, es, fr, hi, it, ko, pt-BR, vi, zh | NVIDIA MagpieTTS Multilingual 357M (v2607) with baked speaker prompts and NanoCodec decode | GGUF original/Q8
| **miotts** | TTS, Clone | en, ja | MioTTS-1.7B | GGUF 16/Q8 |
| **moss_tts_local** | TTS, Clone, Ctrl | auto, optional language hint | MOSS-TTS-Local-Transformer-v1.5 | GGUF 16/Q8 |
| **moss_tts_nano** | TTS, Clone | auto | MOSS-TTS-Nano-100M | GGUF 16/Q8 |
| **neutts** | TTS, Ctrl | en | NeuTTS 2E with built-in speaker prompts and emotion control | GGUF original precision, Stream |
| **omnivoice** | TTS, Clone, Design, Ctrl | 646+ langs | OmniVoice, Qwen3-0.6B based | GGUF 16/Q8, Stream |
| **personaplex** | Dialogue, S2S | en | PersonaPlex 7B v1 speech-to-speech conversational model with packaged voice/persona prompts | GGUF Q4/Q8, Stream |
| **pocket_tts** | TTS, Clone | en, de, it, pt, es | PocketTTS-100M English/German/Italian/Portuguese/Spanish | GGUF 16/Q8, Stream |
| **qwen3_tts** | TTS, Clone, Design, Ctrl | zh, en, fr, de, it, ja, ko, pt, ru, es | Qwen3-TTS-12Hz-0.6B-Base<br>Qwen3-TTS-12Hz-1.7B-Base<br>Qwen3-TTS-12Hz-1.7B-CustomVoice<br>Qwen3-TTS-12Hz-1.7B-Voi
| **supertonic** | TTS | en, ko, ja, ar, bg, cs, da, de, el, es, et, fi, fr, hi, hr, hu, id, it, lt, lv, nl, pl, pt, ro, ru, sk, sl, sv, tr, uk, vi, na | Supertonic 3 | GGUF F32, Stream |
| **vibevoice** | TTS, Dialogue | en, zh | VibeVoice-1.5B<br>VibeVoice-7B | GGUF 16/Q8 |
| **voxcpm2** | TTS, Clone, Design, Ctrl | ar, da, de, el, en, es, fi, fr, he, hi, id, it, ja, km, ko, lo, ms, my, nl, no, pl, pt, ru, sv, sw, th, tl, tr, vi, zh | VoxCPM2-2B, 48 kHz | GGUF 16/Q8, Str

### Speech Recognition And Analysis

| Family | Task | Lang | Variants | Runtime |
|---|---|---|---|---|
| **canary_asr** | ASR, Translate | en, de, es, fr | Canary 180M Flash | GGUF F32/Q8 |
| **citrinet_asr** | ASR | en | Citrinet-256 | GGUF Q8 |
| **cohere_asr** | ASR | en, fr, de, es, it, pt, nl, pl, el, ar, ja, zh, vi, ko | Cohere Transcribe 03-2026 | GGUF BF16/Q8/Q4_0 |
| **fun_asr_nano** | ASR | auto, zh, en, ja | Fun-ASR-Nano-2512 | GGUF 16/Q8 |
| **higgs_audio_stt** | ASR | en | Higgs Audio v3 STT | GGUF 16/Q8, Stream |
| **hviske_asr** | ASR | da | Hviske v5.3 | GGUF Q8 |
| **marblenet_vad** | VAD | lang agnostic | MarbleNet VAD | Bundled |
| **pulsevad** | VAD | lang agnostic | PulseVAD 2.1K Student / 81K Teacher | GGUF F32 |
| **moonshine_asr** | ASR | en | Moonshine Streaming Tiny/Small/Medium | GGUF Q8, Stream |
| **moss_transcribe_diarize** | ASR | auto, 50+ languages | MOSS-Transcribe-Diarize with speaker labels and timestamps | GGUF BF16/Q8/Q4_K, Stream |
| **nemotron_3_diar** | Diar | multilingual | NVIDIA Nemotron 3 Diarization with eight-speaker arrival-order diarization | GGUF BF16, Batch, Stream |
| **nemotron_asr** | ASR | 100+ ASR prompt codes incl. auto | Nemotron 3.5 ASR Streaming 0.6B | GGUF 16/Q8, Stream |
| **niagara_asr** | ASR | en | Niagara 19M Batch English<br>Niagara 38M Batch English | GGUF F32 |
| **qwen3_asr** | ASR | zh, en, yue, ar, de, fr, es, pt, id, it, ko, ru, th, vi, ja, tr, hi, ms, nl, sv, da, fi, pl, cs, fil, fa, el, ro, hu, mk | Qwen3-ASR-0.6B<br>Qwen3-ASR-1.7B-hf | GGUF 16/Q8, Str
| **qwen3_forced_aligner** | Align | zh, yue, en, de, es, fr, it, pt, ru, ko, ja | Qwen3-ForcedAligner-0.6B | GGUF 16/Q8 |
| **silero_vad** | VAD | lang agnostic | Silero VAD | Bundled, Stream |
| **sortformer_diar** | Diar | en | Sortformer-4spk-v1 | - |
| **vibevoice_asr** | ASR | auto | VibeVoice ASR | GGUF 16/Q8 |
| **vibevoice_asr_streaming** | ASR | en, zh, es, pt, de, ja, ko, fr, ru, it | VibeVoice ASR Streaming 7B/1.5B with persistent decoder state and speaker turns | GGUF BF16/Q8/Q4, Stream |
| **voxtral_realtime** | ASR | auto | Voxtral-Mini-4B-Realtime-2602 | GGUF 16/Q8/Q4, Stream |

### Audio Conversion And Processing

| Family | Task | Lang | Variants | Runtime |
|---|---|---|---|---|
| **audiosr** | S2S | lang agnostic | AudioSR Basic audio super-resolution package | GGUF F32 |
| **apollo** | S2S | lang agnostic | Apollo music restoration | GGUF F32 |
| **universr** | S2S | lang agnostic | UniverSR Audio and Speech super-resolution | GGUF F32 |
| **bs_roformer** | Sep | lang agnostic | BS-RoFormer vocal separation checkpoints | GGUF Q8 |
| **controlfoley** | SFX | auto | ControlFoley 44 kHz multimodal Foley generation from text, video, and reference audio conditioning | GGUF F32/Q8 |
| **htdemucs** | Sep | lang agnostic | HTDemucs<br>HTDemucs_ft | GGUF 16/Q8 |
| **meanvc2** | VC | lang agnostic | MeanVC2 120 ms/40 ms zero-shot voice conversion | GGUF F32/Q4, Stream |
| **mel_band_roformer** | Sep | lang agnostic | Mel-Band RoFormer MLX vocal separation variants | GGUF 16/Q8 |
| **miocodec** | Codec, VC | lang agnostic | MioCodec v2, 25 Hz, 44.1 kHz | GGUF 16/Q8 |
| **muscriptor** | MIDI | music | MuScriptor Small audio-to-symbolic transcription | GGUF F32, Stream |
| **rvc** | VC | lang agnostic | RVC F16 GGUF with packaged v1/v2 voices and optional retrieval blending | GGUF 16 |
| **seed_vc** | VC | lang agnostic | SeedVC XLS-R + HiFT<br>SeedVC Whisper-small + BigVGAN | GGUF 16/Q8 |
| **sheetsage2** | MIDI | music | SheetSage2 audio-to-ABC score transcription | GGUF orig |

### Music, Media, And Editing

| Family | Task | Lang | Variants | Runtime |
|---|---|---|---|---|
| **ace_step** | Music, Edit | 50+ langs | ACE-Step 1.5 Turbo<br>ACE-Step 1.5 Base<br>ACE-Step 1.5 XL Turbo<br>ACE-Step 1.5 XL SFT | GGUF 16 |
| **heartmula** | Music | zh, en, ja, ko, es | HeartMuLa-oss-3B with HeartCodec-oss | GGUF 16/Q8 |
| **midashenglm_gen** | Music, SFX | auto | MiDashengLM-Gen structured-prompt generation for speech, music, sound effects, and ambience | GGUF F32/Q8 |
| **minimax_h3** | Video, Music, TTS/Dialogue | auto | MiniMax-H3 Q4_K with optional INT8 ConvRot DiT | GGUF Q4/INT8 |
| **minimax_music3** | Music | auto | MiniMax Music 3 text-to-music generation with lyrics conditioning | GGUF Q4/Q8 |
| **stable_audio** | Music, SFX, Edit | en | Stable Audio 3 Small Music<br>Stable Audio 3 Small SFX<br>Stable Audio 3 Medium | GGUF 16/Q8 |
| **vevo2** | TTS, Music, VC, Edit | en, zh | Vevo2 with Qwen2.5-0.5B AR model | GGUF 16 |
| **yue2** | Music | en | YuE2-3B lyrics-conditioned song generation with optional ABC score planning and conditioning | GGUF BF16/Q8/Q4 |

Some model families in the supported table started as outside contributions before being promoted into the core release surface. Thanks to Mirek [@mirek190](https://github.com/mirek190) for BS-RoForme

