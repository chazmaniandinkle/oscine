# Platform-API opportunity backlog

This is a build-ready backlog of web-platform-API opportunities for Oscine. It
came out of an audit that ran seven lenses (concurrency/cross-tab, storage/files,
page lifecycle, sharing/PWA/OS, rendering, input devices, audio engine/capture)
over the codebase. Each item below is scoped to be picked up as-is and turned
into a build Workflow.

## How to use this

Open this file, pick a cluster (or a single id), and author a Workflow from the
detail card and the follow-up plan. Every item names the layers and files it
touches, whether it adds a catalog command, and how it degrades on browsers that
lack the API. The constraints recap (every item respects these):

- **Zero runtime dependencies.** No npm packages, no bundler. Hand-rolled
  wrappers only. Dev-only tooling (playwright for e2e) is fine but must never be
  required to run.
- **No build step.** Plain ES modules served as-is. New worker modules ship as
  plain `.js` files, resolved with `new URL('./x.js', import.meta.url)`.
- **Hosted-no-sidecar is the floor.** The primary surface is a static GitHub
  Pages page with no sidecar. Anything that needs the sidecar is a deepening, not
  a base capability.
- **The catalog is the contract.** Features land as `src/api/commands.js`
  commands first, UI second. UI/console/MCP/OSC parity holds. The smoke suite
  fails if a catalog command has no handler (`test/smoke.mjs:236-237`).
- **Project / share-link format is load-bearing.** `src/core/schema.js` is both
  the in-memory shape and the on-disk `.oscine.json`, and the share link encodes
  it. Synth-only projects must stay byte-identical; binary bytes live out-of-band.

Layer rules from `AGENTS.md` hold throughout: `src/core/` is node-importable
(no DOM, no audio), `src/engine/` is audio-only and never mutates the project,
`src/ui/` is DOM-only, `src/api/` is the programmatic surface. Guard
`window`/`navigator`/`document` access with `typeof` so `core/` still imports in
node.

## Prioritized backlog

Sorted by priority (P0, P1, P2, P3) then by impact (high before medium before
low). Effort is S (small), M (medium), L (large).

| id | title | domain | priority | impact | effort | contract impact | browser support | depends-on |
|---|---|---|---|---|---|---|---|---|
| `web-locks-autosave-leader` | Web Locks autosave leader to stop cross-tab clobber | Cross-tab | P0 | high | L | optional `project` reload action; leader is plumbing | Web Locks Chromium/FF/Safari (secure ctx); storage event universal | none |
| `flush-autosave-on-pagehide` | Flush the debounced autosave on visibilitychange/pagehide | Page lifecycle | P0 | high | S | none (invisible durability fix) | universal incl. mobile Safari | none |
| `background-tab-clock-via-visibility-and-worker` | Worker/AudioWorklet clock + visibility resync (gate 5) | Page lifecycle | P0 | high | L | none (internal scheduler) | Workers + visibility universal | none |
| `indexeddb-asset-store` | Hash-addressed sample asset store on IndexedDB (gate 1) | Storage | P1 | high | L | new `asset` command + required smoke check | IDB universal; crypto.subtle secure-ctx | `opfs-large-asset-storage`, `structured-clone-deepclone` |
| `broadcastchannel-tab-presence` | BroadcastChannel tab presence + sidecar-free peer count | Cross-tab | P1 | high | M | new read-only `presence` command | BroadcastChannel evergreen; Safari 15.4+ | none |
| `gate-raf-loop-on-visibility-and-activity` | Gate the single rAF loop on visibility and activity | Rendering | P1 | high | S | none (client-side render affordance) | Visibility + rAF universal | none |
| `file-system-access-save-open` | Real Save/Open with a retained file handle | Storage | P1 | high | M | extend `project` with save/export action | Chrome/Edge 86+ only (secure ctx) | none |
| `web-share-song-link-and-wav` | Web Share API: native share sheet for link and WAV | Sharing/PWA | P1 | high | S | none for link; surface WAV Blob from `cmd_export_wav` | Chrome/Safari/Samsung; not FF desktop | none |
| `web-locks-midi-owner-election` | Web Locks single-owner election for WebMIDI input | Cross-tab | P1 | high | M | none (extends `midi` status payload) | Web Locks Chromium where MIDI exists | `broadcastchannel-tab-presence` |
| `compressionstream-share-link` | Gzip the share-link payload with CompressionStream (gate 2) | Storage | P1 | medium | M | `cmd_share` goes async; no new command | CompressionStream Chrome 80/FF 113/Safari 16.4/node 18+ | none |
| `web-app-manifest-installable-pwa` | Web App Manifest: installable, standalone PWA | Sharing/PWA | P1 | medium | S | none; mandatory `sync-plugin.mjs` SOURCES edit | Chromium full; Safari/iOS subset via apple-* | none |
| `record-live-output` | Record live master output (MediaStreamDestination + MediaRecorder) | Audio/capture | P2 | high | M | new `record` command + required smoke check | MediaRecorder Chrome/Edge/FF; Safari 14.1+ codec quirks | none |
| `media-session-lockscreen-transport` | navigator.mediaSession: lock-screen + media-key transport | Sharing/PWA | P2 | medium | S | none (rides `transport` command) | Chrome/Safari full; FF metadata+play/pause | (manifest, soft) |
| `persistent-storage-for-autosave-and-assets` | Request persistent storage so the autosave is not evicted | Page lifecycle | P2 | medium | S | optional additive `status` storage block | persist() Chrome 55/FF 57/Safari 15.4 | none |
| `opfs-large-asset-storage` | OPFS as the bulk-bytes backend with persisted durability | Storage | P2 | medium | M | folds into `asset` command (usage/estimate action) | OPFS Chrome 86/FF 111/Safari 15.2 | `indexeddb-asset-store` |
| `drag-drop-import` | Drag-and-drop import of `.oscine.json` (and later samples) | Storage | P2 | medium | S | none (reuses `store.load`) | universal | `indexeddb-asset-store` (sample branch only) |
| `launchqueue-file-handler` | Open `.oscine.json` from the OS via launchQueue | Storage | P2 | medium | S | none (funnels into `store.load`) | Chrome/Edge 102+, installed PWA only | `file-system-access-save-open` (soft) |
| `page-lifecycle-freeze-resume-handling` | Handle Page Lifecycle freeze/resume to resync transport | Page lifecycle | P2 | medium | M | none (engine lifecycle) | freeze/resume Chrome only; visibility fallback | `background-tab-clock-via-visibility-and-worker` |
| `analyser-spectrum-visualizer` | AnalyserNode spectrum/scope + RMS metering | Rendering | P2 | medium | M | new `view` command (visualizer mode) + smoke check | AnalyserNode reads universal | `gate-raf-loop-on-visibility-and-activity` |
| `cache-theme-vars-and-reduced-motion` | Cache resolved theme CSS vars off the paint hot path | Rendering | P2 | medium | S | none | getComputedStyle/MutationObserver baseline | none |
| `gamepad-pad-bank-transport-remote` | Gamepad API: controller as pad bank + transport remote | Input | P2 | medium | L | new `gamepad` command + `/oscine/gamepad/*` OSC + smoke | Chrome/Edge/FF/Safari (secure ctx) | none |
| `pointer-lock-infinite-knob-drag` | Pointer Lock for unbounded knob/fader/NumberDrag drags | Input | P2 | medium | S | none (values flow through existing commands) | Chrome/Edge/FF full; Safari standard | none |
| `service-worker-offline-shell` | Service Worker: offline app shell | Sharing/PWA | P2 | medium | M | none; sw.js into SOURCES, CACHE_VERSION per release | SW + Cache Storage all secure-ctx browsers | `web-app-manifest-installable-pwa` |
| `web-locks-transport-audio-owner` | Web Locks single audio/transport owner across tabs | Cross-tab | P2 | medium | L | `transport` result gains owner reason; all play paths routed | Web Locks Chromium/FF/Safari (secure ctx) | `web-locks-autosave-leader`, `broadcastchannel-tab-presence` |
| `latency-compensated-playhead` | Compensate the playhead with getOutputTimestamp/outputLatency | Audio/capture | P2 | medium | S | none (read-only display change) | getOutputTimestamp Chrome/Edge/FF; Safari partial | none |
| `storage-event-cross-tab-settings` | storage event to sync MIDI config across tabs | Cross-tab | P3 | low | S | none (routes through `store.configureMidi`) | storage event universal | `web-locks-midi-owner-election` |
| `prefers-reduced-motion-and-color-scheme` | Honor prefers-reduced-motion and declare color-scheme | Rendering | P3 | medium | S | none (OS query); optional `view` override | all baseline | none |
| `stepgrid-resizeobserver-and-intersection-virtualization` | ResizeObserver sizing + IntersectionObserver virtualization | Rendering | P3 | medium | M | none | observers baseline; container queries Chrome 105/FF 110/Safari 16 | `gate-raf-loop-on-visibility-and-activity` |
| `navigator-vibrate-pad-feedback` | navigator.vibrate: haptic pad/step feedback | Input | P3 | low | S | none (UI-only affordance) | Android Chromium only; iOS no-op | none |
| `permissions-api-midi-gamepad-status` | Permissions API to reflect MIDI device state (MIDI-scoped) | Input | P3 | low | S | none (enriches `midi` status) | permissions broad; {name:'midi'} Chromium only | none |
| `choose-output-device` | Let users pick the audio output device with setSinkId | Audio/capture | P3 | low | M | new `output` command + smoke check | setSinkId Chrome/Edge 110+; FF partial; not Safari | none |
| `view-transitions-editor-routing` | View Transitions API for editor routing and toggles | Rendering | P3 | low | S | none | same-doc VT Chrome 111/Safari 18; FF rolling out | `prefers-reduced-motion-and-color-scheme` |
| `offscreencanvas-pianoroll-worker` | Move piano-roll painting to an OffscreenCanvas worker | Rendering | P3 | high | L | none (worker mirrored by recursive sync) | OffscreenCanvas Chrome/FF; Safari 16.4+ | `cache-theme-vars-and-reduced-motion` |
| `badging-api-recording-indicator` | Badging API: app-icon badge for record-arm state | Sharing/PWA | P3 | low | S | none (derived from midi state) | Chrome/Edge desktop + installed PWAs | `web-app-manifest-installable-pwa` |
| `sharedworker-bridge-singleton` | SharedWorker as a single sidecar bridge for all tabs | Cross-tab | P3 | low | L | none (same CommandAPI; transport-only change) | Chrome/Edge/FF; Safari does NOT support | `broadcastchannel-tab-presence`, `web-locks-transport-audio-owner` |
| `structured-clone-deepclone` | Replace JSON deepClone with structuredClone | Storage | P2 | low | S | none (internal helper swap) | structuredClone Chrome 98/FF 94/Safari 15.4/node 17+ | none |
| `constant-source-master-mod` | ConstantSourceNode for a shared modulation/automation source | Audio/capture | P3 | low | M | none (primitive); the automation feature it enables would add one | ConstantSourceNode universal | none |
| `keyboard-lock-fullscreen-performance` | Keyboard Lock so perform-mode shortcuts survive fullscreen | Input | P3 | low | M | optional `perform`/`view` command only if it ships | Keyboard Lock Chrome/Edge only | `gamepad-pad-bank-transport-remote` |

## Detail cards

Grouped by cluster. Each card carries what it enables, current state with file
refs, the proposed approach, affected layers/files, the catalog-contract
implication, effort/impact, browser support and graceful degradation, constraint
fit, risks, and dependencies.

### Cluster 1: Cross-tab safety + autosave durability

Stop silent data loss and make multi-tab behavior coherent on the bare Pages
page with no sidecar. Anchored by the live autosave cross-tab clobber defect plus
the terminal-flush gap. Presence is the shared substrate the lock/election items
build on.

---

#### `web-locks-autosave-leader` (P0, high, L)

**What it enables.** Stops two tabs from silently overwriting each other's
autosave. `src/core/persist.js` writes a single `localStorage` key
(`oscine.project.v1`) on a 600ms debounce with no coordination, so last-writer
wins and the other session's work is destroyed. Leader election plus a
storage-event reconcile makes the single-key model safe.

**Current state.** Pure last-writer-wins on one key. No storage listener exists
(`src/core/persist.js` has none). No dirty bit. `loadInitialProject` reads once
at boot and never re-checks.

**Proposed approach.** (1) Wrap the autosave `setItem` in
`navigator.locks.request('oscine.autosave')` and gate on a per-tab dirty flag so
a passive tab cannot clobber an active one. (2) Add a window `storage` listener
keyed on `STORAGE_KEY`; a non-dirty tab adopts the new project via `store.load`
(emits `project:replaced`, already handled). A dirty tab surfaces a "changed in
another tab" choice instead of auto-adopting. Same single key, same format.

**Affected layers/files.** core, ui, api. `src/core/persist.js`, `src/main.js`,
`src/core/store.js`, `src/ui/app.js`, `src/api/commands.js`, `src/api/api.js`,
`test/smoke.mjs`.

**Catalog-contract implication.** Storage-event adopt routes through
`store.load` (existing mutation point). The optional user-facing "reload from
autosave" / "keep mine" choice belongs as a `project` command action in
`src/api/commands.js` plus a smoke shape check. Leader election itself is
internal plumbing, no command.

**Effort/impact.** L / high. L only because it must add a dirty bit and a
conflict-resolution affordance. The cost is justified by it being a real defect.

**Browser support + degradation.** Web Locks: Chrome 69+/Firefox 96+/Safari
15.4+, secure-context only (Pages qualifies). The storage event is universal and
degrades independently. Without locks, keep the storage-event reconcile, which
alone converts silent clobber into a detectable event. Without either, exactly
today's behavior.

**Constraint fit.** Zero-dep, no-build, no sidecar. No schema/share/on-disk
change. core/ stays node-importable via `typeof` guards on `window`/`navigator`,
matching the existing localStorage guards.

**Risks.** The "has local edits" dirty guard is load-bearing; a wrong guard
trades one clobber for another. The dirty bit does not exist today and must be
added (set on any non-ephemeral bus event per `EPHEMERAL_PREFIXES`, clear on
write). Adopt discards the receiving tab's per-tab undo stack (reset by
`store.load`).

**Dependencies.** None. Benefits from the presence bus wiring landing first.

---

#### `flush-autosave-on-pagehide` (P0, high, S)

**What it enables.** An edit made within 600ms of closing, navigating, or
backgrounding is silently lost today. A terminal flush makes autosave durable at
the moment of departure, which is exactly when people lose work.

**Current state.** `src/core/persist.js` `attachAutosave` wraps the write in
`debounce(600)` with no terminal flush. No `pagehide`/`visibilitychange`/
`beforeunload` listener exists anywhere. `src/ui/midi.js` `persist()` has the
same gap.

**Proposed approach.** Expose `flushNow()` in `src/core/persist.js` that writes
`store.serialize()` synchronously, bypassing the debounce. Register
`visibilitychange` (flush when `visibilityState === 'hidden'`) plus a `pagehide`
fallback. Prefer attaching from `src/main.js` (already adds window listeners), or
`typeof`-guard the access since persist.js is core/. `src/ui/midi.js` `persist()`
flushes on the same signal.

**Affected layers/files.** core. `src/core/persist.js`, `src/main.js`,
`src/ui/midi.js`.

