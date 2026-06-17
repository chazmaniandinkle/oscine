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
  // Count guard: the always-on performance 'ledger' command (read/clear) is the
  // newest catalog addition, taking the count from 20 to 21. The e2e tool-count
  // check is derived from COMMANDS.length, so it tracks this automatically.
  check('catalog command count is 21', COMMANDS.length === 21, `got ${COMMANDS.length}`);
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
console.log('\n[4c] midi command: WebMIDI config state (headless)');
{
  // The 'midi' command only reads/writes ephemeral store.ui.midi and returns
  // JSON; the browser-only WebMIDI manager (src/ui/midi.js) applies it when a
  // device is present. So it runs headlessly with no navigator. Device binding
  // is exercised in the browser-driven e2e, not here.
  const bus = new EventBus();
  const store = new Store(bus, demoProject());
  // status() (exercised below for the compact midi field) reads transport
  // position, so this block needs a real transport stub, not an empty object.
  const transportStub = { getPosition() { return { playing: false, localBeat: 0, loopBeats: 8 }; } };
  const api = new CommandAPI({ store, engine: {}, transport: transportStub, bus });

  const s0 = await api.execute('midi', { action: 'status' });
  check('midi status has the documented shape (disabled, omni, no record)',
    s0.enabled === false && s0.channel === 0 && s0.record === false &&
    typeof s0.knobs === 'object' && Array.isArray(s0.devices) && typeof s0.available === 'boolean');

  const en = await api.execute('midi', { action: 'enable' });
  check('midi enable flips enabled true', en.enabled === true && store.ui.midi.enabled === true);
  const dis = await api.execute('midi', { action: 'disable' });
  check('midi disable flips enabled false', dis.enabled === false && store.ui.midi.enabled === false);

  const set = await api.execute('midi', { action: 'set', channel: 7, record: true });
  check('midi set applies channel + record', set.channel === 7 && set.record === true &&
    store.ui.midi.channel === 7 && store.ui.midi.record === true);

  // map: select a real synth track first, then bind a CC to a numeric param
  // key that actually exists on its instrument.
  await api.execute('select_track', { track: 'Bass' });
  const bass = store.project.tracks.find(t => t.name === 'Bass');
  const synthKey = (await api.execute('list_instruments')).instruments
    .find(d => d.type === bass.instrument.type).params
    .find(p => p.type !== 'select').key; // a numeric (knob) param, e.g. 'cutoff'
  const mapped = await api.execute('midi', { action: 'map', cc: 1, param: synthKey });
  check('midi map binds cc -> selected-track param',
    mapped.knobs[1] === synthKey && store.ui.midi.knobs[1] === synthKey);

  let unknownParam = null;
  try { await api.execute('midi', { action: 'map', cc: 2, param: 'definitelyNotAParam' }); }
  catch (e) { unknownParam = e.message; }
  check('midi map rejects an unknown param with the key list',
    /definitelyNotAParam/.test(unknownParam ?? '') && new RegExp(synthKey).test(unknownParam ?? ''));

  // map/learn require a selected synth track; with none selected they error.
  store.ui.selectedTrackId = null;
  let noTrack = null;
  try { await api.execute('midi', { action: 'map', cc: 3, param: synthKey }); }
  catch (e) { noTrack = e.message; }
  check('midi map with no selected track errors', !!noTrack);
  store.selectTrack(bass.id);

  // A non-numeric (select-type) param cannot be CC-mapped.
  const selectKey = (await api.execute('list_instruments')).instruments
    .find(d => d.type === bass.instrument.type).params
    .find(p => p.type === 'select').key; // e.g. 'osc1Wave'
  let nonNumeric = null;
  try { await api.execute('midi', { action: 'map', cc: 4, param: selectKey }); }
  catch (e) { nonNumeric = e.message; }
  check('midi map rejects a non-numeric (select) param', !!nonNumeric);

  const learned = await api.execute('midi', { action: 'learn', param: synthKey });
  check('midi learn arms learnParam + returns a note',
    store.ui.midi.learnParam === synthKey && typeof learned.note === 'string' && learned.note.length > 0);

  const clear = await api.execute('midi', { action: 'clear_map', cc: 1 });
  check('midi clear_map removes the mapping', clear.knobs[1] === undefined && store.ui.midi.knobs[1] === undefined);

  // status() carries a compact midi field for the orient-first snapshot.
  await api.execute('midi', { action: 'map', cc: 5, param: synthKey });
  const st = await api.execute('status');
  check('status includes a compact midi field',
    st.midi && st.midi.enabled === false && st.midi.channel === 7 &&
    st.midi.record === true && st.midi.knobs === Object.keys(store.ui.midi.knobs).length);

  // Single-tab ownership: status() reports who holds the hardware. The lock and
  // peer roster live in the browser (src/api/crosstab.js + src/ui/midi.js); the
  // handler just surfaces the runtime fields. Headless has no crosstab, so the
  // values default sanely (owner defined-but-stable, peers a number, and
  // ownerElsewhere only true when a peer owns it and we don't).
  const own = await api.execute('midi', { action: 'status' });
  check('midi status reports owner/peers/ownerElsewhere shape',
    typeof own.owner === 'boolean' && typeof own.peers === 'number' &&
    typeof own.ownerElsewhere === 'boolean');
  check('midi ownerElsewhere is consistent with owner (not both true)',
    !(own.owner && own.ownerElsewhere));

  // 'claim' sets the take-over intent (store.requestMidiClaim()) and returns
  // state; the actual Web Lock steal happens in the UI manager. Headless with no
  // crosstab/app it is a harmless no-op that still returns a midiState object.
  const claimed = await api.execute('midi', { action: 'claim' });
  check('midi claim returns midiState() without throwing headlessly',
    typeof claimed === 'object' && typeof claimed.enabled === 'boolean' &&
    typeof claimed.owner === 'boolean' && typeof claimed.peers === 'number' &&
    typeof claimed.knobs === 'object');

  // -- velocity shaping + monitor --------------------------------------------
  // Incoming MIDI note velocity is shaped in software (floor + curve, or a
  // fixed override) so soft presses on stiff mini-keys still sound. The shaping
  // math itself lives in the browser manager (src/ui/midi.js); the 'midi'
  // command is the pure config + readback surface for it, and the raw-velocity
  // MONITOR is fed by the manager via store.observeMidiVelocity. Defaults
  // (floor 0, curve 1, fixed 0) reproduce today's dead-linear behavior.

  // Defaults: status carries velocity + monitor objects with sane initials.
  const vel0 = await api.execute('midi', { action: 'status' });
  check('midi status carries a velocity object with linear-by-default values',
    vel0.velocity && vel0.velocity.floor === 0 && vel0.velocity.curve === 1 &&
    vel0.velocity.fixed === 0);
  check('midi status carries a zeroed velocity monitor with an empty recent[]',
    vel0.monitor && vel0.monitor.last === 0 && vel0.monitor.min === 0 &&
    vel0.monitor.max === 0 && vel0.monitor.count === 0 &&
    Array.isArray(vel0.monitor.recent) && vel0.monitor.recent.length === 0);

  // set floor/curve/fixed updates store.ui.midi and is reflected in status.
  const velSet = await api.execute('midi', { action: 'set', floor: 0.2, curve: 0.6, fixed: 0.5 });
  check('midi set applies floor/curve/fixed to the store',
    store.ui.midi.velFloor === 0.2 && store.ui.midi.velCurve === 0.6 &&
    store.ui.midi.velFixed === 0.5);
  check('midi set reflects floor/curve/fixed back in status.velocity',
    velSet.velocity.floor === 0.2 && velSet.velocity.curve === 0.6 &&
    velSet.velocity.fixed === 0.5);

  // Out-of-range values clamp: curve 99 -> 5, floor 2 -> 1, fixed 2 -> 1.
  const velClamp = await api.execute('midi', { action: 'set', floor: 2, curve: 99, fixed: 2 });
  check('midi set clamps floor/curve/fixed to range',
    velClamp.velocity.floor === 1 && velClamp.velocity.curve === 5 &&
    velClamp.velocity.fixed === 1 &&
    store.ui.midi.velFloor === 1 && store.ui.midi.velCurve === 5 &&
    store.ui.midi.velFixed === 1);
  const velCurveLow = await api.execute('midi', { action: 'set', curve: 0 });
  check('midi set clamps curve up to its 0.2 floor', velCurveLow.velocity.curve === 0.2);

  // set keeps the existing channel/record handling intact (regression guard).
  await api.execute('midi', { action: 'set', channel: 3, record: false, floor: 0.1 });
  check('midi set still applies channel/record alongside velocity',
    store.ui.midi.channel === 3 && store.ui.midi.record === false &&
    store.ui.midi.velFloor === 0.1);

  // observeMidiVelocity is browser-fed (the manager records the RAW value before
  // shaping); exercise it directly on the store, then read it back over the
  // command surface. last/min/max/count track the spread; recent[] is capped.
  store.resetMidiVelocityMonitor();
  store.observeMidiVelocity(40);
  store.observeMidiVelocity(100);
  store.observeMidiVelocity(12);
  check('observeMidiVelocity tracks last/min/max/count',
    store.ui.midi.velMonitor.last === 12 && store.ui.midi.velMonitor.min === 12 &&
    store.ui.midi.velMonitor.max === 100 && store.ui.midi.velMonitor.count === 3);
  check('observeMidiVelocity rounds + clamps raw d2 into 0..127',
    store.ui.midi.velMonitor.recent.join(',') === '40,100,12');
  // recent[] holds the last 16 raw values (oldest shifted off).
  store.resetMidiVelocityMonitor();
  for (let v = 1; v <= 20; v++) store.observeMidiVelocity(v);
  check('observeMidiVelocity caps recent[] at 16 (oldest dropped)',
    store.ui.midi.velMonitor.recent.length === 16 &&
    store.ui.midi.velMonitor.recent[0] === 5 &&
    store.ui.midi.velMonitor.recent[15] === 20 &&
    store.ui.midi.velMonitor.count === 20);

  // monitor action returns the live monitor; reset:true clears it first.
  const mon = await api.execute('midi', { action: 'monitor' });
  check('midi monitor returns the current velocity monitor',
    mon.last === 20 && mon.max === 20 && mon.count === 20 && mon.recent.length === 16);
  const monReset = await api.execute('midi', { action: 'monitor', reset: true });
  check('midi monitor reset:true clears the monitor and returns it cleared',
    monReset.last === 0 && monReset.min === 0 && monReset.max === 0 &&
    monReset.count === 0 && Array.isArray(monReset.recent) && monReset.recent.length === 0 &&
    store.ui.midi.velMonitor.count === 0);

  // -- OSC MIDI input (the external-bridge entry point) ----------------------
  // 'input' is a pure handler: it clamps the raw bytes and emits 'midi:inject'
  // on the bus. The browser MidiInput manager subscribes and feeds them through
  // the same onMessage pipeline WebMIDI uses (shaping/monitor/record/routing),
  // so injected MIDI works even when WebMIDI is disabled or unavailable. Here we
  // assert the handler half: the event fires with clamped bytes and bad input
  // throws. The browser-side consumption (MidiInput.onMessage with no WebMIDI
  // access) is asserted directly in the next block.
  const injected = [];
  const offInject = bus.on('midi:inject', ({ bytes }) => injected.push(bytes));
  const inRes = await api.execute('midi', { action: 'input', bytes: [144, 60, 100] });
  check('midi input emits midi:inject with the bytes and returns ok',
    inRes.ok === true && injected.length === 1 &&
    injected[0].join(',') === '144,60,100' &&
    inRes.injected.join(',') === '144,60,100');

  const inClamp = await api.execute('midi', { action: 'input', bytes: [200, 300, -5] });
  check('midi input rounds + clamps each byte into 0..255',
    injected[1].join(',') === '200,255,0' && inClamp.injected.join(',') === '200,255,0');
  offInject();

  // A 1..3 length numeric array is required; missing/empty/non-array throws.
  for (const bad of [undefined, [], [1, 2, 3, 4], 'note', { 0: 144 }]) {
    let inErr = null;
    try { await api.execute('midi', { action: 'input', bytes: bad }); } catch (e) { inErr = e.message; }
    check(`midi input rejects bad bytes (${JSON.stringify(bad) ?? 'undefined'})`, !!inErr);
  }

  // The whole point of injection is that it works with WebMIDI OFF/unavailable:
  // MidiInput.onMessage reads only e.data and never touches this.access. Assert
  // that end-to-end headlessly. We construct the real browser manager (no
  // navigator.requestMIDIAccess in node, so this.access stays null), select a
  // synth track, emit 'midi:inject' on the bus, and verify the note reached the
  // engine preview path with shaped velocity and that the raw velocity hit the
  // monitor. This is the one correctness claim the OSC-MIDI change rests on.
  {
    const { MidiInput } = await import(`${ROOT}/src/ui/midi.js`);
    const { getInstrumentDef } = await import(`${ROOT}/src/engine/instruments/index.js`);
    const previews = [];
    const engineStub = {
      previewOn: (trackId, midi, vel) => previews.push({ trackId, midi, vel }),
      previewOff: () => {}, previewHit: () => {},
    };
    // Fresh project so the injected note targets a known synth track.
    const ibus = new EventBus();
    const istore = new Store(ibus, demoProject());
    const synth = istore.project.tracks.find(t => getInstrumentDef(t.instrument.type).kind !== 'drums');
    istore.selectTrack(synth.id);
    const appStub = {
      store: istore, bus: ibus, engine: engineStub,
      transport: { getPosition() { return { playing: false, localBeat: 0, loopBeats: 8 }; } },
    };
    // Constructing the manager must NOT require WebMIDI: it only wires bus
    // listeners and (guarded) restore; this.access stays null in node.
    const mgr = new MidiInput(appStub);
    check('MidiInput constructs headlessly with no WebMIDI access', mgr.access === null);
    // note-on, channel 1, pitch 60, velocity 100 -> routed through onMessage.
    ibus.emit('midi:inject', { bytes: [0x90, 60, 100] });
    check('injected MIDI reaches the engine preview path without WebMIDI',
      previews.length === 1 && previews[0].midi === 60 &&
      previews[0].trackId === synth.id && previews[0].vel > 0);
    check('injected note-on velocity hits the velocity monitor (raw)',
      istore.ui.midi.velMonitor.last === 100 && istore.ui.midi.velMonitor.count === 1);
  }

  // status()'s compact midi field carries velocity + lastVelocity for orient.
  await api.execute('midi', { action: 'set', floor: 0.25, curve: 0.7 });
  store.observeMidiVelocity(88);
  const stVel = await api.execute('status');
  check('status compact midi field includes velocity + lastVelocity',
    stVel.midi.velocity && stVel.midi.velocity.floor === 0.25 &&
    stVel.midi.velocity.curve === 0.7 && stVel.midi.lastVelocity === 88);

  // OSC routing-table additions for /oscine/midi/*. (routeOsc is also exercised
  // in section [5]; imported here under an alias to keep this block standalone.)
  const { routeOsc: routeOscMidi } = await import(`${ROOT}/plugin/server/osc-gateway.js`);
  const midiRoutes = [
    ['/oscine/midi/enable', [1], { cmd: 'midi', args: { action: 'enable' } }],
    ['/oscine/midi/enable', [0], { cmd: 'midi', args: { action: 'disable' } }],
    ['/oscine/midi/channel', [10], { cmd: 'midi', args: { action: 'set', channel: 10 } }],
    ['/oscine/midi/record', [1], { cmd: 'midi', args: { action: 'set', record: true } }],
    ['/oscine/midi/floor', [0.3], { cmd: 'midi', args: { action: 'set', floor: 0.3 } }],
    ['/oscine/midi/curve', [0.5], { cmd: 'midi', args: { action: 'set', curve: 0.5 } }],
    ['/oscine/midi/claim', [], { cmd: 'midi', args: { action: 'claim' } }],
    ['/oscine/midi/in', [144, 60, 100], { cmd: 'midi', args: { action: 'input', bytes: [144, 60, 100] } }],
  ];
  let midiRouteOk = true;
  for (const [addr, args, want] of midiRoutes) {
    const got = routeOscMidi(addr, args);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      midiRouteOk = false;
      console.error(`      route ${addr} ${JSON.stringify(args)}: got ${JSON.stringify(got)}`);
    }
  }
  check(`midi OSC routes map ${midiRoutes.length} addresses correctly`, midiRouteOk);
}

