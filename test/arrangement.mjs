// Arrangement catalog commands, headless: builds a small v2 project in
// memory and drives every action of arrangement/clip/lane/marker/cycle/
// range/insert/automation/words through CommandAPI, asserting project state,
// bus events, and that each mutation is exactly one undo step.
//
//   node test/arrangement.mjs

import { EventBus } from '../src/core/bus.js';
import { Store } from '../src/core/store.js';
import { createProject, createArrangement } from '../src/core/schema.js';
import { CommandAPI } from '../src/api/api.js';
import { placedDur } from '../src/core/arrangement.js';

let failed = 0, passed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
async function throws(fn, re) {
  try { await fn(); return false; } catch (e) { return re.test(e.message) || e.message; }
}

// Two assets (fake durations), three clips, two lanes, three placements,
// two markers, a cycle, one lane envelope, one clip envelope.
function fixture() {
  const p = createProject('Arr Test');
  p.assets = {
    vox: { id: 'vox', kind: 'audio', duration: 20, variants: {}, words: [
      { s: 0.5, e: 1.0, t: 'hello' }, { s: 1.2, e: 1.8, t: 'there' }, { s: 6.0, e: 6.5, t: 'world' }, { s: 12, e: 12.5, t: 'late' },
    ] },
    gtr: { id: 'gtr', kind: 'audio', duration: 30, variants: {}, words: null },
  };
  p.clips = {
    v1: { id: 'v1', name: 'Verse vox', sourceOf: 'vox', in: 0, out: 8, representation: null, fadeIn: 0, fadeOut: 0, materializedAs: null, supersededBy: null },
    v2: { id: 'v2', name: 'Chorus vox', sourceOf: 'vox', in: 10, out: 14, representation: null, fadeIn: 0, fadeOut: 0, materializedAs: null, supersededBy: null },
    g1: { id: 'g1', name: 'Gtr', sourceOf: 'gtr', in: 0, out: 20, representation: null, fadeIn: 0, fadeOut: 0, materializedAs: null, supersededBy: null },
  };
  p.arrangement = createArrangement(0);
  p.arrangement.lanes = [
    { id: 'vocal', name: 'Vocal', gainDb: 0, mute: false, solo: false },
    { id: 'guitar', name: 'Guitar', gainDb: -3, mute: false, solo: false },
  ];
  p.arrangement.placements = [
    { track: 'vocal', clip: 'v1', at: 0 },
    { track: 'vocal', clip: 'v2', at: 10 },
    { track: 'guitar', clip: 'g1', at: 0 },
  ];
  p.arrangement.markers = [{ id: 'm1', t: 0, name: 'Verse' }, { id: 'm2', t: 10, name: 'Chorus' }];
  p.arrangement.loop = { a: 10, b: 14, on: true };
  p.arrangement.automation = [
    { target: 'lane:vocal:gainDb', points: [{ t: 2, v: 0 }, { t: 6, v: -6 }, { t: 12, v: -3 }] },
    { target: 'clip:v2:gainDb', points: [{ t: 1, v: -2 }] },
  ];
  return p;
}

const bus = new EventBus();
const events = [];
for (const ev of ['arrangement:changed', 'lanes:changed', 'inserts:changed', 'loop:changed', 'range:changed']) bus.on(ev, () => events.push(ev));
const store = new Store(bus, fixture());
let armed = 0;
const transport = { getPosition: () => ({ playing: false, localBeat: 0, loopBeats: 8 }), armLoop: () => { armed++; } };
const api = new CommandAPI({ store, engine: {}, transport, bus });
const run = (name, args) => api.execute(name, args);
const snap = () => JSON.stringify(store.project);

// One undoable mutation: returns the result, asserts one undo step restores
// the prior state and redo re-applies it.
async function mutate(label, name, args, { emits } = {}) {
  const before = snap(), depth = store.undoStack.length;
  events.length = 0;
  const out = await run(name, args);
  const after = snap();
  check(`${label}: one undo step`, store.undoStack.length === depth + 1, `depth ${depth} -> ${store.undoStack.length}`);
  if (emits) check(`${label}: emits ${emits.join(', ')}`, emits.every(e => events.includes(e)), events.join(','));
  store.undo();
  check(`${label}: undo restores`, snap() === before);
  store.redo();
  check(`${label}: redo re-applies`, snap() === after);
  return out;
}
const arr = () => store.project.arrangement;