**Catalog-contract implication.** No catalog command. This is an invisible
durability fix to an existing mechanism, not a user capability. Guard
`document`/`window` access with `typeof`.

**Effort/impact.** S / high.

**Browser support + degradation.** `visibilitychange` and `pagehide` are
universal including mobile Safari, no secure-context requirement. Attach whichever
events exist; if none fire, the 600ms debounce remains. Strictly additive.
`setItem` is already wrapped in try/catch.

**Constraint fit.** Zero-dep, no-build, pure platform events. Works on bare
Pages (localStorage path). No format change. No invariant tension.

**Risks.** `beforeunload` harms bfcache and must NOT be the primary hook; rely
on `visibilitychange` + `pagehide`.

**Dependencies.** None. The canonical quick win to pull forward.

---

#### `broadcastchannel-tab-presence` (P1, high, M)

**What it enables.** Makes the multi-tab indicator work on bare GitHub Pages
with no sidecar. Today peer count only shows when the WebSocket sidecar pushes a
session message, so with no sidecar it is permanently absent. A user with the
same song open in three tabs has no idea. A same-origin BroadcastChannel presence
ring gives identical "N tabs open" awareness purely client-side, and it is the
foundation the other cross-tab items build on.

**Current state.** Peer awareness is 100% sidecar-derived (`bridge:sessions`
only from a server session frame; `src/ui/transportbar.js` renders it). No
BroadcastChannel anywhere. On Pages the bridge never connects, so peers is
effectively 1.

**Proposed approach.** Add `src/core/presence.js` (node-importable, feature-detect
BroadcastChannel and sessionStorage, no-op when absent). Each tab joins channel
`oscine.presence`, posts `{hello,id,name,ts}` with the existing per-tab clientId
(lift the `src/api/bridge.js` clientId() into core behind a `typeof` guard).
Maintain a Map pruned by heartbeat (about 3s post, about 8s drop), post `{bye}`
on `pagehide`. Surface count via a new `presence:peers` bus event that
transportbar consumes with the same rendering it has for `bridge:sessions`
(sidecar count when bridged, BroadcastChannel otherwise).

**Affected layers/files.** core, ui, api. `src/core/presence.js`, `src/main.js`,
`src/ui/transportbar.js`, `src/api/bridge.js`, `src/api/commands.js`,
`src/api/api.js`, `test/smoke.mjs`.

**Catalog-contract implication.** Add a read-only `presence` command (or fold
into `status`) + `cmd_presence` returning `{tabs,self,peers}`, for UI/console/MCP
parity. Must pass smoke shape checks (description over 20 chars,
`input.type === 'object'`, `cmd_` handler present, see `test/smoke.mjs:234-237`).
No OSC route needed.

**Effort/impact.** M / high.

**Browser support + degradation.** BroadcastChannel evergreen; Safari 15.4+. No
secure-context requirement (works on http localhost and https Pages). Same-origin
only by design. Feature-detect; when absent, presence.js no-ops and the indicator
falls back to today's behavior.

**Constraint fit.** Zero-dep, no-build, pure client, works as a static page with
no sidecar. core/ stays node-importable: BroadcastChannel/sessionStorage touches
are feature-detected and the channel opens only from the browser entry.

**Risks.** BroadcastChannel does not deliver to the posting tab, so
self-presence is tracked locally. Backgrounded-tab heartbeat throttling can make
a sleeping tab look stale; tune the drop window generously and treat the count as
advisory, not a lock.

**Dependencies.** None. It is the reusable substrate for the MIDI/transport owner
items.

---

#### `web-locks-midi-owner-election` (P1, high, M)

**What it enables.** Fixes silent double-capture of a hardware controller across
tabs. `src/ui/midi.js` binds `input.onmidimessage` independently in every tab, so
with a controller enabled in two tabs both preview AND record every note.
Electing one MIDI owner makes the controller behave like a single instrument
across the origin.

**Current state.** No ownership coordination. Each `MidiInput` binds the handler
on its own; `unbindAll` only runs on local disable. No election, no lock, no
awareness of other tabs. `store.ui.midi.enabled` is per-tab.

**Proposed approach.** Acquire
`navigator.locks.request('oscine.midi-owner', {mode:'exclusive'})` when a tab
enables MIDI; the callback holds for the lifetime of ownership. Only the
lock-holder binds `onmidimessage`; non-owners keep config but bind nothing. Use
`{ifAvailable:true}` to detect "owned elsewhere" and report
`owned`/`ownerElsewhere` via `store.reportMidi` so the transport bar shows "MIDI
active in another tab". Pair with the presence BroadcastChannel to announce
takeover (lock release alone is sufficient for correctness; broadcast is only for
snappy UI).

**Affected layers/files.** ui, core, api. `src/ui/midi.js`, `src/core/store.js`,
`src/api/commands.js`, `src/api/api.js`, `src/ui/transportbar.js`,
`test/smoke.mjs`.

**Catalog-contract implication.** No new command. The `midi` command's status
action should report ownership in its `midiState`, reflected in `cmd_status`'s
midi block; extend the existing payload with an `owner` flag. No OSC change.

**Effort/impact.** M / high.

**Browser support + degradation.** Web Locks Chrome/Edge 69+/Firefox 96+/Safari
15.4+, secure-context required. WebMIDI is Chromium-only and Web Locks ships in
Chromium, so the pairing is reliable exactly where MIDI works. Feature-detect
`navigator.locks`; when absent, today's first-come-both-bind behavior (the bug
stays, nothing new breaks).

**Constraint fit.** Zero-dep, no-build, pure client, no sidecar. Lives in ui/
(the only layer allowed to touch `requestMIDIAccess`). Secure-context satisfied
by Pages.

**Risks.** A held exclusive lock releases on tab crash/close automatically.
Document that the held promise IS the ownership token (devs may expect `request()`
to resolve quickly). Gate re-acquire behind a user action (enabling MIDI), not a
tight retry loop, to avoid livelock.

**Dependencies.** `broadcastchannel-tab-presence` (for snappy UI only, not
correctness).

---

#### `storage-event-cross-tab-settings` (P3, low, S)

**What it enables.** Keeps per-tab persisted settings consistent without a
sidecar. `src/ui/midi.js` persists MIDI config to its own key `oscine.midi` and
restores it only at construction. Change the controller channel or knob map in
one tab and others keep the stale config until reload. A storage listener
live-updates siblings, which matters once Web Locks elects a single MIDI owner.

**Current state.** MIDI config is written to localStorage but never re-read after
boot; no storage listener exists. Each tab's `store.ui.midi` is independent.

**Proposed approach.** Add a window `storage` listener (in `src/ui/midi.js` or a
small `src/core/crosstab.js`) scoped to the `oscine.midi` key; on a foreign
write, re-apply via `store.configureMidi` (emits `midi:config`, the manager
already reacts). Optionally mirror over the presence BroadcastChannel for lower
latency. Keep writes idempotent so a config echo does not loop (skip re-persisting
an identical foreign blob).

**Affected layers/files.** ui, core, api. `src/ui/midi.js`, `src/core/store.js`,
`src/main.js`, `test/smoke.mjs`.

**Catalog-contract implication.** None. Purely client-side sync of state already
reachable via the `midi` command. The storage path routes through
`store.configureMidi` (an existing mutation action). No OSC change.

**Effort/impact.** S / low. Lowest-value cross-tab item.

**Browser support + degradation.** The storage event is universal (no
secure-context requirement). BroadcastChannel (optional accelerator) Chrome/
Firefox + Safari 15.4+. If neither is available, tabs keep today's
boot-time-only restore.

**Constraint fit.** Zero-dep, no-build, no sidecar, no project-format change
(operates on the separate `oscine.midi` key). core/ node-importable since the
listener registers from the browser entry, `typeof window` guarded.

**Risks.** The storage event does not fire in the writing tab and only on a real
value change, so it cannot be the only sync channel. Guard against re-persist
loops when applying a foreign config.

**Dependencies.** `web-locks-midi-owner-election`.

---

#### `web-locks-transport-audio-owner` (P2, medium, L)

**What it enables.** Prevents two tabs of the same song from both running the
transport and emitting sound at once. `src/engine/transport.js` runs an
independent `setInterval` lookahead clock per tab; `src/engine/context.js` has one
AudioContext per tab. If a user opens the same project in two tabs and hits play
in both (easy once the storage-event sync mirrors them), they get two
unsynchronized clocks producing phased, doubled audio. Electing one playback owner
gives "the song" one voice per origin.

**Current state.** No playback-ownership coordination. Transport start/stop are
purely local. The UI play button (`src/ui/transportbar.js:25`) calls
`transport.toggle()` DIRECTLY, not through the API, and the spacebar shortcut
bypasses the API too, so an owner guard placed only in `cmd_transport` would be
bypassed.

**Proposed approach.** Gate the SINGLE play entry point behind
`navigator.locks.request('oscine.audio-owner', {ifAvailable:true})`. If
unavailable, another tab owns audio: refuse and surface "playing in another tab,
click to take over", or broadcast a takeover over the presence channel so the
current owner stops/releases. Hold the lock for the duration of playback; release
on stop/pagehide. Because the UI button, spacebar, api, MCP, and OSC all reach
playback, the guard cannot live only in `cmd_transport`. Either route every caller
(including the direct `src/ui/transportbar.js:25` toggle) through one owner-aware
guard, or place the check at `transport.play()` in engine/ behind a
`typeof navigator` guard (which bends the engine-is-audio-only rule and must be
flagged). Prefer a thin ui/api owner-guard all entry points call.

**Affected layers/files.** engine, api, ui. `src/engine/transport.js`,
`src/api/api.js`, `src/api/commands.js`, `src/ui/transportbar.js`, `src/main.js`,
`test/smoke.mjs`.

**Catalog-contract implication.** The `transport` command gains an
ownership-aware result (for example `{playing:false, reason:'owned-elsewhere'}`
or a takeover ack). But `cmd_transport` is NOT the only play path: the UI button
calls `transport.toggle()` directly, so the owner guard must wrap that call site
too (or live at the `transport.play` boundary), or the contract describes behavior
the UI bypasses. If the lock is placed in `src/engine/transport.js` it must be a
`typeof`-guarded no-op in node so headless tests still import it. No OSC change
beyond the existing transport route reflecting the new reason field.

**Effort/impact.** L / medium. Effort raised M to L because of the
all-entry-points refactor.

**Browser support + degradation.** Web Locks Chrome/Edge 69+/Firefox 96+/Safari
15.4+, secure-context only. Feature-detect `navigator.locks`; when absent, play
works as today (both tabs can play).

**Constraint fit.** Zero-dep, no-build, pure client, no sidecar. Does not touch
the project format. Layer caveat: keeping engine/ audio-only requires the lock in
a ui/api owner-guard all play entry points funnel through; placing it inside
transport.js bends the audio-only rule and must be `typeof`-guarded.

**Risks.** Lower-impact than MIDI/autosave (dual playback is annoying, not
data-destroying), and a determined user may WANT both. Make takeover explicit,
not automatic. Main risk is the multiple-entry-point routing: miss the
`transportbar.js` direct call and the lock does nothing.

**Dependencies.** `web-locks-autosave-leader`, `broadcastchannel-tab-presence`.
Build LAST in its cluster.

---

#### `sharedworker-bridge-singleton` (P3, low, L)

**What it enables.** Collapses N tabs' N WebSocket connections to the sidecar
into one shared connection, simplifying the split-brain problem the session
registry was built to manage. A SharedWorker holding ONE bridge connection,
fanning commands out over BroadcastChannel, means the sidecar sees a single
stable client and the in-browser presence layer decides which tab handles a
command.

**Current state.** Each tab runs its own Bridge, opens its own WebSocket, and
registers a separate session server-side (`registry.add`). The whole
SessionRegistry and `broadcastSessions()` machinery exists to referee these
independent connections. No SharedWorker is used.

**Proposed approach.** Move the WebSocket bridge into a SharedWorker
(`src/api/bridge-worker.js`). Tabs connect via a MessagePort; the worker
maintains the single sidecar socket and relays cmd/result frames to and from the
elected handler tab (use the Web Locks owner or a BroadcastChannel-elected
leader). The 10Hz state push runs from whichever tab is active. This is a
deepening of the shipped bridge, sidecar-only, strictly optional, with the
per-tab WebSocket path as the fallback.

**Affected layers/files.** api, ui. `src/api/bridge.js`,
`src/api/bridge-worker.js`, `src/main.js`, `plugin/server/oscine-mcp.mjs`,
`test/smoke.mjs`, `test/e2e-mcp.mjs`.

**Catalog-contract implication.** No new catalog command. Commands still execute
against the same CommandAPI (`api.execute`); only the transport of the cmd frame
changes. `test/e2e-mcp.mjs` needs a path that exercises the worker variant.

**Effort/impact.** L / low.

**Browser support + degradation.** SharedWorker Chrome/Edge and Firefox; Safari
does NOT support it. Feature-detect `typeof SharedWorker`; on Safari and anywhere
absent, fall back to today's per-tab WebSocket bridge, which the SessionRegistry
already handles correctly.

**Constraint fit.** Zero-dep, no-build (a SharedWorker is a plain ES module). It
ONLY benefits the sidecar setup; it does nothing for the bare GitHub Pages page,
so it is explicitly a sidecar-only deepening.

**Risks.** Highest-complexity, lowest-portability item: the Safari gap plus
SharedWorker debugging make the cost real. Ship presence + Web Locks election
first and revisit only if connection churn against the sidecar proves to be a
measured problem.

**Dependencies.** `broadcastchannel-tab-presence`,
`web-locks-transport-audio-owner`.

---

### Cluster 2: Background-tab clock + lifecycle robustness (gate 5)

The roadmap gate-5 fix: keep the transport steady in throttled, frozen, or hidden
tabs so arrangements left playing do not drift. Engine-only, no catalog surface
change, shares one `resync()` method across the items.

---

#### `background-tab-clock-via-visibility-and-worker` (P0, high, L)

**What it enables.** The `setInterval(25ms)` lookahead clock is throttled to
about 1Hz in hidden tabs, so a loop or song-mode arrangement left playing drifts
and stutters. A Worker (or AudioWorklet) timer keeps the scheduler waking at full
rate; a visibility-triggered resync corrects residual drift at the boundary.
Arrangements are the first thing users leave playing, so this gates unattended
playback. (Merges the worklet-clock-source angle: same gate-5 fix, two API
angles.)

**Current state.** `src/engine/transport.js` drives scheduling with
`setInterval(() => tick(), intervalMs = 25)` at line 93; the class comment (lines
11-13) and ROADMAP gate 5 both flag the Worker swap. `tick()` reads
`ctx.currentTime` so audio is sample-accurate but only fires as often as the
throttled timer allows. The rAF loop pauses when hidden. No `transport.resync()`
exists today.

**Proposed approach.** (1) Move only the wakeup tick into a tiny inline Blob-URL
Worker (no separate file, honors no-build; prefer this over AudioWorklet first to
avoid the addModule/URL wrinkle) that posts a message every `intervalMs`;
`transport.tick()` runs on receipt reading `ctx.currentTime` exactly as now.
(2) Add a visibility listener that on becoming visible calls a new
`transport.resync()` rebasing `anchorTime`/`anchorBeat` (like `setBpm` does),
optionally widening lookahead while hidden. Scheduling math, bus events, and audio
nodes untouched.

