// Headless smoke tests: run with `node test/smoke.mjs`.
// Covers everything that doesn't need a real browser: import graph,
// schema/store actions, undo, slot queueing, and transport scheduling
// math (driven with a stubbed AudioContext clock).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n[1] import graph: every relative import resolves to a file');
{
  const jsFiles = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.js')) jsFiles.push(p);
    }
  })(join(ROOT, 'src'));

  let broken = 0;
  for (const file of jsFiles) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]|import\s+['"](\.[^'"]+)['"]/g)) {
      const spec = m[1] || m[2];
      const target = resolve(dirname(file), spec);
      if (!existsSync(target)) {
        console.error(`      missing: ${spec} (from ${file})`);
        broken++;
      }
    }
  }
  check(`all imports resolve across ${jsFiles.length} modules`, broken === 0);
}

// ---------------------------------------------------------------------------
console.log('\n[2] schema + store actions');
const { EventBus } = await import(`${ROOT}/src/core/bus.js`);
const { Store } = await import(`${ROOT}/src/core/store.js`);
const { demoProject, createProject, validateProject } = await import(`${ROOT}/src/core/schema.js`);
const { listInstrumentDefs } = await import(`${ROOT}/src/engine/instruments/index.js`);

{
  const defs = listInstrumentDefs();
  check('instrument registry has 3 built-ins', defs.length === 3, `got ${defs.length}`);

  const demo = demoProject();
  check('demo project validates', !!validateProject(JSON.parse(JSON.stringify(demo))));
  check('demo has 4 tracks', demo.tracks.length === 4);
  const drumPattern = demo.slots[0].patterns[demo.tracks[0].id];
  check('demo drum pattern is 32 steps', drumPattern.steps.kick.length === 32);

  const bus = new EventBus();
  const events = [];
  bus.on('*', (type) => events.push(type));
  const store = new Store(bus, createProject());

  const t = store.addTrack('poly');
  check('addTrack selects new track', store.ui.selectedTrackId === t.id);
  check('addTrack created patterns in all slots', store.project.slots.every(s => s.patterns[t.id]));

  store.checkpoint();
  const n = store.addNote(t.id, { start: 1, pitch: 60, dur: 0.5, vel: 0.8 });
  check('addNote lands in active slot', store.getPattern(t.id).notes.length === 1);

  store.updateNotes(t.id, [{ id: n.id, pitch: 64 }]);
  check('updateNotes patches pitch', store.getPattern(t.id).notes[0].pitch === 64);

  store.undo();
  check('undo removes the note', store.getPattern(t.id).notes.length === 0);
  store.redo();
  check('redo restores the note', store.getPattern(t.id).notes.length === 1);

  const dt = store.addTrack('drums');
  store.checkpoint();
  store.setStep(dt.id, 'kick', 0, 1);
  check('setStep writes velocity', store.getPattern(dt.id).steps.kick[0] === 1);

  store.setSlotBars(4);
  check('setSlotBars resizes drum steps to 64', store.getPattern(dt.id).steps.kick.length === 64);

  store.copySlot(0, 2);
  check('copySlot copies bars + patterns', store.project.slots[2].bars === 4 &&
    store.project.slots[2].patterns[dt.id].steps.kick[0] === 1);

  const json = store.serialize();
  store.load(JSON.parse(json));
  check('serialize/load round-trips', store.getPattern(dt.id, 0).steps.kick[0] === 1);

  check('events flowed on the bus', events.includes('track:added') && events.includes('notes:changed'));
}

// ---------------------------------------------------------------------------
console.log('\n[3] transport scheduling math (stubbed clock)');
const { Transport } = await import(`${ROOT}/src/engine/transport.js`);

