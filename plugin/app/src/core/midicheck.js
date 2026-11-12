// "Check my controller": a one-minute guided pass over a built-in controller profile. The profile's numbers come from a
// published default program, not from the device, so this walks Chaz through each control ("Turn K1", "Hit PAD 3",
// "Push the joystick left, then right"), compares what the device REALLY sent with what the profile expects, confirms
// the ones that match and corrects the ones that don't. The result is a saved profile marked as checked.
//
// Pure (node-testable, no DOM). The browser glue is in src/ui/midimap.js, the checklist UI in src/ui/midisurface.js.
//
// Attribution rule: a message belongs to the CURRENT step. If it is exactly what the profile expects there, the step is
// confirmed. If the profile expects it from another control that is still unchecked, that other control is confirmed
// (Chaz went out of order) and the current step stays. Anything else of a compatible kind CORRECTS the current step
// (its source becomes what was heard). A source already settled by another step is ignored (a repeat or a bounce).
// Messages of an incompatible kind (a note while we want a knob) are stray: counted, never applied.

import { decodeMessage, srcKey, srcLabel, normOf } from './midisrc.js';
import { allControls } from './controllers/index.js';

const WANT = {                                    // control kind -> message types that can be that control
  knob: ['cc'], fader: ['cc'], encoder: ['cc'], modwheel: ['cc'], pitchbend: ['pb'], aftertouch: ['cp'],
  pad: ['note'], key: ['note'], button: ['cc', 'note', 'pc'], xy: ['cc'],
};

const same = (a, b) => !!a && !!b && a.t === b.t && (a.n ?? 0) === (b.n ?? 0) && (a.t !== 'note' || !a.ch || !b.ch || a.ch === b.ch);

export class ControllerCheck {
  constructor(profile) {
    this.profile = JSON.parse(JSON.stringify({ ...profile, match: undefined }));    // a private copy: corrections never touch the built-in
    this.steps = [];
    this.stray = 0;
    this.keysChannel = null;
    this.offBank = [];                                  // sources of controls we deliberately don't check (bank B pads)
    for (const sg of this.profile.segments || []) {
      if (sg.bank === 'B') { for (const c of sg.controls || []) if (c.src) this.offBank.push({ ...c.src }); continue; }    // bank B stays unchecked
      if (sg.local) continue;                                                        // device-only buttons send nothing
      if (sg.kind === 'keys') { this.steps.push({ id: 'keys', seg: sg.id, ctl: null, kind: 'key', label: 'Keys', prompt: 'Play any key', state: 'todo', expect: { t: 'note', ch: sg.ch ?? 1 } }); continue; }
      for (const c of sg.controls || []) {
        if (c.local || c.kind === 'button' && !c.src && !c.role) continue;           // a layout button we know nothing about: skip, not a step
        this.steps.push({ id: `${sg.id}.${c.id}`, seg: sg.id, ctl: c.id, kind: c.kind, label: c.label, prompt: promptFor(sg, c), state: 'todo', expect: c.src ? { ...c.src } : null, ...(c.src ? {} : { slot: true }) });
      }
    }
    this.i = 0;
    this.skipDone();
  }

  get current() { return this.steps[this.i] || null; }
  get finished() { return this.i >= this.steps.length; }
  get counts() {
    const c = { ok: 0, fixed: 0, skipped: 0, todo: 0 };
    for (const s of this.steps) c[s.state]++;
    return c;
  }
  get total() { return this.steps.length; }

  // Move past steps that are already settled.
  skipDone() { while (this.i < this.steps.length && this.steps[this.i].state !== 'todo') this.i++; }

  skip() { const s = this.current; if (!s) return; s.state = 'skipped'; this.i++; this.skipDone(); }
  // Do step n again (clears its result; a fixed source is forgotten).
  redo(n) {
    const s = this.steps[n]; if (!s) return;
    s.state = 'todo'; if (s.fixedFrom !== undefined) { s.expect = s.fixedFrom; delete s.fixedFrom; }
    this.i = n;
  }

  // True when no source in the profile already means this message under another control (so a correction can't alias).
  _taken(msg, except) {
    return this.steps.some((s) => s !== except && (s.state === 'ok' || s.state === 'fixed') && s.expect && s.kind !== 'key' && same(s.expect, { t: msg.t, n: msg.t === 'pb' || msg.t === 'cp' ? 0 : msg.n, ch: msg.ch }));
  }

