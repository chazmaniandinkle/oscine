// Controller profiles, discovery inference, binding targets + soft takeover (headless): node test/midimap.mjs
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const { EventBus } = await import(`${ROOT}/src/core/bus.js`);
const { Store } = await import(`${ROOT}/src/core/store.js`);
const { demoProject } = await import(`${ROOT}/src/core/schema.js`);
const S = await import(`${ROOT}/src/core/midisrc.js`);
const C = await import(`${ROOT}/src/core/controllers/index.js`);
const { Discovery } = await import(`${ROOT}/src/core/mididiscover.js`);
const M = await import(`${ROOT}/src/core/midimap.js`);

console.log('\n[1] source keys + message decoding');
{
  check('cc key, channel-specific key, note key, pb',
    S.srcKey({ t: 'cc', n: 74 }) === '74' && S.srcKey({ t: 'cc', n: 74, ch: 2 }) === '74@2' && S.srcKey({ t: 'note', n: 36, ch: 10 }) === 'n36@10' && S.srcKey({ t: 'pb' }) === 'pb');
  check('parse round-trips', ['74', '74@2', 'n36@10', 'pb', 'cp', 'pc5'].every((k) => S.srcKey(S.parseSrcKey(k)) === k));
  check('isSrcKey accepts legacy numeric keys and rejects junk', S.isSrcKey('7') && S.isSrcKey('n60') && !S.isSrcKey('foo') && !S.isSrcKey('n'));
  const m = S.decodeMessage([0xe0, 0x00, 0x40]);
  check('pitch bend 14-bit: centre = 8192, v = 64', m.t === 'pb' && m.v14 === 8192 && m.v === 64);
  check('note-on vel 0 is a note-off', S.decodeMessage([0x90, 60, 0]).on === false);
  check('channel pressure + program change decode', S.decodeMessage([0xd1, 50]).t === 'cp' && S.decodeMessage([0xc2, 9]).n === 9 && S.decodeMessage([0xc2, 9]).ch === 3);
  check('realtime/system bytes ignored', S.decodeMessage([0xf8]) === null && S.decodeMessage([0xa0, 60, 5]) === null);
  check('relative decoders', S.decodeRel('twos', 1) === 1 && S.decodeRel('twos', 127) === -1 && S.decodeRel('binoff', 65) === 1 && S.decodeRel('binoff', 63) === -1 && S.decodeRel('signmag', 65) === -1 && S.decodeRel('signmag', 2) === 2);
}

console.log('\n[2] controller profile matching');
{
  const n = (s, mf) => C.matchProfile(s, mf)?.id;
  check('MPK mini 3 (macOS name "MPK mini 3")', n('MPK mini 3') === 'akai-mpk-mini-3', n('MPK mini 3'));
  check('MPK mini 3 (Chrome name "MPK mini 3 MIDI 1" style, Akai maker)', n('MPK mini 3 MIDI 1', 'AKAI professional LLC') === 'akai-mpk-mini-3');
  check('MPK mini mk2 is NOT matched as mk3', n('MPK mini II') === 'akai-mpk-mini' && n('MPK mini Mk2') === 'akai-mpk-mini');
  check('MiniLab 3', n('Minilab3 MIDI') === 'arturia-minilab-3' && n('Arturia MiniLab 3') === 'arturia-minilab-3');
  check('KeyStep', n('Arturia KeyStep 32') === 'arturia-keystep' && n('KeyStep Pro') === 'arturia-keystep');
  check('Launchkey Mini MK3 (Chrome adds "MIDI")', n('Launchkey Mini MK3 MIDI') === 'novation-launchkey-mini-3' && n('Launchkey Mini MK3 MIDI Out') === 'novation-launchkey-mini-3');
  check('nanoKONTROL2 + microKEY', n('nanoKONTROL2 SLIDER/KNOB') === 'korg-nanokontrol2' && n('microKEY-25 KEYBOARD') === 'korg-microkey');
  check('unknown device -> null (generic fallback is the caller\'s choice)', n('Some Synth 9000') == null && n('') == null);
  check('generic profile is always listed last', C.listProfiles().at(-1).id === 'generic');
  const mpk = C.profileById('akai-mpk-mini-3');
  const all = C.allControls(mpk);
  check('MPK profile: 8 knobs CC70-77, 8+8 pads, pitch + mod, keys', all.filter((x) => x.control.kind === 'knob').length === 8 && all.filter((x) => x.control.kind === 'pad').length === 16
    && all.some((x) => x.control.kind === 'pitchbend') && all.some((x) => x.control.kind === 'modwheel') && mpk.segments.some((s) => s.kind === 'keys'));
  check('every built-in profile is flagged verified:false (nothing claims to be checked against real hardware yet)', C.BUILTIN.every((p) => p.verified === false));
  check('controlIndex finds K1 by source key', C.controlIndex(mpk).get('70')?.control.id === 'k1');
  const custom = C.registerProfile({ id: 'custom-x', name: 'X', matchName: 'My Weird Box', segments: [] });
  check('a registered custom profile wins by exact device name', C.matchProfile('my  weird box')?.id === 'custom-x');
  C.removeProfile('custom-x');
}