{
  const bus = new EventBus();
  const store = new Store(bus, createProject());
  store.addTrack('poly');
  store.project.bpm = 120; // 0.5s per beat; loop = 2 bars = 8 beats = 4s
  const ctx = { currentTime: 0 };
  const tp = new Transport(ctx, store, bus);

  const windows = [];
  let loops = 0;
  bus.on('schedule:window', w => windows.push(w));
  bus.on('transport:loop', () => loops++);

  tp.play();
  clearInterval(tp.timer); // drive manually
  for (let t = 0; t <= 9; t += 0.025) {
    ctx.currentTime = t;
    tp.tick();
  }

  check('windows were scheduled', windows.length > 50, `got ${windows.length}`);

  let contiguous = true, inBounds = true;
  let prevEnd = null;
  for (const w of windows) {
    if (w.toLocal < w.fromLocal - 1e-9) inBounds = false;
    if (w.fromLocal < -1e-9 || w.toLocal > 8 + 1e-9) inBounds = false;
    const absFrom = w.loopStartAbs + w.fromLocal;
    if (prevEnd !== null && Math.abs(absFrom - prevEnd) > 1e-6) contiguous = false;
    prevEnd = w.loopStartAbs + w.toLocal;
  }
  check('windows are contiguous (no gaps/overlaps)', contiguous);
  check('windows never cross the loop boundary', inBounds);
  check('loop fired ~2x over 9s of 4s loops', loops >= 2, `got ${loops}`);

  // Queued slot switch applies exactly at the boundary.
  const bus2 = new EventBus();
  const store2 = new Store(bus2, createProject());
  store2.addTrack('poly');
  store2.project.bpm = 120;
  store2.project.slots[1].bars = 1; // slot B is shorter
  const ctx2 = { currentTime: 0 };
  const tp2 = new Transport(ctx2, store2, bus2);
  const slotAt = [];
  bus2.on('schedule:window', w => slotAt.push({ abs: w.loopStartAbs + w.fromLocal, slot: w.slotIndex }));
  tp2.play();
  clearInterval(tp2.timer);
  ctx2.currentTime = 1; tp2.tick();
  store2.requestSlot(1, true); // queue B mid-loop
  for (let t = 1; t <= 6; t += 0.025) { ctx2.currentTime = t; tp2.tick(); }

  const before = slotAt.filter(x => x.abs < 8 - 1e-6);
  const after = slotAt.filter(x => x.abs >= 8 - 1e-6);
  check('pre-boundary windows stay on slot A', before.every(x => x.slot === 0));
  check('post-boundary windows are on slot B', after.length > 0 && after.every(x => x.slot === 1));
  check('queued switch consumed', store2.ui.activeSlot === 1 && store2.ui.queuedSlot === null);

  // Swing: odd 16ths delayed, even untouched.
  store2.project.swing = 0.5;
  const even = tp2.swingOffset(0.0) === 0 && tp2.swingOffset(0.5) === 0;
  const odd = tp2.swingOffset(0.25) > 0 && tp2.swingOffset(0.75) > 0;
  check('swing offsets odd 16ths only', even && odd);

  // BPM rebase keeps position continuous.
  const ctx3 = { currentTime: 0 };
  const bus3 = new EventBus();
  const store3 = new Store(bus3, createProject());
  const tp3 = new Transport(ctx3, store3, bus3);
  tp3.play();
  clearInterval(tp3.timer);
  ctx3.currentTime = 2.06; // anchor was 0.06; at 120bpm... default project bpm=110
  const beatBefore = tp3.timeToBeat(ctx3.currentTime);
  store3.setSetting('bpm', 160);
  const beatAfter = tp3.timeToBeat(ctx3.currentTime);
  check('bpm change keeps beat position continuous', Math.abs(beatBefore - beatAfter) < 1e-9,
    `${beatBefore} vs ${beatAfter}`);
}

// ---------------------------------------------------------------------------
console.log('\n[4] command API: every catalog command executes headlessly');
const { COMMANDS } = await import(`${ROOT}/src/api/commands.js`);
const { CommandAPI } = await import(`${ROOT}/src/api/api.js`);

