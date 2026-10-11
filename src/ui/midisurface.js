// The controller surface panel: draws the detected controller as its segments (knobs, faders, pads, keys, buttons,
// sticks) that light up live as Chaz touches them, each showing what it is bound to. Docked + non-modal on purpose:
// binding means looking at the rest of Oscine while this is open. Click a control here to arm it, then click any UI
// control in Oscine (or touch hardware first, then click): that is the whole binding flow.
import { el } from './widgets.js';
import { srcKey, srcLabel } from '../core/midisrc.js';
import { allControls, listProfiles, profileById, GENERIC, controlIndex } from '../core/controllers/index.js';
import { targetLabel, asTarget, defaultMap } from '../core/midimap.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const isBlack = (n) => [1, 3, 6, 8, 10].includes(n % 12);
const KIND_ICON = { knob: '◉', fader: '▮', pad: '▦', button: '◘', encoder: '◎', xy: '✥', pitchbend: '↕', modwheel: '≋', aftertouch: '⇣', key: '♪' };

export class MidiSurface {
  constructor(app) {
    this.app = app; this.store = app.store; this.bus = app.bus;
    this.map = app.midiMap;
    this.root = null;
    this.cells = new Map();          // sourceKey -> element(s) lit by live touches
    const rerender = () => { if (this.root) this.render(); };
    for (const ev of ['midi:surface', 'midi:status', 'midi:config', 'midi:wizard', 'midi:check', 'midi:profiles', 'ui:selection']) this.bus.on(ev, rerender);
    // Binding needs the rest of the app in view: shrink the panel the moment a control is armed (from either side),
    // restore it when the binding lands. The user can still toggle it by hand.
    this.bus.on('midi:bind', (e) => { if (e.armedSource || e.armedTarget) this.min = true; rerender(); });
    this.bus.on('midi:bound', () => { this.min = false; rerender(); });
    this.bus.on('midi:touch', (e) => this.light(e));
    this.hold = null;
    this.onKey = (e) => { if (e.key === 'Escape' && this.root) { if (this.store.ui.midi.bindMode) this.map.setBindMode(false); else this.close(); } };
    window.addEventListener('keydown', this.onKey);
  }

