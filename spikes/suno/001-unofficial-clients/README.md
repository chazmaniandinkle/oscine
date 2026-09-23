# Spike 001 — Suno clip schema from unofficial public clients (lane A)

Status: DONE (2026-09-23)
Method: read PUBLIC GitHub repo code only. Shallow clones live in `../_clones/` (gitignored); single files fetched with `gh api` sit in `../_clones/files/`. We did not log in, send cookies, or call any Suno endpoint. Every claim cites `repo@commit path:line`.

## Questions

1. Full clip object: exact field names and types (top level and `metadata.*`), plus a real example.
2. Lineage: extend, cover, remaster, infill, stems and upload; the shape of `history` and `concat_history`.
3. Endpoints: hosts, feed, clip by id, generate, concat, stems, WAV, aligned lyrics, personas, uploads, and Clerk auth.
4. Media URLs: CDN patterns, and whether they are fetchable without auth.
5. Maintenance and fragility.
6. Aligned-lyrics format.

## Sources surveyed (ranked by evidentiary weight)

| # | Repo @ commit (date) | Why it matters |
|---|---|---|
| A | **ChanMeng666/github-readme-suno-cards @3b94d8e (2026-09-17)** | **Real JSON fixtures** captured live on 2026-09-17: 40 clips across 7 files in `packages/parser/test/fixtures/`. A valibot `ClipSchema` records field presence rates. Reads **anonymous public** endpoints only. Freshest ground truth. |
| B | paperfoot/suno-cli @f0dea4d (2026-07-20) | Rust serde types plus `API_INTELLIGENCE.md`, which records traffic captured from suno.com in 2026 (the header says "Reverse-Engineered April 6, 2026"; a later note is marked "verified live 2026-07-18"). Uses the authed v2-web generate path. |
| C | gcui-art/suno-api @a2e6a82 (2026-03-07) | The canonical proxy (3.2k★), with `src/lib/SunoApi.ts`. It still gets commits (4 in 2026-03), but 108 issues are open and maintenance has stalled (issue #262 "willing to take over"). |
| D | gantasmo/theDAW @851f6a0 (2026-09-18) | `docs/guides/LIVE_CACHE_FIELD_DICTIONARY.md` lists 468 field paths sampled from 5,000 cached songs. Gives names only, no types. |
| E | jchoi2x/suno-api @1d9de0d (2025-12-30) | A zod `ClipInfoSchema` (a gcui fork). Adds a status enum and a `history[]` shape. |
| F | tjdevries/subd @611822c (2025-03) | Rust `SunoResponse` and `Metadata` structs. |
| G | mvanhorn/printing-press-library @aed80b7 (2026-09-23) | `…/suno/spec.yaml`: the widest endpoint list (≈40 routes). |
| H | sunsetsacoustic/SunoSync @c8bb5b0 (2026-02-17) | Bulk downloader, including the WAV conversion flow. |
| I | Malith-Rukshan/Suno-API @c789c33 (2024-07), SunoAI-API/Suno-API @953885c (2025-04), yihong0618/SunoSongsCreator @ef33985 (2024-08), wlhtea/Suno2openai @2e63807 (2025-01) | Historical hosts and URL patterns from the 2024 era. |

---

## 1. The clip object

Sources: the union of keys across 40 fixture clips in A (computed in code), cross-checked against B, C, E and F. `?` = optional or sparse. The zero UUID `00000000-…` means "redacted" (see §2).

### Top level

| Field | Type | Notes / source |
|---|---|---|
| `id` | string (UUIDv4) | A `fixtures/clip-complete.json:8` |
| `title` | string | A; B `src/api/types.rs:88` |
| `status` | string enum | `submitted` \| `queued` \| `streaming` \| `complete` \| `error` (E `src/schemas/index.ts:45`) |
| `created_at` | string (ISO-8601, ms, Z) | e.g. `2026-02-07T06:49:35.705Z` (A clip-complete.json) |
| `model_name` | string | internal key: `chirp-v3`, `chirp-auk`, `chirp-fenix`, `chirp-hawk`, `chirp-goose`, `chirp-flounder` (remaster), `chirp-chirp` (= no model: upload or studio export) |
| `major_model_version` | string | display: `v3.5`, `v4.5-all`, `v5.5`, `v6`; `""` when no model (A `packages/parser/src/schema.ts:428`, AGENTS.md) |
| `audio_url` | string | **Since early Sept 2026 this is the literal `https://studio-api.prod.suno.com/api/forbidden` on public reads** (A CHANGELOG 0.3.0; `mapping.ts:66`) |
| `media_urls` | array\<{url, content_type, delivery, encoding}\> | new in Aug 2026. Now holds a single `m4a-opus` "progressive" entry at `d2lwuy8qc234o3.cloudfront.net/1/clip/{id}.m4a`, and the payload is opaque/encrypted (A `schema.ts:68-100`) |
| `video_url` | string | `https://cdn1.suno.ai/{id}.mp4` |
| `video_cover_url`? , `hook_preview_thumbnail_url`? | string | A fixtures |
| `image_url`, `image_large_url` | string | `https://cdn2.suno.ai/image_{id}.jpeg`, `…/image_large_{id}.jpeg` |
| `is_video_pending`? | bool | F `models.rs:11`; E |
| `user_id` | string (UUID) | |
| `display_name`, `handle` | string | creator; `is_handle_updated` bool; `avatar_image_url` string |
| `is_public`, `is_liked`, `is_trashed`, `is_hidden`, `is_pinned`?, `is_verified`, `explicit`, `allow_comments`, `is_contest_clip`, `has_hook`, `is_persona_root`, `is_following_creator` | bool | A |
| `play_count`, `upvote_count`, `comment_count`, `flag_count` | int | A |
| `batch_index` | int | 0 or 1: which of the pair returned by one generate call |
| `entity_type` | string | always `"song_schema"` (A `schema.ts:341`) |
| `display_tags`?, `caption`? | string | |
| `persona`? | object {id, name, image_s3_id, root_clip_id, user_handle, user_display_name, user_image_url, is_owned, …} | A editorial-shelf.json |
| `albums` | array | |
| `action_config.actions[]` | {action_type, disabled, visible} | UI affordances such as `remix_extend`, `remix_cover` |
| `lyric` | — | **Not Suno's.** gcui derives it from `metadata.prompt` (C `SunoApi.ts:631`) |
| `audio_url_2` | string? | listed only in B `API_INTELLIGENCE.md:103`; UNCONFIRMED elsewhere |

### `metadata`

| Field | Type | Meaning |
|---|---|---|
| `tags` | string | **The style prompt** (comma-separated free text) |
| `prompt` | string | **The lyrics** (with `[Verse]` markers), or the description in simple mode. Only in the full `/api/clip/{id}` shape (A `schema.ts:136`) |
| `gpt_description_prompt` | string? | description-mode input (~6%) |
| `negative_tags` | string? | "exclude styles" (~9%) |
| `type` | string | `gen`, `concat`, `concat_infilling`, `upsample`, `upload`, `studio_export`, `edit_v3_export`, `edit_crop`, `edit_speed`, `edit_fade` (A `schema.ts:204-216`) |
| `task` | string? | `cover`, `upsample`, `playlist_condition`, …; paperfoot sends `cover` and `remaster` (B `src/api/cover.rs`, `remaster.rs`) |
| `duration` | number (s) | float or int; gcui/jchoi types also allow a string |
| `make_instrumental`, `has_vocal`, `has_stem`, `is_remix`, `can_remix`, `show_remix`, `is_mumble`, `uses_latest_model`, `can_publish_with_vocal`, `stream`, `refund_credits`, `video_is_stale`, `is_audio_upload_tos_accepted`, `is_max_mode`? | bool | A |
| `priority` | int | |
| `control_sliders` | {style_weight, audio_weight, weirdness_constraint, aug_creativity?} (0–1) | A editorial-shelf; B `types.rs:277-287` |
| `persona_id` | string? UUID | **not** redacted |
| `cover_clip_id`, `edited_clip_id`, `upsample_clip_id`, `stem_from_id`, `artist_clip_id`, `overpainting_clip_id`, `underpainting_clip_id`, `override_history_clip_id`, `override_future_clip_id` | string? UUID | lineage pointers (§2) |
| `cover_start_s`/`cover_end_s`, `artist_start_s`/`artist_end_s`, `continue_at`, `override_*_seconds` | number? | time windows (D; B `types.rs:195-203`) |
| `infill`, `infill_lyrics` | bool, string? | |
| `concat_history`, `history` | array (§2) | |
| `mashup_clip_ids`, `playlist_clip_ids` | string[]? | D; A `schema.ts:201` |
| `stem_task`, `stem_type_id`, `stem_type_group_name` | ? | D (names only) |
| `avg_bpm`, `min_bpm`, `max_bpm`, `key` | number/string? | D; B `types.rs:108`. **Types UNKNOWN**, no fixture |
| `studio_project_id`, `studio_project_version_id`, `edit_session_id` | string? | D |
| `vox_render_mode` | string | `strict` \| `beautified` |
| `variation_category` | string? | `normal` |
| `model_badges`, `secondary_badges`, `image_config` | UI objects | |
| `error_type`, `error_message` | string? | B `types.rs:120-122`; C `SunoApi.ts:803` |
| `video_upload_width/height` | int? | uploads only |
| `audio_prompt_id`, `audio_upload_id` | — | **UNKNOWN**: no repo reads or captures these names |

**Real example:** `ChanMeng666/github-readme-suno-cards@3b94d8e packages/parser/test/fixtures/clip-complete.json` is a complete `GET /api/clip/{id}` response from 2026-02 (a v4.5-all `gen` clip). `editorial-shelf.json` holds cover, concat, upsample, upload and persona examples. `clip.schema.json` in this folder encodes the union.

## 2. Lineage

- **Extend** (`type:"gen"` + `continue_clip_id`/`continue_at` in the request) creates a new partial clip. **Get whole song** (`POST /api/generate/concat/v2/ {clip_id}`) creates `type:"concat"` with:
  ```json
  "concat_history": [
    {"id":"b0a87596-…","type":"concat","source":"web","infill":false,"continue_at":227},
    {"id":"f587f768-…"}
  ]
  ```
  In a real fixture (A `trending.json`, v3.5), entry *i* carries the segment id and the cut point `continue_at` (seconds into that segment); the final entry is id-only. `source` ∈ `web`, `ios`; a `source_is_webview` bool also appears (A editorial-shelf). Schema: A `schema.ts:108-114`.
- **`history[]`** is a sibling with a richer shape: `id, continue_at, type, source, infill, infill_start_s, infill_end_s, infill_dur_s, infill_context_start_s/end_s, infill_lyrics, include_history_s, include_future_s, lyrics_updated, edited_clip_id, stem_clip_id, stem_from_id, stem_task, stem_type_id, stem_type_group_name, control_tags` (D `LIVE_CACHE_FIELD_DICTIONARY.md:268-290`, names only; E `schemas/index.ts:28-34` gives `{id, continue_at?, type, source?}`). It is sparse (1–2%) and has no real fixture.
- **Replace section / infill**: `type:"concat_infilling"`, `metadata.infill:true`, and `infill_*` seconds in the `history` entries. Field names only (D). PARTIAL.
- **Cover**: `task:"cover"`, `cover_clip_id`, and optional `cover_start_s`/`cover_end_s`; `is_remix:true` (A fixture 5bcff4c0; B `types.rs:194-196`).
- **Remaster**: `task:"upsample"`, `type:"upsample"`, `upsample_clip_id`, model `chirp-flounder`/`carp`/`bass` (A fixture c2462082; B `API_INTELLIGENCE.md:33-38`).
- **Stems**: `POST /api/edit/stems/{id}` returns new clips carrying `metadata.stem_from_id`, plus (per D) `stem_task`/`stem_type_id`/`stem_type_group_name`. The parent gets `has_stem:true` (C `SunoApi.ts:707-717`).
- **Upload**: `type:"upload"`, `model_name:"chirp-chirp"`, `major_model_version:""`, no `model_badges`, `is_audio_upload_tos_accepted:true` (A fixture 465f7c3c).
- **Parent graph**: `GET /api/clips/parent?clip_id=`, `/api/clips/direct_children_count`, `/api/clips/{id}/attribution` (G `spec.yaml:159-215`). theDAW's cache holds `parent_ids[].relationship`, `root_id` and `ancestors[]`, and uses relationship code `"MA"` for mashup (D `scripts/build_api_compatible_cache.py:829`). Other relationship codes are UNKNOWN.
- ⚠️ **Redaction**: on anonymous endpoints, every clip-parent pointer (`cover_clip_id`, `edited_clip_id`, `upsample_clip_id`, `concat_history[].id`) can come back as the zero UUID. The 2026 fixtures show it on cross-author remixes; the 2024-era trending fixture still has real ids. `persona_id` is never redacted (A `schema.ts:183, 285, 291-294`). **The owner's authed feed presumably has the real ids, but we did not verify that.**

## 3. Endpoints (all under the studio API host unless noted)

**Hosts**: `studio-api.suno.ai` (2024: I) → `studio-api.prod.suno.com` (C `SunoApi.ts:71`, H) and `studio-api-prod.suno.com` (B `src/api/mod.rs:32`, A). B reports both hosts answering on 2026-07-18. Auth: `clerk.suno.com` (2024–25: I, C `SunoApi.ts:436`) → `auth.suno.com` (C `:72`, B `src/auth.rs:11`).

| Purpose | Method + path | Found in (latest) |
|---|---|---|
| Clip by id (**anonymous OK**) | `GET /api/clip/{id}` | A (2026-09), C `SunoApi.ts:815` |
| Feed / by ids | `GET /api/feed/?ids=a,b` (legacy), `GET /api/feed/v2?ids=&page=` | C `:771`, B `generate.rs:107`, I |
| Feed (current) | `POST /api/feed/v3` `{cursor, limit, filters{searchText,trashed,fullSong,stem{presence}}}` → `{clips,next_cursor,has_more}` | B `feed.rs:16`, `types.rs:126-163`; usedhonda/suno-kit (2026-09) |
| Generate | `POST /api/generate/v2/` (C `:597`); **current web: `POST /api/generate/v2-web/`** | B `generate.rs:54` (2026-07) |
| Captcha preflight | `POST /api/c/check {ctype:"generation"}` → `{required, captcha_version}` | B `captcha.rs:13`, C `:207` |
| Concat (whole song) | `POST /api/generate/concat/v2/ {clip_id}` | B `concat.rs:9`, C `:482` |
| Stems | `POST /api/edit/stems/{id}` | B `stems.rs:11`, C `:707` |
| WAV | `POST /api/gen/{id}/convert_wav/`, then poll `GET /api/gen/{id}/wav_file/` (404 until ready) | H `core/downloader.py:1053,1065`; G `spec.yaml:136,146` |
| Aligned lyrics | `GET /api/gen/{id}/aligned_lyrics/v2/` | B `metadata.rs:46`, C `:729` |
| Set metadata / visibility / trash | `POST /api/gen/{id}/set_metadata/`, `…/set_visibility/`, `POST /api/gen/trash` | B `metadata.rs:14,28`, `delete.rs:18` |
| Lyrics gen | `POST /api/generate/lyrics/`, then `GET /api/generate/lyrics/{id}` | B, C, I |
| Personas | `GET /api/persona/get-persona-paginated/{id}/?page=`, `POST /api/persona/create/` | C `:837`, B `persona.rs:12` |
| Uploads | `POST /api/uploads/audio/{id}/upload-finish/`, `GET /api/uploads/audio/{id}/`, `POST /api/processed_clip/voice-vox-stem`, `POST /api/voice-verification/` (presigned S3 step not captured) | B `API_INTELLIGENCE.md:127-175` only (2026-04) |
| Projects / playlists / profiles | `/api/project/me`, `/api/project/{id}`, `/api/playlist/{id}` (anon), `/api/profiles/{handle}` (anon), `/api/oembed` (anon) | H, A, G |
| Parent graph | `/api/clips/parent`, `/api/clips/{id}/attribution`, `/api/clips/direct_children_count`, `/api/clips/get_similar/` | G only |
| Billing / models | `GET /api/billing/info/` | 7 repos |
| Removed | `/api/trending/`, removed 2026-07-24 | A AGENTS.md |

**Auth**: the Clerk `__client` cookie is exchanged at `GET {auth}/v1/client?__clerk_api_version=…` (gets the session id), then `POST {auth}/v1/client/sessions/{sid}/tokens` returns a JWT (~1 h) (C `SunoApi.ts:155,178`; B `auth.rs:192-199`). Studio requests carry `Authorization: Bearer <jwt>`, `device-id`, `browser-token: {"token":base64({"timestamp":ms})}`, and origin/referer `https://suno.com` (B `API_INTELLIGENCE.md:3-13`). Generation may need an hCaptcha `token`: gcui solves it with Playwright plus 2captcha (C `SunoApi.ts:8,308-415`); paperfoot pilots Chrome.

## 4. Media URLs

- Audio, before Aug 2026: `https://cdn1.suno.ai/{id}.mp3`, anonymous (I; `chchchadzilla/suno-song-downloaderist models.py:59`). 2024: `audiopipe.suno.ai/?item_id={id}` while streaming (Malith `suno/models.py:67`).
- **Now: blocked.** `cdn1…/{id}.mp3` returns 403 (CloudFront "Missing Key-Pair-Id", i.e. signed URLs) since late Aug 2026. `audio_url` is `/api/forbidden`; the only `media_urls` entry is an encrypted `m4a-opus` (A CHANGELOG 0.3.0; gcui issue #289, 2026-08-29; paperfoot issue #13, 2026-09-03). Whether an **authed owner** still gets a signed playable URL, or WAV via `convert_wav`, is UNKNOWN from code dated after 2026-09. SunoSync's WAV path predates the change.
- Video: `https://cdn1.suno.ai/{id}.mp4`, still anonymous as of 2026-09-17 (A).
- Images: `https://cdn2.suno.ai/image_{id}.jpeg`, `image_large_{id}.jpeg` (older: `cdn1…/image_{id}.png`). Custom covers use `{uuid}.jpeg` or `{uuid}_{hash}.jpeg`. `?width=` accepts only 100/256/360/720; any other value returns 403 (A `cdn.ts:5-26`).
- Song page: `https://suno.com/song/{id}`; short links `suno.com/s/{code}` redirect there (A `resolver.ts`); embed `suno.com/embed/{id}`.

## 5. Maintenance and fragility

- gcui-art/suno-api: last push 2026-03-06; commits dropped from 10–19 a month in 2024 to about 1 a quarter in 2025–26. 108 issues open. Captcha issues are chronic (#263, #261 and others); #269 (2026-01) says it no longer works after updating cookies, and #289 (2026-08) says all downloads are broken.
- paperfoot/suno-cli (the most active authed client): schema drift on v2-web is 422-ing (#9 title:null, 2026-07; #10, 2026-08). Download was broken on 2026-09-03 (#13). The stems response doesn't match the Clip type (#5).
- ChanMeng666 cards: breaking changes on 2026-07-24 (trending removed), about 2026-09-10 (badge colours dropped) and early Sept (audio). That is roughly **one breaking change a month** in 2026. The response shape also varies by endpoint (slim vs full) and by User-Agent (a UA starting with `suno` drops `secondary_badges`) (A `schema.ts:259-275`).
- Hosts moved twice (`suno.ai` → `prod.suno.com`/`-prod.suno.com`; `clerk.` → `auth.`). Generate moved from v2 to v2-web.
- **Takedowns: none found.** Searching `github/dmca` for "suno" returned only unrelated notices. No issue mentions a C&D.

## 6. Aligned lyrics

`GET /api/gen/{id}/aligned_lyrics/v2/` returns `{"aligned_words":[{word, start_s, end_s, success, p_align}], …}` (B `metadata.rs:53-58`, `types.rs:322-329`; C `SunoApi.ts:732-738`).
- `word`: string. **Includes trailing punctuation and `\n`** (for example `"花非花，\n"`), so line breaks are recoverable from the tokens (joeseesun/suno-music-creator@733f4ef `scripts/fetch_aligned_lyrics.py:69`).
- `start_s`, `end_s`: float seconds from the clip start. `success`: bool, whether the aligner placed the word. `p_align`: float 0–1, alignment confidence (optional in B).
- The other envelope keys (the `…`) are UNKNOWN; no repo captured the full body. It needs auth; there is no public-endpoint evidence.
- This maps directly onto Oscine's `asset.words:[{s,e,t}]`: `s=start_s`, `e=end_s`, `t=word.trim()`. Keep `p_align`/`success` as an optional confidence.

---

## Verdict: **PARTIAL**

*"The Suno clip schema is documented well enough in public code to design Oscine's Suno source block from."*

- **VALIDATED**: identity and prompt fields (`id`, `title`, `created_at`, `model_name`, `major_model_version`, `metadata.tags/prompt/negative_tags/gpt_description_prompt/type/task/duration/make_instrumental/control_sliders/persona_id`) and the aligned-words format. These are backed by real 2026 fixtures and several independent typed clients.
- **PARTIAL**: lineage. The pointer names are known (`cover_clip_id`, `upsample_clip_id`, `stem_from_id`, `edited_clip_id`, `concat_history[{id,continue_at,source,infill}]`), but public reads redact them to the zero UUID, and `history[]` and the infill and stem sub-fields are names without types or fixtures.
- **INVALIDATED**: `audio_url` as a durable link. Since Sept 2026 it is a `/api/forbidden` placeholder. Oscine must store the **song id and page URL** as the link back, and treat the audio bytes as whatever the user exported or downloaded, never as a URL we can refetch.

## Recommended Oscine `suno` source block

```jsonc
"source": { "kind": "suno",
  "id": "uuid",                          // clip.id — the durable key
  "url": "https://suno.com/song/{id}",   // derived, never audio_url
  "title": "…", "createdAt": "ISO",
  "model": { "name": "chirp-fenix", "version": "v5.5" },
  "style": "…",                          // metadata.tags
  "negativeStyle": "…",                  // metadata.negative_tags?
  "lyrics": "…",                         // metadata.prompt
  "description": "…",                    // metadata.gpt_description_prompt?
  "instrumental": false,                 // metadata.make_instrumental
  "sliders": { "style": 0.7, "audio": 0.4, "weirdness": 0.2 },   // control_sliders?
  "personaId": "uuid?",
  "kind2": "gen|concat|concat_infilling|upsample|upload|studio_export|edit_*", // metadata.type
  "task": "cover|upsample|…?",
  "lineage": {                           // null ids when zero-UUID-redacted
    "coverOf": "uuid?", "remasterOf": "uuid?", "stemOf": "uuid?", "editOf": "uuid?",
    "segments": [ { "id": "uuid", "continueAt": 227 } ]           // concat_history
  },
  "stemType": "?",                       // metadata.stem_type_group_name (unverified)
  "durationS": 255.96,
  "fetchedAt": "ISO", "raw": { /* verbatim clip JSON, for fields we don't model yet */ }
}
```
Keep a verbatim `raw` copy, because the shape changes about monthly. Treat the zero UUID as `null`. Words go into `asset.words`, not into the source block.

`clip.schema.json` (JSON Schema 2020-12, permissive) validates **40/40** real fixture clips from A with 0 errors (checked 2026-09-23 with python-jsonschema). The `$defs.alignedLyricsResponse` definition covers §6.