**Affected layers/files.** engine. `src/engine/transport.js`,
`src/engine/context.js`, `src/main.js`, `test/smoke.mjs`.

**Catalog-contract implication.** No new catalog command: internal scheduler
mechanism, transport command surface unchanged. The smoke suite already calls
`play()` then `clearInterval(tp.timer)` and loops `tick()` manually
(`test/smoke.mjs:123-128`) and asserts contiguous windows, so the swap is
contract-verified by existing tests; add an assertion that message-driven tick
produces identical `schedule:window` segments. A new `src/engine` file is
auto-mirrored by recursive sync (no sync-tool edit).

**Effort/impact.** L / high.

**Browser support + degradation.** Web Workers and `visibilitychange` universal.
AudioWorklet all current browsers, Safari 16.4+. Blob workers need no secure
context. Chrome intensive-throttling still limits background worker timers after
about 5 minutes hidden, so the resync is load-bearing. Feature-detect Worker/
`URL.createObjectURL`; if missing, fall back to today's `setInterval` verbatim.

**Constraint fit.** Zero-dep, no-build via inline Blob worker (plain ES, no
separate bundled file). Engine stays audio-only and never mutates the project.
The inline worker is a slight departure from file-per-module and should be flagged
in `engine-layers.md`.

**Risks.** A worklet/worker tick still hands off to the main thread, so a fully
frozen main thread can still stall; this removes the timer-clamping class of
drift, not all. Keep all scheduling decisions on the main thread (worker only
signals "tick"). The Worker variant is simpler than AudioWorklet; evaluate it
first.

**Dependencies.** None.

---

#### `page-lifecycle-freeze-resume-handling` (P2, medium, M)

**What it enables.** When Chrome freezes a backgrounded tab the `setInterval`
scheduler stops and the AudioContext may be OS-suspended. On resume the
beat-to-time anchor is stale, so playback jumps or schedules a flood of past-due
events. freeze/resume let Oscine release the clock cleanly on freeze and rebase
its anchor on resume, so a frozen-then-restored tab picks up musically instead of
glitching.

**Current state.** `src/engine/transport.js` has no lifecycle awareness. On
freeze the `setInterval` simply stops being serviced while
`anchorTime`/`anchorBeat` keep referencing the pre-freeze `ctx.currentTime`. No
resume handler to rebase (`suspendClock()`/`resync()` are net-new).
`src/engine/context.js` `ensureRunning` resumes the AudioContext only on a user
gesture, not on lifecycle resume.

**Proposed approach.** Add freeze/resume listeners (with a `visibilitychange`
fallback). On freeze: `transport.suspendClock()` clears intervals and records a
pending resync without changing playing state. On resume (or visible while
playing and a resync is pending): `transport.resync()` sets
`anchorTime = ctx.currentTime` and `anchorBeat = current logical beat` (like
`setBpm`), restarts the timer, and calls `ensureRunning()` to bring a suspended
AudioContext back. Shares `resync()` with the worker-clock item.

**Affected layers/files.** engine. `src/engine/transport.js`,
`src/engine/context.js`, `src/main.js`.

**Catalog-contract implication.** No catalog command: automatic lifecycle
handling, changes no command's observable contract. No OSC route. Worth a smoke
test that `resync()` leaves `anchorTime`/`anchorBeat` consistent (no past-due
flood); the existing scheduler tests drive `tick()` manually and can be extended.

**Effort/impact.** M / medium.

**Browser support + degradation.** freeze/resume Chrome/Edge 68+ only.
Firefox/Safari do not fire them, so `visibilitychange` is the cross-browser
fallback. Add listeners for both; engines lacking the lifecycle events still get
the visibility-based suspend/resync. Worst case is today's behavior.

**Constraint fit.** Zero-dep, no-build, sidecar-independent. Works on Pages. No
format change. Engine stays audio-only (resync only adjusts the local clock
anchor). Shares `resync()` with the worker-clock item to avoid duplicate logic.

**Risks.** Overlap with the worker timer: both must agree on a single resync
path, not rebase independently (hard dependency, build them together). If the
AudioContext was OS-suspended, `resume()` is async; the first post-resume tick
must await it or it schedules into a not-yet-running clock.

**Dependencies.** `background-tab-clock-via-visibility-and-worker`.

---

#### `constant-source-master-mod` (P3, low, M), primitive, not a standalone build

**What it enables.** Gives the engine one sample-accurate scalar source that can
drive many AudioParams at once: a master/global LFO or a sample-accurate
parameter-automation lane shared across tracks, fanned out by connecting the
node's `.offset` to each target. The right primitive for the automation lanes the
gate-3 work implies, keeping modulation on the audio thread instead of timer-driven
`setTargetAtTime` from JS.

**Current state.** No ConstantSourceNode anywhere. Per-voice modulation uses
per-instrument oscillators/LFOs; all parameter changes come through JS via
`setTargetAtTime`/`setParam`. There is no shared, sample-accurate modulation
source, and automation is not yet a feature (gate 3 is still a decision).

**Proposed approach.** When automation/global-LFO lands, model each automation
lane (or a global tempo-synced LFO) as a single `ctx.createConstantSource()` whose
`.offset` is shaped with `setValueAtTime`/`linearRampToValueAtTime`/
`setValueCurveAtTime`, then connected (`node.offset` to target AudioParam) to every
parameter it drives. The offline renderer builds the same node against its
OfflineAudioContext from the same project data, so automation bounces identically.

**Affected layers/files.** engine. `src/engine/engine.js`, `src/engine/render.js`,
`src/engine/instruments/base.js`.

**Catalog-contract implication.** The modulation primitive itself is internal
engine plumbing (no command). The user-facing automation feature it enables would
need its own catalog command and schema fields, and adding automation data to
`src/core/schema.js` would grow the project doc / share payload, which must be
flagged against the few-KB share-link assumption when that feature is specced.

**Effort/impact.** M / low.

**Browser support + degradation.** ConstantSourceNode universal across
Chrome/Edge/Firefox/Safari. No secure-context concerns. No fallback needed.

**Constraint fit.** Zero-dep, no-build, no sidecar. Engine-only and
engine-never-mutates-project preserved. Keeps offline-equals-live because the same
node is rebuilt in `render.js`.

**Risks.** Enabling infrastructure rather than a standalone win; its value is
contingent on the automation/global-LFO feature (gate 3) actually shipping.
Implement it INSIDE the automation workflow, not as its own task. Correction: it
has NO dependency on the worker-clock item; AudioParam automation on a
ConstantSourceNode runs sample-accurately on the audio thread regardless of the
lookahead timer.

**Dependencies.** None (but build inside the gate-3 automation feature, carry it
here as a note only).

---

### Cluster 3: Asset layer + share-link headroom (gates 1 and 2)

The sampling-prerequisite spec the roadmap says to write before sampler A ships:
bytes out-of-band, keyed by content hash, with durable storage and a compression
strategy that keeps synth-only share links byte-identical.

---

#### `indexeddb-asset-store` (P1, high, L)

**What it enables.** Unblocks the sampler instrument by giving audio bytes a home
that is NOT the project document. Synth-only projects stay byte-identical; samples
become content-hash references, so undo/load/autosave keep working because the
JSON stays small. This IS the gate-1 spec.

**Current state.** Absent. No audio data in the system; the only persistence is
the single localStorage key. `src/core/schema.js` has no sample/asset/hash field.
localStorage is wrong for multi-MB audio.

**Proposed approach.** Add `src/core/assets.js` (node-importable, `typeof`-guarded
like `downloadBlob`): `putAsset(bytes)` returns a sha256 hex via
`crypto.subtle.digest`, `getAsset(hash)` returns `ArrayBuffer|null`,
`hasAsset(hash)`. One IDB object store keyed by hash, value `ArrayBuffer`. Schema
references samples by hash only; bytes never enter `src/core/schema.js`.
Hand-rolled IDB Promise wrapper (zero-dep). The sidecar later resolves the same
hashes.

**Affected layers/files.** core, engine, api. `src/core/assets.js`,
`src/core/schema.js`, `src/engine/instruments/`, `src/api/commands.js`,
`src/api/api.js`, `test/smoke.mjs`.

**Catalog-contract implication.** Needs a catalog command: `asset`
(register/list/check by hash) + `cmd_asset`, so MCP/OSC and UI share one path.
Smoke asserts every command has a handler (`test/smoke.mjs:236-237`), so the
headless check is non-optional. Sampler also needs `set_params` to accept a
sample hash. `src/core/assets.js` stays DOM/audio-free.

**Effort/impact.** L / high. P1 not P0 because it unblocks a Later-tier feature
rather than fixing a live defect.

**Browser support + degradation.** IndexedDB universal. `crypto.subtle.digest`
universal but secure-context only (Pages https qualifies). If IDB is unavailable,
feature-detect and disable the sampler with a clear message; synth-only projects
unaffected.

**Constraint fit.** Zero-dep (hand-rolled IDB wrapper, no npm `idb`), no-build,
works client-side on Pages; the sidecar is an optional second resolver.
Project-format invariant respected: bytes out-of-band, the doc only gains optional
hash refs.

**Risks.** IDB quota is origin-shared and evictable; a project could load with a
dangling hash. Mitigate with `navigator.storage.persist()` and a clear "missing
sample" state. The async API threads through the currently synchronous load path
(`store.load`, `src/main.js` `maybeLoadSharedSong`), so the boot sequence must
await asset availability for sampled projects.

**Dependencies.** `opfs-large-asset-storage`, `structured-clone-deepclone`.

---

#### `compressionstream-share-link` (P1, medium, M)

**What it enables.** Shrinks song-in-URL fragments below today's JSON-as-base64,
buying headroom against URL-length limits as projects grow (song-mode arrangement
list, automation events). Serves gate-2. Repetitive step/note JSON compresses
extremely well.

**Current state.** No compression. `src/core/share.js` `encodeProjectToFragment`
does `JSON.stringify(toWire(project))` to TextEncoder to raw base64url. The header
and ROADMAP gate 2 assume a few-KB project with no headroom strategy.

**Proposed approach.** Make the byte pipeline async: pipe UTF-8 JSON through
`new CompressionStream('gzip')` (read via `new Response(stream).arrayBuffer()`),
base64url the result, prefix a one-char codec tag (`s1=` raw vs `s2=` gzip) so
decode branches and old raw links still parse. `decodeFragmentToProject`
feature-detects `DecompressionStream`. Node fallback (zlib or skip-compress
tagged raw) keeps smoke green; node 22 exposes CompressionStream globally.

**Affected layers/files.** core, api. `src/core/share.js`, `src/api/api.js`,
`src/main.js`, `test/smoke.mjs`.

**Catalog-contract implication.** Making encode/decode async means `cmd_share`
(`src/api/api.js:606`) must become async and await `buildShareUrl`/
`encodeProjectToFragment` (it is currently synchronous, unlike `cmd_export_wav`).
`execute()` already awaits every handler so an async `cmd_share` is
backward-compatible with the command layer, but `share.js`'s encode/decode go
async and the synchronous boot-path decode (`maybeLoadSharedSong`, `src/main.js`)
must await. No new command. Tag versioning keeps existing `s=` links decodable.
Add a round-trip smoke assertion.

**Effort/impact.** M / medium.

**Browser support + degradation.** CompressionStream/DecompressionStream
Chrome 80+/Firefox 113+/Safari 16.4+, node 18+ (node 22 confirmed). No
secure-context requirement. Feature-detect; when absent, encode falls back to raw
base64url with the `s1=` tag (larger but valid). Decode must ALWAYS handle both
tags. Surface a clear "needs a newer browser" message if a consumer lacks
`DecompressionStream`.

**Constraint fit.** Zero-dep (replaces what would tempt npm pako), no-build,
client-side. On-disk `.oscine.json` stays plain JSON (`serialize()` unchanged);
only the URL fragment compresses, the codec tag prevents a format fork.

**Risks.** Async share-encode touches the boot/share path; ensure all
`buildShareUrl` callers and the synchronous `projectFromUrl` decode await
correctly. A modern producer can mint a gzip link old Safari cannot open; mitigate
with the tag and a readable error. Win is modest for tiny projects; frame as
growth headroom.

**Dependencies.** None.

---

#### `opfs-large-asset-storage` (P2, medium, M)

**What it enables.** Gives the asset layer a durable, quota-friendlier home for
larger sample libraries than IndexedDB blobs, and via `persist()` stops the
browser silently evicting imported samples (which would corrupt a saved project
into dangling hashes). Surfaces real storage usage so the UI can warn before quota
runs out.

**Current state.** Absent. No `navigator.storage` usage. The app has no concept
of a storage budget.

**Proposed approach.** Make `src/core/assets.js` backend-pluggable: prefer OPFS
(`getDirectory`, write each asset as a file named by hash) when available, fall
back to the IndexedDB store otherwise. On first sample import call
`navigator.storage.persist()`; expose `navigator.storage.estimate()` through the
asset command so the UI shows "X MB stored". Reads return ArrayBuffer the engine
decodes to an AudioBuffer.

**Affected layers/files.** core, api, ui. `src/core/assets.js`,
`src/api/commands.js`, `src/api/api.js`, `src/ui/transportbar.js`.

**Catalog-contract implication.** Folds into the same `asset` command from
`indexeddb-asset-store`: add a `usage`/`estimate` action returning
`{usageBytes,quotaBytes,persisted}`. Purely additive read-only action. The
`persist()` request is a client-side affordance triggered by the handler; headless
contexts skip it.

**Effort/impact.** M / medium.

**Browser support + degradation.** OPFS Chrome/Edge 86+, Firefox 111+, Safari
15.2+ (broad but newer than IDB, hence a backend behind feature-detect).
`persist()` Chrome/Edge/Firefox yes; Safari heuristic, may resolve false. Secure
context only. Feature-detect `getDirectory`; when absent, transparently use the
IndexedDB backend.

**Constraint fit.** Zero-dep, no-build, standard APIs, fully client-side.
Project-format invariant respected: OPFS holds bytes out-of-band identically to
IDB.

**Risks.** Two backends to keep in sync; keep the `assets.js` surface tiny
(put/get/has/estimate). Use the async main-thread OPFS API (not the worker-only
sync-access-handle path). Persisted storage is not a backup; the `.json`/`.wav`
exports remain the real durability story. Dedup note: it absorbs the
`persist()`/`estimate()` surface, overlapping the standalone persistent-storage
item; the asset workflow owns `persist()` once it runs.

**Dependencies.** `indexeddb-asset-store`.

---

#### `structured-clone-deepclone` (P2, low, S)

**What it enables.** Faster, safer deep copies on the clone paths (`cmd_project`
get/load, `copySlot`, `cmd_get_steps`). `structuredClone` copies in one native
call without stringify+parse and can carry binary (ArrayBuffer/TypedArray/Blob)
which JSON silently drops, making it the correct clone primitive once samples
enter (gate 1).

**Current state.** `src/core/util.js:37-39` `deepClone` is
`JSON.parse(JSON.stringify(obj))`. The store undo path does its OWN JSON snapshot
and does NOT call `deepClone` (separate code path).

**Proposed approach.** `deepClone` prefers `structuredClone` when available:
`return typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj))`.
Leave `serialize()` on JSON (file/URL format unchanged).

**Affected layers/files.** core. `src/core/util.js`, `src/core/store.js`.

**Catalog-contract implication.** None. Internal helper swap; same
signature/semantics for plain JSON. Project format unchanged.

