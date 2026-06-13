# Oscine plugin

Compose music with Claude. This plugin bundles the Oscine synth composer
(a no-build browser app) and a zero-dependency sidecar that Claude
Desktop manages for you.

## What the sidecar does

One node process, spawned via this plugin's `.mcp.json`:

- speaks MCP over stdio (18 `oscine_*` tools)
- serves the bundled app at `http://127.0.0.1:7321/` (next free port if busy)
- hosts the WebSocket bridge the app connects back through
- runs an OSC gateway on `udp://127.0.0.1:7340` for hardware and
  software control surfaces

So: install plugin, ask Claude to "open oscine", click once in the tab
(browser audio policy), and start asking for beats, basslines, patches,
or mix moves. Everything Claude does lands live in your session and is
undoable.

## Tools

`oscine_open_app` plus one tool per app command: status, transport,
project (get/new/load/rename/undo/redo), list_instruments, add_track,
remove_track, rename_track, select_track, set_mix, set_master,
set_params, get_notes, set_notes, get_steps, set_steps, slots, preview.

The tool catalog is generated from the app's own command registry
(`app/src/api/commands.js`), so app capability and MCP surface cannot
drift apart.

## OSC

Anything that speaks OSC over UDP (TouchOSC, Open Stage Control,
Max/MSP, Pd, SuperCollider, Sonic Pi, Reaper) can control Oscine and
receive feedback. The address space maps onto the same command catalog
the MCP tools use. Track names with spaces use `_` in addresses.

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
/oscine/cmd set_notes {"track":"Bass","mode":"clear"}   (escape hatch)
```

(* preset names are sent as string args, so spaces are fine there;
the underscore convention applies only to track names inside the
address path.)

Feedback: send `/oscine/subscribe [port]` (port defaults to the sender's
source port). Subscribers receive `/oscine/position bar beat` and
`/oscine/meter/<track>` at ~10Hz while playing, plus `/oscine/transport`,
`/oscine/bpm`, and `/oscine/slot` on change. `/oscine/unsubscribe` and
`/oscine/ping` do what they say.

## Configuration

- `OSCINE_PORT` (env in `.mcp.json`): HTTP/bridge port, default 7321.
- `OSCINE_OSC_PORT`: OSC UDP port, default 7340.
- `OSCINE_ALLOWED_ORIGINS`: comma-separated origins allowed to connect
  to the bridge in addition to localhost. Ships allowing the project's
  GitHub Pages URL so the hosted app can use your local sidecar; add
  your own fork's Pages origin here. Everything else is rejected, so
  random websites cannot drive your session.

## Development

The app under `app/` is a synced copy of the Oscine repo (see the repo's
`tools/sync-plugin.mjs`). Edit the repo, run the sync, repackage.

Requires node 18+ on PATH.