console.log('\n[3] discovery: inference from synthetic message streams');
{
  const d = new Discovery();
  const cc = (n, v, ch = 1) => d.feed([0xb0 | (ch - 1), n, v]);
  for (let v = 0; v <= 127; v += 9) cc(21, v);                            // knob sweep
  for (let v = 127; v >= 0; v -= 11) cc(22, v);                           // another knob, other direction
  cc(30, 127); cc(30, 0); cc(30, 127); cc(30, 0);                         // momentary button
  for (let i = 0; i < 6; i++) cc(40, 1); for (let i = 0; i < 6; i++) cc(40, 127);          // encoder, twos (1 / 127)
  for (let i = 0; i < 5; i++) cc(41, 65); for (let i = 0; i < 5; i++) cc(41, 63);           // encoder, binoff (65 / 63)
  for (let i = 0; i < 5; i++) cc(42, 2); for (let i = 0; i < 5; i++) cc(42, 66);            // encoder, signmag (2 / 66)
  cc(1, 10); cc(1, 80); cc(1, 120);                                                          // mod wheel
  cc(64, 127); cc(64, 0);                                                                    // sustain pedal
  d.feed([0xe0, 0, 0x40]); d.feed([0xe0, 0x7f, 0x7f]);                                       // pitch bend
  d.feed([0xd0, 90]);                                                                        // channel pressure
  for (let n = 48; n < 61; n++) { d.feed([0x90, n, 90]); d.feed([0x80, n, 0]); }            // 13 keys, ch1
  for (let n = 36; n < 40; n++) { d.feed([0x99, n, 100]); d.feed([0x89, n, 0]); }           // 4 pads, ch10
  const k = Object.fromEntries(d.report().map((r) => [r.key, r]));
  check('knob sweeps -> knob', k['21@1'].kind === 'knob' && k['22@1'].kind === 'knob');
  check('0/127 CC -> button', k['30@1'].kind === 'button');
  check('1/127 -> encoder twos', k['40@1'].kind === 'encoder' && k['40@1'].rel === 'twos', JSON.stringify(k['40@1']));
  check('65/63 -> encoder binoff', k['41@1'].kind === 'encoder' && k['41@1'].rel === 'binoff', JSON.stringify(k['41@1']));
  check('2/66 -> encoder signmag', k['42@1'].kind === 'encoder' && k['42@1'].rel === 'signmag', JSON.stringify(k['42@1']));
  check('CC1 -> modwheel, CC64 two-valued -> button (pedal)', k['1@1'].kind === 'modwheel' && k['64@1'].kind === 'button');
  check('pitch bend / pressure', k['pb@1'].kind === 'pitchbend' && k['cp@1'].kind === 'aftertouch');
  check('13 notes on ch1 -> keys; notes on ch10 -> pads', k['n48@1'].kind === 'key' && k['n36@10'].kind === 'pad');
  check('channel is part of identity: same CC on ch1 vs ch2 are two sources',
    (() => { const x = new Discovery(); x.feed([0xb0, 7, 10]); x.feed([0xb1, 7, 10]); return x.seen.size === 2; })());
  const p = d.buildProfile({ name: 'My Box', deviceName: 'My Box MIDI 1' });
  const kinds = p.segments.map((s) => s.kind);
  check('built profile groups: stick, knobs, encoders, buttons, pads, keys', ['stick', 'knobs', 'encoders', 'buttons', 'pads', 'keys'].every((x) => kinds.includes(x)), kinds.join(','));
  check('built profile: knobs numbered in touch order, srcs kept', p.segments.find((s) => s.id === 'knobs').controls.map((c) => c.src.n).join() === '21,22');
  check('built profile: keys range', p.segments.find((s) => s.id === 'keys').range.join() === '48,60');
  check('built profile matches its device by name once registered', (C.registerProfile(p), C.matchProfile('My Box MIDI 1')?.id === p.id));
  C.removeProfile(p.id);
  check('profile is JSON-serialisable (saved to the sidecar)', JSON.parse(JSON.stringify(p)).segments.length === p.segments.length);
}

