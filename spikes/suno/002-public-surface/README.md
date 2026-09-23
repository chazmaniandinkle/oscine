# Spike 002 — Suno public & official surface

Lane B. Scope: only public, official surfaces. No login, no cookies, no private API, no bulk fetching.
Only a handful of single fetches, the way a person opens a shared link. Evidence lives in `evidence/`.

## Questions
1. Official API / partner / enterprise program? Official integrations (Copilot etc.)?
2. Public song page (suno.com/song/<uuid>): OG/Twitter, JSON-LD, __NEXT_DATA__/RSC. Which fields? oEmbed/embed?
3. CDN: do cdn1.suno.ai mp3 + image URLs resolve without auth? Headers?
4. Downloads/exports: formats, plans, embedded metadata?
5. Suno Studio: export formats, stems, MIDI, project file? Oscine import?
6. Rights: ownership of output, use in other tools.
7. Uploads: audio upload (cover/extend), length limits.

## Findings

_Status: complete (2026-09-23). Gap fetches: CDN HEADs (`evidence/cdn_head_538ab4ae-….headers`), one oEmbed GET, platform.suno.com landing page, one DMN article, three DuckDuckGo queries._

### Q2. Public song page (`suno.com/song/<uuid>`)
- Server-rendered Next.js App Router page. There is **no JSON-LD** and **no `__NEXT_DATA__`**. It has an RSC flight payload (`self.__next_f.push`), about 105 KB after decoding. Sources: `evidence/song_538ab4ae-….html` and `evidence/song_9f5adfa3-….html`.
- **OG/Twitter tags:** `og:title` = title, `og:image` = cover (cdn2.suno.ai, 256x256), `og:type` = `music.song`. `meta description` = "<title> by <display_name> (@<handle>)". For songs with video there are also `og:video` (cdn1 mp4), `twitter:card=player`, and `twitter:player` = **`https://suno.com/embed/<uuid>`** (760x240). That is the official embed player URL (`song_9f5adfa3-….html`).
- **The clip object is embedded in full** in the flight payload. Extracted copies: `evidence/song_538ab4ae-3ace-4abf-95f9-be0bed53b65d.clip.json` and `evidence/song_9f5adfa3-865d-482f-9ce6-38f5cc05a8ae.clip.json`. Fields present:
  - `id`, `title`, `created_at` (ISO UTC), `display_name`, `handle`, `user_id`, `avatar_image_url`, `caption`, `display_tags`
  - `metadata.tags`: the full style prompt
  - `metadata.prompt`: the full lyrics, with section tags
  - `major_model_version` ("v6") and `model_name` ("chirp-hawk")
  - `metadata.duration` (s), `metadata.type` ("gen"), `metadata.task` ("cover" / "agentic_thinking"), `make_instrumental`, `has_stem`, `is_remix`, `can_remix`
  - `image_url` / `image_large_url` (cdn2), `video_url` (cdn1 mp4)
  - `media_urls[0]`: CloudFront `…/1/clip/<id>.m4a`, content_type `m4a-opus`
  - `ownership.ownership_reason` ("subscribed"), `play_count`, `upvote_count`
- **`audio_url` is deliberately withheld.** It holds `https://studio-api.prod.suno.com/api/forbidden`.
- **Lineage is weak.** There is no `history` or `concat_history`. `metadata.cover_clip_id` and `metadata.edited_clip_id` exist, but on 538ab4ae (task=cover, is_remix=true, badge "COVER") both are the nil UUID `00000000-…`, so the source clip is **not** exposed. 9f5adfa3 has neither key.
- **Example (trimmed), song 538ab4ae:**
```json
{"id":"538ab4ae-3ace-4abf-95f9-be0bed53b65d","title":"Porch Light On",
 "created_at":"2026-09-09T20:37:50.189Z","handle":"kealix018","display_name":"kealix",
 "major_model_version":"v6","model_name":"chirp-hawk",
 "image_url":"https://cdn2.suno.ai/538ab4ae-3ace-4abf-95f9-be0bed53b65d_e7472649.jpeg",
 "audio_url":"https://studio-api.prod.suno.com/api/forbidden",
 "media_urls":[{"url":"https://d2lwuy8qc234o3.cloudfront.net/1/clip/538ab4ae-….m4a","content_type":"m4a-opus"}],
 "metadata":{"tags":"slow atmospheric indie alternative ballad, sparse sustained acoustic piano, …",
   "prompt":"[Verse 1]\nYou leave your coat beside the kitchen chair\n…","duration":213.96,
   "task":"cover","is_remix":true,"cover_clip_id":"00000000-0000-0000-0000-000000000000",
   "edited_clip_id":"00000000-0000-0000-0000-000000000000","make_instrumental":false,"has_stem":false},
 "display_tags":"indie, alternative, ballad","ownership":{"ownership_reason":"subscribed"}}
```
- **oEmbed exists.** The song page's `<link rel=alternate type=application/json+oembed>` points to `https://studio-api-prod.suno.com/api/oembed?url=https://suno.com/song/<uuid>`. One GET returned 200 with `{type:"rich", provider_name:"Suno", title, width:600, height:140, html:<iframe src=https://suno.com/embed/<uuid>>, iframe_url}`. It carries **title only**: no author, thumbnail, style, lyrics or model. `evidence/oembed_538ab4ae-….json`. This is a published discovery endpoint meant for consumers who have a link, so it is the cleanest official hook.
- The page sends `content-security-policy: frame-ancestors 'none'`, so the song page itself cannot be iframed. Use `/embed/<uuid>` instead (`song_*.headers`).

