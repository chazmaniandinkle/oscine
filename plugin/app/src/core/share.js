// Song-in-URL: encode a whole project into a URL fragment and back. This
// is Oscine's distribution unit -- because projects are synth/pattern data
// (a few KB of JSON, no audio samples), the entire song fits in a link.
//
// Pure and dependency-free (node-importable, smoke-tested). The fragment is
// base64url of the project JSON with note ids stripped (they're per-session
// and regenerated on load, so dropping them shrinks the payload with no
// loss). The transport is the URL hash, e.g.  https://host/#s=<fragment> .

import { validateProject, FORMAT_VERSION } from './schema.js';

export const FRAGMENT_KEY = 's';

// -- base64url over UTF-8, working in both browser and node ----------------

function bytesToBase64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === 'function'
    ? btoa(bin)
    : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

// -- project <-> fragment --------------------------------------------------

// Drop fields that don't survive a round-trip anyway (note ids), to shrink.
function toWire(project) {
  const wire = JSON.parse(JSON.stringify(project));
  for (const slot of wire.slots ?? []) {
    for (const pattern of Object.values(slot.patterns ?? {})) {
      if (Array.isArray(pattern.notes)) {
        for (const n of pattern.notes) delete n.id;
      }
    }
  }
  return wire;
}

export function encodeProjectToFragment(project) {
  const json = JSON.stringify(toWire(project));
  const bytes = new TextEncoder().encode(json);
  return bytesToBase64url(bytes);
}

export function decodeFragmentToProject(fragment) {
  if (!fragment || typeof fragment !== 'string') throw new Error('Empty share fragment.');
  let json;
  try {
    json = new TextDecoder().decode(base64urlToBytes(fragment));
  } catch {
    throw new Error('Share link is malformed (could not decode).');
  }
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error('Share link is malformed (not valid project data).');
  }
  return validateProject(obj); // throws on wrong version / shape
}

// -- URL helpers -----------------------------------------------------------

// Build a shareable URL from a base (origin + path, hash stripped) and a
// project. Pass an explicit base in non-browser contexts.
export function buildShareUrl(project, base) {
  const fragment = encodeProjectToFragment(project);
  let root = base;
  if (!root && typeof location !== 'undefined') {
    root = location.origin + location.pathname + location.search;
  }
  root = (root ?? '').split('#')[0];
  return `${root}#${FRAGMENT_KEY}=${fragment}`;
}

// Pull the share fragment out of a full URL or a bare hash. Returns the
// fragment string, or null if the URL carries no Oscine share payload.
export function fragmentFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const hashIdx = url.indexOf('#');
  const hash = hashIdx >= 0 ? url.slice(hashIdx + 1) : url;
  const params = new URLSearchParams(hash);
  return params.get(FRAGMENT_KEY);
}

// Convenience for the boot path: parse a share project out of a URL, or null.
export function projectFromUrl(url) {
  const fragment = fragmentFromUrl(url);
  if (!fragment) return null;
  return decodeFragmentToProject(fragment);
}

export { FORMAT_VERSION };