console.log('\n[4] binding targets');
const mk = () => {
  const bus = new EventBus();
  const store = new Store(bus, demoProject());
  const calls = [];
  const transport = { playing: false, toggle() { this.playing = !this.playing; calls.push('toggle'); }, play() { calls.push('play'); }, stop() { calls.push('stop'); } };
  const engine = { previewHit: (t, l, v) => calls.push(`hit:${l}`) };
  const api = { execute: async (n, a) => { calls.push(`cmd:${n}`); } };
  store.selectTrack(store.project.tracks[0].id);
  return { store, ctx: { store, transport, engine, api }, calls, bus };
};
const press = (ctx, st, map, bytes) => {
  const msg = S.decodeMessage(bytes);
  const b = M.findBinding(map, msg);
  return b ? M.applyMessage(ctx, st, b.key, b.entry, msg) : { handled: false };
};
{
  const { store, ctx, calls } = mk();
  const st = new Map();
  const t0 = store.project.tracks[0];
  const synth = store.project.tracks.find((t) => store.kindOf(t) !== 'drums');
  store.selectTrack(synth.id);
  const strip2 = store.project.tracks[1];

  // legacy string entry still binds the selected track's param
  const def = (await import(`${ROOT}/src/engine/instruments/index.js`)).getInstrumentDef(synth.instrument.type);
  const p0 = def.params.find((p) => p.type !== 'select');
  let r = press(ctx, st, { '5': p0.key }, [0xb0, 5, 127]);
  check('legacy string entry (CC -> param of selected track) still works', r.handled && Math.abs(synth.instrument.params[p0.key] - p0.max) < 1e-6 || r.waiting, JSON.stringify(r));

  // channel gain by strip, with soft takeover
  const map = { '7': { k: 'channel', strip: 2, key: 'gain' } };
  strip2.channel.gain = 0.2;
  r = press(ctx, st, map, [0xb0, 7, 100]);
  check('soft takeover: hardware far from the value does NOT jump it', r.waiting && strip2.channel.gain === 0.2, `gain ${strip2.channel.gain}`);
  r = press(ctx, st, map, [0xb0, 7, 40]);
  check('...approaching but not yet at it still waits', r.waiting && strip2.channel.gain === 0.2);
  r = press(ctx, st, map, [0xb0, 7, 20]);
  check('...crossing the value picks it up (no jump)', !r.waiting && Math.abs(strip2.channel.gain - 20 / 127) < 1e-6, `gain ${strip2.channel.gain}`);
  press(ctx, st, map, [0xb0, 7, 90]);
  check('...then follows', Math.abs(strip2.channel.gain - 90 / 127) < 1e-6);
  const noPick = { '8': { k: 'channel', strip: 2, key: 'gain', pickup: false } };
  press(ctx, new Map(), noPick, [0xb0, 8, 10]);
  check('pickup:false jumps immediately', Math.abs(strip2.channel.gain - 10 / 127) < 1e-6);

  // master / fx / settings
  press(ctx, new Map(), { '9': { k: 'master', pickup: false } }, [0xb0, 9, 127]);
  check('master volume knob', Math.abs(store.project.masterVolume - 1.2) < 1e-6);
  press(ctx, new Map(), { '10': { k: 'fx', key: 'verbReturn', pickup: false } }, [0xb0, 10, 64]);
  check('fx knob', Math.abs(store.project.fx.verbReturn - 64 / 127) < 1e-6);
  press(ctx, new Map(), { '11': { k: 'setting', key: 'bpm', pickup: false } }, [0xb0, 11, 127]);
  check('tempo knob spans 40..240', store.project.bpm === 240);

  // toggles + triggers fire on the press edge only
  const mute = { '20': { k: 'channel', strip: 1, key: 'mute' } };
  const s2 = new Map();
  press(ctx, s2, mute, [0xb0, 20, 127]); press(ctx, s2, mute, [0xb0, 20, 0]);
  check('mute button toggles on press, not on release', store.project.tracks[0].channel.mute === true);
  press(ctx, s2, mute, [0xb0, 20, 127]);
  check('second press un-mutes', store.project.tracks[0].channel.mute === false);
  press(ctx, new Map(), { '41': { k: 'transport', op: 'toggle' } }, [0xb0, 41, 127]);
  check('transport button fires once per press', calls.filter((c) => c === 'toggle').length === 1);
  ctx.transport.playing = false;
  press(ctx, new Map(), { 'n40@10': { k: 'slot', n: 3 } }, [0x99, 40, 100]);
  check('a pad bound to a pattern slot', store.ui.activeSlot === 3);
  press(ctx, new Map(), { 'n41@10': { k: 'command', name: 'ledger', args: { action: 'clear' } } }, [0x99, 41, 100]);
  check('a pad bound to any catalog command', calls.includes('cmd:ledger'));
  const kit = store.project.tracks.find((t) => store.kindOf(t) === 'drums');
  const lane = (await import(`${ROOT}/src/engine/instruments/index.js`)).getInstrumentDef(kit.instrument.type).lanes[1];
  press(ctx, new Map(), { 'n42@10': { k: 'drum', lane: lane.id } }, [0x99, 42, 100]);
  check('a pad bound to a drum lane of the (selected or first) kit', calls.includes(`hit:${lane.id}`));

  // channel-specific source beats the bare one
  const both = { '7': { k: 'master' }, '7@3': { k: 'fx', key: 'verbSize' } };
  check('findBinding prefers the channel-specific key', M.findBinding(both, S.decodeMessage([0xb2, 7, 1])).key === '7@3' && M.findBinding(both, S.decodeMessage([0xb0, 7, 1])).key === '7');

  // encoders move relatively
  const enc = { '50': { k: 'master', rel: 'binoff' } };
  store.setSetting('masterVolume', 0.6);
  const before = store.project.masterVolume;
  press(ctx, new Map(), enc, [0xb0, 50, 66]);
  check('relative encoder: +2 detents nudges up, no jump to a position', store.project.masterVolume > before && store.project.masterVolume - before < 0.1);
  press(ctx, new Map(), enc, [0xb0, 50, 60]);
  check('...and down', store.project.masterVolume < before + 0.03);

  // pitch bend / channel pressure are bindable sources
  const tempo = { pb: { k: 'setting', key: 'swing', pickup: false } };
  press(ctx, new Map(), tempo, [0xe0, 0x7f, 0x7f]);
  check('pitch bend bound as a source', store.project.swing > 0.99);
  press(ctx, new Map(), { cp: { k: 'master', pickup: false } }, [0xd0, 0]);
  check('channel pressure bound as a source', store.project.masterVolume === 0);

  // an unresolvable target is simply unhandled (no throw)
  check('target that cannot resolve is a no-op', press(ctx, new Map(), { '60': { k: 'channel', strip: 99, key: 'gain' } }, [0xb0, 60, 5]).handled === false);

  // targetLabel
  check('targetLabel reads like a human', /Volume/.test(M.targetLabel(ctx, map['7'])) && /Tempo/.test(M.targetLabel(ctx, { k: 'setting', key: 'bpm' })));
}

