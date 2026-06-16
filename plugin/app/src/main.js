// Bootstrap: wire bus -> store -> engine/transport -> UI.
// Everything is dependency-injected from here; no module-level singletons
// besides the AudioContext, so a future multi-project DAW can instantiate
// several of these side by side.

import { EventBus } from './core/bus.js';
import { Store } from './core/store.js';
import { loadInitialProject, attachAutosave } from './core/persist.js';
import { getCtx, ensureRunning } from './engine/context.js';
import { AudioEngine } from './engine/engine.js';
import { Transport } from './engine/transport.js';
import { CommandAPI } from './api/api.js';
import { Bridge, clientId } from './api/bridge.js';
import { CrossTab } from './api/crosstab.js';
import { App } from './ui/app.js';
import { projectFromUrl } from './core/share.js';

// One stable per-tab id, shared by autosave (per-tab project keys), the
// bridge (session identity), and cross-tab coordination. Derived before
// anything that needs it so all three key off the same tab.
const tabId = clientId();

const bus = new EventBus();
const store = new Store(bus, loadInitialProject(tabId));
const engine = new AudioEngine(store, bus);
const transport = new Transport(getCtx(), store, bus);
attachAutosave(store, bus, tabId);

// Same-origin cross-tab coordination: presence roster + exclusive ownership
// of shared hardware (MIDI). Fully feature-detected; a no-op on browsers
// without BroadcastChannel / Web Locks.
const crosstab = new CrossTab(tabId, { title: tabTitle() });
crosstab.start();

// API-first: the command API is the canonical programmatic surface
// (same store/engine/transport calls the UI uses). The bridge exposes it
// to the MCP sidecar; window.oscine.api exposes it to the console.
const api = new CommandAPI({ store, engine, transport, bus });
const bridge = new Bridge(api, bus);
bridge.start();

// Song-in-URL: if the page was opened with a share link (#s=...), load that
// song before building the UI, so a shared link lands on the shared song
// rather than the autosaved one. Bad/foreign fragments are ignored.
maybeLoadSharedSong(store);

const app = new App(document.getElementById('app'), { store, bus, engine, transport, api, crosstab });

// Autoplay policy: resume the context on the first gesture anywhere.
const unlock = () => { ensureRunning(); };
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

// Console access for poking at the internals (and future scripting).
// Try: oscine.api.execute('status').then(console.log)
window.oscine = { bus, store, engine, transport, app, api, bridge, crosstab };

// Load a song carried in the page URL's #s= fragment, replacing the freshly
// loaded autosave. Runs before the UI is built, so this is a plain swap (no
// undo checkpoint needed: nothing has happened yet). The fragment is left in
// the URL so the link stays copyable/refreshable.
function maybeLoadSharedSong(store) {
  try {
    const shared = projectFromUrl(typeof location !== 'undefined' ? location.hash : null);
    if (shared) store.load(shared);
  } catch (err) {
    console.warn('[oscine] ignoring unreadable share link:', err.message);
  }
}

function tabTitle() {
  try { return document.title || 'Oscine'; } catch { return 'Oscine'; }
}
