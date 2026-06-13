// Dependency-free control widgets. Every widget returns { root, set(v) }
// so external state changes (undo, preset load) can sync the visuals.
// Convention: onInput fires continuously during a drag, onCommit once at
// the end of the gesture.

import { clamp, norm, denorm, roundTo } from '../core/util.js';

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmtValue(v, o) {
  if (o.format) return o.format(v);
  const abs = Math.abs(v);
  let s;
  if (o.step && o.step >= 1) s = String(Math.round(v));
  else if (abs >= 1000) s = (v / 1000).toFixed(1) + 'k';
  else if (abs >= 100) s = v.toFixed(0);
  else if (abs >= 10) s = v.toFixed(1);
  else s = v.toFixed(2);
  return o.unit ? `${s}${o.unit}` : s;
}

// -- Knob: vertical-drag rotary with SVG arc ------------------------------

const ARC_SWEEP = 270;
const R = 13;
const CIRC = 2 * Math.PI * R;

function arcDash(n) {
  const frac = (ARC_SWEEP / 360) * n;
  return `${CIRC * frac} ${CIRC}`;
}

export function Knob(o) {
  const min = o.min, max = o.max, curve = o.curve || 'lin';
  let value = o.value ?? o.default ?? min;
  const defaultValue = o.default ?? value;

  const root = el('div', 'knob' + (o.small ? ' knob-sm' : ''));
  root.innerHTML = `
    <svg viewBox="0 0 34 34">
      <circle class="knob-track" cx="17" cy="17" r="${R}"
        stroke-dasharray="${arcDash(1)}" />
      <circle class="knob-fill" cx="17" cy="17" r="${R}" />
      <line class="knob-needle" x1="17" y1="17" x2="17" y2="5.5" />
    </svg>`;
  const fill = root.querySelector('.knob-fill');
  const needle = root.querySelector('.knob-needle');
  const valueEl = el('div', 'knob-value');
  const labelEl = el('div', 'knob-label', o.label || '');
  root.appendChild(valueEl);
  if (o.label) root.appendChild(labelEl);
  if (o.color) fill.style.stroke = o.color;

  function paint() {
    const n = norm(value, min, max, curve);
    fill.setAttribute('stroke-dasharray', arcDash(n));
    const angle = -135 + n * ARC_SWEEP;
    needle.setAttribute('transform', `rotate(${angle} 17 17)`);
    valueEl.textContent = fmtValue(value, o);
  }

  function setFromNorm(n) {
    let v = denorm(n, min, max, curve);
    if (o.step) v = clamp(roundTo(v, o.step), min, max);
    if (v !== value) {
      value = v;
      paint();
      o.onInput?.(value);
    }
  }

  let startY = 0, startNorm = 0, dragging = false;
  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startNorm = norm(value, min, max, curve);
    root.setPointerCapture(e.pointerId);
    root.classList.add('active');
  });
  root.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const scale = e.shiftKey ? 900 : 160;
    setFromNorm(clamp(startNorm + (startY - e.clientY) / scale, 0, 1));
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('active');
    o.onCommit?.(value);
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  root.addEventListener('dblclick', () => {
    value = defaultValue;
    paint();
    o.onInput?.(value);
    o.onCommit?.(value);
  });
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    const n = norm(value, min, max, curve);
    setFromNorm(clamp(n - Math.sign(e.deltaY) * 0.03, 0, 1));
    o.onCommit?.(value);
  }, { passive: false });

  paint();
  return {
    root,
    set(v) { value = clamp(v, min, max); paint(); },
    get value() { return value; },
  };
}

// -- Fader: vertical slider --------------------------------------------------

export function Fader(o) {
  let value = clamp(o.value ?? 0.8, 0, 1);
  const root = el('div', 'fader');
  const track = el('div', 'fader-track');
  const fillBar = el('div', 'fader-fill');
  const cap = el('div', 'fader-cap');
  track.appendChild(fillBar);
  track.appendChild(cap);
  root.appendChild(track);

  function paint() {
    const pct = value * 100;
    cap.style.bottom = `calc(${pct}% - 6px)`;
    fillBar.style.height = `${pct}%`;
  }

  function setFromEvent(e) {
    const rect = track.getBoundingClientRect();
    const n = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
    value = n;
    paint();
    o.onInput?.(value);
  }

  let dragging = false;
  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true;
    root.setPointerCapture(e.pointerId);
    setFromEvent(e);
  });
  root.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    o.onCommit?.(value);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('dblclick', () => {
    value = o.default ?? 0.8;
    paint();
    o.onInput?.(value);
    o.onCommit?.(value);
  });

  paint();
  return { root, set(v) { value = clamp(v, 0, 1); paint(); }, get value() { return value; } };
}