console.log('\n[5] default map for a known device');
{
  const mpk = M.defaultMap(C.profileById('akai-mpk-mini-3'));
  check('MPK: knobs K1..K8 -> params 1..8 of the selected track (auto)', ['70', '71', '77'].every((k) => mpk[k]?.k === 'param' && mpk[k].auto) && mpk['70'].slot === 0 && mpk['77'].slot === 7);
  check('MPK: no binding needed for pads/keys (they already play the selected track)', !Object.keys(mpk).some((k) => k.startsWith('n')));
  const nano = M.defaultMap(C.profileById('korg-nanokontrol2'));
  check('nanoKONTROL2: faders -> mixer strips 1..8 volume', nano['0@1']?.k === 'channel' && nano['0@1'].strip === 1 && nano['7@1'].strip === 8 && nano['7@1'].key === 'gain');
  check('nanoKONTROL2: solo/mute buttons -> that strip', nano['32@1']?.key === 'solo' && nano['32@1'].strip === 1 && nano['55@1']?.key === 'mute' && nano['55@1'].strip === 8);
  check('nanoKONTROL2: transport play/stop/record', nano['41@1']?.op === 'toggle' && nano['42@1']?.op === 'stop' && nano['45@1']?.op === 'record');
  check('nanoKONTROL2: pan knobs left alone (user picks)', !nano['16@1']);
  const lk = M.defaultMap(C.profileById('novation-launchkey-mini-3'));
  check('Launchkey Mini: knobs CC21..28 on ch1 -> params', lk['21@1']?.slot === 0 && lk['28@1']?.slot === 7);
  const { store, ctx } = mk();
  const synth = store.project.tracks.find((t) => store.kindOf(t) !== 'drums');
  store.selectTrack(synth.id);
  const st = new Map();
  const r = M.applyMessage(ctx, st, '70', mpk['70'], S.decodeMessage([0xb0, 70, 64]));
  check('default-mapped knob resolves against whatever track is selected', r.handled && r.desc.label.startsWith(synth.name));
  check('cleanMap drops junk keys', Object.keys(M.cleanMap({ '5': 'x', foo: 'y', 'n3': { k: 'master' } })).join() === '5,n3');
}

