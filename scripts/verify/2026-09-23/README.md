# Verification harnesses, 2026-09-23

The scripts that proved each feature shipped in 2.0.1 through 2.2.0, kept so
the checks can be rerun or copied. Each one drives the real app (headless
Chrome over CDP, or playwright-core) against the dev sidecar and reads state
back from `window.oscine`, then undoes its changes. None saves the project.

Setup they assume: the dev sidecar on :7351 with `OSCINE_PROJECT_ROOT` set to
the cog workspace (`scripts/dev-sidecar.sh`), and for the `.py` ones a
headless Chrome with `--remote-debugging-port=9333` plus `websocket-client`
(the cog workspace venv at `tmp/venv-mir`). The `.mjs` ones launch their own
Chrome through `node_modules/playwright-core`. Paths inside are absolute to
Chaz's machine; adjust before running elsewhere.

| Script | Proves |
|---|---|
| fixtest.py | transport stops at song end; mixer resize; lyrics bar lane picker |
| scrolltest.py | vertical lane scroll, ruler pinned |
| reordertest.py | lane reorder by dragging the name |
| transtest.py | transcribe a clip span through the sidecar's whisper; merge |
| clipenv.py | clip-relative envelope travels with the clip; stacks with clip gain |
| duptest.py | drag clip between lanes; ⌥-drag duplicate |
| markertest.py | markers: add, rename, drag, section select, nav, delete, persist |
| looptest.py | cycle region: gapless wrap, independent of range, bar drag |
| rippletest.py | ripple delete: clips, markers, cycle, automation shift; audio match |
| look.py / look2.py / mixdom.py | full-app review: load timing, mixer/gutter layout |
| eardebug.py / earlive.py | ear worker health; background profiling completes (27.7 s) |
| earbench.mjs / eareq.mjs | FFT NSDF speed, and identical pitch to the old direct NSDF |
| mcpdrive.mjs | arrangement editing through real MCP tools, then 10 undos |
| nosagan.mjs | render a clone with a lane muted to WAV (the no-Sagan bounce) |
| revealtest.mjs | File > Show in Finder and ⌘⇧R |
| automation-ui/ | the automation-UI agent's harness (t1..t4) and its screenshots |