console.log('\n[1] arrangement get');
{
  const s = await run('arrangement', { action: 'get' });
  check('lanes summarised', s.lanes.length === 2 && s.lanes[1].gainDb === -3 && s.lanes[0].name === 'Vocal');
  check('placements with index/at/end', s.placements.length === 3 && s.placements[1].at === 10 && s.placements[1].end === 14 && s.placements[2].index === 2);
  check('markers + cycle + length', s.markers.length === 2 && s.cycle.a === 10 && s.length === 20);
  check('automation targets with counts', s.automation.find(a => a.target === 'lane:vocal:gainDb').points === 3);
  check('no word arrays in summary', !JSON.stringify(s).includes('hello') && s.assets.find(a => a.id === 'vox').words === 4);
  check('bad action rejected', await throws(() => run('arrangement', { action: 'nuke' }), /Bad action/));
}

console.log('\n[2] clip');
{
  const g = await run('clip', { action: 'get', index: 1 });
  check('get by index', g.clip.id === 'v2' && g.placements[0].index === 1);
  const g2 = await run('clip', { action: 'get', clip: 'chorus vox' });
  check('get by name (case-insensitive)', g2.clip.id === 'v2');

  await mutate('set', 'clip', { action: 'set', clip: 'v1', gainDb: -4, fadeIn: 0.5, pitch: 2, name: 'Verse A' }, { emits: ['arrangement:changed'] });
  const c = store.project.clips.v1;
  check('set fields applied (pitch -> semitones)', c.gainDb === -4 && c.fadeIn === 0.5 && c.semitones === 2 && c.name === 'Verse A');
  check('set rejects out past asset end', await throws(() => run('clip', { action: 'set', clip: 'v1', out: 25 }), /past the end/));
  check('set rejects out <= in', await throws(() => run('clip', { action: 'set', clip: 'v1', in: 5, out: 5 }), /after 'in'/));

  await mutate('set stretch', 'clip', { action: 'set', index: 2, stretch: 1.5 });
  check('stretch changes placed length', near(placedDur(store.project.clips.g1), 30));
  store.undo();

  const sp = await mutate('split', 'clip', { action: 'split', index: 0, t: 3 }, { emits: ['arrangement:changed'] });
  check('split: left ends at t, right starts at t', sp.left.end === 3 && sp.right.at === 3 && sp.right.end === 8);
  check('split: right clip in = 3, left out = 3', store.project.clips[sp.right.clip].in === 3 && store.project.clips.v1.out === 3);
  check('split: placements now 4', arr().placements.length === 4);
  check('split outside placement rejected', await throws(() => run('clip', { action: 'split', index: 0, t: 5 }), /not inside/));
  store.undo();

  const d = await mutate('duplicate', 'clip', { action: 'duplicate', index: 1 });
  check('duplicate lands right after, with its own clip', d.placement.at === 14 && d.placement.clip !== 'v2' && store.project.clips[d.placement.clip].in === 10);
  store.undo();

  await mutate('move', 'clip', { action: 'move', index: 1, at: 15, lane: 'Guitar' });
  check('move sets at + lane', arr().placements[1].at === 15 && arr().placements[1].track === 'guitar');
  check('move needs at or lane', await throws(() => run('clip', { action: 'move', index: 1 }), /needs 'at'/));
  store.undo();

  await mutate('remove', 'clip', { action: 'remove', index: 2 });
  check('remove drops placement, keeps clip record', arr().placements.length === 2 && store.project.clips.g1);
  store.undo();

  const pl = await mutate('place asset', 'clip', { action: 'place', asset: 'gtr', lane: 'vocal', at: 22 });
  check('place asset makes a full-length clip', pl.clip.in === 0 && pl.clip.out === 30 && pl.placement.at === 22 && pl.placement.lane === 'vocal');
  store.undo();
  await mutate('place clip', 'clip', { action: 'place', clip: 'v2', lane: 'guitar', at: 30 });
  check('place clip reuses the clip id', arr().placements.at(-1).clip === 'v2');
  store.undo();
  check('bad index is actionable', await throws(() => run('clip', { action: 'remove', index: 9 }), /Bad placement index 9; there are 3/));
}