console.log('\n[6] the midi command: bind / bindings / profiles (headless, as Cog drives it over MCP)');
{
  const { CommandAPI } = await import(`${ROOT}/src/api/api.js`);
  const bus = new EventBus();
  const store = new Store(bus, demoProject());
  const transport = { playing: false, getPosition() { return { playing: false, localBeat: 0, loopBeats: 8 }; }, toggle() {}, play() {}, stop() {} };
  const api = new CommandAPI({ store, engine: {}, transport, bus });
  store.selectTrack(store.project.tracks[0].id);
  let r = await api.execute('midi', { action: 'bind', source: '7', target: { k: 'channel', strip: 2, key: 'gain' } });
  check('bind: CC7 -> strip 2 volume shows up in status.bindings with readable text', r.bindings.some((b) => b.source === '7' && /Volume/.test(b.text)), JSON.stringify(r.bindings));
  r = await api.execute('midi', { action: 'bind', source: 'n36@10', target: { k: 'transport', op: 'toggle' } });
  check('bind: a pad (note 36 on ch10) -> transport', r.knobs['n36@10']?.k === 'transport');
  r = await api.execute('midi', { action: 'bind', cc: 74, target: { k: 'master' }, pickup: false });
  check('bind: bare cc number + pickup:false', r.knobs['74']?.pickup === false);
  r = await api.execute('midi', { action: 'bind', source: '75', target: { k: 'master' }, rel: 'binoff' });
  check('bind: relative encoder encoding kept', r.knobs['75']?.rel === 'binoff');
  r = await api.execute('midi', { action: 'bind', source: 'pb', target: { k: 'setting', key: 'swing' } });
  check('bind: pitch bend is a valid source', !!r.knobs.pb);
  const bad = async (a) => { try { await api.execute('midi', { action: 'bind', ...a }); return null; } catch (e) { return e.message; } };
  check('bind: junk source rejected with the grammar', /source/.test(await bad({ source: 'foo', target: { k: 'master' } }) || ''));
  check('bind: unresolvable target rejected (strip 99)', /resolve/.test(await bad({ source: '9', target: { k: 'channel', strip: 99, key: 'gain' } }) || ''));
  check('bind: missing target rejected', /target/.test(await bad({ source: '9' }) || ''));
  r = await api.execute('midi', { action: 'bind', source: '12', param: Object.keys(store.project.tracks[0].instrument.params)[0] }).catch((e) => ({ err: e.message }));
  r = await api.execute('midi', { action: 'unbind', source: '7' });
  check('unbind removes it', r.knobs['7'] === undefined && /Removed 1/.test(r.note));
  r = await api.execute('midi', { action: 'bindings' });
  check('bindings lists the rest', r.bindings.length >= 3);
  r = await api.execute('midi', { action: 'profiles' });
  check('profiles: built-ins listed, MPK mini 3 among them', r.profiles.some((p) => p.id === 'akai-mpk-mini-3') && r.profiles.length >= 8);
  r = await api.execute('midi', { action: 'profile', profile: 'akai-mpk-mini-3' });
  check('profile: segments with the message each control sends', r.segments.find((s) => s.id === 'knobs').controls[0].source === '70' && r.segments.some((s) => s.kind === 'keys'));
  r = await api.execute('midi', { action: 'defaults', profile: 'korg-nanokontrol2' });
  check('defaults: applies the nanoKONTROL2 starter map', r.knobs['0@1']?.k === 'channel' && /Applied \d+ default/.test(r.note));
  r = await api.execute('midi', { action: 'bind_mode', record: true });
  check('bind_mode flag', r.bindMode === true);
  check('status exposes the detected controller slot (null headless) and outputs', 'controller' in r && Array.isArray(r.outputs));
}

