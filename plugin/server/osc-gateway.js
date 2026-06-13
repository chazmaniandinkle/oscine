// OSC gateway: maps the /oscine/* UDP address space onto the same command
// catalog that MCP and the UI use, and streams transport/meter state back
// to subscribers. TouchOSC, Max/MSP, Pd, SuperCollider, Reaper, Sonic Pi:
// anything that speaks OSC over UDP can drive Oscine with these.
//
// Inbound (control):
//   /oscine/play  /oscine/stop  /oscine/toggle
//   /oscine/bpm <n>        /oscine/swing <f>      /oscine/metronome <0|1>
//   /oscine/master/volume <f>     (also delayFeedback, delayReturn,
//                                  delayDiv, verbSize, verbReturn)
//   /oscine/track/<name>/gain <f>   /pan <f>   /mute <0|1>   /solo <0|1>
//   /oscine/track/<name>/send/delay <f>   /send/reverb <f>
//   /oscine/track/<name>/param/<key> <v>  /preset <s>   /select
//   /oscine/track/<name>/note <midi> [vel] [durSec]   (synth audition)
//   /oscine/track/<name>/hit <lane> [vel]             (drum audition)
//   /oscine/slot/select <A-D|0-3>   /slot/bars <n> [slot]
//   /oscine/slot/copy <from> <to>
//   /oscine/project/undo   /oscine/project/redo
//   /oscine/cmd <name> [json-args]    escape hatch to the full catalog
// Track names: '_' matches ' ' (OSC addresses can't contain spaces).
// Note: export_wav and share have no first-class /oscine/* address (a WAV
// download and a clipboard link aren't realtime control). Reach them via
// /oscine/cmd, e.g.  /oscine/cmd export_wav   or   /oscine/cmd share .
//
// Subscription (feedback):
//   /oscine/subscribe [port]    register sender (default: source port)
//   /oscine/unsubscribe         /oscine/ping -> /oscine/pong
// Subscribers receive, at ~10Hz while the app streams:
//   /oscine/position <bar:int> <beat:float>
//   /oscine/meter/<name> <float>   (every track + master)
// and on change: /oscine/transport <0|1>, /oscine/bpm <f>,
//   /oscine/slot <name> [queued]

import { createSocket } from 'node:dgram';
import { encodeMessage, decodePacket } from './osc-codec.js';

const trackName = (part) => decodeURIComponent(part).replaceAll('_', ' ');
const oscName = (name) => name.replaceAll(' ', '_');
const num = (v, fallback = undefined) => (typeof v === 'number' ? v : fallback);
const onOff = (v) => v === undefined || v === null ? true : (typeof v === 'boolean' ? v : Number(v) >= 1);

// Pure routing: OSC address + args -> catalog command (or control op).
// Returns { cmd, args } | { control, ... } | { error }.
export function routeOsc(address, args = []) {
  const parts = address.split('/').filter(Boolean);
  if (parts[0] !== 'oscine') return { error: `unhandled address ${address}` };
  const [, p1, p2, p3, p4] = parts;

  switch (p1) {
    case 'play': return { cmd: 'transport', args: { action: 'play' } };
    case 'stop': return { cmd: 'transport', args: { action: 'stop' } };
    case 'toggle': return { cmd: 'transport', args: { action: 'toggle' } };
    case 'transport':
      if (['play', 'stop', 'toggle'].includes(p2)) return { cmd: 'transport', args: { action: p2 } };
      return { error: `unknown transport op ${p2}` };
    case 'bpm': return { cmd: 'transport', args: { bpm: Math.round(num(args[0], 120)) } };
    case 'swing': return { cmd: 'transport', args: { swing: num(args[0], 0) } };
    case 'metronome': return { cmd: 'transport', args: { metronome: onOff(args[0]) } };

    case 'master': {
      const keys = ['volume', 'delayDiv', 'delayFeedback', 'delayReturn', 'verbSize', 'verbReturn'];
      if (!keys.includes(p2)) return { error: `unknown master key ${p2}` };
      return { cmd: 'set_master', args: { [p2]: num(args[0], 0) } };
    }

    case 'track': {
      if (!p2 || !p3) return { error: 'track address needs /oscine/track/<name>/<op>' };
      const track = trackName(p2);
      switch (p3) {
        case 'gain': case 'pan':
          return { cmd: 'set_mix', args: { track, [p3]: num(args[0], 0) } };
        case 'mute': case 'solo':
          return { cmd: 'set_mix', args: { track, [p3]: onOff(args[0]) } };
        case 'send': {
          if (p4 === 'delay') return { cmd: 'set_mix', args: { track, sendDelay: num(args[0], 0) } };
          if (p4 === 'reverb') return { cmd: 'set_mix', args: { track, sendReverb: num(args[0], 0) } };
          return { error: `unknown send ${p4}` };
        }
        case 'param': {
          if (!p4) return { error: 'param address needs a key' };
          return { cmd: 'set_params', args: { track, params: { [p4]: args[0] } } };
        }
        case 'preset':
          return { cmd: 'set_params', args: { track, preset: String(args[0] ?? 'init') } };
        case 'select':
          return { cmd: 'select_track', args: { track } };
        case 'note':
          return {
            cmd: 'preview',
            args: { track, pitch: Math.round(num(args[0], 60)), vel: num(args[1], 0.9), dur: num(args[2], 0.6) },
          };
        case 'hit':
          return { cmd: 'preview', args: { track, lane: String(args[0] ?? 'kick'), vel: num(args[1], 1) } };
        default:
          return { error: `unknown track op ${p3}` };
      }
    }

    case 'slot': {
      if (p2 === 'select') return { cmd: 'slots', args: { action: 'select', slot: args[0] } };
      if (p2 === 'bars') {
        const a = { action: 'set_bars', bars: Math.round(num(args[0], 2)) };
        if (args[1] !== undefined) a.slot = args[1];
        return { cmd: 'slots', args: a };
      }
      if (p2 === 'copy') return { cmd: 'slots', args: { action: 'copy', from: args[0], to: args[1] } };
      return { error: `unknown slot op ${p2}` };
    }

    case 'project':
      if (p2 === 'undo' || p2 === 'redo') return { cmd: 'project', args: { action: p2 } };
      return { error: `unknown project op ${p2}` };

    case 'cmd': {
      const name = String(args[0] ?? '');
      let parsed = {};
      if (args[1] !== undefined) {
        try { parsed = JSON.parse(String(args[1])); } catch { return { error: 'second arg of /oscine/cmd must be JSON' }; }
      }
      return { cmd: name, args: parsed };
    }

    case 'subscribe': return { control: 'subscribe', port: num(args[0]) };
    case 'unsubscribe': return { control: 'unsubscribe' };
    case 'ping': return { control: 'ping' };

    default:
      return { error: `unhandled address ${address}` };
  }
}