console.log('\n[3] lane');
{
  const a = await mutate('add', 'lane', { action: 'add', name: 'Bass Gtr' }, { emits: ['lanes:changed'] });
  check('add makes slug id', a.lane.id === 'bass-gtr' && arr().lanes.length === 3);
  await mutate('rename', 'lane', { action: 'rename', lane: 'bass-gtr', name: 'Bass' });
  check('rename', arr().lanes[2].name === 'Bass');
  await mutate('set', 'lane', { action: 'set', lane: 'Bass', gainDb: -99, pan: 0.4, mute: true, solo: true, color: '#fff' }, { emits: ['lanes:changed'] });
  const l = arr().lanes[2];
  check('set clamps gainDb, sets pan/mute/solo/color', l.gainDb === -60 && l.pan === 0.4 && l.mute && l.solo && l.color === '#fff');
  await mutate('reorder', 'lane', { action: 'reorder', lane: 'Bass', index: 0 });
  check('reorder', arr().lanes.map(x => x.id).join() === 'bass-gtr,vocal,guitar');
  const r = await mutate('remove', 'lane', { action: 'remove', lane: 'vocal' });
  check('remove drops placements + lane automation', r.placementsRemoved === 2 && r.envelopesRemoved === 1 && !arr().placements.some(p => p.track === 'vocal'));
  check('unknown lane lists lanes', await throws(() => run('lane', { action: 'rename', lane: 'nope', name: 'x' }), /No lane 'nope'. Lanes: .*Guitar/));
  // back to the fixture lanes
  while (store.undoStack.length) store.undo();
  check('undo all returns to fixture', arr().lanes.length === 2);
}

console.log('\n[4] marker');
{
  const l = await run('marker', { action: 'list' });
  check('list', l.markers.length === 2 && l.markers[1].name === 'Chorus');
  const a = await mutate('add', 'marker', { action: 'add', t: 5, name: 'Pre' });
  check('add sorts by time', a.marker.id === 'm3' && arr().markers.map(m => m.name).join() === 'Verse,Pre,Chorus');
  await mutate('move', 'marker', { action: 'move', marker: 'Pre', t: 15 });
  check('move resorts', arr().markers.map(m => m.name).join() === 'Verse,Chorus,Pre');
  await mutate('rename', 'marker', { action: 'rename', marker: 'm3', name: 'Outro' });
  check('rename', arr().markers[2].name === 'Outro');
  await mutate('remove', 'marker', { action: 'remove', marker: 'outro' });
  check('remove', arr().markers.length === 2);
  check('unknown marker', await throws(() => run('marker', { action: 'remove', marker: 'zzz' }), /No marker/));
}

console.log('\n[5] cycle');
{
  const g = await run('cycle', { action: 'get' });
  check('get', g.cycle.a === 10 && g.cycle.b === 14 && g.cycle.on);
  armed = 0;
  await mutate('set', 'cycle', { action: 'set', a: 2, on: false }, { emits: ['loop:changed'] });
  check('set merges with existing + re-arms transport', arr().loop.a === 2 && arr().loop.b === 14 && !arr().loop.on && armed === 1);
  check('set rejects b <= a', await throws(() => run('cycle', { action: 'set', a: 5, b: 5 }), /Bad cycle/));
  await mutate('clear', 'cycle', { action: 'clear' });
  check('clear', arr().loop === null);
  check('set with no cycle needs both edges', await throws(() => run('cycle', { action: 'set', a: 1 }), /needs both/));
  store.undo(); store.undo();
}

console.log('\n[6] range');
{
  await mutate('cut (one lane)', 'range', { action: 'cut', a: 2, b: 4, lanes: ['Vocal'] }, { emits: ['arrangement:changed'] });
  const ps = arr().placements;
  check('cut middle of v1 leaves a gap and a tail', ps.length === 4 && store.project.clips.v1.out === 2 && ps[1].at === 4 && store.project.clips[ps[1].clip].in === 4);
  check('cut left guitar alone', store.project.clips.g1.in === 0 && store.project.clips.g1.out === 20);
  store.undo();

  // Ripple math, matching timeline.rippleDeleteRange: [4,6] (2s gap).
  const r = await mutate('ripple_delete', 'range', { action: 'ripple_delete', a: 4, b: 6 }, { emits: ['arrangement:changed', 'loop:changed'] });
  const P = arr().placements;
  check('ripple: v1 head kept 0..4, tail moves to 4', store.project.clips.v1.out === 4 && P[1].at === 4 && store.project.clips[P[1].clip].in === 6);
  check('ripple: later placement v2 shifts 10 -> 8', P.find(p => p.clip === 'v2').at === 8);
  check('ripple: guitar cut and closed (length 18)', P.filter(p => p.track === 'guitar').reduce((s, p) => s + placedDur(store.project.clips[p.clip]), 0) === 18);
  check('ripple: markers after b shift', arr().markers.find(m => m.id === 'm2').t === 8);
  check('ripple: cycle shifts', arr().loop.a === 8 && arr().loop.b === 12);
  const lane = arr().automation.find(e => e.target === 'lane:vocal:gainDb');
  check('ripple: lane automation keeps edge points, drops inside, shifts after (b->a)', lane.points.map(p => p.t).join() === '2,4,10');
  check('ripple: clip envelope untouched (clip-local)', arr().automation.find(e => e.target === 'clip:v2:gainDb').points[0].t === 1);
  check('ripple: reports length', r.length === 18);
  // marker inside the range collapses to a
  store.undo();
  store.checkpoint(); arr().markers.push({ id: 'm9', t: 5, name: 'Inside' });
  await run('range', { action: 'ripple_delete', a: 4, b: 6 });
  check('ripple: marker inside range collapses to a', arr().markers.find(m => m.id === 'm9')?.t === 4);
  store.undo(); store.undo();
  check('bad range', await throws(() => run('range', { action: 'cut', a: 5, b: 4 }), /Bad range/));
}