console.log('\n[7] MPK mini mk3: layout + "Check my controller"');
{
  const { ControllerCheck } = await import(`${ROOT}/src/core/midicheck.js`);
  const mk3 = C.profileById('akai-mpk-mini-3');
  const all = C.allControls(mk3);
  const real = all.filter((x) => !x.control.local);
  check('layout: physical areas for every segment (stick, arp, pad modes, pads, pads-b, knobs, keys)',
    mk3.layout && mk3.segments.every((s) => s.area) && ['stick', 'arp', 'pmode', 'pads', 'knobs', 'keys'].every((a) => mk3.layout.areas.join(' ').includes(a)));
  check('8 knobs CC70-77 ch-any, 8 pads bank A notes 36-43 ch10, bank B 44-51',
    real.filter((x) => x.control.kind === 'knob').every((x, i) => x.control.src.n === 70 + i) && mk3.segments.find((s) => s.id === 'pads').controls.every((c, i) => c.src.n === 36 + i && c.src.ch === 10)
    && mk3.segments.find((s) => s.id === 'pads-b').controls.every((c, i) => c.src.n === 44 + i));
  check('joystick: pitch bend + CC1 (up) known, down is an empty slot (not guessed)',
    mk3.segments.find((s) => s.id === 'stick').controls.map((c) => c.src ? c.id : '-' + c.id).join() === 'pb,mod,-moddn');
  check('every known source is flagged verified:false (default program, not read off the device)', real.filter((x) => x.control.src).every((x) => x.control.verified === false) && mk3.verified === false);
  check('device-only buttons are marked local and carry no source (arp, tap, oct, full level, repeat, bank/CC/prog)',
    all.filter((x) => x.control.local).length === 10 && all.filter((x) => x.control.local).every((x) => !x.control.src));
  const dm = M.defaultMap(mk3);
  check('default map still: K1-K8 -> params 1-8; pads and device buttons get NO binding (pads play the kit via padOf)',
    ['70', '77'].every((k) => dm[k]?.k === 'param') && !Object.keys(dm).some((k) => k.startsWith('n')) && Object.keys(dm).length === 8);

  // a clean run: everything matches
  let c1 = new ControllerCheck(mk3);
  check('steps: stick x3 + 8 knobs + 8 pads (bank A) + keys, bank B and device buttons excluded', c1.total === 3 + 8 + 8 + 1, String(c1.total));
  check('first prompt is the joystick', /joystick/i.test(c1.current.prompt));
  const feed = (c, ...b) => c.feed(b);
  let r = feed(c1, 0xe0, 0, 0x7f);                                         // bend right
  check('pitch bend confirms the pitch step', r.kind === 'ok' && r.step.id === 'stick.pb');
  r = feed(c1, 0xe0, 0, 0x40);                                             // spring back to centre
  check('bend near centre is ignored (spring-back)', r.kind === 'ignored');
  r = feed(c1, 0xb0, 1, 90);
  check('CC1 confirms mod up', r.kind === 'ok' && r.step.id === 'stick.mod');
  check('next prompt asks for stick down', /down/i.test(c1.current.prompt));
  c1.skip();
  check('skipping leaves it unchecked; order follows the hardware (stick, pads, knobs, keys)', c1.counts.skipped === 1 && /PAD 1/.test(c1.current.prompt));

  // out of order: Chaz hits PAD 3 while we ask for PAD 1
  r = feed(c1, 0x99, 38, 100);
  check('out of order: PAD 3 (note 38) is confirmed, the current step stays', r.kind === 'other' && r.step.label === 'PAD 3' && /PAD 1/.test(c1.current.prompt));
  r = feed(c1, 0x89, 38, 0);
  check('releases never count', r.kind === 'ignored');
  r = feed(c1, 0x99, 38, 100);
  check('a repeat of a settled pad is a repeat', r.kind === 'repeat');
  r = feed(c1, 0x99, 44, 100);
  check('a bank B pad is noted, not applied', r.kind === 'bankb' && /PAD 1/.test(c1.current.prompt));
  r = feed(c1, 0x90, 60, 100);
  check('a key press while a pad is wanted is stray, not a correction', r.kind === 'stray' && c1.stray === 1 && /PAD 1/.test(c1.current.prompt));
  r = feed(c1, 0xb0, 70, 20);
  check('a knob while a pad is wanted confirms that knob (out of order), pad step stays', r.kind === 'other' && r.step.label === 'K1' && /PAD 1/.test(c1.current.prompt));
  for (const n of [36, 37, 39, 40, 41, 42, 43]) feed(c1, 0x99, n, 90);
  check('all 8 pads done; next is a knob (K1 was already confirmed, so K2)', /K2/.test(c1.current.prompt), c1.current.prompt);
  for (let i = 1; i < 8; i++) feed(c1, 0xb0, 70 + i, 60);
  check('knobs done; keys prompt', /key/i.test(c1.current.prompt) && c1.counts.ok === 2 + 8 + 8, JSON.stringify(c1.counts));
  r = feed(c1, 0x90, 60, 90);
  check('a key on ch1 confirms the keys', r.kind === 'ok' && c1.finished);
  const res = c1.result({ deviceName: 'MPK mini 3', maker: 'AKAI professional LLC' });
  check('result: custom profile bound to this device name, verified, based on the built-in',
    res.custom && res.verified && res.matchName === 'MPK mini 3' && res.based_on === 'akai-mpk-mini-3' && res.id === 'custom-mpk-mini-3' && res.checked.skipped === 1);
  check('result: checked controls are verified, the skipped joystick-down slot stays unverified/empty',
    res.segments.find((s) => s.id === 'knobs').controls.every((c) => c.verified) && !res.segments.find((s) => s.id === 'stick').controls.find((c) => c.id === 'moddn').verified);
  check('the built-in profile is untouched by a check', mk3.segments.find((s) => s.id === 'knobs').controls[0].verified === false && mk3.verified === false);

  // corrections: this unit sends K3 as CC74 and PAD 2 as note 45
  let c2 = new ControllerCheck(mk3);
  feed(c2, 0xe0, 0, 0x7f); feed(c2, 0xb0, 1, 100); c2.skip();
  for (let n = 36; n <= 43; n++) feed(c2, 0x99, n, 90);
  feed(c2, 0xb0, 70, 50); feed(c2, 0xb0, 71, 50);
  r = feed(c2, 0xb0, 90, 50);                                              // K3 sends CC90 on this device
  check('a different CC while K3 is asked for corrects K3', r.kind === 'fixed' && r.step.label === 'K3' && r.step.expect.n === 90);
  check('correction is reported in words', c2.fixes()[0].step === 'K3' && /CC72/.test(c2.fixes()[0].was) && /CC90/.test(c2.fixes()[0].now), JSON.stringify(c2.fixes()));
  const rr = c2.result({ deviceName: 'MPK mini 3' });
  check('the saved profile carries the corrected source', rr.segments.find((s) => s.id === 'knobs').controls[2].src.n === 90 && rr.checked.fixes.length === 1);
  const dm2 = M.defaultMap(rr);
  check('and the default map is rebuilt on the corrected CC (CC90 -> param 3, CC72 gone)', dm2['90']?.slot === 2 && !dm2['72']);
  c2.redo(c2.steps.findIndex((s) => s.label === 'K3'));
  check('redo forgets a correction', c2.current.label === 'K3' && c2.current.expect.n === 72);

  // keys on another channel get corrected
  let c3 = new ControllerCheck(mk3);
  const kIdx = c3.steps.findIndex((s) => s.id === 'keys');
  for (let i = 0; i < kIdx; i++) c3.skip();
  r = feed(c3, 0x93, 60, 90);
  check('keys on ch4 corrects the keys channel', r.kind === 'fixed' && c3.result({ deviceName: 'x' }).segments.find((s) => s.kind === 'keys').ch === 4);

  // generic profile / pure matching still behaves
  check('MPK mini 3 name variants all match the mk3 profile',
    ['MPK mini 3', 'MPK mini 3 MIDI 1', 'MPK mini mk3', 'MPK mini MK3', 'AKAI MPK mini 3'].every((n) => C.matchProfile(n, 'AKAI professional LLC')?.id === 'akai-mpk-mini-3'));
  check('mk2 does not match the mk3 profile', C.matchProfile('MPK mini Mk2')?.id === 'akai-mpk-mini');
}

console.log('\n[8] input choice (hotplug): a recognised controller beats virtual ports');
{
  // midi.js is a browser module (no DOM at import time, so it loads headless)
  const { preferInput } = await import(`${ROOT}/src/ui/midi.js`);
  const port = (name, maker = '') => ({ id: 'in-' + name, name, manufacturer: maker });
  check('no inputs -> null', preferInput([]) === null);
  check('IAC bus listed first, MPK second -> the MPK', preferInput([port('IAC Driver Bus 1'), port('MPK mini 3', 'AKAI professional LLC')]).name === 'MPK mini 3');
  check('only virtual + an unknown real device -> the unknown real device', preferInput([port('Midi Through Port-0'), port('Some Synth 9000')]).name === 'Some Synth 9000');
  check('only virtual ports -> the first one (better than nothing)', preferInput([port('IAC Driver Bus 1')]).name === 'IAC Driver Bus 1');
  check('two known devices -> the first known', preferInput([port('Minilab3 MIDI'), port('MPK mini 3')]).name === 'Minilab3 MIDI');
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall ok');
