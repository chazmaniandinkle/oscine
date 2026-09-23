# Spike: Suno sources as Oscine assets (2026-09-23)

Question: can an Oscine asset carry a live link to the Suno song it came from,
with Suno's metadata, without scraping or a private API?

Lanes (each README cites its evidence):
- `001-unofficial-clients/`: the clip schema from public client code (`clip.schema.json`, validated on 40 real responses)
- `002-public-surface/`: the public song page, oEmbed, CDN, help docs, terms, and the partner API
- `003-local-evidence/`: tags in the Suno files on this machine, and the Borrowed Light project today

## Verdict: VALIDATED, except lineage

| Field | Source, in order of trust | Status |
|---|---|---|
| song id, url | downloaded file `©cmt` (`made with suno; created=…; id=…`), or the pasted URL | yes, offline |
| created | `©cmt` | yes, offline |
| lyrics as sent | `©lyr` in the file; page `metadata.prompt` | yes |
| line timings | the file's mov_text subtitle track | yes, offline |
| title, cover art | page OG tags / official oEmbed (stable); `image_url` on cdn2 is public | yes |
| style, model, task, duration, instrumental, creator | page data (`self.__next_f` payload, undocumented, brittle) | yes, best effort |
| word timings (`aligned_words`) | private endpoint only | no (unless we ever get partner access) |
| lineage (cover of, extended from, stems from) | parent ids read as the zero UUID when you aren't logged in | no: Oscine records it itself |
| audio | the user's own download | never fetched: `audio_url` is `/api/forbidden`, and the ToS bans stream ripping |

No public API exists. The partner API (announced 2026-07-01) is invite-only and
generation-only. Unofficial clients break about monthly and violate the ToS, so we don't build on them.

## Design consequences

1. **The file is the anchor.** Importing a Suno `.m4a` reads `©cmt` / `©lyr` /
   subtitles, with no network. The file's tags must be preserved (the ToS says
   Suno's watermark/metadata may not be removed).
2. **Enriching is optional, and it's one request.** A "Fetch from Suno" button in the asset
   inspector reads the one public song page for that id (title, style, model,
   cover). It's triggered by the user and cached. It never runs in bulk or in the background.
3. **Oscine owns lineage.** The round-trip records what was sent (the lyrics/style file,
   the exported range, the parent asset), and the returned file is matched to that
   record by id and time. Suno's own lineage fields get stored raw, with zeros kept as null.
4. **Keep `raw`.** Store the verbatim page clip object, because its shape changes monthly.

## Proposed `asset.source` (optional; format stays v2)

```json
"source": {
  "kind": "suno",
  "id": "39802a94-8c2f-49b7-bb77-79bfe022b18d",
  "url": "https://suno.com/song/39802a94-8c2f-49b7-bb77-79bfe022b18d",
  "created": "…from ©cmt",
  "title": null, "style": null, "model": null, "task": null, "cover": null,
  "lyrics": { "text": "…©lyr", "from": "file" },
  "sent": { "lyrics": "borrowed-light-suno-lyrics-v14-SEND.txt", "style": "borrowed-light-suno-style-v13b-dynamics.txt", "confidence": "guess" },
  "parent": null,
  "provenance": { "id": "file", "lyrics": "file", "style": "sent-guess" },
  "fetched": null,
  "raw": null
}
```
and for stems and edits: `{ "kind": "derived", "from": "<assetId>", "by": "demucs" }`.

It's per asset, not per variant. It rides alongside the existing keys (lane C confirmed extra keys
survive an in-app save).

## Build order (after sign-off)
1. `src/core/sources.js`: pure m4a/mp4 atom reader (`©cmt`, `©lyr`, `tx3g`) plus tests on the six real files.
2. Schema `source` + `asset` catalog command (get/set source), and an MCP tool.
3. The importer fills it on drop; subtitles go into `asset.words` at line level.
4. Asset inspector Suno panel: link, cover, prompt, lyrics, "Fetch from Suno", and an embed player.
5. The round-trip send/receive writes `sent` + `parent`.
6. Backfill Borrowed Light: render1/render2 get sources, and the four demucs stems get `derived`.
