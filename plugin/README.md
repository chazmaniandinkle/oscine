# Oscine plugin

Compose and arrange music with Claude. This plugin bundles Oscine (a no-build
browser DAW) and a zero-dependency sidecar that Claude starts and stops for
you.

## What the sidecar does

One node process, spawned via this plugin's `.mcp.json`:

- speaks MCP over stdio (every catalog command, plus the sidecar tools below)
- serves the bundled app at `http://127.0.0.1:7321/` (next free port if busy)
- serves project files from `OSCINE_PROJECT_ROOT`, so the app can open and
  save `*.oscine.json` projects and stream their audio
- runs a local whisper on request to transcribe audio (`POST /transcribe`)
- hosts the WebSocket bridge the app connects back through
- runs an OSC gateway on `udp://127.0.0.1:7340` for hardware and software
  control surfaces

So: install the plugin, ask Claude to "open oscine", click once in the tab
(browser audio policy), and start asking for beats, basslines, patches, or mix
moves. Everything Claude does lands live in your session and is undoable.

## Tools

One tool per app command: status, transport, project
(get/new/load/rename/undo/redo), list_instruments, add_track, remove_track,
rename_track, select_track, set_mix, set_master, set_params, get_notes,
set_notes, get_steps, set_steps, slots, midi, preview, export_wav, share,
ledger, and for arrangement projects arrangement (get), clip
(get/set/split/duplicate/move/remove/place), lane
(add/remove/rename/set/reorder), marker (list/add/move/rename/remove), cycle
(get/set/clear), range (cut/ripple_delete), insert (list/add/set/remove/move),
automation (list/set_points/add_point/remove_point/clear) and words
(get/set). The list is generated from the app's own command registry
(`app/src/api/commands.js`), so app capability and MCP surface can't drift
apart.

Sidecar-level tools (no app command behind them):

- `oscine_open_app` opens the app in a browser.
- `oscine_sessions` lists the open Oscine tabs and picks which one commands
  target. Each tab is a stable session; commands go to the most recently
  opened one unless you pass `session` (instance id, clientId, or project
  name). `status` reports every open instance.
- `oscine_project_open_file` loads a `*.oscine.json` from the project root
  into the running app (validated and migrated to the current format, one
  undo away).
- `oscine_project_save_file` writes the running project to a
  `*.oscine.json` under the project root. It only ever writes project
  documents, never audio.

The bundled skills are also exposed as MCP resources (`resources/list`,
`resources/read`), so an agent can find them without loading them.

Arrangement projects are editable over MCP: open one with
`oscine_project_open_file`, read it with `oscine_arrangement`, edit with the
clip/lane/marker/cycle/range/insert/automation/words tools (each edit is one
undo step), then save with `oscine_project_save_file`. Times are seconds.

## HTTP routes

| Route | What |
|---|---|
| `GET /health` | server name, version, connected instances |
| `GET /projects.json` | every `*.oscine.json` under the project root |
| `GET /project-doc/<path>` | a project document, with `baseUrl` set for its assets |
| `PUT /project-doc/<path>` | save a project document (`.oscine.json` only; `baseUrl` stripped) |
| `GET /project/<path>` | files under the project root, with byte ranges (audio streaming) |
| `POST /reveal` | `{path}` → open that file's folder in Finder (or the OS file manager), file selected. Same-origin pages only. |
| `POST /transcribe` | `{file, from?, to?, model?, force?}` → words `[{s,e,t}]` in source seconds |

All paths are relative to `OSCINE_PROJECT_ROOT` and can't escape it.
`/transcribe` reads audio files only and caches results next to the project
(`stems/words/<sha256>[_span].<model>.json`), so repeating a request is free.

## OSC

Anything that speaks OSC over UDP (TouchOSC, Open Stage Control, Max/MSP, Pd,
SuperCollider, Sonic Pi, Reaper) can control Oscine and receive feedback. The
address space maps onto the same command catalog the MCP tools use. Track names
with spaces use `_` in addresses.