**Effort/impact.** S / low. A sensible warm-up that de-risks the asset work.

**Browser support + degradation.** `structuredClone` Chrome/Edge 98+, Firefox
94+, Safari 15.4+, node 17+. Feature-detect and fall back to
`JSON.parse(JSON.stringify)`. Zero behavior change where absent (the fallback IS
the current implementation).

**Constraint fit.** Zero-dep, no-build, stays in core/ node-importable.
Serialization stays JSON.

**Risks.** JSON-clone silently drops undefined/functions; `structuredClone`
preserves undefined and throws on functions/DOM nodes. Project data is plain JSON
today so it is safe; verify no caller relies on the JSON pass to scrub undefined.

**Dependencies.** None. Pull into the asset workflow's prep phase.

---

#### `persistent-storage-for-autosave-and-assets` (P2, medium, S)

**What it enables.** The single localStorage key is the only auto-saved copy of
unsaved work, and best-effort storage is evictable under disk pressure (especially
mobile/Safari). Requesting persistence asks the browser to keep Oscine's data
durable, which matters more once sampling lands and audio bytes live in IndexedDB
(gate 1).

**Current state.** `src/core/persist.js` uses localStorage with no durability
request. No `navigator.storage` call anywhere.

**Proposed approach.** On boot, feature-detect `navigator.storage?.persist` and
call it once, non-blocking, ignoring the boolean (advisory). Optionally expose
`StorageManager.estimate()` in the `status` command so an agent can report quota
usage. If the call lives in `src/core/persist.js`, guard navigator access with
optional chaining/`typeof`.

**Affected layers/files.** core, api. `src/core/persist.js`, `src/main.js`,
`src/api/api.js`.

**Catalog-contract implication.** `persist()` is a client-side affordance with no
command. If `estimate()` is surfaced, it belongs in the read-only `status` command
as a `storage:{usage,quota,persisted}` block, guarded to return nulls when
`navigator.storage` is absent (matching how `cmd_status` returns `audioState` via
optional chaining). Additive read-only fields, no contract break.

**Effort/impact.** S / medium.

**Browser support + degradation.** `persist()` Chrome/Edge 55+, Firefox 57+,
Safari 15.4+. `estimate()` broad (Safari partial). Secure context required.
Feature-detect each method; if absent, skip silently.

**Constraint fit.** Zero-dep, no-build, works on bare Pages. No project/share
format change. Dovetails with gate-1's IndexedDB store.

**Risks.** Firefox may prompt on `persist()`; consider deferring until after the
first checkpoint so the prompt has context. Dedup note: the `persist()`/
`estimate()` surface also appears inside `opfs-large-asset-storage` and
`indexeddb-asset-store`; this standalone item protects today's autosave, and once
the asset workflow runs, that workflow owns the `persist()` call (coordinate to
avoid double-calling).

**Dependencies.** None.

---

### Cluster 4: Desktop-grade file I/O

Make Oscine feel like a song-file editor rather than a web toy: save-in-place, OS
open, drag-drop import, native share sheet. All progressive enhancement over the
existing download/upload floor, same `.oscine.json` on every path.

---

#### `file-system-access-save-open` (P1, high, M)

**What it enables.** Turns the one-shot "download a copy to ~/Downloads" export
into a real Save: pick a `.oscine.json` once, then Cmd-S re-saves to that file
with no dialog. Open reads a project the user can edit and save back in place.

**Current state.** Export is a download via `downloadBlob` (always a new copy,
never overwrites, no handle). Import is a hidden `<input type=file>`.
`store.serialize()` already yields the JSON string. No file handle anywhere.

**Proposed approach.** Add a handle path: `saveProjectAs()` calls
`showSaveFilePicker`, keeps the returned `FileSystemFileHandle` in module state,
writes `store.serialize()` via `createWritable`. `saveProject()` reuses the handle
(no dialog). `openProject()` uses `showOpenFilePicker`, reads `getFile().text()`,
stores the handle. Wire Save / Save As / Open into the File menu, keeping the
existing download/upload entries as the fallback.

**Affected layers/files.** ui, api, core. `src/ui/fileops.js`,
`src/ui/transportbar.js`, `src/core/persist.js`, `src/api/commands.js`,
`src/api/api.js`.

**Catalog-contract implication.** The picker is a user gesture and cannot run
headless, so the catalog command stays the serialize path: extend the `project`
command with a `save`/`export` action returning `store.serialize()` (what
MCP/OSC/sidecar consume), and the File-menu wrapper layers `showSaveFilePicker` on
top. Same midi-style split already in the codebase. Do NOT add a picker-only
capability with no command behind it.

**Effort/impact.** M / high.

**Browser support + degradation.** `showSaveFilePicker`/`showOpenFilePicker`
Chrome/Edge 86+. NOT in Firefox or Safari (deliberately unshipped). Must be
additive behind a feature-detect. Secure-context only. When absent, the File menu
keeps today's download/hidden-input behavior. Same JSON on both paths.

**Constraint fit.** Zero-dep, no-build, standard API. Works on Pages (Chrome
only). Same `.oscine.json`. Tension to flag: Chrome gets Save-in-place,
Firefox/Safari get download-a-copy (progressive enhancement, not a fork).

**Risks.** Handles do not survive reload unless persisted in IndexedDB (re-grant
needs a permission round-trip); v1 keeps the handle in memory only. Writable
streams need `close()` in a finally. Do not let in-place Save and the 600ms
autosave fight: autosave stays crash-recovery, the file is the explicit save.

**Dependencies.** None.

---

#### `drag-drop-import` (P2, medium, S)

**What it enables.** Drop a `.oscine.json` anywhere on the window to load it, far
more direct than File > Import > pick. The same surface is the natural import
gesture for sample files once the sampler lands (drop a `.wav` onto a track).

**Current state.** Absent. Import is only the hidden file input. No `dragover`/
`drop` file handlers exist (the `preventDefault` calls in
pianoroll/stepgrid/keyboard/widgets are pointer/key handlers for knob/note drags,
not file drops).

**Proposed approach.** Add a window/`#app`-level `dragover` handler that
`preventDefault()`s (required to allow a drop) and shows a drop overlay, plus a
`drop` handler reading `e.dataTransfer.files` routed by type: `.json`/
`.oscine.json` to `file.text()` to the existing `store.load` path; later, audio to
`file.arrayBuffer()` to `assets.putAsset`. Keep it in a small
`src/ui/dropzone.js` wired from `src/ui/app.js`.

**Affected layers/files.** ui. `src/ui/dropzone.js`, `src/ui/app.js`,
`src/ui/fileops.js`.

**Catalog-contract implication.** Client-side affordance over existing
capabilities: a project drop reuses the `project` load path
(`store.load`/`cmd_project` 'load'), so no new command. Sample drops later go
through the gate-1 `asset` command's register action. The drop gesture funnels
into already-contracted store actions, so parity holds.

**Effort/impact.** S / medium.

**Browser support + degradation.** HTML Drag-and-Drop + `DataTransfer.files`
universal, no secure-context requirement (lowest-risk API in this domain). If
somehow absent, File > Import remains the full path.

**Constraint fit.** Zero-dep, no-build, DOM-only (sits in ui/), fully
client-side. Project-format invariant respected.

**Risks.** Must `preventDefault` on BOTH `dragover` and `drop` or the browser
navigates away to the dropped file (the classic footgun), losing unsaved work.
Catch non-project JSON (`validateProject` throws on wrong shape; toast it). Scope
the drop overlay so it does not interfere with the existing pointer-event knob/
keyboard drags.

**Dependencies.** `indexeddb-asset-store` (the sample-drop branch only; the
project-drop branch ships independently).

---

#### `launchqueue-file-handler` (P2, medium, S)

**What it enables.** Lets a user double-click a `.oscine.json` in Finder/Explorer
(or drag it onto the installed app icon) and have Oscine open that song. The
OS-level half of being a real song-file editor.

**Current state.** Absent and not currently possible: no Web App Manifest at all,
no `file_handlers`, no `launchQueue`. A song enters only via the hidden file
input, a share-link `#s=` fragment, or the autosave.

**Proposed approach.** Add a `file_handlers` entry to `manifest.webmanifest`
mapping action `/` to `{'application/json':['.oscine.json']}`, and a
`<link rel='manifest'>` to `index.html`. In `src/main.js` boot after the
share-link check:
`if ('launchQueue' in window) launchQueue.setConsumer(p => { if (p.files?.length) p.files[0].getFile().then(f=>f.text()).then(txt=>store.load(JSON.parse(txt))); })`.
Reuse the same `store.load` path.

**Affected layers/files.** build, core, ui. `manifest.webmanifest`,
`index.html`, `src/main.js`.

**Catalog-contract implication.** Purely a new entry point into the existing load
path; no new command because loading is already the `project` command's `load`
action / `store.load`. The manifest is a static asset, not a contract surface.

**Effort/impact.** S / medium.

**Browser support + degradation.** `launchQueue` + `file_handlers` Chrome/Edge
102+ and only when the PWA is installed. NOT in Firefox or Safari. Requires a
manifest and secure context. Feature-detect `'launchQueue' in window`; on
browsers without it nothing changes.

**Constraint fit.** Zero-dep, no-build, standard manifest + API. Works on Pages
once installed. Project-format invariant respected.

**Risks.** Requires installation to fire. A malformed double-clicked file must be
try/catch'd and toasted, not throw during boot (mirror `maybeLoadSharedSong`'s
try/catch). Coordinate the manifest with the PWA work so there is one manifest,
not two.

**Dependencies.** `file-system-access-save-open` (soft, shared file-handle
story); `launchQueue` could ship on its own.

---

#### `web-share-song-link-and-wav` (P1, high, S)

**What it enables.** On mobile, sharing dead-ends at the clipboard.
`navigator.share` opens the OS share sheet so a user can send the song-in-URL link
(or the WAV) straight to Messages, Mail, Discord, AirDrop. The whole song travels
in the link, so "share this beat" becomes one tap.

**Current state.** `src/ui/fileops.js` `copyShareLink` only writes the link to
clipboard with a `history.replaceState` fallback; no `navigator.share`. WAV export
builds bytes in `cmd_export_wav` (the Uint8Array exists at `src/api/api.js:589`)
and `downloadBlob`s them, returning only metadata. No `navigator.share`/`canShare`
anywhere.

**Proposed approach.** Link: in `copyShareLink()`, if `navigator.share` exists,
`await navigator.share({title,text,url})` inside the menu-click gesture, fall back
to today's clipboard path on absence/AbortError (no new command needed; the
`share` action 'link' already returns the url). WAV: surface the bytes (a thin
ui/engine helper or an opt-in Blob return from `cmd_export_wav`), build
`File([bytes],'<name>.wav',{type:'audio/wav'})`; if `navigator.canShare({files})`
offer "Share audio" next to "Export audio".

**Affected layers/files.** ui, engine, api. `src/ui/fileops.js`,
`src/ui/transportbar.js`, `src/api/commands.js` (optional, only if adding a
share_link/native flag), `src/api/api.js` (optional, only if surfacing the WAV
Blob).

**Catalog-contract implication.** Link sharing is already the `share` command;
the native gesture is a client-side affordance, no new command. Sharing the WAV
file is new user-facing capability but `navigator.share` needs a live gesture and
a Blob, so model it as a thin UI affordance over the existing `export_wav`/`share`
commands. The real touchpoint: the WAV bytes are produced inside `cmd_export_wav`
and not returned today, so surfacing them is the work. Document the
headless-can't-share asymmetry in the command description.

**Effort/impact.** S / high.

**Browser support + degradation.** `navigator.share` Chrome/Edge (desktop +
Android), Safari (macOS + iOS), Samsung. Firefox desktop NO (Firefox Android yes).
File sharing narrower: Android Chrome + iOS/macOS Safari, absent on Firefox.
Secure-context required. Feature-detect `share` and `canShare`; when absent, keep
clipboard copy + address-bar fallback for links and file download for WAV. Treat
AbortError as a no-op.

**Constraint fit.** Zero-dep, no-build, pure browser API. Works in hosted and
sidecar modes. Link sharing ships the existing `#s=` fragment. Only WAV-file share
is new capability.

**Risks.** `navigator.share` throws outside a user gesture (stay in the
menu-click handler). Very large URLs may exceed what some target apps accept. Do
not duplicate render logic surfacing the WAV; prefer a shared helper or opt-in
Blob return.

**Dependencies.** None.

---

### Cluster 5: Installable PWA + OS transport integration

Manifest-gated app-ness: standalone window, offline shell, lock-screen/media-key
transport, app-icon badge. The manifest is the gate for the rest of the domain.

---

#### `web-app-manifest-installable-pwa` (P1, medium, S)

**What it enables.** An installed Oscine launches in its own standalone window,
gets a real app icon, and reads as an instrument rather than a tab. It is the
prerequisite that unlocks lock-screen media controls, offline use, the badge, and
OS file-open.

**Current state.** No manifest exists. `index.html` declares only a stylesheet +
favicon link, no `apple-*` meta tags. Icon source art exists:
`styles/brand/oscine-mark.svg` and `brand/oscine-master.svg`.

**Proposed approach.** Add a static `manifest.webmanifest` at repo root, reference
it from `index.html`. Fields: name/short_name "Oscine", `start_url '.'` (relative,
resolves under `/oscine/` and the sidecar root), `display 'standalone'`,
theme/background from design tokens, icons. Generate PNG icons (192/512 + maskable
512) from the brand SVG (SVG-only is insufficient for Android install). Add
`manifest.webmanifest` and the icons to the SOURCES array in
`tools/sync-plugin.mjs` so the sidecar serves them AND the plugin-integrity check
covers them. Add iOS `apple-*` meta tags to `index.html`.

**Affected layers/files.** build, ui. `index.html`, `manifest.webmanifest`,
`tools/sync-plugin.mjs`, `styles/brand/oscine-mark.svg`.

**Catalog-contract implication.** Pure static-asset + markup change; no catalog
command. The one contract touchpoint: new top-level files MUST be added to SOURCES
in `tools/sync-plugin.mjs`, or they live at repo root but never copy into
`plugin/app/` while the existing `--check` (which only hashes the SOURCES tree)
stays green (silent drift). Once in SOURCES the existing smoke guard covers them.

**Effort/impact.** S / medium. The GATE for the rest of its domain.

**Browser support + degradation.** Install + `beforeinstallprompt` Chrome/Edge/
Samsung full; Firefox parses (install Android-only); Safari/iOS honors a subset
via `apple-*` fallbacks. A browser that ignores the manifest runs Oscine as
today's static page.

**Constraint fit.** Zero-dep, no-build (hand-authored JSON + committed PNGs).
Works in all three run modes. No schema/share change. As a repo-root static file
in SOURCES, the Pages deploy serves it too.

**Risks.** `start_url`/scope must be relative or the `/oscine/` Pages install
scope breaks. Maskable-icon safe zone needs attention. iOS needs the legacy
`apple-*` meta tags. The SOURCES edit is mandatory or the existing check passes
while `plugin/app/` silently lacks the files.

**Dependencies.** None.

---

#### `media-session-lockscreen-transport` (P2, medium, S)

**What it enables.** Let the OS drive Oscine's transport: keyboard media keys,
headphones, the macOS Now Playing widget, and the mobile lock screen all map to
`transport.toggle()`/`stop()`, with a "Now Playing: <song>" card and icon. It
dovetails with the "arrangements are the first thing users leave playing" framing.

