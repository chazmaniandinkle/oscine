# Sources: Suno songs and your own files

An asset is a song or stem the clips point at. It can say where it came from
(`asset.source`) and it can hold several audio files for the same thing
(`asset.variants`), with one chosen to play (`asset.preferred`). The format
stays v2: all of this is optional and old projects load unchanged.

## asset.source

```json
"source": {
  "kind": "suno",
  "id": "39802a94-8c2f-49b7-bb77-79bfe022b18d",
  "url": "https://suno.com/song/39802a94-8c2f-49b7-bb77-79bfe022b18d",
  "created": "2026-09-22T23:31:44Z",
  "title": "The Field Remains", "style": "Electronic ballad, ...", "model": "v6 chirp-goose",
  "task": "cover", "duration": 231.64, "cover": "https://cdn2.suno.ai/...jpeg",
  "lyrics": { "text": "[Intro ...", "from": "file" },
  "sent": { "lyrics": "borrowed-light-suno-lyrics-v14-SEND.txt", "style": "borrowed-light-suno-style-v13b-dynamics.txt", "confidence": "guess" },
  "parent": null,
  "provenance": { "id": "file", "lyrics": "file", "title": "page", "sent": "user" },
  "fetched": "2026-09-23T18:40:32Z",
  "raw": { "...": "the clip object as Suno sent it" }
}
```

For stems and edits: `{ "kind": "derived", "from": "<assetId>", "by": "demucs" }`.

`provenance` says where each field came from: `file` (the download's own
tags), `page` (the public song page), `library` (an imported clip list),
`user`, or `sent-guess`. When two sources disagree, the higher one keeps the
field: user, then file, then page and library, then sent-guess. So fetching
the page never overwrites the lyrics the file carries.

Suno's own lineage (cover of, extended from) reads as the zero UUID unless
you're logged in, so `parent` is usually null. Oscine records its own lineage
in `sent` and in `derived` sources.

## Variants

```json
"variants": {
  "default": { "sha256": "d64e...", "ext": "m4a", "origin": "suno-download", "filename": "render2-v14.m4a",
               "codec": "opus", "sampleRate": 48000, "channels": 2, "duration": 231.64, "addedAt": "..." },
  "user":    { "sha256": "42a8...", "ext": "wav", "origin": "user", "filename": "my-bounce.wav",
               "codec": "pcm_s24le", "sampleRate": 48000, "channels": 2, "duration": 231.65, "addedAt": "..." }
},
"preferred": "user"
```

A clip names its asset, not a file. Which file plays: the variant the clip
pins (`clip.representation`), else `asset.preferred`, else `default`, else
the first one. So when a better file turns up (a WAV export, your own
bounce, a re-download), add it as a variant and prefer it: every clip on
that asset switches, none break, and one undo switches back.

Origins: `suno-download`, `suno-stream`, `user`, `render`, `derived`, `import`.

## The Suno library

`<workspace>/.oscine/suno-library.json` indexes every Suno song Oscine has
seen, metadata only. It is per workspace, not inside a project.

```json
{ "version": 1, "updated": "...",
  "songs": { "<id>": { "...source fields": "", "seenIn": ["..."],
                       "localFiles": [{ "path": "...", "sha256": "...", "variantKind": "suno-download" }] } } }
```

How it fills:

- **scan** reads the Suno id from each `.m4a`/`.mp3` under the workspace (plus
  any folders you add, like Downloads). Files are only read.
- **import** takes raw Suno clip objects from anything that has them (a
  library export, a saved page, a paste) and merges them. That is the seam
  for a future library collector; Oscine has no Suno login.
- **fetch** reads one public song page when you ask for it, and caches the
  result. At most one request every 2 s, and the whole library only with
  `all: true, max: N` (N up to 25).

No audio is ever downloaded from Suno.

## Commands (MCP tools)

| Tool | Actions |
|---|---|
| `oscine_asset` | `list`, `get`, `source` (set, merge, clear), `variant-add` (`sha256` already in assets/, or `path` under the workspace, copied in and probed), `variant-remove`, `prefer`, `import` (a new asset from a file; Suno tags fill its source) |
| `oscine_suno` | `library`, `scan`, `import`, `fetch`, `link` (copy a library song onto an asset as its source, with optional `sent`) |

Each edit is one undo step (`assetSourceSet`, `assetVariantAdd`,
`assetVariantRemove`, `assetPrefer`, `assetAdd` in the store).

## In the app

Click a source in the bin. The inspector shows a Suno card (cover, title
linking to suno.com, style, model, task, created, what was sent, lyrics
folded) with **Fetch from Suno**, then **Variants**: each file with its
origin and format, the playing one marked, **Prefer** on the others, and
**Add file...** (a path under the workspace, or drop a file on the panel).