Control:

```
/oscine/play  /oscine/stop  /oscine/toggle
/oscine/bpm 168          /oscine/swing 0.12      /oscine/metronome 1
/oscine/master/volume 0.85          (also delayFeedback, delayReturn,
                                     delayDiv, verbSize, verbReturn)
/oscine/track/Bass/gain 0.8         /oscine/track/Bass/pan -0.3
/oscine/track/Bass/mute 1           /oscine/track/Bass/solo 1
/oscine/track/Bass/send/delay 0.3   /oscine/track/Bass/send/reverb 0.4
/oscine/track/Bass/param/cutoff 800 /oscine/track/Bass/preset Acid_Bass*
/oscine/track/Keys/note 64 0.8      /oscine/track/Drums/hit snare 1
/oscine/track/Bass/select
/oscine/slot/select B               /oscine/slot/bars 4
/oscine/slot/copy A D
/oscine/project/undo                /oscine/project/redo
/oscine/midi/in 144 60 100          (raw MIDI bytes; see the repo README)
/oscine/cmd set_notes {"track":"Bass","mode":"clear"}   (escape hatch)
```

(* preset names are sent as string args, so spaces are fine there; the
underscore convention applies only to track names inside the address path.)

Feedback: send `/oscine/subscribe [port]` (port defaults to the sender's
source port). Subscribers receive `/oscine/position bar beat` and
`/oscine/meter/<track>` at about 10 Hz while playing, plus `/oscine/transport`,
`/oscine/bpm`, and `/oscine/slot` on change. `/oscine/unsubscribe` and
`/oscine/ping` do what they say.

## Configuration

- `OSCINE_PORT` (env in `.mcp.json`): HTTP/bridge port, default 7321.
- `OSCINE_OSC_PORT`: OSC UDP port, default 7340.
- `OSCINE_PROJECT_ROOT`: the folder project files are opened from and saved
  to. Defaults to the directory the sidecar was started in.
- `OSCINE_ALLOWED_ORIGINS`: comma-separated origins allowed to connect to the
  bridge in addition to localhost. Ships allowing the project's GitHub Pages
  URL so the hosted app can use your local sidecar; add your own fork's Pages
  origin here. Everything else is rejected, so random websites can't drive your
  session.
- `OSCINE_WHISPER`, `OSCINE_WHISPER_MODELS`, `OSCINE_FFMPEG`: paths for
  transcription. Defaults: `~/.local/bin/whisper` (the openai-whisper CLI),
  `<project root>/tmp/whisper-models`, and `ffmpeg` on PATH. Transcription is
  optional; nothing else needs them.

## Installing and updating locally

Install Oscine as a **marketplace** plugin, not by uploading the `.plugin`
file. Uploaded ("My Uploads") plugins have no update path (every release needs
a manual re-upload), whereas a marketplace install updates with one command.

One-time setup (remove any uploaded copy first, via Settings):

```sh
claude plugin marketplace add chazmaniandinkle/oscine   # or a local path:
# claude plugin marketplace add /path/to/oscine  (test before merge)
claude plugin install oscine@oscine
```

After each release (once it's merged to `main`):

```sh
npm run release:local        # = claude plugin marketplace update oscine
                             #   && claude plugin update oscine@oscine
```

Then restart Claude (or `/reload-plugins`) and reopen the app tab. The repo
root is itself the marketplace (`.claude-plugin/marketplace.json`, plugin
`source: ./plugin`), so the same repo serves both GitHub and local installs.

## Development

The app under `app/` is a synced copy of the Oscine repo (see the repo's
`tools/sync-plugin.mjs`). Edit the repo, run the sync, repackage.

For inner-loop work, skip install entirely: `npm run plugin:dev`
(`claude --plugin-dir ./plugin`) loads this plugin directly and
`/reload-plugins` picks up edits without repackaging. To run the sidecar
against a folder of projects without Claude at all, use the repo's
`scripts/dev-sidecar.sh`.

Requires node 18+ on PATH.
