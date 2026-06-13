// Bridge: WebSocket client that connects the running app to the Oscine
// MCP sidecar and executes incoming commands against the CommandAPI.
//
// When the app is served BY the sidecar (the normal plugin setup), the
// bridge connects same-origin at /bridge. When served by a plain dev
// server (./start.sh), it falls back to the default sidecar port, so a
// dev copy of the app can still attach to a running sidecar.
//
// Protocol (JSON text frames):
//   app -> server  {type:'hello', app:'oscine', apiVersion, project}
//   server -> app  {type:'cmd', id, name, args}
//   app -> server  {type:'result', id, ok, result?, error?}
//   server -> app  {type:'ping'}  ->  {type:'pong'}

export const DEFAULT_BRIDGE_PORT = 7321;

export class Bridge {
  constructor(api, bus) {
    this.api = api;
    this.bus = bus;
    this.ws = null;
    this.connected = false;
    this.candidateIndex = 0;
    this.timer = null;
    this.streamTimer = null; // 10Hz state push while OSC subscribers exist
  }

  candidates() {
    const list = [];
    const override = new URLSearchParams(location.search).get('bridge');
    if (override) list.push(`ws://127.0.0.1:${override}/bridge`);
    if (location.protocol.startsWith('http') &&
        ['localhost', '127.0.0.1'].includes(location.hostname)) {
      list.push(`ws://${location.host}/bridge`);
    }
    list.push(`ws://127.0.0.1:${DEFAULT_BRIDGE_PORT}/bridge`);
    return [...new Set(list)];
  }

  start() {
    this.connect();
  }

  connect() {
    const urls = this.candidates();
    const url = urls[this.candidateIndex % urls.length];
    this.candidateIndex++;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.candidateIndex = Math.max(0, this.candidateIndex - 1); // stick with this one
      ws.send(JSON.stringify({
        type: 'hello',
        app: 'oscine',
        apiVersion: this.api.version,
        project: this.api.store.project.name,
      }));
      this.bus.emit('bridge:status', { connected: true, url });
      console.info(`[oscine] MCP bridge connected: ${url}`);
    };

    ws.onmessage = async (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (msg.type === 'stream') {
        this.setStreaming(msg.on);
        return;
      }
      if (msg.type !== 'cmd') return;
      try {
        const result = await this.api.execute(msg.name, msg.args ?? {});
        ws.send(JSON.stringify({ type: 'result', id: msg.id, ok: true, result }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'result', id: msg.id, ok: false, error: { message: err.message } }));
      }
    };

    ws.onclose = () => {
      this.setStreaming(false);
      if (this.connected) {
        this.connected = false;
        this.bus.emit('bridge:status', { connected: false });
        console.info('[oscine] MCP bridge disconnected');
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ok */ } };
  }

  scheduleReconnect() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), 2500);
  }

  // State streaming for the sidecar's OSC subscribers: compact snapshot
  // at 10Hz, fanned out as OSC messages server-side.
  setStreaming(on) {
    clearInterval(this.streamTimer);
    this.streamTimer = null;
    if (on) {
      this.streamTimer = setInterval(() => this.pushState(), 100);
    }
  }

  pushState() {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
    const { store, engine, transport } = this.api;
    const pos = transport.getPosition();
    const meters = { master: round3(engine.getLevel('master')) };
    for (const t of store.project.tracks) meters[t.name] = round3(engine.getLevel(t.id));
    const ts = this.api.transportState();
    this.ws.send(JSON.stringify({
      type: 'event',
      name: 'state',
      data: {
        playing: pos.playing,
        bar: Math.floor(pos.localBeat / 4) + 1,
        beat: pos.localBeat % 4,
        bpm: store.project.bpm,
        slot: ts.activeSlot,
        queued: ts.queuedSlot,
        meters,
      },
    }));
  }
}

const round3 = (v) => Math.round(v * 1000) / 1000;
