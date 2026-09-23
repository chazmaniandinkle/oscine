// Settings panel: a modal built entirely from core/prefs.js, so a new pref
// shows up here (and in the `settings` command) without touching this file.
// Open with the ⚙ toolbar button or ⌘, ; Esc or a click outside closes it.
// Also lists the active key scheme's bindings, so shortcuts are findable.
import { el } from './widgets.js';
import { PREFS, SECTIONS } from '../core/prefs.js';
import { keymap, ACTIONS } from '../core/keymap.js';

export class SettingsPanel {
  constructor(app) {
    this.app = app;
    this.prefs = app.prefs;
    this.root = null;
    this.prefs.onChange(() => { if (this.root) this.render(); });
    app.bus.on('keymap:changed', () => { if (this.root) this.render(); });
  }

  get isOpen() { return !!this.root; }
  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    if (this.root) return;
    this.root = el('div', 'settings-backdrop');
    this.root.addEventListener('pointerdown', (e) => { if (e.target === this.root) this.close(); });
    this.onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } };
    window.addEventListener('keydown', this.onKey, true);
    document.body.appendChild(this.root);
    this.render();
  }

  close() {
    if (!this.root) return;
    window.removeEventListener('keydown', this.onKey, true);
    this.root.remove(); this.root = null;
  }

  render() {
    const panel = el('div', 'settings');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Settings');
    const head = el('div', 'settings-head');
    head.append(el('div', 'settings-title', 'Settings'));
    const x = el('button', 'btn settings-close', '×'); x.type = 'button'; x.title = 'Close (Esc)';
    x.addEventListener('click', () => this.close());
    head.append(x);
    panel.append(head);
    const body = el('div', 'settings-body');
    for (const sec of SECTIONS) {
      const keys = Object.keys(PREFS).filter(k => PREFS[k].section === sec.id);
      if (!keys.length) continue;
      const box = el('section', 'settings-section');
      box.append(el('h3', 'settings-h', sec.label));
      for (const key of keys) box.append(this.row(key));
      if (sec.id === 'keys') box.append(this.shortcuts());
      body.append(box);
    }
    const foot = el('div', 'settings-foot');
    const reset = el('button', 'btn', 'Reset all to defaults'); reset.type = 'button';
    reset.addEventListener('click', () => this.prefs.reset());
    foot.append(el('span', 'settings-note', 'Saved in this browser. Claude can read and change these with the settings tool.'), reset);
    panel.append(body, foot);
    this.root.replaceChildren(panel);
  }

  row(key) {
    const d = PREFS[key], v = this.prefs.get(key);
    const row = el('label', 'settings-row');
    row.dataset.key = key;
    const text = el('div', 'settings-text');
    text.append(el('div', 'settings-label', d.label), el('div', 'settings-help', d.help || ''));
    let ctl;
    if (d.type === 'boolean') {
      ctl = el('input'); ctl.type = 'checkbox'; ctl.checked = v;
      ctl.addEventListener('change', () => this.prefs.set(key, ctl.checked));
    } else if (d.options) {
      ctl = el('select', 'select');
      for (const o of d.options) { const op = el('option', null, o.label); op.value = String(o.value); ctl.append(op); }
      ctl.value = String(v);
      ctl.addEventListener('change', () => {
        const o = d.options.find(o => String(o.value) === ctl.value);
        this.prefs.set(key, o ? o.value : ctl.value);
      });
    } else if (d.type === 'number') {
      ctl = el('input', 'settings-num'); ctl.type = 'number';
      if (d.min != null) ctl.min = d.min; if (d.max != null) ctl.max = d.max; if (d.step) ctl.step = d.step;
      ctl.value = v;
      ctl.addEventListener('change', () => { try { this.prefs.set(key, ctl.value); } catch { ctl.value = this.prefs.get(key); } });
    } else {
      ctl = el('input'); ctl.value = v;
      ctl.addEventListener('change', () => this.prefs.set(key, ctl.value));
    }
    ctl.classList.add('settings-ctl');
    const right = el('div', 'settings-right');
    right.append(ctl);
    if (d.suffix) right.append(el('span', 'settings-suffix', d.suffix.trim()));
    if (v !== d.default) {
      const r = el('button', 'btn settings-reset', '↺'); r.type = 'button'; r.title = `Reset to default (${d.default})`;
      r.addEventListener('click', (e) => { e.preventDefault(); this.prefs.reset(key); });
      right.append(r);
    }
    row.append(text, right);
    return row;
  }

  // Every bound action in the active scheme, grouped by scope.
  shortcuts() {
    const wrap = el('details', 'settings-keys');
    wrap.append(el('summary', null, `Shortcuts in this scheme (${keymap.scheme})`));
    const tbl = el('div', 'settings-keytable');
    for (const [action, meta] of Object.entries(ACTIONS)) {
      const k = keymap.label(action); if (!k) continue;
      tbl.append(el('span', 'settings-k', k), el('span', null, meta.label));
    }
    const g = keymap.gestures || {};
    const names = { 'timeline.rangeSelect': 'drag ruler → range', 'timeline.clipSlip': 'drag clip → slip', 'timeline.clipStretch': 'drag right edge → stretch', 'timeline.clipDuplicate': 'drag clip → duplicate', 'timeline.noSnap': 'hold while dragging → no snap', 'timeline.zoom': 'wheel → zoom' };
    for (const [n, label] of Object.entries(names)) {
      if (!(n in g)) continue;
      const mod = (g[n] || 'plain').replace('Mod', '⌘').replace('Shift', '⇧').replace('Alt', '⌥').replace(/\+/g, '');
      tbl.append(el('span', 'settings-k', mod), el('span', null, label));
    }
    wrap.append(tbl);
    return wrap;
  }
}