console.log('\n[7] insert');
{
  const l0 = await run('insert', { action: 'list' });
  check('list master (default), shows available types', l0.owner === 'master' && l0.inserts.length === 0 && l0.available.includes('eq3'));
  const a = await mutate('add lane insert', 'insert', { action: 'add', lane: 'Vocal', type: 'eq3', params: { lowGain: 40, hpSlope: 24 } }, { emits: ['inserts:changed'] });
  check('add validates + clamps params', a.insert.params.lowGain === 18 && a.insert.params.hpSlope === 24 && arr().lanes[0].inserts.length === 1);
  check('add rejects unknown type', await throws(() => run('insert', { action: 'add', lane: 'Vocal', type: 'wobbler' }), /Unknown effect type 'wobbler'. Available: eq3/));
  check('add rejects unknown param', await throws(() => run('insert', { action: 'add', type: 'eq3', params: { nope: 1 } }), /no param 'nope'/));
  check('add rejects bad select value', await throws(() => run('insert', { action: 'add', type: 'eq3', params: { hpSlope: 7 } }), /must be one of/));
  await mutate('add second', 'insert', { action: 'add', lane: 'vocal', type: 'compressor' });
  await mutate('set', 'insert', { action: 'set', lane: 'vocal', index: 0, params: { midGain: 3 }, bypass: true });
  const i0 = arr().lanes[0].inserts[0];
  check('set merges params + bypass', i0.params.lowGain === 18 && i0.params.midGain === 3 && i0.bypass === true);
  await mutate('move', 'insert', { action: 'move', lane: 'vocal', index: 0, to: 1 });
  check('move', arr().lanes[0].inserts.map(x => x.type).join() === 'compressor,eq3');
  await mutate('remove', 'insert', { action: 'remove', lane: 'vocal', index: 0 });
  check('remove', arr().lanes[0].inserts.map(x => x.type).join() === 'eq3');
  await mutate('add master', 'insert', { action: 'add', lane: 'master', type: 'limiter' });
  check('master chain', arr().master.inserts[0].type === 'limiter');
  check('bad index', await throws(() => run('insert', { action: 'remove', lane: 'vocal', index: 5 }), /Bad insert index 5/));
  const s = await run('arrangement', { action: 'get' });
  check('summary lists insert types', s.lanes[0].inserts[0] === 'eq3 (bypassed)' && s.master.inserts[0] === 'limiter', JSON.stringify([s.lanes[0], s.master]));
}