{
  // Stubs standing in for browser-only layers.
  const previews = [];
  const engineStub = {
    ctx: { state: 'running' },
    previewNote: (...a) => previews.push(['note', ...a]),
    previewHit: (...a) => previews.push(['hit', ...a]),
    getLevel: () => 0,
    // Stand in for the OfflineAudioContext render (browser-only): hand back a
    // tiny stereo buffer so the export_wav handler's encode path runs in node.
    renderToBuffer: async ({ slotIndex = 0, loops = 2, sampleRate = 44100 } = {}) => {
      const frames = 64;
      const data = new Float32Array(frames);
      for (let i = 0; i < frames; i++) data[i] = Math.sin(i / 4) * 0.5;
      return {
        buffer: {
          numberOfChannels: 2,
          sampleRate,
          duration: frames / sampleRate,
          getChannelData: () => data,
        },
        durationSec: frames / sampleRate, sampleRate, channels: 2, loops, slotIndex,
      };
    },
  };
  const transportStub = {
    playing: false,
    play() { this.playing = true; },
    stop() { this.playing = false; },
    toggle() { this.playing = !this.playing; },
    getPosition() { return { playing: this.playing, localBeat: 0, loopBeats: 8 }; },
  };

  const bus = new EventBus();
  const store = new Store(bus, demoProject());
  const api = new CommandAPI({ store, engine: engineStub, transport: transportStub, bus });

  // Catalog sanity.
  const names = COMMANDS.map(c => c.name);
  check('catalog names are unique', new Set(names).size === names.length);
  check('every command has description + object schema',
    COMMANDS.every(c => c.description?.length > 20 && c.input?.type === 'object'));
  check('every command has a handler',
    COMMANDS.every(c => typeof api[`cmd_${c.name}`] === 'function'),
    COMMANDS.filter(c => !api[`cmd_${c.name}`]).map(c => c.name).join(','));

  const status = await api.execute('status');
  check('status reports demo project', status.project.name === 'First Light' && status.tracks.length === 4);

  const t = await api.execute('transport', { action: 'play', bpm: 124, swing: 0.2 });
  check('transport plays + sets tempo', t.playing === true && t.bpm === 124 && Math.abs(t.swing - 0.2) < 1e-9);
  await api.execute('transport', { action: 'stop', metronome: true });
  check('metronome toggled via API', store.ui.metronome === true);

  const inst = await api.execute('list_instruments');
  check('list_instruments exposes schemas + presets',
    inst.instruments.length === 3 &&
    inst.instruments.every(d => d.params.length > 0) &&
    inst.instruments.find(d => d.type === 'poly').presets.includes('Acid Bass'));

  const added = await api.execute('add_track', { type: 'fm', name: 'Counter' });
  check('add_track + name', added.track.name === 'Counter' && added.track.kind === 'synth');

  await api.execute('rename_track', { track: 'Counter', name: 'Counterline' });
  check('rename_track by name', !!store.project.tracks.find(x => x.name === 'Counterline'));

  const sel = await api.execute('select_track', { track: 'counterline' });
  check('select_track case-insensitive', sel.selected === 'Counterline' && sel.editor === 'piano roll');

  const mix = await api.execute('set_mix', { track: 'Bass', gain: 0.7, pan: -0.3, sendDelay: 0.25 });
  check('set_mix clamps + applies', Math.abs(mix.channel.gain - 0.7) < 1e-9 && mix.channel.pan === -0.3);

  const master = await api.execute('set_master', { volume: 0.9, delayDiv: 0.5, verbSize: 3 });
  check('set_master applies fx', master.fx.delayDiv === 0.5 && master.fx.verbSize === 3);

  const presetOnly = await api.execute('set_params', { track: 'Counterline', preset: 'bell' });
  check('set_params: preset applies case-insensitively', presetOnly.preset === 'Bell');

  const params = await api.execute('set_params', { track: 'Counterline', params: { fmIndex: 99, ratio: '3' } });
  check('set_params: clamp, select coercion, edited-away-from-preset',
    params.preset === null && params.params.fmIndex === 12 && params.params.ratio === 3);

  let threw = null;
  try { await api.execute('set_params', { track: 'Counterline', params: { nope: 1 } }); } catch (e) { threw = e.message; }
  check('set_params rejects unknown keys with key list', /No param 'nope'/.test(threw) && /fmIndex/.test(threw));

  const written = await api.execute('set_notes', {
    track: 'Counterline', mode: 'replace', slot: 'B',
    notes: [{ start: 0, pitch: 72 }, { start: 1.5, pitch: 200, dur: 0.5, vel: 2 }],
  });
  check('set_notes validates/clamps + writes target slot',
    written.slot === 'B' && written.noteCount === 2 &&
    written.notes[1].pitch === 107 && written.notes[1].vel === 1);

  const read = await api.execute('get_notes', { track: 'Counterline', slot: 1 });
  check('get_notes reads same slot by index', read.noteCount === 2 && read.notes[0].noteName === 'C5');

  const beyond = await api.execute('set_notes', { track: 'Counterline', mode: 'add', slot: 'B', notes: [{ start: 99, pitch: 60 }] });
  check('set_notes warns about notes beyond loop', /loop end/.test(beyond.warning ?? ''));

  await api.execute('set_notes', { track: 'Counterline', mode: 'clear', slot: 'B' });
  check('set_notes clear', (await api.execute('get_notes', { track: 'Counterline', slot: 'B' })).noteCount === 0);

  const steps = await api.execute('set_steps', {
    track: 'Drums', mode: 'merge',
    lanes: { kick: [1, 0, 0, 0], ride: [0.5, 0.5] },
  });
  check('set_steps merge pads to slot length',
    steps.lanes.kick.length === 32 && steps.lanes.kick[0] === 1 && steps.lanes.ride[1] === 0.5 &&
    steps.lanes.snare.some(v => v > 0)); // untouched lane kept

  const cleared = await api.execute('set_steps', { track: 'Drums', mode: 'replace', lanes: { kick: [1] } });
  check('set_steps replace clears omitted lanes', cleared.lanes.snare.every(v => v === 0) && cleared.lanes.kick[0] === 1);

  let laneErr = null;
  try { await api.execute('set_steps', { track: 'Drums', mode: 'merge', lanes: { cowbell: [1] } }); } catch (e) { laneErr = e.message; }
  check('set_steps rejects unknown lane with lane list', /No lane 'cowbell'/.test(laneErr) && /kick/.test(laneErr));

  let kindErr = null;
  try { await api.execute('get_steps', { track: 'Bass' }); } catch (e) { kindErr = e.message; }
  check('kind mismatch errors point to the right tool', /get_notes/.test(kindErr));

  transportStub.playing = true;
  const qs = await api.execute('slots', { action: 'select', slot: 'C' });
  check('slot select queues while playing', qs.queuedSlot === 'C' && qs.activeSlot === 'A');
  transportStub.playing = false;
  await api.execute('slots', { action: 'select', slot: 'C' });
  check('slot select immediate when stopped', store.ui.activeSlot === 2);
  await api.execute('slots', { action: 'set_bars', slot: 'C', bars: 4 });
  check('slots set_bars', store.project.slots[2].bars === 4);
  const copied = await api.execute('slots', { action: 'copy', from: 'A', to: 'D' });
  check('slots copy reports content', copied.copied === 'A -> D');

  await api.execute('preview', { track: 'Bass', pitch: 45 });
  await api.execute('preview', { track: 'Drums', lane: 'kick' });
  check('preview routes by kind', previews[0][0] === 'note' && previews[1][0] === 'hit');

  const wav = await api.execute('export_wav', { slot: 'A', loops: 3 });
  check('export_wav renders + reports metadata',
    wav.ok && wav.filename.endsWith('.wav') && wav.channels === 2 && wav.loops === 3 &&
    wav.bytes > 44 && wav.slot === 'A');

  let wavErr = null;
  try { await api.execute('export_wav', { sampleRate: 96000 }); } catch (e) { wavErr = e.message; }
  check('export_wav rejects bad sample rate', /44100 or 48000/.test(wavErr ?? ''));

  const link = await api.execute('share', { action: 'link' });
  check('share link returns a #s= URL', /#s=/.test(link.url) && link.fragmentChars > 0);

  // Round-trip: encode the current song to a link, mutate, then open the link.
  await api.execute('project', { action: 'rename', name: 'Shared Tune' });
  const link2 = await api.execute('share', { action: 'link' });
  await api.execute('project', { action: 'new', kind: 'blank' });
  check('project replaced before open', store.project.name !== 'Shared Tune');
  const opened = await api.execute('share', { action: 'open', url: link2.url });
  check('share open loads the song from the link', opened.ok && store.project.name === 'Shared Tune');
  await api.execute('project', { action: 'undo' });
  check('share open is undoable', store.project.name !== 'Shared Tune');

  let shareErr = null;
  try { await api.execute('share', { action: 'open', url: 'https://x/#nope=1' }); } catch (e) { shareErr = e.message; }
  check('share open rejects a URL with no share data', /share data/.test(shareErr ?? ''));

  const undone = await api.execute('project', { action: 'undo' });
  check('project undo via API', undone.ok === true);

  const full = await api.execute('project', { action: 'get' });
  check('project get returns serializable project', JSON.parse(JSON.stringify(full)).version === 1);

  const fresh = await api.execute('project', { action: 'new', kind: 'blank', name: 'API Song' });
  check('project new + named', fresh.project === 'API Song' && store.project.tracks.length === 0);
  await api.execute('project', { action: 'undo' });
  check('project new is undoable', store.project.tracks.length > 0);
}

// ---------------------------------------------------------------------------
console.log('\n[4b] WAV encoder + song-in-URL codec');
const { encodeWav } = await import(`${ROOT}/src/core/wav.js`);
const share = await import(`${ROOT}/src/core/share.js`);

{
  // WAV: a known 2ch / 4-frame buffer produces a valid 44-byte header + data.
  const L = new Float32Array([0, 1, -1, 0.5]);
  const R = new Float32Array([0, -1, 1, -0.5]);
  const bytes = encodeWav([L, R], 44100);
  const str = (o, n) => String.fromCharCode(...bytes.slice(o, o + n));
  const dv = new DataView(bytes.buffer);
  check('wav header is RIFF/WAVE with fmt+data chunks',
    str(0, 4) === 'RIFF' && str(8, 4) === 'WAVE' && str(12, 4) === 'fmt ' && str(36, 4) === 'data');
  check('wav fmt: PCM, 2ch, 44100, 16-bit',
    dv.getUint16(20, true) === 1 && dv.getUint16(22, true) === 2 &&
    dv.getUint32(24, true) === 44100 && dv.getUint16(34, true) === 16);
  check('wav size = 44 + frames*channels*2', bytes.length === 44 + 4 * 2 * 2 &&
    dv.getUint32(40, true) === 4 * 2 * 2);
  check('wav full-scale samples quantize to int16 extremes',
    dv.getInt16(44 + 1 * 4, true) === 0x7fff && dv.getInt16(44 + 1 * 4 + 2, true) === -0x8000);

  let wavThrew = null;
  try { encodeWav([], 44100); } catch (e) { wavThrew = e.message; }
  check('encodeWav rejects empty channel list', /at least one channel/.test(wavThrew ?? ''));

  // Share codec: a full project round-trips through a URL fragment, note ids
  // are stripped from the wire form (regenerated on load), patterns survive.
  const proj = demoProject();
  const url = share.buildShareUrl(proj, 'https://oscine.app/');
  check('buildShareUrl emits an #s= fragment under the given base',
    url.startsWith('https://oscine.app/#s=') && share.fragmentFromUrl(url)?.length > 0);

  const back = share.decodeFragmentToProject(share.fragmentFromUrl(url));
  check('share round-trips name/bpm/tracks/slots',
    back.name === proj.name && back.bpm === proj.bpm &&
    back.tracks.length === proj.tracks.length && back.slots.length === 4);
  const leadId = proj.tracks.find(t => t.name === 'Lead').id;
  const origNotes = proj.slots[0].patterns[leadId].notes;
  const backNotes = back.slots[0].patterns[leadId].notes;
  check('share preserves note data', backNotes.length === origNotes.length &&
    backNotes[0].pitch === origNotes[0].pitch && backNotes[0].start === origNotes[0].start);
  check('share wire form omits note ids (kept compact)', backNotes.every(n => n.id === undefined));
  check('decoded project still validates as loadable', !!validateProject(JSON.parse(JSON.stringify(back))));

  check('projectFromUrl returns null when no fragment is present',
    share.projectFromUrl('https://oscine.app/') === null);
  let decErr = null;
  try { share.decodeFragmentToProject('!!!not-base64!!!'); } catch (e) { decErr = e.message; }
  check('decode rejects a malformed fragment', /malformed/.test(decErr ?? ''));
}

// ---------------------------------------------------------------------------
console.log('\n[5] OSC codec + address routing');
const { encodeMessage, decodePacket } = await import(`${ROOT}/plugin/server/osc-codec.js`);
const { routeOsc } = await import(`${ROOT}/plugin/server/osc-gateway.js`);

{
  // Codec round-trips, including padding edge cases.
  const cases = [
    ['/oscine/bpm', [168]],
    ['/oscine/swing', [0.125]],
    ['/x', ['a']],                       // 1-char string: 3 pad bytes
    ['/pad', ['abc']],                   // 3-char string: 1 pad byte
    ['/pad4', ['abcd']],                 // 4-char string: 4 pad bytes
    ['/mixed', [1, 2.5, 'three', true, false]],
    ['/empty', []],
  ];
  let rt = true;
  for (const [addr, args] of cases) {
    const [decoded] = decodePacket(encodeMessage(addr, args));
    if (decoded.address !== addr || decoded.args.length !== args.length) { rt = false; break; }
    for (let i = 0; i < args.length; i++) {
      const a = args[i], d = decoded.args[i];
      const same = typeof a === 'number' ? Math.abs(a - d) < 1e-4 : a === d;
      if (!same) { rt = false; console.error(`      mismatch ${addr}[${i}]: ${a} vs ${d}`); }
    }
  }
  check('codec round-trips messages (int/float/string/bool, padding)', rt);

  // Bundle: two messages, flattened with a timetag.
  const m1 = encodeMessage('/oscine/play', []);
  const m2 = encodeMessage('/oscine/bpm', [90]);
  const sizeBuf = (b) => { const s = Buffer.alloc(4); s.writeInt32BE(b.length); return s; };
  const bundle = Buffer.concat([
    Buffer.from('#bundle\0'),
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), // timetag "immediately"
    sizeBuf(m1), m1, sizeBuf(m2), m2,
  ]);
  const unbundled = decodePacket(bundle);
  check('bundles decode and flatten', unbundled.length === 2 && unbundled[1].args[0] === 90);

  // Routing table: OSC address space -> catalog commands.
  const routes = [
    ['/oscine/play', [], { cmd: 'transport', args: { action: 'play' } }],
    ['/oscine/bpm', [172.4], { cmd: 'transport', args: { bpm: 172 } }],
    ['/oscine/metronome', [1], { cmd: 'transport', args: { metronome: true } }],
    ['/oscine/master/volume', [0.8], { cmd: 'set_master', args: { volume: 0.8 } }],
    ['/oscine/track/Bass/gain', [0.5], { cmd: 'set_mix', args: { track: 'Bass', gain: 0.5 } }],
    ['/oscine/track/My_Synth/mute', [], { cmd: 'set_mix', args: { track: 'My Synth', mute: true } }],
    ['/oscine/track/Bass/send/reverb', [0.4], { cmd: 'set_mix', args: { track: 'Bass', sendReverb: 0.4 } }],
    ['/oscine/track/Lead/param/cutoff', [900], { cmd: 'set_params', args: { track: 'Lead', params: { cutoff: 900 } } }],
    ['/oscine/track/Lead/preset', ['Bell'], { cmd: 'set_params', args: { track: 'Lead', preset: 'Bell' } }],
    ['/oscine/track/Keys/note', [64, 0.7], { cmd: 'preview', args: { track: 'Keys', pitch: 64, vel: 0.7, dur: 0.6 } }],
    ['/oscine/track/Drums/hit', ['snare'], { cmd: 'preview', args: { track: 'Drums', lane: 'snare', vel: 1 } }],
    ['/oscine/slot/select', ['B'], { cmd: 'slots', args: { action: 'select', slot: 'B' } }],
    ['/oscine/slot/copy', ['A', 'D'], { cmd: 'slots', args: { action: 'copy', from: 'A', to: 'D' } }],
    ['/oscine/project/undo', [], { cmd: 'project', args: { action: 'undo' } }],
    ['/oscine/cmd', ['add_track', '{"type":"fm"}'], { cmd: 'add_track', args: { type: 'fm' } }],
  ];
  let routeOk = true;
  for (const [addr, args, want] of routes) {
    const got = routeOsc(addr, args);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      routeOk = false;
      console.error(`      route ${addr}: got ${JSON.stringify(got)}`);
    }
  }
  check(`routing table maps ${routes.length} addresses correctly`, routeOk);

  check('subscribe/ping route as control ops',
    routeOsc('/oscine/subscribe', [9000]).control === 'subscribe' &&
    routeOsc('/oscine/ping', []).control === 'ping');
  check('unknown addresses yield errors, not commands',
    !!routeOsc('/oscine/nope', []).error && !!routeOsc('/other/play', []).error);
}