  // Drag the panel by its header (position kept for the session). Pointer events, so touch works too.
  dragger(head) {
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = this.root.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const x = Math.max(0, Math.min(innerWidth - 60, ev.clientX - dx)), y = Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy));
        Object.assign(this.root.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
        this.pos = { left: x, top: y };
      };
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up);
    });
    head.classList.add('drag');
    if (this.pos) Object.assign(this.root.style, { left: this.pos.left + 'px', top: this.pos.top + 'px', right: 'auto', bottom: 'auto' });
  }

  get isOpen() { return !!this.root; }
  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    if (this.root) return;
    this.root = el('aside', 'msurf');
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', 'MIDI controller surface');
    document.body.appendChild(this.root);
    document.body.classList.add('msurf-open');
    // The surface fades its live lights; one timer for all of them (cheap, and zero cost while closed).
    this.timer = setInterval(() => this.fade(), 80);
    this.render();
  }

  close() {
    if (!this.root) return;
    if (this.store.ui.midi.bindMode) this.map.setBindMode(false);
    clearInterval(this.timer);
    this.root.remove(); this.root = null; this.cells.clear();
    document.body.classList.remove('msurf-open');
  }

  // -- live lights -----------------------------------------------------------------------------------------------------
  light(e) {
    if (!this.root) return;
    const targets = this.cells.get(String(e.key).split('@')[0]);       // cells are keyed without the channel
    for (const c of targets || []) {
      c.classList.add('hot'); c._hot = performance.now();
      c.style.setProperty('--v', String(Math.round(e.v * 100) / 100));
      if (c._val) c._val.textContent = String(Math.round(e.v * 127));
    }
    if (this.feedEl) this.paintFeed();
  }
  fade() {
    const now = performance.now();
    for (const set of this.cells.values()) for (const c of set) if (c._hot && now - c._hot > 700) { c.classList.remove('hot'); c._hot = 0; }
  }

  // -- render ----------------------------------------------------------------------------------------------------------
  render() {
    const root = this.root; if (!root) return;
    const m = this.store.ui.midi, map = this.map;
    const keep = root.querySelector('.msurf-body')?.scrollTop || 0;
    this.cells.clear();
    root.textContent = '';
    root.classList.toggle('binding', !!m.bindMode);
    root.classList.toggle('min', !!this.min);
    root.classList.toggle('phys', !!(this.map.profile && this.map.profile.layout && !this.map.profile.generic));

    // header: what is plugged in
    const head = el('div', 'msurf-head');
    const title = el('div', 'msurf-title');
    const prof = m.profile;
    if (!m.enabled) title.append(el('span', 'msurf-dev', 'MIDI is off'));
    else if (!m.available) title.append(el('span', 'msurf-dev', 'No Web MIDI in this browser'));
    else if (!prof) title.append(el('span', 'msurf-dev', m.owner === false && m.peers > 1 ? 'MIDI is held by another Oscine tab' : 'No controller detected — plug one in'));
    else {
      title.append(el('span', 'msurf-dev', prof.name));
      if (prof.maker) title.append(el('span', 'msurf-maker', prof.maker));
      title.append(el('span', 'msurf-chip ' + (prof.generic ? 'warn' : prof.verified ? 'good' : ''), prof.generic ? 'unknown device' : prof.custom ? 'your map' : prof.verified ? 'verified' : 'default layout, unverified'));
    }
    const x = el('button', 'btn mini msurf-x', '×'); x.type = 'button'; x.title = 'Close (Esc)'; x.addEventListener('click', () => this.close());
    const mn = el('button', 'btn mini msurf-min', this.min ? '▴' : '▾'); mn.type = 'button'; mn.title = this.min ? 'Expand' : 'Shrink so you can see the app (drag the title to move it)';
    mn.addEventListener('click', () => { this.min = !this.min; this.render(); });
    head.append(title, mn, x);
    this.dragger(head);
    root.append(head);

    // device row: inputs and outputs, so "is my controller seen" is answerable at a glance
    const ins = (m.devices || []), outs = (m.outputs || []);
    if (ins.length || outs.length) {
      const dev = el('div', 'msurf-devs');
      for (const d of ins) {
        const b = el('button', 'msurf-d' + (d.id === m.inputId ? ' on' : ''), `⇥ ${d.name}`); b.type = 'button';
        b.title = `${d.maker || 'MIDI input'}${d.id === m.inputId ? ' (bound)' : ' — click to use'}`;
        b.addEventListener('click', () => this.store.configureMidi({ inputId: d.id }));
        dev.append(b);
      }
      for (const d of outs) { const o = el('span', 'msurf-d out', `⇤ ${d.name}`); o.title = 'MIDI output (LED feedback)'; dev.append(o); }
      root.append(dev);
    }

    // toolbar
    const bar = el('div', 'msurf-bar');
    const bind = el('button', 'btn' + (m.bindMode ? ' accent' : ''), m.bindMode ? '● Binding — click a control' : 'Bind controls'); bind.type = 'button';
    bind.title = 'Touch a control on your controller, then click what it should drive in Oscine (or click one here first)';
    bind.addEventListener('click', () => map.setBindMode(!m.bindMode));
    if (prof && !prof.generic && !m.wizard) {
      const chk = el('button', 'btn' + (map.check ? ' accent' : ''), map.check ? '● Checking…' : (prof.custom || prof.verified ? 'Check again' : 'Check my controller')); chk.type = 'button';
      chk.title = 'One minute: touch each control and Oscine confirms or corrects what this layout says it sends';
      chk.addEventListener('click', () => (map.check ? map.cancelCheck() : map.startCheck()));
      bar.append(chk);
    }
    const wiz = el('button', 'btn', m.wizard ? 'Mapping…' : 'Map my controller'); wiz.type = 'button';
    wiz.title = 'Teach Oscine a controller it doesn\'t know: wiggle everything, name it, save';
    wiz.addEventListener('click', () => (m.wizard ? map.cancelWizard() : map.startWizard()));
    bar.append(bind, wiz);
    if (prof && !prof.generic) {
      const rs = el('button', 'btn', 'Reset to defaults'); rs.type = 'button'; rs.title = 'Rebuild the starter map for this device (replaces your bindings for its controls)';
      rs.addEventListener('click', () => { const n = map.applyDefaults(prof, true); this.hint(`Default map applied (${n} controls)`); });
      bar.append(rs);
    }
    const exp = el('button', 'btn', 'Export'); exp.type = 'button'; exp.title = 'Copy the bindings + profile as JSON';
    exp.addEventListener('click', () => this.exportJson());
    const clr = el('button', 'btn', 'Clear'); clr.type = 'button'; clr.title = 'Remove every binding';
    clr.addEventListener('click', () => { this.store.configureMidi({ knobs: {} }); this.hint('All bindings cleared'); });
    bar.append(exp, clr);
    root.append(bar);

    // status line (bind mode instructions / last result)
    this.hintEl = el('div', 'msurf-hint');
    root.append(this.hintEl);
    this.paintHint();

    const body = el('div', 'msurf-body');
    if (m.wizard) body.append(this.wizardView());
    else if (map.check) { body.append(this.checkView()); body.append(...this.surfaceView(map.check.profile)); }
    else if (prof && map.profile) body.append(...this.surfaceView(map.profile));   // the store holds a summary; the layout is map.profile
    else body.append(el('div', 'msurf-empty', m.enabled ? 'Plug in a MIDI controller. Known ones get a starter map the moment they appear; anything else you can teach with “Map my controller”.' : 'Turn MIDI on from the MIDI button to see your controller here.'));
    root.append(body);
    body.scrollTop = keep;

    // recent touches
    this.feedEl = el('div', 'msurf-feed');
    root.append(this.feedEl);
    this.paintFeed();
  }

  paintHint() {
    const m = this.store.ui.midi, map = this.map;
    if (!this.hintEl) return;
    let t = '';
    if (m.bindMode) {
      if (map.armedSource) t = `${map.armedSource.label} armed — now click what it should control in Oscine`;
      else if (map.armedTarget) t = `${map.armedTargetLabel || 'Control'} picked — now touch the control on your controller`;
      else t = 'Touch a control on your controller, then click a knob, fader or button in Oscine. Or click a control below first.';
    } else if (this.msg) t = this.msg;
    this.hintEl.textContent = t; this.hintEl.classList.toggle('on', !!t);
  }
  hint(msg) { this.msg = msg; this.paintHint(); clearTimeout(this._mt); this._mt = setTimeout(() => { this.msg = ''; this.paintHint(); }, 3500); }

  paintFeed() {
    if (!this.feedEl) return;
    const f = this.map.feed.slice(-4).reverse();
    this.feedEl.textContent = '';
    if (!f.length) { this.feedEl.append(el('span', 'msurf-feed-empty', 'Touch something on the controller…')); return; }
    for (const e of f) {
      const row = el('div', 'msurf-feed-row' + (e.bound ? '' : ' unbound'));
      row.append(el('span', 'msurf-feed-src', e.label), el('span', 'msurf-feed-v', String(Math.round(e.v * 127))), el('span', 'msurf-feed-to', e.waiting ? 'waiting to pick up…' : (e.bound || 'not bound')));
      this.feedEl.append(row);
    }
  }

  // -- the controller, segment by segment -----------------------------------------------------------------------------
  surfaceView(profile) {
    const out = [];
    const knobs = this.store.ui.midi.knobs, ctx = { store: this.store, transport: this.app.transport, engine: this.app.engine, api: this.app.api };
    const boundOf = (key) => knobs[key] ?? knobs[key.split('@')[0]] ?? null;
    let segs = profile.segments || [];
    if (profile.generic) {
      // Unknown device: draw what it has sent so far, so something appears the moment a control is touched.
      const heard = this.map.heard.buildProfile({ name: 'heard', deviceName: this.map.deviceName || 'device' });
      segs = [...heard.segments, ...segs.filter((s) => s.kind === 'keys' && !heard.segments.some((h) => h.kind === 'keys'))];
      if (!heard.segments.length) out.push(el('div', 'msurf-empty', 'Unknown controller. Move a knob or press a pad and it appears here — or use “Map my controller” to name and save it.'));
    }
    // A profile may carry a physical layout (profile.layout: CSS grid columns + named areas); then the controller is
    // drawn the way it sits on the desk: joystick top-left, pads in the middle, knobs right, keys along the bottom.
    // Pad banks share one area; the bank on show is a tab (bank A by default).
    const L = !profile.generic && profile.layout && segs.every((sg) => sg.area) ? profile.layout : null;
    const bankShown = this.bank || 'A';
    const wrap = L ? el('div', 'msurf-phys') : null;
    if (wrap) { wrap.style.gridTemplateColumns = L.cols; wrap.style.gridTemplateAreas = L.areas.map((r) => `"${r}"`).join(' '); }
    for (const sg of segs) {
      if (L && sg.bank && sg.bank !== bankShown) continue;
      const box = el('section', 'msurf-seg msurf-' + sg.kind + (sg.local ? ' local' : ''));
      if (L) box.style.gridArea = sg.area;
      const head = el('div', 'msurf-seg-h', sg.label || sg.id);
      if (L && sg.bank) {
        const tab = el('button', 'msurf-bank', `Bank ${sg.bank}`); tab.type = 'button'; tab.title = 'Show the other pad bank (the BANK A/B button on the controller switches which one the hardware sends)';
        tab.addEventListener('click', () => { this.bank = sg.bank === 'A' ? 'B' : 'A'; this.render(); });
        head.append(tab);
      }
      box.append(head);
      if (sg.kind === 'keys') box.append(this.keysView(sg, boundOf));
      else {
        const grid = el('div', 'msurf-grid');
        grid.style.setProperty('--cols', String(sg.cols || Math.min(8, (sg.controls || []).length || 1)));
        const list = sg.order === 'mpc' ? mpcOrder(sg.controls || [], sg.cols || 4) : (sg.controls || []);
        for (const c of list) grid.append(this.controlView(sg, c, boundOf, ctx));
        box.append(grid);
      }
      if (wrap) wrap.append(box); else out.push(box);
    }
    if (wrap) out.push(wrap);
    return out;
  }

  controlView(sg, c, boundOf, ctx) {
    if (c.local) {                                   // a button that works inside the controller and sends nothing
      const w = el('div', 'msurf-c k-button local'); w.title = (c.title ? c.title + '. ' : '') + 'Works inside the controller and sends no MIDI, so Oscine can\'t see or map it.';
      w.append(el('div', 'msurf-face', '◘'), el('div', 'msurf-lbl', c.label));
      return w;
    }
    const key = c.src ? srcKey(c.src) : null;
    const bound = key ? boundOf(key) : null;
    const st = this.map.check ? this.map.check.stateOf(sg.id, c.id) : null;
    const isNow = this.map.check && this.map.check.current && this.map.check.current.seg === sg.id && this.map.check.current.ctl === c.id;
    const wrap = el('div', `msurf-c k-${c.kind}` + (bound ? ' bound' : '') + (key ? '' : ' slot') + (this.map.armedSource?.key === key && key ? ' armed' : ''));
    const bare = key ? key.split('@')[0] : null;          // lights and the unbind lookup ignore the channel
    wrap.dataset.src = bare || '';
    if (st) wrap.classList.add('chk-' + st);
    if (isNow) wrap.classList.add('chk-now');
    if (!this.map.check && key && c.src && c.verified === false) wrap.classList.add('unverified');
    const face = el('div', 'msurf-face');
    face.append(el('span', 'msurf-ico', KIND_ICON[c.kind] || '•'));
    const val = el('span', 'msurf-val', ''); face.append(val); wrap._val = val;
    wrap.append(face, el('div', 'msurf-lbl', c.short || c.label));
    const tgt = bound ? targetLabel(ctx, bound) : (key ? '' : 'tap, then touch it');
    const t = el('div', 'msurf-to', tgt); wrap.append(t);
    if (bound) {
      const un = el('button', 'msurf-un', '×'); un.type = 'button'; un.title = 'Unbind';
      un.addEventListener('click', (e) => { e.stopPropagation(); this.store.unbindMidi(key); this.hint(`${c.label} unbound`); });
      wrap.append(un);
      wrap.title = `${srcLabel(c.src)} → ${tgt}`;
    } else wrap.title = key ? `${srcLabel(c.src)} — click to bind, then click a control in Oscine` : 'This control\'s message isn\'t known yet: click it, then touch it on the controller';
    wrap.addEventListener('click', () => {
      if (this.map.check) { const n = this.map.check.steps.findIndex((x) => x.seg === sg.id && x.ctl === c.id); if (n >= 0) this.map.checkRedo(n); return; }   // in a check, a click means "do this one next"
      if (!key) { this.map.armSlot(sg.id, c.id); this.hint(`Touch ${c.label} on the controller…`); return; }
      this.map.armSource({ key, t: c.src.t, n: c.src.n, ch: c.src.ch, label: c.label, kind: c.kind });
      if (!this.store.ui.midi.bindMode) this.map.setBindMode(true), this.map.armSource({ key, t: c.src.t, n: c.src.n, ch: c.src.ch, label: c.label, kind: c.kind });
    });
    if (bare) { if (!this.cells.has(bare)) this.cells.set(bare, new Set()); this.cells.get(bare).add(wrap); }
    return wrap;
  }

  keysView(sg, boundOf) {
    const [lo, hi] = sg.range || [48, 72];
    const wrap = el('div', 'msurf-keys');
    for (let n = lo; n <= hi; n++) {
      const k = el('div', 'msurf-key' + (isBlack(n) ? ' black' : ''));
      k.title = NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
      const key = srcKey({ t: 'note', n });
      if (n % 12 === 0) k.classList.add('c');
      if (boundOf(key)) k.classList.add('bound');
      if (this.map.check) { const ks = this.map.check.steps.find((x) => x.id === 'keys'); if (ks) k.classList.add('chk-' + ks.state); }
      if (!this.cells.has(key)) this.cells.set(key, new Set()); this.cells.get(key).add(k);
      wrap.append(k);
    }
    return wrap;
  }

  // -- "Check my controller" ----------------------------------------------------------------------------------------------
  // One prompt at a time ("Turn K1"), the controls on the surface below colour in as they're confirmed (green) or
  // corrected (amber). Click any control to do it next; Skip leaves it unchecked. Finish saves the checked profile.
  checkView() {
    const c = this.map.check, box = el('div', 'msurf-check');
    const n = c.counts, done = n.ok + n.fixed;
    const head = el('div', 'msurf-check-h');
    head.append(el('span', 'msurf-check-t', c.finished ? 'All checked' : 'Check my controller'), el('span', 'msurf-check-n', `${done + n.skipped} / ${c.total}`));
    box.append(head);
    const bar = el('div', 'msurf-check-bar'); const fill = el('i'); fill.style.width = `${Math.round(((done + n.skipped) / Math.max(1, c.total)) * 100)}%`; bar.append(fill); box.append(bar);
    const cur = c.current;
    box.append(el('div', 'msurf-check-now', cur ? cur.prompt : 'That was everything. Save it to keep the checked layout.'));
    const r = this.map.checkLast;
    if (r && r.step) {
      const what = { ok: 'matches', other: 'matches', fixed: `is different from the layout: now ${c.fixes().find((f) => f.step === r.step.label)?.now ?? 'updated'}` }[r.kind];
      if (what) box.append(el('div', 'msurf-check-last ' + (r.kind === 'fixed' ? 'fix' : 'ok'), `${r.step.label} ${what}`));
    } else if (r && r.kind === 'stray') box.append(el('div', 'msurf-check-last stray', 'That was a different kind of control. Waiting for the one above.'));
    else if (r && r.kind === 'bankb') box.append(el('div', 'msurf-check-last stray', 'Bank B pad: noted, not part of this check.'));
    const act = el('div', 'msurf-check-act');
    if (cur) {
      const sk = el('button', 'btn', 'Skip'); sk.type = 'button'; sk.title = 'This control stays unchecked'; sk.addEventListener('click', () => this.map.checkSkip());
      act.append(sk);
    }
    const fin = el('button', 'btn accent', c.finished ? 'Save' : 'Finish now'); fin.type = 'button';
    fin.title = 'Keep what has been checked so far as your layout for this controller';
    fin.addEventListener('click', async () => { const p = await this.map.finishCheck(); this.hint(p ? `Saved. ${p.checked.ok} confirmed, ${p.checked.fixed} corrected, ${p.checked.skipped} skipped` : 'Nothing was checked'); });
    const cx = el('button', 'btn', 'Cancel'); cx.type = 'button'; cx.addEventListener('click', () => this.map.cancelCheck());
    act.append(fin, cx); box.append(act);
    if (n.fixed) {
      const fx = el('div', 'msurf-check-fixes');
      for (const f of c.fixes()) fx.append(el('div', '', `${f.step}: ${f.was ?? '?'} → ${f.now}`));
      box.append(fx);
    }
    return box;
  }

  // -- the wizard ------------------------------------------------------------------------------------------------------
  wizardView() {
    const w = this.store.ui.midi.wizard, map = this.map;
    const box = el('div', 'msurf-wiz');
    box.append(el('div', 'msurf-wiz-h', 'Map my controller'));
    box.append(el('div', 'msurf-wiz-p', 'Move every knob and fader, press every pad and button, bend the stick and play a few keys. Each thing you touch appears below with what it looks like.'));
    const list = el('div', 'msurf-wiz-list');
    if (!w.sources.length) list.append(el('div', 'msurf-feed-empty', 'Waiting for the first touch…'));
    for (const s of w.sources) {
      const row = el('div', 'msurf-wiz-row');
      row.append(el('span', 'msurf-wiz-src', s.label), el('span', 'msurf-wiz-kind' + (s.sure ? '' : ' guess'), s.kind + (s.rel ? ` (${s.rel})` : '') + (s.sure ? '' : ' ?')), el('span', 'msurf-wiz-n', `×${s.count}`));
      list.append(row);
    }
    box.append(list);
    const name = el('input', 'msurf-wiz-name'); name.type = 'text'; name.placeholder = 'Name this controller'; name.value = w.name || '';
    name.addEventListener('input', () => { w.name = name.value; });
    name.addEventListener('keydown', (e) => e.stopPropagation());
    const save = el('button', 'btn accent', 'Save'); save.type = 'button';
    save.addEventListener('click', async () => { const p = await map.finishWizard(name.value); this.hint(p ? `Saved “${p.name}” — ${w.sources.length} controls` : 'Nothing was touched'); });
    const cancel = el('button', 'btn', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', () => map.cancelWizard());
    const row = el('div', 'msurf-wiz-act'); row.append(name, save, cancel);
    box.append(row);
    return box;
  }

  async exportJson() {
    const m = this.store.ui.midi;
    const doc = JSON.stringify({ device: m.inputName, profile: m.profile, bindings: m.knobs }, null, 2);
    try { await navigator.clipboard.writeText(doc); this.hint('Copied the bindings as JSON'); } catch { this.hint('Clipboard unavailable'); console.log(doc); }
  }
}

// MPC pad order: the bottom row is pads 1-4, the top row 5-8 etc.; draw top row first so the grid reads like the hardware.
function mpcOrder(list, cols) {
  const rows = [];
  for (let i = 0; i < list.length; i += cols) rows.push(list.slice(i, i + cols));
  return rows.reverse().flat();
}

export { allControls, listProfiles, profileById, GENERIC, controlIndex, asTarget, defaultMap };