export class OscGateway {
  constructor({ port = 7340, callApp, onSubscribersChange, log = () => {} }) {
    this.callApp = callApp;
    this.onSubscribersChange = onSubscribersChange;
    this.log = log;
    this.subscribers = new Map(); // 'host:port' -> {host, port}
    this.lastState = {};
    this.port = null;
    this.socket = createSocket('udp4');
    this.socket.on('message', (data, rinfo) => this.onPacket(data, rinfo));
    this.socket.on('error', (err) => log('osc socket error:', err.message));
    this.bind(port, 9);
  }

  bind(port, attemptsLeft) {
    const tryBind = (p, left) => {
      const onErr = (err) => {
        if (err.code === 'EADDRINUSE' && left > 0) {
          this.socket.removeListener('error', onErr);
          this.log(`osc port ${p} busy, trying ${p + 1}`);
          tryBind(p + 1, left - 1);
        }
      };
      this.socket.once('error', onErr);
      this.socket.bind(p, '127.0.0.1', () => {
        this.socket.removeListener('error', onErr);
        this.port = p;
        this.log(`OSC gateway listening on udp://127.0.0.1:${p} (try: /oscine/play)`);
      });
    };
    tryBind(port, attemptsLeft);
  }

  info() {
    return { port: this.port, subscribers: this.subscribers.size };
  }

  sendTo(sub, address, args) {
    try { this.socket.send(encodeMessage(address, args), sub.port, sub.host); } catch { /* ok */ }
  }

  broadcast(address, args) {
    for (const sub of this.subscribers.values()) this.sendTo(sub, address, args);
  }

  async onPacket(data, rinfo) {
    let messages;
    try { messages = decodePacket(data); } catch (err) {
      this.log('bad osc packet:', err.message);
      return;
    }
    for (const { address, args } of messages) {
      const route = routeOsc(address, args);

      if (route.control === 'subscribe') {
        const port = route.port ?? rinfo.port;
        this.subscribers.set(`${rinfo.address}:${port}`, { host: rinfo.address, port });
        this.lastState = {}; // force full refresh for the newcomer
        this.log(`osc subscriber + ${rinfo.address}:${port} (${this.subscribers.size} total)`);
        this.onSubscribersChange?.(this.subscribers.size);
        this.sendTo({ host: rinfo.address, port }, '/oscine/subscribed', [this.port]);
        continue;
      }
      if (route.control === 'unsubscribe') {
        for (const [key, sub] of this.subscribers) {
          if (sub.host === rinfo.address) this.subscribers.delete(key);
        }
        this.onSubscribersChange?.(this.subscribers.size);
        continue;
      }
      if (route.control === 'ping') {
        this.sendTo({ host: rinfo.address, port: rinfo.port }, '/oscine/pong', []);
        continue;
      }
      if (route.error) {
        this.log('osc:', route.error);
        continue;
      }

      try {
        await this.callApp(route.cmd, route.args);
      } catch (err) {
        this.log(`osc ${address} failed:`, err.message);
        this.sendTo({ host: rinfo.address, port: rinfo.port }, '/oscine/error', [`${address}: ${err.message}`]);
      }
    }
  }

  // Called by the sidecar when the app streams a state event (~10Hz).
  relayState(data) {
    if (this.subscribers.size === 0) return;
    const last = this.lastState;

    if (data.playing !== last.playing) this.broadcast('/oscine/transport', [data.playing ? 1 : 0]);
    if (data.bpm !== last.bpm) this.broadcast('/oscine/bpm', [data.bpm]);
    const slotKey = `${data.slot}|${data.queued ?? ''}`;
    if (slotKey !== last.slotKey) {
      this.broadcast('/oscine/slot', data.queued ? [data.slot, data.queued] : [data.slot]);
    }
    if (data.playing) {
      this.broadcast('/oscine/position', [data.bar, Math.round(data.beat * 100) / 100]);
    }
    for (const [name, level] of Object.entries(data.meters ?? {})) {
      this.broadcast(`/oscine/meter/${oscName(name)}`, [Math.round(level * 1000) / 1000]);
    }
    this.lastState = { playing: data.playing, bpm: data.bpm, slotKey };
  }

  close() {
    try { this.socket.close(); } catch { /* ok */ }
  }
}