// ---------------------------------------------------------------------------
console.log('\n[6] plugin bundle integrity');
{
  const pluginJson = JSON.parse(readFileSync(join(ROOT, 'plugin/.claude-plugin/plugin.json'), 'utf8'));
  check('plugin.json valid (name kebab-case, semver)',
    /^[a-z0-9-]+$/.test(pluginJson.name) && /^\d+\.\d+\.\d+$/.test(pluginJson.version));

  const mcpJson = JSON.parse(readFileSync(join(ROOT, 'plugin/.mcp.json'), 'utf8'));
  const server = mcpJson.mcpServers?.oscine;
  check('.mcp.json points at the sidecar via ${CLAUDE_PLUGIN_ROOT}',
    server?.command === 'node' && server.args[0].startsWith('${CLAUDE_PLUGIN_ROOT}/'));
  check('sidecar file exists at the referenced path',
    existsSync(join(ROOT, 'plugin', server.args[0].replace('${CLAUDE_PLUGIN_ROOT}/', ''))));

  const skill = readFileSync(join(ROOT, 'plugin/skills/composing-with-oscine/SKILL.md'), 'utf8');
  check('skill has frontmatter name + description', /^---\nname: composing-with-oscine\ndescription: /.test(skill));

  // Repo-root marketplace: makes the repo an updatable plugin source so
  // releases land via `claude plugin update` instead of a manual re-upload.
  const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
  check('marketplace.json valid (name kebab-case, has plugins)',
    /^[a-z0-9-]+$/.test(market.name) && Array.isArray(market.plugins) && market.plugins.length >= 1);
  const oscineEntry = market.plugins.find(p => p.name === pluginJson.name);
  check('marketplace lists the oscine plugin', !!oscineEntry);
  check('marketplace plugin source resolves to the plugin dir',
    !!oscineEntry && existsSync(join(ROOT, oscineEntry.source, '.claude-plugin/plugin.json')));

  const { execSync } = await import('node:child_process');
  let syncOk = true;
  try { execSync(`node ${join(ROOT, 'tools/sync-plugin.mjs')} --check`, { stdio: 'pipe' }); }
  catch { syncOk = false; }
  check('plugin/app is in sync with the repo (tools/sync-plugin.mjs)', syncOk);
}

