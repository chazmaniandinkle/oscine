// Song-in-URL: encode a whole project into a URL fragment and back. This
// is Oscine's distribution unit -- because projects are synth/pattern data
// (a few KB of JSON, no audio samples), the entire song fits in a link.
//
// Pure and dependency-free (node-importable, smoke-tested). The fragment is
// base64url of the project JSON with note ids stripped (they're per-session
// and regenerated on load, so dropping them shrinks the payload with no
// loss). New links gzip the JSON first (CompressionStream is a global in
// Node 18+ and in browsers), shrinking the payload ~5-10x; the decoder
// auto-detects gzip by its magic bytes (0x1f 0x8b), so older plain-base64url
// links still decode and no version marker is needed. The transport is the
// URL hash, e.g.  https://host/#s=<fragment> .

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

// -- gzip helpers (CompressionStream is a global in Node 18+ and browsers) --

// Compress bytes with gzip. Streams the input through CompressionStream and
// collects the result via Response.arrayBuffer, which works in both node and
// the browser. Returns a Uint8Array of the gzipped bytes.
async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

// Inverse of gzip(): inflate gzipped bytes back to the original Uint8Array.
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
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

// ASYNC: gzip the project JSON when CompressionStream is available (new
// links), otherwise fall back to plain base64url of the raw JSON (legacy).
export async function encodeProjectToFragment(project) {
  const json = JSON.stringify(toWire(project));
  let bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream !== 'undefined') {
    bytes = await gzip(bytes);
  }
  return bytesToBase64url(bytes);
}

// ASYNC: base64url-decode, then auto-detect gzip by its magic bytes
// (0x1f 0x8b). Gzipped payloads are inflated first; plain payloads (legacy
// links) are decoded as JSON directly. Then validate as today.
export async function decodeFragmentToProject(fragment) {
  if (!fragment || typeof fragment !== 'string') throw new Error('Empty share fragment.');
  let bytes;
  try {
    bytes = base64urlToBytes(fragment);
  } catch {
    throw new Error('Share link is malformed (could not decode).');
  }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      bytes = await gunzip(bytes);
    } catch {
      throw new Error('Share link is malformed (could not decompress).');
    }
  }
  let json;
  try {
    json = new TextDecoder().decode(bytes);
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

// ASYNC: build a shareable URL from a base (origin + path, hash stripped)
// and a project. Pass an explicit base in non-browser contexts.
export async function buildShareUrl(project, base) {
  const fragment = await encodeProjectToFragment(project);
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

// ASYNC convenience for the boot path: parse a share project out of a URL,
// or null. (fragmentFromUrl stays synchronous; it only parses the hash.)
export async function projectFromUrl(url) {
  const fragment = fragmentFromUrl(url);
  if (!fragment) return null;
  return decodeFragmentToProject(fragment);
}

export { FORMAT_VERSION };
