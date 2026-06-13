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
import { Bridge } from './api/bridge.js';
import { App } from './ui/app.js';

const bus = new EventBus();
const store = new Store(bus, loadInitialProject());
const engine = new AudioEngine(store, bus);
const transport = new Transport(getCtx(), store, bus);
attachAutosave(store, bus);

// API-first: the command API is the canonical programmatic surface
// (same store/engine/transport calls the UI uses). The bridge exposes it
// to the MCP sidecar; window.oscine.api exposes it to the console.
const api = new CommandAPI({ store, engine, transport, bus });
const bridge = new Bridge(api, bus);
bridge.start();

const app = new App(document.getElementById('app'), { store, bus, engine, transport });

// Autoplay policy: resume the context on the first gesture anywhere.
const unlock = () => { ensureRunning(); };
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

// Console access for poking at the internals (and future scripting).
// Try: oscine.api.execute('status').then(console.log)
window.oscine = { bus, store, engine, transport, app, api, bridge };