// ---------------------------------------------------------------------------
console.log('\n[7] sidecar session registry (multi-instance routing)');
{
  const { SessionRegistry } = await import(`${ROOT}/plugin/server/sessions.js`);

  check('empty registry reports not-connected', new SessionRegistry().resolve(null).error === 'not-connected');

  // Newest connection becomes active; a lone session resolves with no selector.
  const reg = new SessionRegistry();
  const cA = { tag: 'A' };
  const idA = reg.add(cA);
  reg.hello(idA, { clientId: 'ca', project: 'First Light' });
  check('one instance resolves without a selector', reg.resolve(null).session?.conn === cA);
  check('newest instance is active', reg.active?.conn === cA);

  // A second tab does NOT evict the first (no more "newest kills old"); it
  // becomes active, but both remain addressable.
  const cB = { tag: 'B' };
  const idB = reg.add(cB);
  reg.hello(idB, { clientId: 'cb', project: 'Redwing' });
  check('second instance keeps the first alive', reg.size === 2);
  check('newest tab is the default target', reg.resolve(null).session?.conn === cB);
  check('explicit id targets the older tab', reg.resolve(idA).session?.conn === cA);
  check('selector by project name targets correctly', reg.resolve('First Light').session?.conn === cA);
  check('selector by clientId targets correctly', reg.resolve('cb').session?.conn === cB);
  check('unknown selector is a loud no-match', reg.resolve('nope').error === 'no-match');
  check('list() exposes id/project/active for discovery',
    reg.list().length === 2 && reg.list().every(s => 'id' in s && 'active' in s && 'project' in s));

  // Same clientId reconnecting folds into the existing session (one tab =
  // one session) and hands back the stale conn to close.
  const cB2 = { tag: 'B2' };
  const idB2 = reg.add(cB2);
  const fold = reg.hello(idB2, { clientId: 'cb', project: 'Redwing' });
  check('reconnect with same clientId does not add a session', reg.size === 2);
  check('reconnect folds into the original session id', fold.id === idB && fold.staleConn === cB);
  check('folded session now points at the new conn', reg.get(idB)?.conn === cB2);

  // Closing a tab drops only that session and re-homes active.
  reg.setActive(idB);
  reg.removeByConn(cB2);
  check('closing a tab removes just that session', reg.size === 1 && reg.resolve(null).session?.conn === cA);

  // Defensive: many instances with no active set -> loud ambiguity, not a
  // silent guess (this is the failure mode that caused the split-brain).
  const amb = new SessionRegistry();
  const p = {}, q = {};
  amb.hello(amb.add(p), { clientId: 'p' });
  amb.hello(amb.add(q), { clientId: 'q' });
  amb.activeId = null; // simulate no chosen target
  const r = amb.resolve(null);
  check('multiple instances with no active target is ambiguous, not silent',
    r.error === 'ambiguous' && r.sessions.length === 2);
}

// ---------------------------------------------------------------------------
console.log('');
if (failures) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('All smoke tests passed.');