**Current state.** No `mediaSession` reference. `src/engine/transport.js` emits
`transport:state {playing}` on play (line 92) and stop (line 103); transportbar
already listens to flip the play glyph. transport exposes `play()`/`stop()`/
`toggle()` and is the single mutation entry point (reachable via the `transport`
command).

**Proposed approach.** Add `src/ui/mediasession.js`, instantiated in
`src/ui/app.js` alongside `this.midi`. When `'mediaSession' in navigator`:
`setActionHandler('play')` to `transport.play()`, `'pause'`/`'stop'` to
`transport.stop()`; subscribe to `transport:state` to set `playbackState`.
Populate `MediaMetadata({title:store.project.name, artist:'Oscine', artwork:[brand PNG 512]})`
and refresh on `settings:changed` (key === 'name') and `project:replaced`.

**Affected layers/files.** ui. `src/ui/mediasession.js`, `src/ui/app.js`.

**Catalog-contract implication.** No new catalog command: every OS action
(play/pause/stop) already exists as the `transport` command, and it only calls
transport methods the UI already calls.

**Effort/impact.** S / medium.

**Browser support + degradation.** Chrome/Edge (desktop + Android, full), Safari
(macOS + iOS good), Firefox (metadata + play/pause). Secure-context only.
Feature-detect `'mediaSession'` and no-op when absent; transport keeps working
from the in-app button and Space key.

**Constraint fit.** Zero-dep, no-build, identical in all run modes. Touches
neither `schema.js` nor the share payload. Wants a PNG artwork icon (the manifest
work produces it); degrades to a card without artwork.