console.log('\n[8] automation');
{
  const all = await run('automation', { action: 'list' });
  check('list all', all.envelopes.length === 2);
  const one = await run('automation', { action: 'list', target: 'lane:Vocal:gainDb' });
  check('list one by lane NAME resolves id + range', one.target === 'lane:vocal:gainDb' && one.points.length === 3 && one.range.min === -60);
  const sp = await mutate('set_points', 'automation', { action: 'set_points', target: 'lane:Guitar:pan', points: [{ t: 4, v: 3 }, { t: 1, v: -0.5, shape: 'hold' }] });
  check('set_points sorts + clamps to range', sp.points.length === 2 && sp.points[0].t === 1 && sp.points[0].shape === 'hold' && sp.points[1].v === 1);
  const ap = await mutate('add_point', 'automation', { action: 'add_point', target: 'lane:guitar:pan', t: 2, v: 0.2 });
  check('add_point', ap.points === 3 && ap.point.v === 0.2);
  await mutate('remove_point by t', 'automation', { action: 'remove_point', target: 'lane:guitar:pan', t: 2.01 });
  check('remove_point by nearest t', arr().automation.find(e => e.target === 'lane:guitar:pan').points.length === 2);
  await mutate('remove_point by index', 'automation', { action: 'remove_point', target: 'lane:guitar:pan', index: 0 });
  await mutate('insert param target', 'automation', { action: 'add_point', target: 'lane:vocal:insert:0:lowGain', t: 1, v: 99 });
  check('insert-param target clamps to effect range', arr().automation.find(e => e.target === 'lane:vocal:insert:0:lowGain').points[0].v === 18);
  await mutate('master target', 'automation', { action: 'add_point', target: 'master:gainDb', t: 0, v: -2 });
  await mutate('clear', 'automation', { action: 'clear', target: 'lane:guitar:pan' });
  check('clear removes envelope', !arr().automation.find(e => e.target === 'lane:guitar:pan'));
  check('bad target grammar', await throws(() => run('automation', { action: 'add_point', target: 'vocal gain', t: 0, v: 0 }), /Bad target/));
  check('insert index with no insert', await throws(() => run('automation', { action: 'add_point', target: 'lane:guitar:insert:3:mix', t: 0, v: 0 }), /no known range/));
}

console.log('\n[9] words');
{
  const a = await run('words', { action: 'get', asset: 'vox' });
  check('get asset', a.total === 4 && a.text === 'hello there world late');
  const c = await run('words', { action: 'get', clip: 'v2' });
  check('get clip window (10..14)', c.total === 1 && c.words[0].t === 'late');
  const w = await run('words', { action: 'get', asset: 'vox', from: 1, to: 7, limit: 1 });
  check('time window + limit', w.total === 2 && w.returned === 1 && w.words[0].t === 'there');
  await mutate('set', 'words', { action: 'set', asset: 'gtr', words: [{ s: 2, e: 3, t: 'b' }, { s: 0, e: 1, t: 'a' }] });
  check('set sorts + stores', store.project.assets.gtr.words.map(x => x.t).join() === 'a,b');
  check('set validates', await throws(() => run('words', { action: 'set', asset: 'gtr', words: [{ s: 3, e: 1, t: 'x' }] }), /words\[0\]/));
}

console.log('\n[10] errors leave history clean');
{
  const depth = store.undoStack.length, before = snap();
  await throws(() => run('clip', { action: 'split', index: 0, t: 99 }), /./);
  await throws(() => run('lane', { action: 'set', lane: 'vocal' }), /./);
  await throws(() => run('insert', { action: 'set', lane: 'vocal', index: 0, params: { nope: 1 } }), /./);
  check('failed edits add no undo entries and change nothing', store.undoStack.length === depth && snap() === before);
}

