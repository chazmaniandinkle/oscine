// Gesture proof for the UI -> store action rewire: loads the real song,
// drives a clip drag, a right-edge trim, a split (S), a marker drag and a
// mixer fader drag with the mouse/keyboard, and for each asserts that the
// project changed as expected, that exactly ONE undo reverts it, and that
// redo restores it. Never saves; every edit is undone at the end.
//
//   OSCINE_URL=http://127.0.0.1:7361 node scripts/verify/2026-09-23/store-actions-gestures.mjs
//
// Needs the dev sidecar with OSCINE_PROJECT_ROOT=/Users/slowbro/workspaces/cog
// and playwright-core in node_modules.

const { chromium } = await import(new URL('../../../node_modules/playwright-core/index.mjs', import.meta.url).href);
const BASE = process.env.OSCINE_URL || 'http://127.0.0.1:7361';
const SONG = 'projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json';
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(`${BASE}/?p=${SONG}`);
await page.waitForFunction(() => window.oscine?.store?.project?.arrangement?.placements?.length > 0, null, { timeout: 30000 });
await page.waitForTimeout(1200);

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`); }
};
const state = () => page.evaluate(() => {
  const p = window.oscine.store.project;
  return { doc: JSON.stringify([p.arrangement, p.clips]), depth: window.oscine.store.undoStack.length };
});
const ev = (fn, arg) => page.evaluate(fn, arg);

// Screen point for song time t on the lane holding placement i (clip body row).
async function clipPoint(i, frac, dy = 30) {
  return ev(([i, frac, dy]) => {
    const { app, store } = window.oscine, tl = app.timeline, arr = store.project.arrangement;
    const pl = arr.placements[i], c = store.project.clips[pl.clip];
    const dur = (c.out - c.in) * (c.stretch ?? 1) / (c.rate ?? 1);
    const li = tl.lanes().findIndex(l => l.id === pl.track);
    const r = tl.canvas.getBoundingClientRect();
    return { x: r.left + tl.x(pl.at + dur * frac), y: r.top + tl.laneY(li) + dy, pxPerSec: tl.pxPerSec, x1: r.left + tl.x(pl.at + dur) };
  }, [i, frac, dy]);
}
async function drag(from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= steps; k++) await page.mouse.move(from.x + (to.x - from.x) * k / steps, from.y + (to.y - from.y) * k / steps);
  await page.mouse.up();
  await page.waitForTimeout(150);
}
// Run a gesture; assert `expect(before, after)`, one undo step, undo, redo.
async function proves(label, gesture, expect) {
  const s0 = await state(), m0 = await ev(() => JSON.stringify(window.oscine.store.project));
  await gesture();
  const s1 = await state();
  const e = await expect(JSON.parse(s0.doc), JSON.parse(s1.doc));
  check(`${label}: project changed as expected`, e === true, typeof e === 'string' ? e : '');
  check(`${label}: exactly one undo step`, s1.depth === s0.depth + 1, `depth ${s0.depth} -> ${s1.depth}`);
  await page.keyboard.press('Meta+KeyZ'); await page.waitForTimeout(120);
  const s2 = await state();
  check(`${label}: one undo reverts it`, s2.doc === s0.doc && s2.depth === s0.depth);
  await page.keyboard.press('Meta+Shift+KeyZ'); await page.waitForTimeout(120);
  const s3 = await state();
  check(`${label}: redo restores it`, s3.doc === s1.doc);
  // Leave the song as it was so the next gesture starts from the real layout.
  await ev(() => window.oscine.store.undo()); await page.waitForTimeout(80);
  return { m0 };
}

// Pick a vocal-r2 placement long enough to work with.
const idx = await ev(() => {
  const { store } = window.oscine, arr = store.project.arrangement;
  return arr.placements.findIndex(pl => { const c = store.project.clips[pl.clip]; return pl.track === 'vocal-r2' && (c.out - c.in) > 20; });
});
console.log(`placement ${idx} on vocal-r2`);
const pristine = await ev(() => JSON.stringify(window.oscine.store.project));
const depth0 = (await state()).depth;

console.log('\n[1] clip drag (body, +100 px)');
await proves('clip drag', async () => {
  const a = await clipPoint(idx, 0.5);
  await drag(a, { x: a.x + 100, y: a.y });
}, (b, a) => {
  const pb = b[0].placements[idx], pa = a[0].placements[idx];
  return (pa.at > pb.at + 1 && pa.track === pb.track && JSON.stringify(a[1]) === JSON.stringify(b[1])) || `at ${pb.at} -> ${pa.at}`;
});

console.log('\n[2] trim (right edge, -60 px)');
await proves('trim', async () => {
  const a = await clipPoint(idx, 1);
  const from = { x: a.x1 - 2, y: a.y };
  await drag(from, { x: from.x - 60, y: from.y });
}, (b, a) => {
  const cid = b[0].placements[idx].clip;
  return (a[1][cid].out < b[1][cid].out - 0.5 && a[1][cid].in === b[1][cid].in && a[0].placements[idx].at === b[0].placements[idx].at) || `out ${b[1][cid].out} -> ${a[1][cid].out}`;
});

console.log('\n[3] split (click clip, playhead mid-clip, S)');
await proves('split', async () => {
  const a = await clipPoint(idx, 0.3);
  await page.mouse.click(a.x, a.y); // select (no undo step)
  await ev(i => { const { store, transport } = window.oscine; const pl = store.project.arrangement.placements[i]; transport.songPos = pl.at + 5; }, idx);
  await page.keyboard.press('KeyS');
  await page.waitForTimeout(150);
}, (b, a) => {
  const n = a[0].placements.length === b[0].placements.length + 1;
  const left = a[1][b[0].placements[idx].clip], right = a[1][a[0].placements[idx + 1].clip];
  return (n && Math.abs(left.out - right.in) < 1e-9 && a[0].placements[idx + 1].at > b[0].placements[idx].at) || 'no split';
});

console.log('\n[4] marker drag (+80 px)');
// Set up a marker through the store action, then drag it with the mouse.
const mk = await ev(() => { const { store, app } = window.oscine; const { marker } = store.markerAdd(30, 'Proof'); app.timeline.dirty = true; return marker; });
await page.waitForTimeout(100);
await proves('marker drag', async () => {
  const p = await ev(id => {
    const tl = window.oscine.app.timeline, r = tl.canvas.getBoundingClientRect();
    const m = tl.markers().find(k => k.id === id);
    return { x: r.left + tl.x(m.t), y: r.top + 22 + 8 };
  }, mk.id);
  await drag(p, { x: p.x + 80, y: p.y });
}, (b, a) => {
  const mb = b[0].markers.find(m => m.id === mk.id), ma = a[0].markers.find(m => m.id === mk.id);
  return (ma.t > mb.t + 1 && ma.name === 'Proof') || `t ${mb.t} -> ${ma?.t}`;
});

console.log('\n[5] mixer fader drag (vocal-r2, down 40 px)');
await ev(() => { const { store, app } = window.oscine; store.ui.mixerOpen = true; app.mixer.paintOpen(); app.mixer.render?.(); });
await page.waitForTimeout(500);
await proves('fader drag', async () => {
  const f = await page.locator('[data-strip="vocal-r2"] .fader-track').boundingBox();
  const cap = await page.locator('[data-strip="vocal-r2"] .fader-cap').boundingBox();
  const from = { x: f.x + f.width / 2, y: cap.y + cap.height / 2 };
  await drag(from, { x: from.x, y: from.y + 40 });
}, (b, a) => {
  const lb = b[0].lanes.find(l => l.id === 'vocal-r2'), la = a[0].lanes.find(l => l.id === 'vocal-r2');
  return (la.gainDb < (lb.gainDb ?? 0) - 1) || `gain ${lb.gainDb} -> ${la.gainDb}`;
});

console.log('\n[5b] mixer clicks: mute, + insert, bypass, remove');
const strip = '[data-strip="vocal-r2"]';
const laneOf = (d, id = 'vocal-r2') => d[0].lanes.find(l => l.id === id);
await proves('mixer mute', () => page.locator(`${strip} .ms-m`).click(), (b, a) => (laneOf(a).mute === !laneOf(b).mute) || 'mute not toggled');
await proves('mixer + insert', async () => {
  await page.locator(`${strip} .insert-add`).click();
  await page.locator('.menu .menu-item', { hasText: 'EQ (3-band)' }).first().click();
}, (b, a) => ((laneOf(a).inserts?.length ?? 0) === (laneOf(b).inserts?.length ?? 0) + 1) || 'no insert added');
// Keep one insert for bypass/remove: redo the add (proves() undid it).
await ev(() => window.oscine.store.redo()); await page.waitForTimeout(150);
await proves('mixer bypass', () => page.locator(`${strip} .insert-byp`).last().click(), (b, a) => (a[0].lanes.find(l => l.id === 'vocal-r2').inserts.at(-1).bypass === true) || 'not bypassed');
await proves('mixer remove insert', () => page.locator(`${strip} .insert-rm`).last().click(), (b, a) => (laneOf(a).inserts.length === laneOf(b).inserts.length - 1) || 'not removed');
await ev(() => window.oscine.store.undo()); await page.waitForTimeout(100); // drop the kept insert

console.log('\n[6] plain click on a clip adds no undo step');
{
  const s0 = await state();
  const a = await clipPoint(idx, 0.5);
  await page.mouse.click(a.x, a.y); await page.waitForTimeout(100);
  const s1 = await state();
  check('click-to-select: no history, no change', s1.depth === s0.depth && s1.doc === s0.doc);
}

// Restore: undo anything left (the marker add).
const depthNow = (await state()).depth;
for (let k = depthNow; k > depth0; k--) await ev(() => window.oscine.store.undo());
const back = await ev(() => JSON.stringify(window.oscine.store.project));
check('all edits undone: project back to the loaded state', back === pristine);
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed ? 1 : 0);