// ---------------------------------------------------------------------------
console.log('\n[4e] performance ledger: silent ring log of live play (headless)');
{
  // The ledger is an always-on, bounded, time-stamped record of everything the
  // user plays live. It lives in ephemeral store.ui.ledger (like velMonitor) and
  // is fed by the input taps (src/ui/midi.js + src/ui/keyboard.js). store.logInput
  // is a SILENT, high-frequency ring push (no bus emit), so autosave/UI are not
  // spammed per note; the 'ledger' command is the pure read/clear surface an agent
  // uses to see and grab a riff. Capture works with the transport STOPPED (beat is
  // null in free play), which is the common case. Everything here runs headless:
  // the handler reads store.ui.ledger and returns JSON, never touching window/audio.
  const bus = new EventBus();
  const ledgerEvents = [];
  bus.on('*', (type) => ledgerEvents.push(type));
  const store = new Store(bus, demoProject());
  const transportStub = { getPosition() { return { playing: false, localBeat: 0, loopBeats: 8 }; } };
  const api = new CommandAPI({ store, engine: {}, transport: transportStub, bus });

  // The store seeds an empty, bounded ledger like the other ephemeral ui state.
  check('store.ui.ledger starts empty with an 800-event cap',
    Array.isArray(store.ui.ledger.events) && store.ui.ledger.events.length === 0 &&
    store.ui.ledger.cap === 800);

  // logInput is a silent ring push: it stamps t itself (never trusts a caller t),
  // pushes oldest-first, and caps at 800 by shifting the oldest off. Critically it
  // must NOT emit a bus event (that would spam autosave/UI on every note).
  const beforeEvents = ledgerEvents.length;
  for (let i = 0; i < 801; i++) {
    store.logInput({ kind: 'note', on: true, trackId: 't', trackName: 'T', pitch: 60 + (i % 12), vel: 0.8, beat: null, t: 123 });
  }
  check('logInput caps the ring at 800 (push 801, oldest dropped)',
    store.ui.ledger.events.length === 800);
  check('logInput stamps t with the wall clock, ignoring any caller-supplied t',
    store.ui.ledger.events.every(e => e.t !== 123 && typeof e.t === 'number'));
  check('logInput keeps events oldest-first (the very first push was dropped)',
    // 801 pushes of pitch 60+(i%12): i=0 -> 60 dropped, so the head is now i=1 -> 61.
    store.ui.ledger.events[0].pitch === 61 &&
    store.ui.ledger.events[799].pitch === 60 + (800 % 12));
  check('logInput is silent (no bus event per note)',
    ledgerEvents.length === beforeEvents);

  // clearLedger empties the ring and emits a single low-frequency 'ledger:cleared'
  // (one event is fine here; it is not per-note).
  store.clearLedger();
  check('clearLedger empties the ring', store.ui.ledger.events.length === 0);
  check('clearLedger emits a single ledger:cleared event',
    ledgerEvents.filter(t => t === 'ledger:cleared').length === 1);

  // 'ledger' read pairs note-on with the next matching note-off (same trackId +
  // pitch) into an agent-friendly 'notes' view. Drive logInput directly with a few
  // on/off pairs so the t values stamp in clock order; a tiny spin between on and
  // off guarantees a non-zero duration. A 'hit' event must also surface in 'notes'.
  const spinMs = (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* advance the wall clock */ } };
  store.logInput({ kind: 'note', on: true, trackId: 'tk', trackName: 'Keys', pitch: 60, vel: 0.9, beat: null });
  spinMs(2);
  store.logInput({ kind: 'note', on: false, trackId: 'tk', pitch: 60, beat: null });
  spinMs(2);
  store.logInput({ kind: 'note', on: true, trackId: 'tk', trackName: 'Keys', pitch: 67, vel: 0.5, beat: null });
  spinMs(2);
  store.logInput({ kind: 'note', on: false, trackId: 'tk', pitch: 67, beat: null });
  spinMs(2);
  store.logInput({ kind: 'hit', trackId: 'td', trackName: 'Drums', lane: 'kick', vel: 0.8, beat: null });

  const read = await api.execute('ledger', { action: 'read' });
  check('ledger read reports count + spanSec over the window',
    read.count === 5 && typeof read.spanSec === 'number' && read.spanSec > 0);
  check('ledger read returns the raw events alongside the derived view',
    Array.isArray(read.events) && read.events.length === 5 && Array.isArray(read.notes));

  const c4 = read.notes.find(n => n.pitch === 60);
  const g4 = read.notes.find(n => n.pitch === 67);
  check('ledger notes pairs each note-on with its matching note-off',
    !!c4 && !!g4 && c4.trackName === 'Keys');
  check('ledger notes carry pitch, a positive dur, vel, and a noteName',
    c4.dur > 0 && c4.vel === 0.9 && c4.noteName === 'C4' &&
    g4.dur > 0 && g4.vel === 0.5 && g4.noteName === 'G4');
  check('ledger notes are sorted by startSec (relative to the window start)',
    typeof c4.startSec === 'number' && c4.startSec === 0 && g4.startSec > c4.startSec);
  const hit = read.notes.find(n => n.lane === 'kick');
  check('ledger notes include drum hits with a lane (and no dur)',
    !!hit && hit.trackName === 'Drums' && typeof hit.startSec === 'number' && hit.dur === undefined);

  // 'ledger' clear empties the ring through the command surface.
  const cleared = await api.execute('ledger', { action: 'clear' });
  check('ledger clear empties the ring and reports it',
    cleared.ok === true && cleared.cleared === true && store.ui.ledger.events.length === 0);
  const emptyRead = await api.execute('ledger', { action: 'read' });
  check('ledger read after clear is empty', emptyRead.count === 0 && emptyRead.notes.length === 0);

  // action defaults to 'read' when omitted (the common agent call).
  store.logInput({ kind: 'note', on: true, trackId: 'tk', trackName: 'Keys', pitch: 62, vel: 0.7, beat: null });
  const defaultRead = await api.execute('ledger', {});
  check('ledger action defaults to read when omitted', defaultRead.count === 1);

  // Retriggered/duplicate same-pitch note-on: hardware + OSC-injected MIDI
  // (src/ui/midi.js) does NO note-on dedup, so a held pitch can receive a second
  // note-on before the first note-off. Every emitted note must still end with a
  // numeric dur; none may leak as dur:null. Covers both (a) on,on,off and
  // (b) two overlapping held on-events with no off in the window.
  await api.execute('ledger', { action: 'clear' });
  // (a) on(C4), on(C4), off(C4) -> two notes, both with positive dur.
  store.logInput({ kind: 'note', on: true, trackId: 'tk', trackName: 'Keys', pitch: 60, vel: 0.9, beat: null });
  spinMs(2);
  store.logInput({ kind: 'note', on: true, trackId: 'tk', trackName: 'Keys', pitch: 60, vel: 0.6, beat: null });
  spinMs(2);
  store.logInput({ kind: 'note', on: false, trackId: 'tk', pitch: 60, beat: null });
  spinMs(2);
  // (b) two overlapping held on-events for the same pitch, neither closed.
  store.logInput({ kind: 'note', on: true, trackId: 'tk', trackName: 'Keys', pitch: 64, vel: 0.5, beat: null });
  spinMs(2);
  store.logInput({ kind: 'note', on: true, trackId: 'tk', trackName: 'Keys', pitch: 64, vel: 0.7, beat: null });
  spinMs(2);
  const dupRead = await api.execute('ledger', { action: 'read' });
  const c4dups = dupRead.notes.filter(n => n.pitch === 60);
  const e4dups = dupRead.notes.filter(n => n.pitch === 64);
  check('retriggered note-on emits one note per on (no merge, no drop)',
    c4dups.length === 2 && e4dups.length === 2);
  check('no retriggered/duplicate same-pitch note leaks a null/NaN dur',
    dupRead.notes.every(n => typeof n.dur === 'number' && n.dur > 0 && !Number.isNaN(n.dur)));
  await api.execute('ledger', { action: 'clear' });
  store.logInput({ kind: 'note', on: true, trackId: 'tk', trackName: 'Keys', pitch: 62, vel: 0.7, beat: null });

  // status() carries a compact ledger:{ count, spanSec } field for orient-first.
  const st = await api.execute('status');
  check('status includes a compact ledger field',
    st.ledger && st.ledger.count === store.ui.ledger.events.length &&
    typeof st.ledger.spanSec === 'number');
}