console.log('\n[11] UI store actions (no catalog command): one undo step each');
{
  // Direct store calls, same one-undo-step contract as the catalog commands.
  async function act(label, fn) {
    const before = snap(), depth = store.undoStack.length;
    const out = fn();
    const after = snap();
    check(`${label}: one undo step`, store.undoStack.length === depth + 1, `depth ${depth} -> ${store.undoStack.length}`);
    store.undo(); check(`${label}: undo restores`, snap() === before);
    store.redo(); check(`${label}: redo re-applies`, snap() === after);
    return out;
  }
  store.load(fixture());
  const cp = await act('clipCopy', () => store.clipCopy(1));
  check('copy appended with <clip>_copy id', cp.clip === 'v2_copy' && arr().placements.length === 4 && arr().placements[3].at === 10 && store.project.clips.v2_copy.name === 'Chorus vox (copy)');
  const cp2 = store.clipCopy(1);
  check('second copy gets _copy2', cp2.clip === 'v2_copy2');

  store.load(fixture());
  const sm = await act('clipSplitMany', () => store.clipSplitMany([0, 2], [6, 2]));
  check('split both clips at both times', sm.splits === 4 && arr().placements.length === 7);
  const vocal = arr().placements.filter(p => p.track === 'vocal').map(p => p.at).sort((a, b) => a - b);
  check('vocal cut at 2 and 6', JSON.stringify(vocal) === '[0,2,6,10]', JSON.stringify(vocal));
  check('times outside a clip are skipped', store.clipSplitMany([1], [2]).splits === 0);

  store.load(fixture());
  const cr = await act('clipCutRange', () => store.clipCutRange([2], 4, 6));
  check('cut only the selected placement', cr.placementsTouched === 1 && arr().placements.length === 4 && arr().placements.filter(p => p.track === 'vocal').length === 2);

  store.load(fixture());
  const mv = await act('automationMovePoint', () => store.automationMovePoint('lane:vocal:gainDb', 1, { t: 7, v: -9 }));
  check('point moved', mv.point.t === 7 && mv.point.v === -9);
  const pts = () => arr().automation[0].points;
  store.automationMovePoint('lane:vocal:gainDb', 1, { t: 50 });
  check('move clamps between neighbours', pts()[1].t < 12 && pts()[1].t > 11.9);
  store.automationMovePoint('lane:vocal:gainDb', 0, { shape: 'hold' });
  check('shape-only change keeps t/v', pts()[0].shape === 'hold' && pts()[0].t === 2);
  check('bad index throws', await throws(() => store.automationMovePoint('lane:vocal:gainDb', 9, { t: 1 }), /No point 9/));

  store.load(fixture());
  store.clipSet('v1', { gainDb: 3, semitones: 2 });
  store.clipSet('v1', { gainDb: null, semitones: null });
  check('clipSet null clears gainDb/semitones', !('gainDb' in store.project.clips.v1) && !('semitones' in store.project.clips.v1));

  const bt = await act('arrangementBatch', () => store.arrangementBatch([['clipSet', 'v2', { in: 11 }], ['movePlacement', 1, { at: 11 }]]));
  check('batch applies every op', store.project.clips.v2.in === 11 && arr().placements[1].at === 11 && bt.length === 2);

  // Gesture: many previews, one commit = one undo step back to the pre-drag state.
  store.load(fixture());
  const before = snap(), depth = store.undoStack.length;
  store.gestureBegin();
  for (const at of [1, 2, 3, 4.5]) store.gesturePreview([['movePlacement', 0, { at }]]);
  check('preview mutates live without history', arr().placements[0].at === 4.5 && store.undoStack.length === depth);
  store.gestureCommit([['movePlacement', 0, { at: 5 }]]);
  const after = snap();
  check('gesture commit = one undo step', store.undoStack.length === depth + 1 && arr().placements[0].at === 5);
  store.undo(); check('gesture undo restores pre-drag', snap() === before);
  store.redo(); check('gesture redo re-applies', snap() === after);

  // Duplicate-drag: copy + moves replayed from the snapshot, never two copies.
  store.load(fixture());
  const d0 = store.undoStack.length;
  store.gestureBegin();
  const { index } = store.gesturePreview([['copyPlacement', 1]])[0];
  store.gesturePreview([['movePlacement', index, { at: 15 }]]);
  store.gestureCommit([['copyPlacement', 1], ['movePlacement', index, { at: 16 }]]);
  check('dup-drag: one copy, one undo step', arr().placements.length === 4 && arr().placements[3].at === 16 && Object.keys(store.project.clips).filter(k => k.startsWith('v2_copy')).length === 1 && store.undoStack.length === d0 + 1);

  // Cancel and no-op commit leave no history.
  store.load(fixture());
  const b2 = snap();
  store.gestureBegin(); store.gesturePreview([['moveMarker', 'm2', 11]]); store.gestureCancel();
  check('cancel restores, no history', snap() === b2 && store.undoStack.length === 0);
  store.gestureBegin(); store.gestureCommit([]);
  check('empty commit (a click) adds no history', snap() === b2 && store.undoStack.length === 0);
  store.gestureBegin(); store.gesturePreview([['setLane', 'vocal', { gainDb: -6 }]]);
  check('bad commit throws and restores', await throws(() => store.gestureCommit([['setLane', 'nope', { gainDb: 1 }]]), /No lane/) && snap() === b2 && store.undoStack.length === 0);
  store.markerAdd(3);
  store.gestureBegin(); store.gesturePreview([['setLane', 'vocal', { gainDb: -6 }]]);
  store.undo();
  check('undo mid-gesture drops the gesture', !store.inGesture);

  // Amend folds into the previous step (marker add + rename = one undo).
  store.load(fixture());
  const b3 = snap();
  const { marker } = store.markerAdd(4);
  store.arrangementAmend([['renameMarker', marker.id, 'Bridge']]);
  check('amend: add+rename is one step', store.undoStack.length === 1 && arr().markers.find(m => m.id === marker.id).name === 'Bridge');
  store.undo(); check('amend: one undo removes both', snap() === b3);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(`${failed} check(s) FAILED`); process.exit(1); }
console.log('All arrangement tests passed.');