  // Feed raw bytes. Returns { kind: 'ok'|'fixed'|'other'|'repeat'|'stray'|'ignored', step?, msg } so the UI can say what happened.
  feed(bytes) {
    const msg = decodeMessage(bytes);
    if (!msg || this.finished) return { kind: 'ignored', msg };
    if (msg.t === 'note' && !msg.on) return { kind: 'ignored', msg };               // releases never count
    if (msg.t === 'pb' && Math.abs(msg.v14 - 8192) < 1200) return { kind: 'ignored', msg };   // spring-back and jitter near centre
    const cur = this.current;
    const key = { t: msg.t, n: msg.t === 'pb' || msg.t === 'cp' ? 0 : msg.n, ch: msg.ch };

    // 1. exactly what the current step expects
    if (cur.expect && cur.kind !== 'key' && same(cur.expect, key)) return this._settle(cur, 'ok', msg);
    if (cur.kind === 'key' && msg.t === 'note' && !this._isPad(msg)) return this._keys(cur, msg);

    // 2. expected by another control still waiting: Chaz went out of order, so confirm that one
    const other = this.steps.find((s) => s !== cur && s.state === 'todo' && s.expect && s.kind !== 'key' && same(s.expect, key));
    if (other) { other.state = 'ok'; return { kind: 'other', step: other, msg }; }

    // 3. a source that is already settled elsewhere: a repeat
    if (this._taken(msg, cur)) return { kind: 'repeat', msg };

    // 3b. a bank B pad while we are on bank A, or a key press while we're asking for a pad: not a correction
    if (this.offBank.some((o) => same(o, key))) return { kind: 'bankb', msg };
    if (cur.kind === 'pad' && msg.t === 'note' && this._looksLikeKey(msg, cur)) { this.stray++; return { kind: 'stray', msg }; }

    // 4. compatible with what we're asking about: it's a correction
    if ((WANT[cur.kind] || []).includes(msg.t)) {
      if (cur.kind === 'key') return this._keys(cur, msg);
      if (cur.kind === 'pitchbend' || cur.kind === 'aftertouch') return this._settle(cur, 'ok', msg);   // there is only one source of that kind
      cur.fixedFrom = cur.expect ?? null;
      cur.expect = msg.t === 'note' ? { t: 'note', n: msg.n, ch: msg.ch } : { t: msg.t, n: msg.n, ...(msg.t === 'cc' ? {} : {}) };
      return this._settle(cur, cur.slot || cur.fixedFrom === null ? 'ok' : 'fixed', msg);
    }
    this.stray++;
    return { kind: 'stray', msg };
  }

  // A note on the keys' channel while the step expects a pad on another channel (or any note inside the keys' own range).
  _looksLikeKey(msg, cur) {
    const ks = this.steps.find((s) => s.id === 'keys');
    const kch = this.keysChannel ?? ks?.expect?.ch ?? 1;
    if (cur.expect?.ch && cur.expect.ch !== msg.ch) return msg.ch === kch;
    return false;
  }

  _isPad(msg) {
    return this.steps.some((s) => s.kind === 'pad' && s.expect && s.expect.n === msg.n && (!s.expect.ch || s.expect.ch === msg.ch));
  }

  _keys(cur, msg) {
    this.keysChannel = msg.ch;
    cur.heard = { n: msg.n, ch: msg.ch };
    const wasCh = cur.expect?.ch ?? 1;
    cur.expect = { t: 'note', ch: msg.ch };
    return this._settle(cur, msg.ch === wasCh ? 'ok' : 'fixed', msg);
  }

  _settle(step, state, msg) {
    step.state = state; step.heard = step.heard || { t: msg.t, n: msg.n, ch: msg.ch };
    this.i = this.steps.indexOf(step) + 1; this.skipDone();
    return { kind: state, step, msg };
  }

  // Corrections as plain data, for the summary ("K3 sends CC74, not CC72").
  fixes() {
    return this.steps.filter((s) => s.state === 'fixed').map((s) => ({
      step: s.label, was: s.fixedFrom ? srcLabel(s.fixedFrom) : null, now: s.kind === 'key' ? `channel ${s.expect.ch}` : srcLabel(s.expect),
    }));
  }

  // The checked profile: a copy of the layout with each corrected source written in and every control we actually
  // saw marked verified. Controls we skipped keep verified:false so the surface can still say what is unproven.
  result({ deviceName, maker = '' } = {}) {
    const p = JSON.parse(JSON.stringify(this.profile));
    const byId = new Map(this.steps.map((s) => [`${s.seg}.${s.ctl}`, s]));
    for (const sg of p.segments || []) {
      if (sg.kind === 'keys') {
        const ks = this.steps.find((s) => s.id === 'keys');
        if (ks && ks.state !== 'todo' && ks.state !== 'skipped') { sg.ch = ks.expect.ch; sg.verified = true; }
        continue;
      }
      for (const c of sg.controls || []) {
        const s = byId.get(`${sg.id}.${c.id}`);
        if (!s || s.state === 'todo' || s.state === 'skipped') continue;
        if (s.expect) c.src = { ...s.expect };
        c.verified = true;
      }
    }
    const id = `custom-${String(deviceName || p.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    return { ...p, id, custom: true, matchName: deviceName || p.name, verified: true, based_on: this.profile.id, maker: maker || p.maker,
      source: 'checked on your device', checked: { at: new Date().toISOString(), ...this.counts, fixes: this.fixes() } };
  }

  // What the surface needs to draw the checklist: per control id, its state.
  stateOf(segId, ctlId) { return this.steps.find((s) => s.seg === segId && s.ctl === ctlId)?.state || null; }
}

function promptFor(sg, c) {
  switch (c.kind) {
    case 'pitchbend': return 'Push the joystick left, then right';
    case 'modwheel': return c.id === 'moddn' ? 'Pull the joystick down (skip if nothing happens)' : 'Push the joystick up';
    case 'knob': return `Turn ${c.label}`;
    case 'fader': return `Move ${c.label}`;
    case 'encoder': return `Turn ${c.label}`;
    case 'pad': return `Hit ${c.label}`;
    case 'button': return `Press ${c.label}`;
    default: return `Touch ${c.label}`;
  }
}

export { normOf, srcKey, allControls };
