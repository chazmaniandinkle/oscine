// Gesture proof for ruler range selection (2026-09-23 fixes):
//  1. ⇧-drag on the ruler with snap on: both ends land on the beat grid
//     (the press end used to be raw; the moving end used to stick to its own
//     previous position because the range's live edges were snap targets).
//  2. The drag emits range:changed on release (the inspector refreshes).
//  3. A ⇧-click (no drag) extends from the playhead to the click.
//  4. A ⇧-drag shorter than the snap distance still counts as a drag.
//  5. ⌘ held (noSnap) gives raw times.
// Never saves; no project mutation.
//   OSCINE_URL=http://127.0.0.1:7351 node scripts/verify/2026-09-23/range-select.mjs
const { chromium } = await import(new URL('../../../node_modules/playwright-core/index.mjs', import.meta.url).href);
const BASE = process.env.OSCINE_URL || 'http://127.0.0.1:7351';
const SONG = 'projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json';
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(`${BASE}/?p=${SONG}`);
await page.waitForFunction(() => window.oscine?.store?.project?.arrangement?.placements?.length > 0, null, { timeout: 30000 });
await page.waitForTimeout(1200);
let passed = 0, failed = 0;
const check = (n, c, d = '') => { if (c) { passed++; console.log(`  ok  ${n}`); } else { failed++; console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ''}`); } };
const ev = (fn, a) => page.evaluate(fn, a);

await ev(() => {
  const { app, store } = window.oscine;
  store.ui.snap = 1; store.ui.snapOn = true; // 1-beat grid
  app.timeline.range = null; app.transport.songPos = 0;
  window.__rc = 0; app.bus.on('range:changed', () => window.__rc++);
  const tl = app.timeline; tl.pxPerSec = 40; tl.scrollX = 0; tl.fitted = false; tl.dirty = true;
});
await page.waitForTimeout(200);
const geo = await ev(() => {
  const tl = window.oscine.app.timeline, r = tl.canvas.getBoundingClientRect();
  return { left: r.left, top: r.top, pps: tl.pxPerSec, x0: tl.x(0) - 0, beat: 60 / (window.oscine.store.project.bpm || 120) };
});
const X = (t) => geo.left + geo.x0 + t * geo.pps; // tl.x includes gutter + scroll
const rulerY = geo.top + 12; // tick row (TICK_H=22); the band below is the marker strip
console.log(`pxPerSec ${geo.pps.toFixed(1)}, beat ${geo.beat.toFixed(3)} s`);
const onGrid = (t) => Math.abs(t / geo.beat - Math.round(t / geo.beat)) < 1e-6;
// Pick times that are clearly off-grid and away from clip edges.
const tA = 20 * geo.beat + 0.37 * geo.beat, tB = 28 * geo.beat + 0.41 * geo.beat;

async function shiftDrag(a, b, mods = ['Shift'], steps = 10) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(X(a), rulerY); await page.mouse.down();
  for (let k = 1; k <= steps; k++) await page.mouse.move(X(a) + (X(b) - X(a)) * k / steps, rulerY);
  await page.mouse.up();
  for (const m of mods.reverse()) await page.keyboard.up(m);
  await page.waitForTimeout(120);
  return ev(() => ({ r: window.oscine.app.timeline.range, rc: window.__rc }));
}

// 1 + 2
let s = await shiftDrag(tA, tB);
check('⇧-drag makes a range', !!s.r, JSON.stringify(s.r));
check('range start snapped to grid', s.r && onGrid(s.r.a), `a=${s.r?.a}`);
check('range end snapped to grid', s.r && onGrid(s.r.b), `b=${s.r?.b}`);
check('range spans the dragged beats', s.r && Math.round(s.r.a / geo.beat) === 20 && Math.round(s.r.b / geo.beat) === 28, JSON.stringify(s.r));
check('range:changed emitted on release', s.rc >= 1, `count=${s.rc}`);
// Reverse drag (right to left) snaps too.
s = await shiftDrag(tB + 4 * geo.beat, tA + 2 * geo.beat);
check('reverse ⇧-drag: both ends on grid', s.r && onGrid(s.r.a) && onGrid(s.r.b), JSON.stringify(s.r));
check('reverse ⇧-drag: correct span 22..32', s.r && Math.round(s.r.a / geo.beat) === 22 && Math.round(s.r.b / geo.beat) === 32, JSON.stringify(s.r));

// 3: click on ruler (seek) then ⇧-click → range playhead..click
await ev(() => { window.oscine.app.timeline.range = null; window.oscine.app.timeline.prevRange = null; });
await page.mouse.click(X(8 * geo.beat + 0.3 * geo.beat), rulerY);
await page.waitForTimeout(80);
const ph = await ev(() => window.oscine.app.transport.songPos);
await page.keyboard.down('Shift'); await page.mouse.click(X(16 * geo.beat + 0.3 * geo.beat), rulerY); await page.keyboard.up('Shift');
await page.waitForTimeout(100);
s = await ev(() => ({ r: window.oscine.app.timeline.range }));
check('click then ⇧-click makes playhead→click range', s.r && Math.abs(s.r.a - ph) < 1e-6 && Math.round(s.r.b / geo.beat) === 16, `ph=${ph} r=${JSON.stringify(s.r)}`);

// 4: small drag (~6 px) still a drag, not reinterpreted as a ⇧-click
await ev(() => { window.oscine.app.timeline.range = null; window.oscine.app.timeline.prevRange = null; window.oscine.app.transport.songPos = 0; });
const small = 12 / geo.pps; // 12 px
s = await shiftDrag(40 * geo.beat, 40 * geo.beat + small, ['Shift'], 4);
check('short ⇧-drag stays anchored at press (not extended from playhead 0)', !s.r || s.r.a > 30 * geo.beat, JSON.stringify(s.r));

// 5: ⌘ bypasses snap
await ev(() => { window.oscine.app.timeline.range = null; });
s = await shiftDrag(tA, tB, ['Shift', 'Meta']);
check('⌘+⇧-drag is unsnapped', s.r && !onGrid(s.r.b) && Math.abs(s.r.b - tB) < 2 / geo.pps, JSON.stringify(s.r));

await ev(() => { window.oscine.app.timeline.range = null; });
// --- Edge vs playhead (2026-09-23 round 3) ---
// Setup: range 20..28 beats, playhead parked ON its left edge (the usual state
// right after making a range).
const B = geo.beat;
const setup = () => ev(([a, b]) => { const { app } = window.oscine; app.timeline.range = { a, b }; app.transport.songPos = a; app.timeline.dirty = true; }, [20 * B, 28 * B]);
const st = () => ev(() => ({ r: window.oscine.app.timeline.range, ph: window.oscine.app.transport.songPos }));
async function dragAt(y, from, to, mods = []) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(X(from), y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(X(from) + (X(to) - X(from)) * k / 8, y);
  await page.mouse.up();
  for (const m of [...mods].reverse()) await page.keyboard.up(m);
  await page.waitForTimeout(100);
  return st();
}
const laneY = await ev(() => { const tl = window.oscine.app.timeline; return tl.canvas.getBoundingClientRect().top + tl.laneY(0) + 20; });
await setup();
// (a) ruler tick row, right edge (the left edge there is under the triangle):
// plain drag moves the boundary, playhead stays
s = await dragAt(geo.top + 12, 28 * B, 25 * B);
check('ruler: plain drag on an edge moves the boundary', s.r && Math.round(s.r.b / B) === 25 && Math.round(s.r.a / B) === 20, JSON.stringify(s.r));
check('ruler: plain edge drag leaves the playhead', Math.abs(s.ph - 20 * B) < 1e-6, `ph=${(s.ph / B).toFixed(2)} beats`);
// (b) same through the lanes
await setup();
s = await dragAt(laneY, 20 * B, 17 * B);
check('lanes: plain drag on left edge moves the boundary', s.r && Math.round(s.r.a / B) === 17, JSON.stringify(s.r));
check('lanes: plain edge drag leaves the playhead', Math.abs(s.ph - 20 * B) < 1e-6, `ph=${(s.ph / B).toFixed(2)}`);
// (c) ⇧-drag on the edge: boundary AND playhead move together
await setup();
s = await dragAt(laneY, 20 * B, 18 * B, ['Shift']);
check('⇧-drag on edge moves the boundary', s.r && Math.round(s.r.a / B) === 18 && Math.round(s.r.b / B) === 28, JSON.stringify(s.r));
check('⇧-drag on edge pulls the playhead with it', Math.abs(s.ph - s.r?.a) < 1e-6, `ph=${(s.ph / B).toFixed(2)} a=${(s.r?.a / B).toFixed(2)}`);
// (d) the triangle (tick row) moves ONLY the playhead
await setup();
s = await dragAt(geo.top + 8, 20 * B, 24 * B);
check('triangle drag moves the playhead', Math.abs(s.ph / B - 24) < 0.6, `ph=${(s.ph / B).toFixed(2)}`);
check('triangle drag leaves the range alone', s.r && Math.abs(s.r.a - 20 * B) < 1e-6 && Math.abs(s.r.b - 28 * B) < 1e-6, JSON.stringify(s.r));
// (e) right edge plain drag
await setup();
s = await dragAt(laneY, 28 * B, 31 * B);
check('right edge plain drag', s.r && Math.round(s.r.b / B) === 31 && Math.round(s.r.a / B) === 20 && Math.abs(s.ph - 20 * B) < 1e-6, JSON.stringify(s));
// (f) without a range, the playhead line in the lanes still scrubs
await ev(() => { window.oscine.app.timeline.range = null; window.oscine.app.transport.songPos = 20 * 60 / (window.oscine.store.project.bpm || 120); });
s = await dragAt(laneY, 20 * B, 23 * B);
check('no range: playhead line drag scrubs', !s.r && Math.abs(s.ph / B - 23) < 0.6, JSON.stringify(s));
await ev(() => { window.oscine.app.timeline.range = null; });
const sb = await ev(() => { const st = document.querySelector('.lyrics-strip'); if (!st) return null; const cs = getComputedStyle(st); return { sw: cs.scrollbarWidth, hBar: st.offsetHeight - st.clientHeight }; });
check('lyrics strip: no scrollbar', sb && sb.sw === 'none' && sb.hBar === 0, JSON.stringify(sb));
// Lyrics auto-scroll: step the playhead through every 7th word; the lit word
// must be fully inside the strip's visible box each time (it used to be
// scrolled past, off the left edge, by the picker's width).
const lyr = await ev(async () => {
  const { app } = window.oscine, lb = app.lyrics, st = lb.strip;
  st.style.scrollBehavior = 'auto'; // measure final positions, not the animation
  const bad = []; let n = 0;
  for (let i = 0; i < lb.words.length; i += 7) {
    lb.onFrame({ sec: lb.words[i].s + 0.01 });
    const w = lb.words[lb.current]; if (!w) continue; n++;
    const a = w.el.getBoundingClientRect(), b = st.getBoundingClientRect();
    if (a.left < b.left - 1 || a.right > b.right + 1) bad.push({ i, word: w.word, l: Math.round(a.left - b.left), r: Math.round(b.right - a.right) });
  }
  st.style.scrollBehavior = '';
  return { n, bad: bad.slice(0, 5), nbad: bad.length, words: lb.words.length };
});
check(`lyrics auto-scroll keeps the lit word visible (${lyr.n} samples of ${lyr.words} words)`, lyr.n > 5 && lyr.nbad === 0, JSON.stringify(lyr.bad));
check('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed ? 1 : 0);