### Q4. Downloads
- Formats (help 13926081, https://help.suno.com/en/articles/13926081): **MP3** on all plans; **WAV** on Pro/Premier, web only, and mobile falls back to MP3; **video**; **stems** when they exist, not counted as an extra download; **MIDI** only for Studio-made songs and only on Premier. `evidence/help_13926081.txt`, `help_2479873.txt` (free plan gets a "lightweight mp3").
- Quotas: Free gets 7 lifetime trial downloads, non-commercial only. Free users who joined on or after 2026-09-03 get only occasional trial downloads plus paid ones. Pro gets 20/month, Premier 60/month. Studio workflows are exempt. Re-downloading the same song or taking multiple formats counts once. Bulk download produces a ZIP. `evidence/help_13876865.txt`, `help_13926209.txt`, `help_2409921.txt`.
- Embedded metadata: **UNKNOWN from the docs.** No saved help article mentions ID3 or embedded tags. Lane C's local finding (the .m4a `©cmt` carries "made with suno; created=; id=" plus lyrics) is neither confirmed nor contradicted there.

### Q5. Suno Studio
- The Export dropdown offers Full Song, Selected Time Range, and **Multitrack** ("all tracks as stems for your DAW"). A single clip can be exported with right-click → Download .WAV. **All Studio audio exports are WAV.** On a stem, **Get MIDI** costs 10 credits and produces a standard MIDI file. `evidence/help_13925249.txt`
- Stem modes: Auto Split (up to 12 stems, 50 credits), Split from Mix (1 stem plus its complement), Advanced (~100 instruments, Premier only). `evidence/help_12702337.txt`, `help_13925185.txt`
- **No project/session file format is documented** (studio category: `help_cat_1708865-studio.txt`). Oscine can import Studio exports as WAV stems plus .mid, but not as a Studio project.

### Q6. Rights
- Paid plans: the user owns the output and keeps commercial rights after cancelling. Allowed uses include monetising, streaming distribution, film/TV/games, and Bandcamp sales. Copyright itself is not guaranteed. `evidence/help_9601665.txt`, `help_2416769.txt`
- Free (Basic) plan: **Suno owns the output**, and the user may use it only non-commercially. Trial downloads are never commercial. `help_2416769.txt`, `help_13876865.txt`
- Using the outputs in another tool (a DAW) is explicitly envisioned ("download your tracks for use outside of Suno"; Studio "for mixing in your DAW of choice").

### Q7. Uploads
- Free plan: up to **60 s**. Pro/Premier: up to **8 min**. The upload can then feed Extend, Cover, and so on. `evidence/help_6141569.txt`. An older article gives 6–60 s, or 120 s for paid plans (`help_2477633.txt`), which the newer one supersedes.
- A single generation can run up to 8 min on v6, v6-wild and v6-mini. `evidence/help_13924929.txt`

### Sharing
- Songs are either "Link Only" (visible to anyone with the URL) or "Public". A pasted link therefore works without login for both. `evidence/help_2565761.txt`

### Q1. Official API / partner program
- **No public self-serve API as of 2026-09.** On 2026-07-01, Suno CPO Jack Brody announced on LinkedIn that Suno is "exploring a developer API … starting with a curated group of partners", with an early-access intake form and no timeline (https://www.digitalmusicnews.com/2026/07/03/suno-is-opening-an-api-partner-program/, saved as `evidence/dmn_suno_api_partner_2026-07-03.html`; also https://www.musicbusinessworldwide.com/suno-explores-developer-api-seeking-apps-that-unlock-experiences-generative-music-makes-possible-for-the-first-time/).
- **`https://platform.suno.com/`** is live but login-gated: "Make music with the Suno API — Generate original songs, covers, and mashups from a single prompt — … behind a simple REST API. Sign in to manage your API account" (`evidence/platform.suno.com.html`). It is a **generation** API (prompt → audio) for approved partners. There is no public documentation, and nothing indicates a read/metadata API for existing clips. Oscine would have to apply as a partner to use it.
- The widely cited "Suno API" sites (sunoapi.org, musicapi.ai, …) are **unofficial third-party wrappers** and are ruled out by the ToS.
- **Microsoft Copilot:** since Dec 2023 Suno has run as a Copilot *plugin*. The user signs in, enables the Suno plugin and prompts in chat, and Suno generates the song server-side, so it is a partner integration rather than a public API (https://techcrunch.com/2023/12/19/microsoft-copilot-gets-a-music-creation-feature-via-suno-integration/, https://www.howtogeek.com/how-to-use-microsoft-copilot-suno-plugin/). Other official partnerships are industry/distribution deals: Believe/TuneCore (suno.com/about, `evidence/suno.com_about.html`) and the Warner Music Group licence (settled the lawsuit "in November" per the DMN article above, presumably Nov 2025). None of these gives third parties metadata access.
- Official "integration" surfaces open to Oscine: **the oEmbed endpoint, the `/embed/<uuid>` player, OG tags, and user-initiated downloads.**

### Q3. CDN (single HEAD each, no cookies; `evidence/cdn_head_538ab4ae-….headers`)
| URL | Result |
|---|---|
| `https://d2lwuy8qc234o3.cloudfront.net/1/clip/<id>.m4a` (the page's `media_urls`, m4a-opus stream) | **200**, audio/mp4, 3,571,467 B, S3 via CloudFront, `x-amz-expiration: 2026-10-10` (a lifecycle rule, so the object is transient), no CORP header |
| `https://cdn1.suno.ai/<id>.mp3` (the legacy pattern) | **403** (text/xml): the mp3 is no longer public |
| `https://cdn2.suno.ai/<id>_e7472649.jpeg` (cover) | **200**, image/jpeg, 80,538 B, `cache-control: public,max-age=2592000`, `cross-origin-resource-policy: cross-origin` |
| `https://cdn1.suno.ai/<id>.mp4` (video) | **200**, video/mp4, 7.7 MB, CORP cross-origin |
- Summary: cover art and video load without auth and are hotlink-friendly. The streaming audio loads without auth, but the ToS forbids obtaining Output "by any means other than a download channel made available by Suno (e.g. recording or stream ripping)" (`evidence/suno.com_terms.html`, Permitted Commercial Use). **Oscine must not pull audio from the CDN.** Audio has to come from the user's own download.

### Q4 addendum: embedded metadata (ToS, effective 2026-09-03)
- Suno "reserve[s] the right to append a fingerprint, watermark, or metadata indicating the applicable service tier of an Output and whether such Output was a permitted Download". Users must not "remove, alter, obscure or circumvent" it (`evidence/suno.com_terms.html`). This fits Lane C's `©cmt: made with suno; created=; id=` finding. **Oscine must preserve the embedded tags on import and export.** The `id=<uuid>` in `©cmt` is the join key to `suno.com/song/<uuid>`. No help article documents the exact tag schema, so the format beyond Lane C's sample is UNKNOWN.
- Other ToS constraints: no "data mining, robots, scraping, or similar data gathering". Free/Basic Output is "personal and non-commercial" only. robots.txt allows `/` (disallowing only followers/following, /login, /voice) (`evidence/suno.com_robots.txt`). robots permission does not override the ToS, so fetches must stay single and user-initiated.

## Verdict
Claim: *"From a pasted public song URL alone, Oscine can legitimately fill title, style, lyrics, model, cover art and lineage."* **Mostly true. Lineage is the exception.** Fetching the song page once, when the user pastes it, is the same action as a browser opening a shared link. Suno also publishes oEmbed for exactly this use.
| Field | Verdict | Source |
|---|---|---|
| Song id / URL | **yes** | the URL itself, plus `©cmt id=` in the download |
| Title | **yes** | og:title, oEmbed `title`, clip `title` |
| Style | **yes** | clip `metadata.tags` (full prompt) plus `display_tags` (RSC payload only; not in OG or oEmbed) |
| Lyrics | **yes** | clip `metadata.prompt` (RSC payload); also in the downloaded file per Lane C |
| Model | **yes** | clip `major_model_version` ("v6") plus `model_name` ("chirp-hawk") |
| Creator | **yes** | meta description plus clip `handle`/`display_name` |
| Created / duration | **yes** | clip `created_at`, `metadata.duration` |
| Cover art | **yes** | og:image / clip `image_url` (cdn2, public, CORP cross-origin) |
| Lineage | **no** (partial) | only `task` ("cover"/"gen"/…) and `is_remix`; `cover_clip_id`/`edited_clip_id` are the nil UUID and there is no `history`/`concat_history` on public pages |
| Audio | **no** | `audio_url` is "forbidden", and the ToS bans stream ripping, so audio must come from the user's download |
Caveat: style, lyrics and model come from parsing the undocumented RSC flight payload, not a published API, so treat the parser as brittle. Keep OG plus oEmbed as the stable fallback (title and cover only), and prefer the file's own embedded metadata for lyrics and id.
