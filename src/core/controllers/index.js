// Controller profile library. A profile names what a device physically has (segments of knobs / faders / pads / keys
// / buttons) and, where known, which MIDI message each control sends. Pure data + matching; no DOM.
// Add a device: write a profile (see kit.js for the shape), export it from its maker's file, list it in BUILTIN.

import akai from './akai.js';
import arturia from './arturia.js';
import novation from './novation.js';
import korg from './korg.js';
import { keysSeg, pitchMod } from './kit.js';
import { srcKey } from '../midisrc.js';

// The fallback: any class-compliant controller. No fixed layout; the surface shows whatever it has sent
// (midimap.seen) and the wizard turns that into a saved profile.
export const GENERIC = {
  id: 'generic', name: 'Generic MIDI controller', maker: '', match: null, verified: true, generic: true,
  source: 'fallback',
  segments: [pitchMod(), keysSeg(36, 96)],
};

export const BUILTIN = [...akai, ...arturia, ...novation, ...korg];

// Profiles Chaz made with the wizard (or filled in from a built-in): matched by exact device name, ahead of the
// built-ins. Runtime registry; the browser manager loads them from storage / the sidecar.
const custom = new Map();
export function registerProfile(p) { if (p?.id) custom.set(p.id, p); return p; }
export function removeProfile(id) { return custom.delete(id); }
export function customProfiles() { return [...custom.values()]; }

export const listProfiles = () => [...custom.values(), ...BUILTIN, GENERIC];
export const profileById = (id) => custom.get(id) || BUILTIN.find((p) => p.id === id) || (id === GENERIC.id ? GENERIC : null);

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

// Name (+ optional manufacturer) -> profile, or null when nothing recognises it.
export function matchProfile(deviceName, manufacturer = '') {
  const name = norm(deviceName);
  if (!name) return null;
  for (const p of custom.values()) if (p.matchName && norm(p.matchName) === name) return p;
  const hay = `${manufacturer} ${deviceName}`;
  return BUILTIN.find((p) => p.match && p.match.test(hay)) || null;
}

// srcKey -> { seg, control } for every control that has a source. Cached per profile object.
const cache = new WeakMap();
export function controlIndex(profile) {
  let idx = cache.get(profile);
  if (idx) return idx;
  idx = new Map();
  for (const sg of profile.segments || []) {
    for (const c of sg.controls || []) if (c.src) idx.set(srcKey(c.src), { seg: sg, control: c });
  }
  cache.set(profile, idx);
  return idx;
}

// Every control in layout order (for slot filling and the surface).
export const allControls = (profile) => (profile.segments || []).flatMap((s) => (s.controls || []).map((c) => ({ seg: s, control: c })));