// ---------------------------------------------------------------------------
console.log('\n[4d] cross-tab coordination + per-tab autosave (node no-op safe)');
{
  // CrossTab wraps browser-only platform APIs (BroadcastChannel, navigator.locks,
  // document visibility). Under node those are absent, so it must construct and
  // run as a benign no-op: no throws, ever. We keep these assertions resilient to
  // a node build that DOES expose a global BroadcastChannel (some do) by checking
  // for no-throw + sane types rather than a specific supported value.
  const { CrossTab } = await import(`${ROOT}/src/api/crosstab.js`);

  let ct = null, ctThrew = null;
  try { ct = new CrossTab('test-id', { title: 'smoke' }); } catch (e) { ctThrew = e.message; }
  check('CrossTab constructs without throwing under node', ct && !ctThrew, ctThrew ?? '');
  check('CrossTab.supported / locksSupported are booleans (feature-detected)',
    typeof ct.supported === 'boolean' && typeof ct.locksSupported === 'boolean');

  let startThrew = null;
  try { ct.start(); ct.start(); } catch (e) { startThrew = e.message; } // idempotent
  check('CrossTab.start() is idempotent and does not throw', startThrew === null, startThrew ?? '');

  check('CrossTab.peers is an array (includes self in the degraded path)',
    Array.isArray(ct.peers));

  let onPresenceThrew = null, unsub = null;
  try { unsub = ct.onPresence(() => {}); } catch (e) { onPresenceThrew = e.message; }
  check('CrossTab.onPresence returns an unsubscribe fn without throwing',
    onPresenceThrew === null && typeof unsub === 'function', onPresenceThrew ?? '');
  unsub?.();

  let setOwnThrew = null;
  try { ct.setOwn('midi', true); ct.setOwn('midi', false); } catch (e) { setOwnThrew = e.message; }
  check('CrossTab.setOwn does not throw', setOwnThrew === null, setOwnThrew ?? '');

  // claim() must resolve truthy without throwing (degraded path resolves true:
  // "no enforcement available"). With a global BroadcastChannel present it may
  // still resolve a boolean either way; we only require truthy + no throw here,
  // mirroring the contract's degraded behavior.
  let claimVal = null, claimThrew = null;
  try { claimVal = await ct.claim('midi'); } catch (e) { claimThrew = e.message; }
  check('CrossTab.claim() resolves truthy without throwing',
    claimThrew === null && !!claimVal, claimThrew ?? `value ${claimVal}`);
  check('CrossTab.owns(resource) is a boolean', typeof ct.owns('midi') === 'boolean');

  let onLostThrew = null;
  try { ct.onLost('midi', () => {}); } catch (e) { onLostThrew = e.message; }
  check('CrossTab.onLost registers without throwing', onLostThrew === null, onLostThrew ?? '');

  // post/on are typed-message helpers; on() ignores messages from self.
  let msgThrew = null, offMsg = null;
  try { offMsg = ct.on('hello', () => {}); ct.post('hello', { x: 1 }); } catch (e) { msgThrew = e.message; }
  check('CrossTab.on/post do not throw and on() returns an unsubscribe',
    msgThrew === null && typeof offMsg === 'function', msgThrew ?? '');
  offMsg?.();

  let releaseThrew = null;
  try { ct.release('midi'); } catch (e) { releaseThrew = e.message; }
  check('CrossTab.release does not throw', releaseThrew === null, releaseThrew ?? '');

  let stopThrew = null;
  try { ct.stop(); } catch (e) { stopThrew = e.message; }
  check('CrossTab.stop() does not throw (Web Locks auto-release on close)',
    stopThrew === null, stopThrew ?? '');

  // persist.js may use localStorage but stays guarded so node-side imports and
  // calls never throw. attachAutosave/loadInitialProject take a clientId now;
  // with no real localStorage in node they must no-op / stay in-memory-safe.
  const persist = await import(`${ROOT}/src/core/persist.js`);
  check('persist.js exports attachAutosave + loadInitialProject',
    typeof persist.attachAutosave === 'function' && typeof persist.loadInitialProject === 'function');

  let loadThrew = null, loaded = null;
  try { loaded = persist.loadInitialProject('client-abc'); } catch (e) { loadThrew = e.message; }
  check('loadInitialProject(clientId) does not throw under node and returns a project',
    loadThrew === null && loaded && Array.isArray(loaded.tracks), loadThrew ?? '');

  let attachThrew = null;
  try {
    const abus = new EventBus();
    const astore = new Store(abus, demoProject());
    persist.attachAutosave(astore, abus, 'client-abc');
    // Fire a project-mutating event; the debounced save must not throw even with
    // no real localStorage (guarded write).
    astore.checkpoint();
    astore.setSetting('bpm', 128);
  } catch (e) { attachThrew = e.message; }
  check('attachAutosave(store, bus, clientId) wires up without throwing',
    attachThrew === null, attachThrew ?? '');
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
  // The encode/decode/build/projectFromUrl functions are async now (they gzip
  // the payload via CompressionStream); fragmentFromUrl stays synchronous.
  const proj = demoProject();
  const url = await share.buildShareUrl(proj, 'https://oscine.app/');
  check('buildShareUrl emits an #s= fragment under the given base',
    url.startsWith('https://oscine.app/#s=') && share.fragmentFromUrl(url)?.length > 0);

  const back = await share.decodeFragmentToProject(share.fragmentFromUrl(url));
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

  // Compression: the encoded fragment gzips the wire JSON via CompressionStream,
  // so it must be meaningfully smaller than a plain base64url of the same JSON.
  const fragment = await share.encodeProjectToFragment(proj);
  const roundTripped = await share.decodeFragmentToProject(fragment);
  check('encode/decode round-trips a non-trivial project',
    roundTripped.name === proj.name &&
    roundTripped.tracks.length === proj.tracks.length &&
    roundTripped.slots[0].patterns[leadId].notes[0].pitch === origNotes[0].pitch);
  // Plain (uncompressed) base64url of the exact same wire JSON, for the size
  // comparison. Mirrors the legacy encoder: stringify the wire form (note ids
  // stripped), utf-8 encode, then base64url. We reuse decode's inverse to size
  // it without re-implementing the base64url table.
  const wireJson = JSON.stringify((() => {
    const w = JSON.parse(JSON.stringify(proj));
    for (const slot of w.slots ?? [])
      for (const pat of Object.values(slot.patterns ?? {}))
        if (Array.isArray(pat.notes)) for (const n of pat.notes) delete n.id;
    return w;
  })());
  const plainBytes = new TextEncoder().encode(wireJson);
  const plainFragment = Buffer.from(plainBytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  check('compressed fragment is smaller than plain base64url of the same JSON',
    fragment.length < plainFragment.length,
    `compressed ${fragment.length} vs plain ${plainFragment.length}`);

  // Backward compatibility: links made before this change are bare base64url of
  // the wire JSON (no gzip, no magic bytes). The decoder auto-detects by the
  // gzip magic (0x1f 0x8b) and falls through to the legacy plain path, so a
  // hand-built legacy fragment must still decode to a valid project.
  const legacyBack = await share.decodeFragmentToProject(plainFragment);
  check('legacy plain (uncompressed) base64url fragment still decodes',
    legacyBack.name === proj.name &&
    legacyBack.tracks.length === proj.tracks.length &&
    !!validateProject(JSON.parse(JSON.stringify(legacyBack))));

  check('projectFromUrl returns null when no fragment is present',
    (await share.projectFromUrl('https://oscine.app/')) === null);
  let decErr = null;
  try { await share.decodeFragmentToProject('!!!not-base64!!!'); } catch (e) { decErr = e.message; }
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
console.log('\n[6b] installable web app (manifest + icons + meta wiring)');
{
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  check('manifest is standalone with a name', manifest.display === 'standalone' && !!manifest.name);
  check('manifest icons resolve to files',
    Array.isArray(manifest.icons) && manifest.icons.length > 0 &&
    manifest.icons.every(i => existsSync(join(ROOT, i.src))));
  check('manifest declares a maskable icon',
    manifest.icons.some(i => (i.purpose || '').split(/\s+/).includes('maskable')));

  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  check('index.html links the manifest', /<link[^>]+rel="manifest"[^>]+href="manifest\.webmanifest"/.test(html));
  check('index.html opts into standalone (apple + mobile web-app-capable)',
    /name="apple-mobile-web-app-capable"\s+content="yes"/.test(html) &&
    /name="mobile-web-app-capable"\s+content="yes"/.test(html));
  const touch = html.match(/<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/);
  check('apple-touch-icon is declared and the file exists',
    !!touch && existsSync(join(ROOT, touch[1])));
  // The manifest AND its icons must be mirrored into the plugin app copy
  // (manifest is in SOURCES; icons ride along under styles/).
  check('manifest + icons bundled into plugin/app',
    existsSync(join(ROOT, 'plugin/app/manifest.webmanifest')) &&
    manifest.icons.every(i => existsSync(join(ROOT, 'plugin/app', i.src))));
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
