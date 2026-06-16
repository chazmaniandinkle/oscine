// MIDI -> OSC bridge: read a connected MIDI controller and forward each raw
// message to Oscine's OSC gateway as /oscine/midi/in <status> <d1> [d2]. The
// gateway feeds the same input pipeline WebMIDI uses, so velocity shaping, the
// velocity monitor, and record-arm all apply. This is how MIDI reaches Oscine
// on surfaces where WebMIDI is blocked (such as the Claude Code preview).
//
// Optional adapter tool, like playwright for e2e: it dynamically imports a
// native MIDI module and is NOT a runtime dependency of the app or sidecar.
// One-time setup:  npm i @julusian/midi
// Run:             npm run midi-bridge -- [--list] [--device <name>]
//                                         [--host <ip>] [--port <n>]
// The OSC port defaults to OSCINE_OSC_PORT (the same env var the sidecar
// reads), falling back to 7340; --port overrides either.
//
// Zero hard deps beyond node built-ins, @julusian/midi (optional), and the
// repo's own OSC codec.

import { createSocket } from 'node:dgram';
import { encodeMessage } from '../plugin/server/osc-codec.js';

function parseArgs(argv) {
  // Default to the same OSC port the sidecar honors (OSCINE_OSC_PORT in
  // oscine-mcp.mjs); --port still overrides. Without this, running the sidecar
  // on a non-default port leaves the bridge sending into the void at 7340.
  const opts = {
    list: false,
    device: null,
    host: '127.0.0.1',
    port: Number(process.env.OSCINE_OSC_PORT) || 7340,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') opts.list = true;
    else if (a === '--device') opts.device = argv[++i] ?? null;
    else if (a === '--host') opts.host = argv[++i] ?? opts.host;
    else if (a === '--port') opts.port = Number(argv[++i]) || opts.port;
  }
  return opts;
}

async function loadMidi() {
  try {
    return await import('@julusian/midi');
  } catch {
    console.error('MIDI bridge needs a native MIDI module. Install it with:');
    console.error('  npm i @julusian/midi');
    process.exit(1);
  }
}

function listPorts(input) {
  const names = [];
  for (let i = 0; i < input.getPortCount(); i++) names.push(input.getPortName(i));
  return names;
}

function pickPort(names, device) {
  if (!device) return names.length ? 0 : -1;
  const needle = device.toLowerCase();
  return names.findIndex((n) => n.toLowerCase().includes(needle));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const midi = await loadMidi();
  const input = new midi.Input();

  const names = listPorts(input);

  if (opts.list) {
    if (names.length === 0) {
      console.log('No MIDI input ports found.');
    } else {
      console.log('MIDI input ports:');
      names.forEach((n, i) => console.log(`  [${i}] ${n}`));
    }
    input.closePort?.();
    process.exit(0);
  }

  if (names.length === 0) {
    console.error('No MIDI input ports found. Connect a controller and try again.');
    process.exit(1);
  }

  const portIndex = pickPort(names, opts.device);
  if (portIndex < 0) {
    console.error(`No MIDI input matching "${opts.device}". Available ports:`);
    names.forEach((n, i) => console.error(`  [${i}] ${n}`));
    process.exit(1);
  }

  const socket = createSocket('udp4');
  const deviceName = names[portIndex];

  input.on('message', (_deltaTime, message) => {
    const bytes = message.slice(0, 3).map((b) => Math.round(b));
    const packet = encodeMessage('/oscine/midi/in', bytes);
    socket.send(packet, opts.port, opts.host, (err) => {
      if (err) console.error('osc send failed:', err.message);
    });
  });

  input.openPort(portIndex);

  console.log(`Bridging MIDI "${deviceName}" -> OSC udp://${opts.host}:${opts.port} (/oscine/midi/in)`);
  console.log('Play your controller; ctrl-C to stop.');

  const shutdown = () => {
    try { input.closePort(); } catch { /* ok */ }
    try { socket.close(); } catch { /* ok */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