**Risks.** Browsers only surface a media session after audio has played (fine
given Oscine's autoplay-unlock gesture). Artwork must be raster PNG, not SVG. Keep
`playbackState` in sync on every `transport:state` change.

**Dependencies.** Manifest (soft, for the full standalone experience and the PNG
artwork).

---

#### `service-worker-offline-shell` (P2, medium, M)

**What it enables.** Oscine is all client-side once loaded (synthesis,
sequencing, autosave, song-in-URL), so it has no reason to need the network at
runtime. A service worker that precaches `index.html` + `styles/` + `src/` + fonts
lets the hosted page open offline and is the second half of a real installable
PWA. It also makes cold loads instant after first visit.

**Current state.** No service worker exists. The app is a graph of native ES
modules loaded from `src/` plus `styles/main.css` and fonts. Nothing cached beyond
the browser HTTP cache. Autosave already persists to localStorage, so user data
offline is solved; only the code shell is not.

**Proposed approach.** Add a static `sw.js` at repo root, registered from
`src/main.js` guarded by `'serviceWorker' in navigator` and secure-context.
Cache-first for same-origin GETs with a precache list of the module graph. Bump a
`CACHE_VERSION` const on release and purge old caches on `activate`. Register with
relative scope (`'./'`). Explicitly network-only-bypass `/health` (a same-origin
GET a cache-first SW would shadow) and all non-GET; the WS bridge upgrade at
`/bridge` is never intercepted by a SW. Add `sw.js` to SOURCES in
`tools/sync-plugin.mjs`. No edit to the sidecar itself.

**Affected layers/files.** build, ui, plugin. `sw.js`, `src/main.js`,
`tools/sync-plugin.mjs`.

**Catalog-contract implication.** No catalog command (page infrastructure).
Contract touchpoints are operational: (1) `sw.js` must be added to SOURCES or the
sidecar loses offline AND the mirror silently diverges; (2) `CACHE_VERSION` must
bump each release alongside `plugin.json`/`SERVER_VERSION` or users get stale code
(wire it to the same version string). The sidecar source needs NO edit; its
`/health` and `/bridge` already behave correctly, the SW just must not shadow
`/health` client-side.

**Effort/impact.** M / medium.

**Browser support + degradation.** Service Worker + Cache Storage Chrome/Edge/
Firefox/Safari in secure contexts. Pages is HTTPS; the sidecar's
`http://127.0.0.1` is a secure context so registration works there too. Guard
registration behind feature detection and secure-context; on absence the app loads
from network as today.

**Constraint fit.** Zero-dep, no-build (hand-written vanilla JS, literal precache
array). Must not break the two non-Pages modes: caches only same-origin GETs for
the shell, leaves `/bridge` untouched, network-only-bypasses `/health` and
non-GET. No schema/share change.

**Risks.** The classic footgun is serving stale JS after a release; the
version-keyed purge plus tying `CACHE_VERSION` to the release version mitigates
it. A precache list that drifts from the module graph leaves offline gaps; derive
it from the same file walk `sync-plugin` already does, or add a smoke check that
every `src/*.js` is precached.

**Dependencies.** `web-app-manifest-installable-pwa`.

---

#### `badging-api-recording-indicator` (P3, low, S)

**What it enables.** Once Oscine is installable, the installed icon can carry a
badge for an at-a-glance background state, most naturally MIDI record-arm being
active, so a user does not leave a recording session armed unaware.

**Current state.** No `setAppBadge` usage. A clear state to badge already exists:
`store.ui.midi.record` and `.enabled`, set via `configureMidi` (emits
`midi:config`) and rendered in transportbar `paintMidi` with an 'armed' class.
transportbar already subscribes to `midi:config`/`midi:status`.

**Proposed approach.** Add a tiny standalone `src/ui/badge.js` (or fold into the
mediaSession module), instantiated in `src/ui/app.js`, that feature-detects
`'setAppBadge' in navigator` and subscribes to `midi:config`/`midi:status`: when
`store.ui.midi.record && enabled`, call `setAppBadge()`; otherwise
`clearAppBadge()`.

**Affected layers/files.** ui. `src/ui/badge.js`, `src/ui/app.js`,
`src/ui/transportbar.js` (optional, only if firing from `paintMidi` rather than a
standalone subscriber).

**Catalog-contract implication.** No new command. The badge mirrors record-arm,
already controllable through the `midi` catalog command (and thus MCP/OSC). A
display-only client affordance reacting to bus events; it never mutates state.

**Effort/impact.** S / low. Lowest-value item in this domain.

**Browser support + degradation.** Badging API Chrome/Edge desktop and installed
PWAs; Android partial; Safari/iOS and Firefox do not support it. Feature-detect
`navigator.setAppBadge`; strictly additive and no-op when missing.

**Constraint fit.** Zero-dep, no-build, pure browser API. Harmless in all run
modes. No schema/share impact.

**Risks.** Narrow support means most users never see it; never rely on it as the
only cue. Must clear the badge on disarm and on app close or it lingers.

**Dependencies.** `web-app-manifest-installable-pwa`.

---

### Cluster 6: Render-loop efficiency + visual feedback

Stop burning a frame's work forever, kill the per-frame forced style recalc, and
turn the already-wired analyser nodes into a real spectrum/scope. Mostly UI-only;
the visualizer is the one item that needs a catalog command.

---

#### `gate-raf-loop-on-visibility-and-activity` (P1, high, S)

**What it enables.** The app burns a full animation frame's work forever,
including when backgrounded and when nothing moves (per-frame master FFT scan, and
per-track FFT scans when the mixer is open). Gating stops needless CPU/GPU/battery
and removes FFT scans that produce no visible change.

**Current state.** `src/ui/app.js` `startFrameLoop` (lines 149-160) schedules rAF
unconditionally and never cancels; reads `engine.getLevel('master')` (a 512-sample
peak scan) and `onFrame` on transportBar/pianoRoll/stepGrid/mixer every frame.
transportBar always calls `masterMeter.set` even when stopped; mixer `onFrame`
early-returns only when closed. No `document.hidden` check anywhere.

**Proposed approach.** Keep one rAF loop but make it self-suspending: schedule
only when playing OR any meter still decaying OR an interaction is in progress;
otherwise stop and re-arm on the next bus event (`transport:state`,
`channel:changed`, pointer gesture) or while any meter is above zero. Re-arm must
poll the LIVE Meter shown value (`src/ui/widgets.js` falloff
`shown=max(level,shown*0.9)` stays visibly non-zero well past about 10 frames),
not assume a fixed budget. Add a `visibilitychange` listener:
`cancelAnimationFrame` on hidden, re-arm on visible. Audio scheduling is
unaffected (lives in the transport timer).

**Affected layers/files.** ui. `src/ui/app.js`, `src/ui/widgets.js`,
`src/ui/transportbar.js`, `src/ui/mixer.js`.

**Catalog-contract implication.** Purely a client-side rendering affordance; no
catalog command. Changes when the UI paints, not any project capability.

**Effort/impact.** S / high. High-impact AND cheap; a near-free CPU/battery win
that also de-risks the visualizer item.

**Browser support + degradation.** Page Visibility and rAF/cancelAnimationFrame
universal. No feature detection needed. If `visibilitychange` never fires,
degrades to today's always-on loop.

**Constraint fit.** Zero-dep, no-build, bare static page, no format change.

**Risks.** Must re-arm reliably or the playhead/meters freeze. The decaying-meter
case is the easy-to-miss trigger and decays slower than a naive 10-frame estimate;
tie re-arm to the live shown value. Keep audio scheduling on the transport timer.

**Dependencies.** None. Could be pulled earlier if idle drain is observed.

---

#### `cache-theme-vars-and-reduced-motion` (P2, medium, S)

**What it enables.** Every piano-roll repaint forces a full style resolution of
`document.documentElement` (once per frame while playing). Resolving the palette
once removes a recurring forced style recalc from the most expensive redraw, and
it unblocks moving the draw to a worker (a worker has no `getComputedStyle`).

**Current state.** `src/ui/pianoroll.js` `paint()` calls
`getComputedStyle(document.documentElement)` and reads seven CSS custom properties
every invocation (bg/rowAlt/line/beat/bar/text/accent; keyWhite/keyBlack are
hardcoded literals), and `paint()` runs every playing frame. The values only
change on theme switch.

**Proposed approach.** Resolve the palette once into a cached object, recomputed
only when the theme changes. No theme-change bus event exists, so trigger
recompute from a MutationObserver on the documentElement class/data-theme
attribute, or on the existing ResizeObserver callback as a cheap catch-all.
`paint()` reads the cached object. This is also the precondition for the
OffscreenCanvas worker, which must receive colors as plain strings.

**Affected layers/files.** ui. `src/ui/pianoroll.js`.

**Catalog-contract implication.** None; pure rendering optimization, no command.

**Effort/impact.** S / medium. The hard precondition for
`offscreencanvas-pianoroll-worker`.

**Browser support + degradation.** getComputedStyle, MutationObserver, matchMedia
all baseline. No degradation path needed; this only removes redundant work.

**Constraint fit.** Zero-dep, no-build, no-sidecar; no project-format change.

**Risks.** Must invalidate the cache on theme change or the roll keeps old
colors. Low risk: a MutationObserver on the documentElement attribute is a tight,
well-scoped trigger.

**Dependencies.** None.

---

#### `prefers-reduced-motion-and-color-scheme` (P3, medium, S)

**What it enables.** Oscine animates continuously (pulsing slot buttons, LED hit
flashes) and drives JS animation loops but ignores the OS reduced-motion setting,
an accessibility gap that can trigger discomfort for motion-sensitive users.
Declaring `color-scheme` also makes native UI (form controls, scrollbars) match
the dark app instead of rendering light-on-dark.

**Current state.** `styles/main.css` has CSS animations and transitions (pulse
keyframes, ledhit, several transitions) and the app runs a continuous rAF loop,
but there is no `prefers-reduced-motion`, no `prefers-color-scheme`, and no
`color-scheme` declaration anywhere (zero `@media` rules).

**Proposed approach.** Add a `@media (prefers-reduced-motion: reduce)` block that
disables/curtails decorative keyframe animations and shortens transitions. Add
`color-scheme: dark` so native widgets/scrollbars theme correctly. For the JS
animations and the proposed visualizer, read
`matchMedia('(prefers-reduced-motion: reduce)')` and skip the most motion-heavy
effects.

**Affected layers/files.** ui. `styles/main.css`, `src/ui/app.js`,
`src/ui/widgets.js`.

**Catalog-contract implication.** Mostly a client-side affordance; an explicit
in-app reduced-motion override (beyond the OS setting) would warrant a
`view`/`settings` command for parity (consistent with the `cmd_transport`
metronome ui-flag precedent). The OS-driven media query alone needs no command.

**Effort/impact.** S / medium.

**Browser support + degradation.** prefers-reduced-motion, prefers-color-scheme,
the color-scheme property, and matchMedia are baseline across all browsers. Media
queries are inert where the user setting is absent.

**Constraint fit.** Zero-dep, no-build, no-sidecar; no project-format change.

**Risks.** Very low. Main care: do not disable the playhead motion itself
(functional, not decorative); scope reduced-motion to ornamental animation only.

**Dependencies.** None. P3 by sequencing (it gates view-transitions and is a paint
input for the visualizer), not by importance.

---

#### `analyser-spectrum-visualizer` (P2, medium, M)

**What it enables.** Turns metering from a single instantaneous-peak bar into
proper metering (RMS alongside peak, smoothed ballistics) and a master
spectrum/oscilloscope for sound-design feedback. The AnalyserNodes already exist
on every channel and the master; this deepens what is read from them. (Merges the
spectrum/RMS engine read side with the visualizer UI/command surface.)

**Current state.** Metering is peak-only: `peakOf` (`src/engine/engine.js:222-230`)
calls `getFloatTimeDomainData` into one shared `meterBuf` (`Float32Array(512)`)
and returns max-abs. `masterAnalyser` fftSize is 512 but
`getByteFrequencyData`/`getFloatFrequencyData` are never called. No spectrum/scope
canvas. The UI paints with a single rAF loop into a Meter widget that already does
falloff smoothing.

**Proposed approach.** Extend the engine read side (not the graph): add
`engine.getSpectrum(trackId|'master')` via `getByteFrequencyData`, and add RMS to
the level read alongside peak. Set `analyser.smoothingTimeConstant` for stable
bars. Add a client-side canvas visualizer (master first; optionally
per-selected-track) reading inside the activity-gated loop, with a toggle/mode
(off/scope/spectrum). Per-channel or correctly-sized scratch buffers replace the
single shared `meterBuf` so master (512) and a larger display FFT coexist. Bump
display fftSize to 1024-2048 only when active.

**Affected layers/files.** engine, ui, api. `src/engine/engine.js`,
`src/ui/mixer.js`, `src/ui/widgets.js`, `src/ui/app.js`, `src/api/commands.js`,
`src/api/api.js`, `plugin/server/osc-gateway.js`.

**Catalog-contract implication.** Needs a catalog command (a `view` command with
a visualizer mode, mirroring how `cmd_transport` carries the metronome ui-flag with
its OSC route). Add the command + `cmd_` handler + smoke check; an OSC route is
optional but cheap for parity. A numeric peak+RMS read should land as data on
`cmd_status` (`transportState`) rather than DOM-only. Visualizer state is ephemeral
`store.ui`, not in `schema.js`/the share link. The gateway already streams meter
state (`/oscine/meter/<name>`), so no new meter route.

**Effort/impact.** M / medium.

**Browser support + degradation.** AnalyserNode frequency/time-domain reads
universal. WebGL (optional fancier scope) universal; degrade to Canvas 2D. If the
visualizer is disabled, zero cost.

**Constraint fit.** Zero-dep, no-build, no-sidecar; the analysers already exist.
core/ untouched (engine read + ui paint). No project-format impact.

**Risks.** Reading frequency data every frame for many channels adds main-thread
cost; keep spectrum reads to master or the visible/selected channel, behind the
toggle, inside the activity-gated loop. STOP reusing the single shared `meterBuf`
for two fftSizes or readings collide. Raise fftSize only on demand.

**Dependencies.** `gate-raf-loop-on-visibility-and-activity`.

---

#### `stepgrid-resizeobserver-and-intersection-virtualization` (P3, medium, M)

**What it enables.** Only the piano roll uses a ResizeObserver today; the step
grid and mixer rely on fixed CSS sizing, so they do not adapt step width to
available width and they keep doing per-frame work when scrolled out of view.
Observers let the grid size itself to its container and let offscreen strips/lanes
skip their per-frame updates.

**Current state.** `src/ui/stepgrid.js` builds a full DOM grid with a fixed
`var(--step)` column and no resize adaptation; its `onFrame` toggles the playhead
column class every change regardless of scroll-into-view. `src/ui/mixer.js`
`onFrame` iterates every meter and reads `engine.getLevel` (FFT peak scan) per
track whenever the mixer is open, even for strips scrolled out of the horizontal
mixer body. ResizeObserver is used only in `src/ui/pianoroll.js`;
IntersectionObserver appears nowhere. `styles/main.css` has no `@media`/`@container`
rules.

**Proposed approach.** Add a ResizeObserver on the step-grid host to recompute
`--step` so a 1- vs 4-bar pattern fits the available width. Add an
IntersectionObserver over mixer strips (and optionally step-grid lanes) so
`onFrame` only scans meters/updates cells for intersecting elements, skipping the
FFT read for off-screen strips. Use CSS container queries on the mixer
body/editor host so strip and control density respond to the panel's own width.

**Affected layers/files.** ui. `src/ui/stepgrid.js`, `src/ui/mixer.js`,
`styles/main.css`.

**Catalog-contract implication.** None; layout and rendering only, no catalog
command.

**Effort/impact.** M / medium.

**Browser support + degradation.** ResizeObserver and IntersectionObserver
baseline. CSS container queries Chrome/Edge 105+, Firefox 110+, Safari 16+. For
container queries the existing fixed-width layout is the fallback. Observers have
no practical gaps; if absent, fall back to always-update.

**Constraint fit.** Zero-dep, no-build, no-sidecar; no project-format change.

**Risks.** IntersectionObserver gating of meters must not freeze a strip's meter
at a stale value when it scrolls back in; reset on intersection. The mixer body is
a horizontal flex row, so "offscreen" means horizontally clipped, which
IntersectionObserver handles but is easy to mis-root.

**Dependencies.** `gate-raf-loop-on-visibility-and-activity`.

---

#### `view-transitions-editor-routing` (P3, low, S)

**What it enables.** Switching the selected track swaps the entire center editor
between piano roll and step grid by clearing and re-appending DOM, an abrupt cut.
A view transition gives a cheap, GPU-composited crossfade/slide with no per-frame
JS, making track switching and mixer open/close feel intentional, while respecting
reduced-motion automatically.

**Current state.** `src/ui/app.js` `routeEditor()` does `editorHost.textContent=''`
then appends `stepGrid.host` or `pianoRoll.host` with no transition. The mixer
toggles via a CSS class (instant show/hide). No `startViewTransition` usage
anywhere.

**Proposed approach.** Wrap the DOM swap in `routeEditor()` (and optionally the
mixer open/close) in `document.startViewTransition(() => { ...existing DOM mutation... })`
behind a feature check. Define a couple of `::view-transition-old`/`new` rules for
a subtle crossfade or slide. Reduced-motion already suppresses View Transitions
per spec.

**Affected layers/files.** ui. `src/ui/app.js`, `src/ui/mixer.js`,
`styles/main.css`.

**Catalog-contract implication.** None; purely a visual transition over an
existing store-driven DOM change. No command, no OSC/MCP surface.

**Effort/impact.** S / low. Explicitly the lowest-value rendering item.

**Browser support + degradation.** Same-document View Transitions Chrome/Edge
111+ and Safari 18+ ship it; Firefox still rolling out. Feature-detect
`document.startViewTransition`; when absent, call the DOM-mutation callback
directly (today's behavior).

**Constraint fit.** Zero-dep, no-build, no-sidecar; no project-format change.

**Risks.** Polish, not performance. Guard against transitions firing on rapid
track-switch spam; keep transitions short.

**Dependencies.** `prefers-reduced-motion-and-color-scheme`.

---

#### `offscreencanvas-pianoroll-worker` (P3, high, L)

**What it enables.** Piano-roll `paint()` is the heaviest main-thread draw and
re-runs on every playing frame to move the playhead. Offloading it to a worker
keeps pointer input, store mutations, and the rAF bookkeeping responsive on dense
patterns or low-end devices.

**Current state.** `src/ui/pianoroll.js` paints on the main thread: `paint()`
clears and redraws background, per-row shading + horizontal lines, the full 16th
grid, every note as rounded rects, ruler, and key gutter, every frame while
playing. It calls `getComputedStyle(document.documentElement)` on every paint.
Plain 2D context; no OffscreenCanvas, no worker.

**Proposed approach.** Create a module worker that owns the drawing. In PianoRoll,
feature-detect `'transferControlToOffscreen' in HTMLCanvasElement.prototype`; if
present, `transferControlToOffscreen()` and `postMessage` the handle plus a paint
state object (scroll, zoom, notes, selection ids, playhead beat, dpr, resolved
theme color strings) to the worker, which runs the existing draw routine verbatim.
Resolve CSS vars once on the main thread (on theme/resize) and pass them in. On
playhead frames, post only the changed playhead beat + scroll. Keep the current
main-thread `paint()` as the fallback behind the flag.

**Affected layers/files.** ui. `src/ui/pianoroll.js`,
`src/ui/pianoroll.worker.js`, `index.html`.

**Catalog-contract implication.** No catalog command; rendering only. The worker
is a static module file served as-is (no bundler), consistent with the zero-build
rule.

**Effort/impact.** L / high. The payoff is real only on dense patterns / low-end
devices; the cheaper rendering wins likely capture most of the benefit. Prototype
behind a flag first.

**Browser support + degradation.** OffscreenCanvas + transferControlToOffscreen
Chrome/Edge (long-standing), Firefox yes, Safari 16.4+. Feature-detect; when
absent, keep the existing synchronous main-thread `paint()`.

**Constraint fit.** Zero-dep and no-build hold (a plain `.js` worker module
fetched at runtime). Works on Pages with no sidecar. Correction: there is no "sync
manifest" to flag; `tools/sync-plugin.mjs` recursively copies and tree-hashes the
whole `src/` tree, so a worker placed under `src/` is mirrored into `plugin/app/`
automatically. The only real constraints: keep the worker module under `src/`, and
resolve its URL with `new URL('./pianoroll.worker.js', import.meta.url)` so it
loads identically from the repo root and the `plugin/app/` copy.

**Risks.** Pointer hit-testing (`hitNote`, marquee) must stay on the main thread,
so the worker needs a geometry snapshot to mirror what it drew. Transfer is
one-way (canvas control moves to the worker), so resize must post new dimensions.

**Dependencies.** `cache-theme-vars-and-reduced-motion` (a worker has no
`getComputedStyle`).

---

### Cluster 7: Physical control surfaces + input polish

Give the bare-Pages user tactile control without owning MIDI hardware, and tighten
the existing knob/pad input. The gamepad pad-bank is the anchor (full catalog+OSC
parity like midi); the rest are localized affordances.

---

#### `gamepad-pad-bank-transport-remote` (P2, medium, L)

**What it enables.** A USB/Bluetooth game controller becomes a cheap physical
surface: face buttons fire the eight drum lanes (the same `previewHit` path the
keyboard pads use), shoulder/Start trigger play/stop and slot switching, analog
sticks/triggers drive params or scrub. It fills the gap between the velocity-less
QWERTY path and a real MIDI controller most listeners do not own. Velocity comes
free from analog trigger pressure (`engine.previewHit`/`previewOn` already accept a
`vel` arg).

**Current state.** Absent. No `getGamepads`/`gamepadconnected` anywhere. Physical
play is only on-screen pads + QWERTY (`DRUM_KEYS` A-K, `KEY_TO_OFFSET` for
melodic) and hardware MIDI. QWERTY note-ons are fixed at vel 0.9 and drum pads call
`previewHit` with no velocity, so velocity is ignored on both.

**Proposed approach.** Mirror the WebMIDI architecture: add `src/ui/gamepad.js`
(sibling of `src/ui/midi.js`) constructed and `init()`'d in `src/ui/app.js` next
to `this.midi`. Listen for `gamepadconnected`; on each frame of the existing rAF
loop call `navigator.getGamepads()`, diff `button.pressed` edges, route: face/d-pad
to `previewHit`/`previewOn` for the selected track (drums vs synth via instrument
kind, same branch as `MidiInput.noteOn`), trigger pressure to velocity, Start to
`transport.toggle`, bumpers to `store.requestSlot`. Config (enabled,
button-to-action/lane map, deadzone) on `store.ui.gamepad` via
`store.configureGamepad` emitting `gamepad:config`, persisted to its own
localStorage key (copying `MidiInput.persist`/`restore`).

**Affected layers/files.** ui, api, core. `src/ui/gamepad.js`, `src/ui/app.js`,
`src/api/commands.js`, `src/api/api.js`, `src/core/store.js`,
`plugin/server/osc-gateway.js`, `plugin/server/oscine-mcp.mjs`, `test/smoke.mjs`.

**Catalog-contract implication.** Needs a catalog command modeled on `midi`: a
`gamepad` command + `cmd_gamepad` (status/enable/disable/map/clear_map +
deadzone). Add `/oscine/gamepad/*` routes to `routeOsc` mirroring
`/oscine/midi/*`, plus the smoke routing-table entry. Device binding/polling is
client-side only; the command writes config the manager reacts to.

**Effort/impact.** L / medium. Anchors the input cluster.

**Browser support + degradation.** Solid in Chrome/Edge/Firefox/Safari;
secure-context only and (recent Chrome) gated behind a prior user gesture, which
the app's audio-unlock click satisfies. Polling-based, no permission prompt.
Feature-detect `'getGamepads' in navigator`; if absent or no pad connects, the
manager stays dormant.

**Constraint fit.** Zero-dep, client-side, works on bare Pages (polling in the
existing rAF loop). Adds nothing to `schema.js`/share payload (config is
`store.ui` + its own localStorage key, never serialized).

**Risks.** Button/axis layout is not standardized; the W3C "standard" mapping
covers common pads but exotic ones need the map UI. Polling adds a tiny per-frame
cost. Edge-detection must debounce to avoid retriggers.

**Dependencies.** None.

---

#### `pointer-lock-infinite-knob-drag` (P2, medium, S)

**What it enables.** Knob and NumberDrag drags run out of screen: Knob maps
absolute clientY through a fixed scale (160, or 900 with shift) and NumberDrag uses
`startY - clientY`, so a full sweep of a deep-range param can hit the viewport edge
and clamp. Pointer Lock turns the drag into relative `movementY` accumulation that
never runs out, the standard behavior every DAW knob has.

**Current state.** Absent. No `requestPointerLock` anywhere. Knob and NumberDrag
compute deltas from absolute clientY against a captured `startY` with
`setPointerCapture`; the Fader maps absolute clientY to a track rect (inherently
bounded). `setPointerCapture` keeps events flowing but does not stop the screen
edge from limiting travel.

**Proposed approach.** On Knob/NumberDrag/Fader pointerdown, call
`root.requestPointerLock()` (best-effort, inside the gesture). Switch pointermove
to accumulate `e.movementY` when `document.pointerLockElement === root` instead of
reading clientY, keeping the current scale/step math; fall back to the clientY
delta when lock was denied. On endDrag/pointerup call `exitPointerLock()`.

**Affected layers/files.** ui. `src/ui/widgets.js`.

**Catalog-contract implication.** None. Purely a client-side input affordance
refining how existing `onInput`/`onCommit` deltas are computed; values still flow
through the same `store.setSetting`/`setTrackParam` actions the catalog exposes
(`set_master`, `set_mix`, `set_params`, `transport` bpm/swing).

**Effort/impact.** S / medium.

**Browser support + degradation.** Chrome/Edge/Firefox full; Safari supports
Pointer Lock (now standard). Requires a user gesture (the pointerdown satisfies
it). Feature-detect `root.requestPointerLock`; if the promise rejects or the API is
missing, keep the current `setPointerCapture` + clientY-delta path. Touch devices
never request lock.

**Constraint fit.** Zero-dep, no-build, works on bare Pages. Touches only ui/. No
project/share impact.

**Risks.** Pointer Lock auto-exits on Escape or tab blur; the drag-end handler
must also fire on a `pointerlockchange` that drops the lock so the widget does not
stick in dragging state. Exit lock immediately on pointerup so locks are momentary.

**Dependencies.** None. Could be cherry-picked into any earlier workflow already
touching `src/ui/widgets.js`.

---

#### `navigator-vibrate-pad-feedback` (P3, low, S)

**What it enables.** On phones/tablets the on-screen drum pads, piano keys, and
step-grid cells give only a visual "pressed" class with no tactile confirmation. A
short `navigator.vibrate(10-20ms)` on pad/step hit, optionally scaled by velocity,
gives the percussive "tap back" that turns a glass slab into a usable pad
controller. Android Chromium only.

**Current state.** Absent. No `navigator.vibrate` calls. Touch feedback is purely
visual: `pad.classList.add('pressed')` in `renderDrumPads` pointerdown, the piano
key 'pressed' class, and StepGrid cell velocity classes via `store.setStep`.

**Proposed approach.** Add a tiny helper in `src/ui/widgets.js` (`haptic(ms)`
guarding on `navigator.vibrate`) and call it from `src/ui/keyboard.js`
drum-pad/piano-key pointerdown and `src/ui/stepgrid.js` cell pointerdown when a
step turns on. Gate on `pointerType === 'touch'` so desktop mice never buzz, and
behind an opt-in `store.ui` flag (default on for touch, mirroring `ui.metronome`).
Do NOT fire on the stepgrid pointerenter paint-drag.

**Affected layers/files.** ui, core. `src/ui/widgets.js`, `src/ui/keyboard.js`,
`src/ui/stepgrid.js`, `src/core/store.js`.

**Catalog-contract implication.** Ship UI-only. The vibration is a transient
client-side affordance with no state to mutate, so it needs no catalog command, the
same reasoning by which `ui.metronome` lives as a UI-local `store.ui` boolean
rather than a serialized/command-backed setting. (Correction: an earlier draft
listed `src/api/commands.js` + `src/api/api.js`; those are dropped because the
recommended path adds no command. Only add a command/api handler in the optional
variant where an agent must remotely flip a global haptics toggle.)

**Effort/impact.** S / low. Lowest-value input item, but a genuinely cheap mobile
win for the tapped-share-link audience.

**Browser support + degradation.** Chrome/Edge/Firefox on Android only.
Safari/iOS does NOT support `navigator.vibrate`; desktop browsers no-op. The helper
feature-detects `'vibrate' in navigator` and the existing visual feedback remains
universal.

**Constraint fit.** Zero-dep, client-side, works on bare Pages. No schema/share
impact (a `store.ui` flag is never serialized).

**Risks.** iOS Safari silently ignores it, so it must not be presented as
cross-device. Overuse (vibrating on every step during paint-drag) would annoy and
drain battery; restrict to discrete pad/key hits and the initial step toggle.

**Dependencies.** None.

---

#### `permissions-api-midi-gamepad-status` (P3, low, S)

**What it enables.** The MIDI button cannot tell "WebMIDI unavailable in this
browser" apart from "available but not granted / blocked": `MidiInput` conflates
both into `available:false`. `navigator.permissions.query({name:'midi'})` lets the
app show an accurate state ("blocked", "needs permission", "granted") and react
live via `PermissionStatus.onchange`. It also lets the app avoid the
`requestMIDIAccess` prompt until the user enables MIDI.

**Current state.** Partial/absent. No `navigator.permissions` usage.
`src/ui/midi.js` conflates "no WebMIDI" and "access denied" into `available:false`,
and `paintMidi` can only say "WebMIDI not available". No distinction for a user who
blocked MIDI, and no live reaction when they change it.

**Proposed approach.** In `src/ui/midi.js` `init()`, when `navigator.permissions`
exists, query `{name:'midi'}` to set a richer status via `reportMidi` (permission:
'granted'|'prompt'|'denied'). Subscribe to `PermissionStatus.onchange` to call
`refresh()`/`reportMidi` on grant change. Extend the `reportMidi` payload and
`paintMidi` to render the accurate state and tooltip. MIDI-only: the Gamepad API
has no permission descriptor, so the gamepad manager has nothing to query here.

**Affected layers/files.** ui, core. `src/ui/midi.js`, `src/ui/transportbar.js`,
`src/core/store.js`.

**Catalog-contract implication.** None new. Refines the runtime device state
already published through `store.reportMidi` to `midi:status` and consumed by the
existing `midi` command's status action. Adding a `permission` field keeps the
existing command's status output more accurate without a new command or OSC
address.

**Effort/impact.** S / low.

**Browser support + degradation.** `navigator.permissions` is broad
(Chrome/Edge/Firefox/Safari), but the `{name:'midi'}` descriptor is Chromium-only;
Firefox/Safari throw or reject for it. Wrap the query in try/catch and
feature-detect `navigator.permissions`; on any failure, fall back to today's
`available:true/false` reporting.

**Constraint fit.** Zero-dep, client-side, no sidecar, no schema/share impact.

**Risks.** Permission descriptor names are not uniformly supported and querying an
unknown name rejects, so it must be defensive. Low impact because it improves
messaging rather than capability. The title's "future input" framing should not
imply gamepad coverage.

**Dependencies.** None. Sequence after the WebMIDI/owner work since it only
enriches that path's status display.

---

#### `keyboard-lock-fullscreen-performance` (P3, low, M)

**What it enables.** Oscine is keyboard-dense: Space toggles transport, Digit1-4
switch slots, Z/X shift octave and QWERTY rows play notes, Cmd/Ctrl+Z undoes. In a
fullscreen live-jam or kiosk setting the browser intercepts Escape and certain
combos. Keyboard Lock lets the page reliably capture a chosen set so a performer's
shortcuts are not swallowed.

**Current state.** Absent. No `navigator.keyboard.lock` and no Fullscreen usage.
All key handling is plain window keydown listeners in
app.js/keyboard.js/pianoroll.js with typing guards. There is no
fullscreen/performance mode at all today.

**Proposed approach.** Introduce a lightweight fullscreen "perform" toggle (button
in `src/ui/transportbar.js`) that calls `editorHost.requestFullscreen()` and, when
granted, `navigator.keyboard.lock(['Escape', ...the keys Oscine binds])`. Exit
unlocks. The existing keydown handlers are unchanged; lock only guarantees they
keep receiving keys in fullscreen.

**Affected layers/files.** ui, api, core. `src/ui/transportbar.js`,
`src/ui/app.js`, `src/core/store.js`, `src/api/commands.js`, `src/api/api.js`.

**Catalog-contract implication.** If a "perform/fullscreen" mode becomes a
user-facing toggle, parity suggests a small catalog command (a `view` or `perform`
action) so MCP/OSC can put a kiosk into performance mode; the Keyboard Lock call
itself is client-side and cannot be driven headlessly. Ship the fullscreen+lock as
a UI affordance and only add a command if/when an agent needs to flip the mode
(then `commands.js`/`api.js` join the file list; for the UI-only first cut they
are optional).

**Effort/impact.** M / low. The lowest-priority item in the entire audit.

**Browser support + degradation.** Chrome/Edge only (Keyboard Lock is not in
Firefox or Safari). Requires fullscreen + secure context. Feature-detect
`navigator.keyboard?.lock`; without it, the fullscreen toggle still works and
shortcuts behave as today.

**Constraint fit.** Zero-dep, client-side, works on bare Pages. No schema/share
impact. Chromium-only and only meaningful in fullscreen.

**Risks.** Capturing Escape is a UX trap (users expect Escape to exit fullscreen);
provide an obvious alternate exit and only lock keys actually bound. Low standalone
value unless a fullscreen/perform mode exists.

**Dependencies.** `gamepad-pad-bank-transport-remote` (to justify a real perform
surface). Build only as polish on a future perform mode.

---

### Cluster 8: Audio engine and capture (cross-cluster items)

These three sit in the audio engine domain and do not group cleanly into one of
the seven clusters above; each is sequenced near a related roadmap gate.

---

#### `record-live-output` (P2, high, M)

**What it enables.** Adds capture of what the user actually hears in real time:
tweaks while playing, live MIDI, previews, slot switches, swing changes, everything
the offline bounce cannot reproduce. Today the only file path is the deterministic
offline render of a single slot (`export_wav`); there is no "record my performance"
path. A step toward the gate-4 capture work.

**Current state.** WAV export is offline-only: `cmd_export_wav` calls
`engine.renderToBuffer` to `renderProjectToBuffer` (OfflineAudioContext) which
rebuilds the graph. No `MediaStreamDestination` or `MediaRecorder` anywhere. The
live master chain ends at `masterAnalyser.connect(ctx.destination)`.

**Proposed approach.** Tap the existing master node into a
`ctx.createMediaStreamDestination()` in parallel with `ctx.destination` (never
replacing the speaker path). Wrap its `.stream` in a `MediaRecorder`; start/stop
produces Blob chunks. Add a `record` catalog command (start|stop|status) with
`cmd_record` driving `engine.startCapture()`/`stopCapture()`; on stop hand the Blob
to `downloadBlob`. MediaRecorder emits WebM/Opus (or audio/mp4 on Safari), not WAV,
so document it as a compressed performance capture distinct from the lossless
offline bounce.

**Affected layers/files.** engine, api. `src/engine/engine.js`,
`src/api/commands.js`, `src/api/api.js`, `test/smoke.mjs`,
`plugin/server/osc-gateway.js` (only if a first-class `/oscine/record` route is
wanted; `/oscine/cmd` already covers it).

**Catalog-contract implication.** Needs a catalog command (record start/stop/
status) + `cmd_record` for parity, plus a smoke headless-execution check.
MediaRecorder/MediaStreamDestination do not exist in node, so the handler must
assert availability and degrade (return an actionable "capture unavailable in this
context" rather than throwing), the way the midi handler stays navigator-free.

**Effort/impact.** M / high. P2 rather than P1: net-new capability adjacent to a
Later gate, not a current defect.

**Browser support + degradation.** MediaRecorder + createMediaStreamDestination
Chrome/Edge/Firefox solid; Safari supports MediaRecorder (audio/mp4) from 14.1+
with codec quirks. Feature-detect with `MediaRecorder.isTypeSupported`; when
absent, the record command returns `{ok:false, reason}` and the UI hides the record
button, leaving offline `export_wav` as the universal path.

**Constraint fit.** Zero-dep, no-build, works with no sidecar. One honest tension:
output is compressed (Opus/AAC), not the 16-bit PCM WAV `core/wav.js` produces, so
it does not replace `export_wav` and the docs must say so. Engine-never-mutates-
project holds (output tap).

**Risks.** Recording captures real-time output including any audio glitches, and
codec/container varies across browsers. Position it alongside, not instead of,
`export_wav` to avoid user confusion.

**Dependencies.** None.

---

#### `latency-compensated-playhead` (P2, medium, S)

**What it enables.** Tightens visual sync. The playhead, piano-roll cursor, and
step-grid highlight are positioned from `ctx.currentTime` (when audio is
scheduled), not when it reaches the speakers. On high-latency outputs (Bluetooth,
USB interfaces) that gap is tens of ms, so the playhead visibly leads the sound.
Using the actual output timestamp makes what you see line up with what you hear.

**Current state.** `Transport.getPosition` computes the visual beat from
`timeToBeat(ctx.currentTime)` with no latency term. `src/engine/context.js`
constructs the AudioContext with `latencyHint:'interactive'` but never reads
`outputLatency`/`baseLatency` or `getOutputTimestamp`. `getPosition` is consumed
in `src/ui/app.js` and fanned to transportbar/pianoroll/stepgrid `onFrame`.

**Proposed approach.** In `getPosition`'s display path, prefer
`ctx.getOutputTimestamp().contextTime` when available, else subtract
`(ctx.outputLatency ?? ctx.baseLatency ?? 0)` from `ctx.currentTime`. The scheduler
keeps using raw `currentTime` + lookahead for SCHEDULING. Only the display
`localBeat` shifts. The `absBeat` field returned by `getPosition` is consumed by
MIDI record-quantize timing (`src/ui/midi.js`); do NOT apply the latency offset to
`absBeat` or recorded/quantized notes land early. Keep `absBeat` on the raw clock;
add the offset only to `localBeat` (or a new `displayBeat`).

**Affected layers/files.** engine. `src/engine/transport.js`.

**Catalog-contract implication.** No catalog command and no OSC route: only
changes how the existing playhead position is computed for painting.
`cmd_status`/`transportState` reads `positionBeat` from `getPosition.localBeat`, so
it benefits automatically and stays consistent, as long as the offset is applied to
`localBeat` only. No UI file needs editing (correction: the original
`src/ui/transport-bar.js` file does not exist; the playhead UI file is
`src/ui/transportbar.js` and it is a read-only beneficiary).

**Effort/impact.** S / medium.

**Browser support + degradation.** `getOutputTimestamp` + `outputLatency`
Chrome/Edge/Firefox. Safari `getOutputTimestamp` incomplete/absent; `baseLatency`
broader. Chain fallbacks: getOutputTimestamp to outputLatency to baseLatency to 0.
With 0 the behavior is identical to today.

**Constraint fit.** Zero-dep, no-build, no sidecar. Engine-never-mutates-project
preserved (read-only). Keeps offline-matches-live: only the display clock shifts.
Display offset confined to `localBeat`; `absBeat` stays latency-free.

**Risks.** `getOutputTimestamp` can return zero/stale values right after resume;
guard against a backwards-jumping or zero `contextTime` by falling back to
`currentTime` when the timestamp looks invalid.

**Dependencies.** None.

---

#### `choose-output-device` (P3, low, M)

**What it enables.** Lets a user route Oscine to a specific output (an audio
interface, headphones, a virtual device) instead of always the system default. A
nicety for anyone running a real monitoring setup; pairs with the live-record and
metering work. Not table stakes for the primary GitHub-Pages groovebox surface,
where system-default output is the norm.

**Current state.** `src/engine/context.js` `getCtx` constructs
`new AudioContext({latencyHint:'interactive'})` and never sets a sink;
`setSinkId`/`sinkId`/`enumerateDevices`/`selectAudioOutput` appear nowhere.

**Proposed approach.** Add `engine.setOutputDevice(deviceId)` calling
`ctx.setSinkId(deviceId)` on the live context (no graph rebuild). Enumerate
candidates with `enumerateDevices()` filtered to `kind==='audiooutput'` (labels
require a prior permission/`selectAudioOutput` gesture). Surface as a catalog
command `output` (list|set) with `cmd_output`, so an agent can list/select a sink
and the UI gets a dropdown from the same handler. Store the chosen deviceId in
UI/session state, NOT in the project doc.

**Affected layers/files.** engine, api, ui. `src/engine/context.js`,
`src/engine/engine.js`, `src/api/commands.js`, `src/api/api.js`, `src/ui/mixer.js`,
`test/smoke.mjs`.

**Catalog-contract implication.** Needs a catalog command (`output` list/set) +
`cmd_output` handler + smoke check for parity, mirroring how the midi command stays
headless-safe: the handler must not touch navigator and should return an actionable
"device selection happens in the browser app" note when run headless. Device
list/selection is machine-local, so it must NOT be written into `src/core/schema.js`
(project doc / share payload).

**Effort/impact.** M / low.

**Browser support + degradation.** `AudioContext.setSinkId` Chrome/Edge 110+ and
(staged/partial) recent Firefox; Safari does NOT support it. `enumerateDevices` is
universal but output-device labels need a permission gesture. Feature-detect
`typeof ctx.setSinkId === 'function'` before exposing the picker; when absent, hide
the picker and the command returns `{ok:false, reason:'output device selection
unsupported in this browser'}`.

**Constraint fit.** Zero-dep, no-build, no sidecar. The one constraint to honor:
do not persist the deviceId in the project document (`schema.js` doubles as the
share-link payload); keep it in session/localStorage UI state only.

**Risks.** Device ids are opaque and unstable across sessions/permission states;
persisting a stale id can fail on next load, so `setSinkId` calls must be try/catch
with a fall-back to the default sink. Impact is modest for the primary
browser-groovebox audience whose default-output flow already works.

**Dependencies.** None.

---

## Suggested follow-up workflows

Each cluster is a candidate build Workflow. Decompositions name the phases,
parallelizable disjoint-file work, and command/OSC implications. The recommended
order across clusters follows.

### Workflow A: Cross-tab safety + autosave durability

- **Phase 1 (parallel, disjoint files):** `flush-autosave-on-pagehide`
  (`persist.js` + `main.js`, no command) and `broadcastchannel-tab-presence`
  (new `core/presence.js` + `transportbar.js` + presence catalog command). These
  touch different files and have no ordering constraint.
- **Phase 2:** `web-locks-autosave-leader` (`persist.js` storage listener + new
  store dirty bit + optional project 'reload' action). The headline defect fix;
  depends on nothing but benefits from the presence bus wiring landing first.
- **Phase 3 (parallel after presence):** `web-locks-midi-owner-election`
  (`midi.js` + extend `midi` status payload, no new command) and
  `storage-event-cross-tab-settings` (`midi.js` storage listener, no command).
  Both ride the presence id and `midi:config` plumbing.
- **Phase 4:** `web-locks-transport-audio-owner`, sequenced LAST and treated as M
  to L because routing the direct `transportbar.js` `toggle()` through one
  owner-guard (not just gating `cmd_transport`) is the real work.
- **Catalog implications:** only presence adds a read-only command (smoke shape
  check at `test/smoke.mjs:234-237`); autosave reload is an optional `project`
  action; midi/transport owner state extends existing command status payloads (no
  new commands).
- `sharedworker-bridge-singleton` is a P3 deepening that trails the whole cluster
  and is sidecar-only; ship only if connection churn proves a measured problem.

### Workflow B: Background-tab clock + lifecycle robustness (gate 5)

- **Phase 1:** the merged worker/worklet clock
  (`background-tab-clock-via-visibility-and-worker`), replace only the wakeup
  source in `transport.js` with an inline Blob Worker (preferred over AudioWorklet
  first, avoids the addModule/URL wrinkle) and add `transport.resync()`. Single
  engine file, no command. The smoke suite already drives `tick()` manually
  (`test/smoke.mjs:123-128`) so the swap is contract-verified; add one assertion
  that message-driven tick produces identical `schedule:window` segments.
- **Phase 2:** `page-lifecycle-freeze-resume-handling`, reuses the SAME
  `transport.resync()` from phase 1 (hard dependency, must land together or
  coordinate the single resync path) plus `context.js` `ensureRunning` on resume.
- **Phase 3 (deferred, gated):** `constant-source-master-mod` is an engine
  primitive for the gate-3 automation feature, not a standalone build item;
  implement it inside the automation workflow and carry it as a note.
- No parallelism within the clock items (all touch `transport.js`); the cluster as
  a whole parallelizes against everything in other clusters. Zero new commands.

### Workflow C: Asset layer + share-link headroom (gates 1 and 2)

- **Phase 0 (independent prep, parallelizable now):** `structured-clone-deepclone`
  (`util.js` one-line helper swap, correctness prep for binary-carrying clones, no
  command) and `persistent-storage-for-autosave-and-assets` (`persist.js`
  `persist()` call + optional storage block on `cmd_status`, additive read-only).
  Both are cheap and de-risk the asset work.
- **Phase 1:** `indexeddb-asset-store`, new `core/assets.js` (hash via
  `crypto.subtle`, IDB object store), new `asset` catalog command + `cmd_asset` +
  REQUIRED smoke headless check (`test/smoke.mjs:236-237`), schema gains optional
  hash refs only, and the synchronous boot path (`main.js`
  `maybeLoadSharedSong`, `store.load`) must be made async-aware for sampled
  projects. This IS the gate-1 spec.
- **Phase 2:** `opfs-large-asset-storage` folds into the SAME `asset` command
  (additive 'usage'/'estimate' action) as a backend-pluggable durability layer
  behind IDB; it absorbs the `persist()`/`estimate()` surface, so coordinate with
  phase 0's persistent-storage item to avoid double-owning `persist()`.
- **Phase 3 (independent, can parallelize with phase 1):**
  `compressionstream-share-link`, gate-2 gzip with a codec tag (`s1=`/`s2=`),
  requires making `cmd_share` async (currently SYNC at `src/api/api.js:606`) and
  the boot-path decode async; verifiable natively on node 22.
- **Catalog:** one new `asset` command (shared by two items); `cmd_share` goes
  async but no new command; storage estimate is additive read-only on existing
  commands.

### Workflow D: Desktop-grade file I/O

- **Phase 1:** `file-system-access-save-open`, new `ui/fileops.js` handle path +
  extend the `project` command with a 'save'/'export' action returning
  `store.serialize()` (the headless-safe contract behind the Chromium-only
  picker). Foundation for the OS-open story.
- **Phase 2 (parallel, disjoint files):** `launchqueue-file-handler` (manifest
  `file_handlers` + `main.js` launchQueue consumer, soft dep on the manifest from
  the PWA cluster, funnels into `store.load`, no new command) and `drag-drop-import`
  (new `ui/dropzone.js` wired from `app.js`, reuses `store.load` and later the
  `asset` register action, no new command).
- **Phase 3:** `web-share-song-link-and-wav`, native share sheet over the existing
  `share` command (link needs no command change) plus surfacing the WAV Blob from
  `cmd_export_wav` (the one real engine/api touchpoint); document the
  headless-can't-share asymmetry.
- **Catalog:** the project 'save'/'export' action is the only meaningful command
  addition; everything else rides existing commands or is a pure UI affordance
  funneling into `store.load`.

### Workflow E: Installable PWA + OS transport integration

- **Phase 1:** `web-app-manifest-installable-pwa`, static `manifest.webmanifest` +
  PNG icons from the existing brand SVG + the MANDATORY `tools/sync-plugin.mjs`
  SOURCES edit (or the existing `--check` passes green while `plugin/app/` silently
  lacks the files) + iOS `apple-*` meta tags. No command.
- **Phase 2 (parallel, both depend on the manifest, disjoint files):**
  `media-session-lockscreen-transport` (new `ui/mediasession.js` consuming
  `transport:state`, no new command, rides the existing `transport` command) and
  `badging-api-recording-indicator` (tiny `ui/badge.js` subscribing to
  `midi:config`/`midi:status`, no command).
- **Phase 3:** `service-worker-offline-shell`, `sw.js` cache-first with explicit
  network-only bypass for `/health` and non-GET (the verified sidecar-safety
  requirement), `CACHE_VERSION` tied to the release version, `sw.js` added to
  SOURCES; needs NO sidecar edit.
- **Catalog:** zero new commands in this entire cluster (all ride existing
  transport/midi commands or are static page metadata).
- Coordinate the single manifest with Workflow D's `launchqueue-file-handler`:
  whichever workflow runs first authors the manifest, the other consumes it.

### Workflow F: Render-loop efficiency + visual feedback

- **Phase 1 (parallel, mostly disjoint):** `gate-raf-loop-on-visibility-and-activity`
  (`app.js` self-suspending loop + visibilitychange; the high-impact idle/hidden-tab
  CPU win), `cache-theme-vars-and-reduced-motion` (`pianoroll.js`: resolve palette
  once, kill per-frame `getComputedStyle`), and `prefers-reduced-motion-and-color-scheme`
  (`main.css` media block + color-scheme). These three touch largely different
  files and ship independently.
- **Phase 2:** `analyser-spectrum-visualizer` (merges spectrum and RMS meters),
  engine getSpectrum/RMS read side + canvas visualizer inside the gated loop
  (depends on gate-raf-loop) + a `view` catalog command carrying the visualizer
  mode for parity (mirrors `cmd_transport` metronome flag); REQUIRES smoke check.
  Also stop reusing the single shared `meterBuf` across two fftSizes.
- **Phase 3 (parallel, both polish):**
  `stepgrid-resizeobserver-and-intersection-virtualization` (depends on
  gate-raf-loop) and `offscreencanvas-pianoroll-worker` (hard dep on
  cache-theme-vars: a worker has no `getComputedStyle`; new `pianoroll.worker.js`
  auto-mirrored by recursive sync).
- **Phase 4 (lowest, optional):** `view-transitions-editor-routing` (depends on
  prefers-reduced-motion).
- **Catalog:** one new `view` command (visualizer mode), shared if a reduced-motion
  override is also exposed; everything else is command-free.

### Workflow G: Physical control surfaces + input polish

- **Phase 1:** `gamepad-pad-bank-transport-remote`, the substantial item,
  mirroring the WebMIDI architecture exactly: new `ui/gamepad.js` polled in the
  existing rAF loop, `store.configureGamepad`, a full `gamepad` catalog command +
  `cmd_gamepad` + `/oscine/gamepad/*` OSC routes + smoke routing entry. Config on
  `store.ui`, never serialized.
- **Phase 2 (parallel, all disjoint, no commands):** `pointer-lock-infinite-knob-drag`
  (`widgets.js` only, unbounded knob/NumberDrag), `navigator-vibrate-pad-feedback`
  (UI-only path: `widgets.js` helper + `keyboard.js`/`stepgrid.js` call sites +
  `store.ui` flag), and `permissions-api-midi-gamepad-status` (MIDI-scoped only;
  enriches the existing `midi:status` report, no command).
- **Phase 3 (lowest, gated on a real perform surface):**
  `keyboard-lock-fullscreen-performance` depends on gamepad-pad-bank landing first
  to justify a fullscreen jam mode.
- **Catalog:** one new `gamepad` command with full OSC parity; an optional
  `perform`/`view` command only if keyboard-lock ships; the rest add nothing.

### Recommended order across clusters

1. **FIRST: Workflow A (Cross-tab safety + autosave durability).** It contains the
   only live data-loss defect in the whole audit (`web-locks-autosave-leader`: two
   tabs silently clobber each other's single autosave key) plus the cheap
   terminal-flush gap (`flush-autosave-on-pagehide`) that loses the last 600ms of
   edits on close. These are P0 correctness fixes with no roadmap dependency and no
   constraint tension. Presence is reusable substrate, so doing this first also
   lays groundwork. Ship flush + presence + autosave-leader core; the
   transport-audio-owner item can trail given its layering caveat.
2. **SECOND: Workflow B (Background-tab clock, gate 5).** An explicit roadmap gate
   the codebase already flags in `transport.js` and ROADMAP gate 5, scheduled
   "alongside song mode." High-impact, engine-only, contract-verified by tests that
   already exist, no cross-cluster dependency. Doing it before the asset/song work
   means unattended playback is solid when song mode lands.
3. **THIRD: Workflow C (Asset layer + share-link headroom, gates 1 and 2).** The
   largest, highest-strategic-value cluster: it writes the gate-1 asset-layer spec
   the roadmap explicitly says to land BEFORE sampler A so the project format is not
   migrated twice, and gate-2 share compression is its natural sibling. Sequence it
   after the two correctness/robustness clusters because it is L-effort, touches the
   synchronous boot path (making it async-aware is the risky part), and is a
   prerequisite for sampling rather than a current-defect fix. Do the cheap prep
   items first inside this workflow.
4. **FOURTH: Workflow D (Desktop-grade file I/O) and Workflow E (Installable PWA).**
   These can run in EITHER order or in parallel by separate operators; they share
   only the manifest (honor the one-manifest constraint, whichever runs first
   authors it). Both are high-polish, progressive-enhancement, low-risk, and unblock
   no roadmap gate. File I/O has slightly higher user-perceived value (save-in-place),
   so prefer it marginally first.
5. **FIFTH: Workflow F (Render-loop efficiency + visual feedback).** gate-raf-loop is
   a genuine high-impact CPU/battery win and could be pulled earlier if idle-drain is
   observed, but the cluster as a whole is performance polish with no gate dependency,
   and the visualizer's value rises after the asset/song work makes sessions longer.
   cache-theme-vars must precede offscreencanvas-pianoroll-worker.
6. **LAST: Workflow G (Physical control surfaces + input polish).** The gamepad
   pad-bank is a real, well-grounded capability with full catalog/OSC parity, but it
   is an alternative-input nicety, not a gate or a defect, so it sequences last.
   pointer-lock and the input-polish items are cheap and could be cherry-picked into
   any earlier workflow that already touches `widgets.js`; keyboard-lock is the
   lowest-priority item in the entire audit.

The three audio-engine items sit outside the seven core clusters: `record-live-output`
sequences near gate-4 capture, `latency-compensated-playhead` is a cheap engine-only
win that can ride any engine-touching workflow, and `constant-source-master-mod` is a
primitive carried into the gate-3 automation feature.

**Cross-cutting quick-wins note.** Pull the S-effort, zero-dependency, zero-command
items (`structured-clone-deepclone`, `persistent-storage-for-autosave-and-assets`,
`cache-theme-vars-and-reduced-motion`, `flush-autosave-on-pagehide`) forward
opportunistically. They are cheap correctness/perf wins that de-risk later clusters
and could seed a single "quick wins" warm-up workflow before Workflow A if an operator
wants momentum.

## Coverage notes

### Gaps the seven lenses left under-covered (relevant, worth a later gate)

- **WebRTC / RTCDataChannel.** The roadmap leans into agent-jam and multi-instance
  sessions, but the lenses only covered same-origin cross-tab coordination
  (BroadcastChannel, Web Locks, storage event) and the sidecar WebSocket. True
  peer-to-peer real-time jam between two DIFFERENT users/browsers (the natural
  extension of the share-link distribution model) is the one genuinely-relevant
  collaboration surface left untouched. It carries sidecar/signaling and format
  implications, so it deserves an explicit later gate rather than silent omission.
- **WebTransport.** A more modern sidecar transport than the current WebSocket
  bridge (HTTP/3, datagrams for the 10Hz state push). Under-covered, arguably a
  deepening of the existing bridge rather than net-new. Lower priority than WebRTC
  and explicitly sidecar-only (so non-core per the brief), but worth naming.
- **AudioWorklet for DSP (not just clock).** The worklet was only proposed as a
  timing source. Custom DSP processors (a real limiter, bitcrusher, custom
  oscillators, sample-accurate per-voice synthesis) are the obvious AudioWorklet use
  the audio-engine lens skipped. Genuinely relevant to a synth, dovetails with the
  gate-2 automation/inserts line, but heavier. Zero build tension (worklet modules
  are fine as plain ES files).
- **Prioritized Task Scheduling (`scheduler.postTask` / `scheduler.yield`).**
  Relevant to the rendering domain (yielding to keep input responsive during heavy
  piano-roll repaints or asset decode), a cleaner primitive than rAF gating in some
  cases. Modest value, Chromium-leaning support.
- **Storage Buckets API.** Would let the asset store and the autosave have
  independent eviction/persistence policies (evict samples under pressure while
  keeping the tiny project doc durable). Relevant to gate-1's durability concern,
  but narrow support (Chromium-only as of the cutoff), so correctly low priority.
- **WebCodecs (AudioDecoder/AudioEncoder).** Relevant once sampling lands (decoding
  imported compressed audio off the main thread, or encoding the MediaRecorder
  capture to a chosen format) and a better answer than MediaRecorder's per-browser
  container lottery for the record-live-output item. Relevant but premature until
  sampler A.
- **Async Clipboard read / ClipboardItem.** The share lens confirmed clipboard WRITE
  is used for the share link, but pasting a share fragment or (later) pasting sample
  bytes / copying the WAV to the clipboard was not considered. Minor, a real small
  gap in the sharing domain.

### Explicitly out of scope (correctly excluded, noted for honesty)

These were rightly left out and should NOT be added:

- **Web Bluetooth, Web Serial, Web USB.** WebMIDI already covers the realistic
  hardware-controller case; raw serial/USB/BLE-MIDI is Tier-3 control-surface
  territory the roadmap rules out.
- **Web Authentication.** No accounts/auth model and none planned.
- **Background Sync / Periodic Background Sync.** No server-sync model; autosave is
  local localStorage.
- **Web Speech.** No voice I/O fit for a synth.
- **Generic Sensor APIs** (accelerometer/gyro as a mod source). A gimmick, not a fit.

### Constraint-tension items flagged inside the cards

A few items carry honest tension with the constraints and are flagged where they
appear, not hidden:

- `file-system-access-save-open`, `launchqueue-file-handler`: Chromium-only Save/Open
  in-place; Firefox/Safari keep download-a-copy. Progressive enhancement, not a fork
  (same `.oscine.json`).
- `web-locks-transport-audio-owner`: bends "engine is audio-only" if the lock lands in
  `transport.js`; preferred placement is a ui/api owner-guard all play paths funnel
  through.
- `background-tab-clock-via-visibility-and-worker`: the inline Blob worker is a slight
  departure from file-per-module; flag in `engine-layers.md`.
- `compressionstream-share-link`: a modern producer can mint a gzip link an old
  browser cannot open; the codec tag plus a readable error contain it.
- `record-live-output`: compressed Opus/AAC output, not the lossless PCM WAV
  `export_wav` produces; position alongside, not instead of.
- `sharedworker-bridge-singleton`: sidecar-only payoff and a hard Safari gap; an
  optimization layer, never a replacement.