// -- Select -------------------------------------------------------------------

export function Select(o) {
  const root = el('div', 'select-wrap');
  if (o.label) root.appendChild(el('div', 'knob-label', o.label));
  const sel = el('select', 'select');
  for (const opt of o.options) {
    const e = el('option', null, opt.label);
    e.value = String(opt.value);
    sel.appendChild(e);
  }
  sel.value = String(o.value);
  sel.addEventListener('change', () => {
    const raw = sel.value;
    const match = o.options.find(x => String(x.value) === raw);
    o.onChange?.(match ? match.value : raw);
  });
  root.appendChild(sel);
  return { root, set(v) { sel.value = String(v); } };
}

// -- Buttons --------------------------------------------------------------------

export function Btn(label, onClick, cls = '') {
  const b = el('button', `btn ${cls}`.trim(), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

export function ToggleBtn(o) {
  const b = el('button', `btn tgl ${o.cls || ''}`.trim(), o.label);
  b.type = 'button';
  if (o.title) b.title = o.title;
  let active = !!o.active;
  const paint = () => b.classList.toggle('on', active);
  b.addEventListener('click', () => {
    active = !active;
    paint();
    o.onChange?.(active);
  });
  paint();
  return { root: b, set(v) { active = !!v; paint(); } };
}

// -- NumberDrag: draggable numeric readout (BPM etc.) ------------------------------

export function NumberDrag(o) {
  let value = o.value;
  const root = el('div', 'numdrag');
  if (o.title) root.title = o.title;
  const paint = () => { root.textContent = (o.format ? o.format(value) : value) + (o.suffix || ''); };

  let dragging = false, startY = 0, startVal = 0, moved = false;
  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true; moved = false;
    startY = e.clientY; startVal = value;
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 2) moved = true;
    const step = o.step ?? 1;
    const fine = e.shiftKey ? 0.2 : 1;
    const v = clamp(roundTo(startVal + dy * step * 0.5 * fine, step), o.min, o.max);
    if (v !== value) { value = v; paint(); o.onInput?.(value); }
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    if (moved) o.onCommit?.(value);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  root.addEventListener('dblclick', () => {
    const input = el('input', 'numdrag-edit');
    input.value = String(value);
    root.textContent = '';
    root.appendChild(input);
    input.focus();
    input.select();
    const commit = () => {
      const v = parseFloat(input.value);
      if (!Number.isNaN(v)) {
        value = clamp(v, o.min, o.max);
        o.onInput?.(value);
        o.onCommit?.(value);
      }
      paint();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = String(value); input.blur(); }
      e.stopPropagation();
    });
  });

  paint();
  return { root, set(v) { value = v; paint(); } };
}

// -- Meter: peak level bar with fall-back ----------------------------------------

export function Meter(o = {}) {
  const root = el('div', 'meter' + (o.horizontal ? ' meter-h' : ''));
  const fillBar = el('div', 'meter-fill');
  root.appendChild(fillBar);
  let shown = 0;
  return {
    root,
    set(level) {
      shown = Math.max(level, shown * 0.9);
      const pct = clamp(Math.pow(shown, 0.6) * 100, 0, 100);
      if (o.horizontal) fillBar.style.width = pct + '%';
      else fillBar.style.height = pct + '%';
      root.classList.toggle('hot', shown > 0.95);
    },
  };
}

// -- Popover menu -------------------------------------------------------------------

export function openMenu(anchor, items) {
  closeMenus();
  const menu = el('div', 'menu');
  for (const item of items) {
    const row = el('button', 'menu-item', item.label);
    row.type = 'button';
    row.addEventListener('click', () => {
      closeMenus();
      item.onPick();
    });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = (r.bottom + 4) + 'px';
  setTimeout(() => {
    const dismiss = (e) => {
      if (!menu.contains(e.target)) closeMenus();
    };
    document.addEventListener('pointerdown', dismiss, { once: true, capture: true });
  }, 0);
}

export function closeMenus() {
  document.querySelectorAll('.menu').forEach(m => m.remove());
}

// -- Toast ------------------------------------------------------------------------------

export function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = el('div', 'toast', msg);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2200);
}
