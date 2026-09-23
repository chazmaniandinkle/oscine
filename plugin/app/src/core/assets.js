// Audio asset resolution + decode cache for the v2 assets/clips model.
// Two separate concerns live here on purpose: URL resolution is pure data
// math (works in node, no DOM), while AssetCache owns the one mutable
// resource that's actually expensive — decoded PCM — keyed by content hash
// so two assets/clips pointing at identical bytes never decode twice.

export const ASSETS_DIR = 'assets'; // convention: <projectDir>/assets/<sha256>.<ext>

// Pick a variant object off an asset: explicit name, else 'default', else
// whatever key sorts first (Object.keys order = insertion order in JS,
// which is stable enough for "first variant recorded").
function pickVariant(asset, variantName) {
  const variants = asset.variants || {};
  const key = variantName || (variants.default ? 'default' : Object.keys(variants)[0]);
  const v = variants[key];
  if (!v) throw new Error(`asset ${asset.id} has no variant "${key}"`);
  return v;
}

// Build the fetchable URL for one asset/variant. baseUrl lets callers point
// at a different origin/prefix (e.g. a CDN mirror) without changing the
// on-disk convention.
export function resolveAssetUrl(project, assetId, variantName = null, baseUrl = '') {
  const asset = project.assets[assetId];
  if (!asset) throw new Error(`no such asset ${assetId}`);
  const variant = pickVariant(asset, variantName);
  const ext = variant.ext || 'wav';
  return `${baseUrl}${ASSETS_DIR}/${variant.sha256}.${ext}`;
}

// Decode cache. Keyed by sha256 (the content hash), not by assetId/variant —
// that's the whole point: a derived variant that happens to share bytes with
// its source (e.g. a no-op render) reuses the same decoded buffer.
export class AssetCache {
  constructor(audioCtx) {
    this.ctx = audioCtx;
    this.buffers = new Map();  // sha256 -> AudioBuffer
    this.inFlight = new Map(); // sha256 -> Promise<AudioBuffer>, dedupes concurrent callers
    this.peaksCache = new Map(); // `${sha256}:${bins}` -> Float32Array
  }

  async getBuffer(project, assetId, variantName = null, baseUrl = project.baseUrl ?? '') {
    const asset = project.assets[assetId];
    if (!asset) throw new Error(`no such asset ${assetId}`);
    const variant = pickVariant(asset, variantName);
    const sha256 = variant.sha256;

    if (this.buffers.has(sha256)) return this.buffers.get(sha256);
    if (this.inFlight.has(sha256)) return this.inFlight.get(sha256);

    const url = resolveAssetUrl(project, assetId, variantName, baseUrl);
    const promise = (async () => {
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      // decodeAudioData exists on both AudioContext and OfflineAudioContext —
      // callers may use an offline ctx for headless export/render paths.
      const buffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.buffers.set(sha256, buffer);
      this.inFlight.delete(sha256);
      // Hook for background work on freshly decoded bytes (the ear profiles
      // every asset here). Keyed by assetId so callers can look it up.
      try { this.onDecoded?.(assetId, buffer); } catch {}
      return buffer;
    })();
    this.inFlight.set(sha256, promise);
    return promise;
  }

  // Derived variant: the same bytes put through a transform (time-stretch /
  // pitch-shift). Cached by content hash + params -- the tier-3 cache key --
  // so two clips asking for the same stretch of the same source share one
  // render, and a clip that goes back to 1.0 hits the plain decode again.
  async getDerived(project, assetId, variantName = null, params = {}, baseUrl = project.baseUrl ?? '') {
    const asset = project.assets[assetId];
    if (!asset) throw new Error(`no such asset ${assetId}`);
    const { sha256 } = pickVariant(asset, variantName);
    const { derivedKey, stretchBuffer } = await import('../engine/stretch.js');
    const key = derivedKey(sha256, params);
    if (this.buffers.has(key)) return this.buffers.get(key);
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const promise = (async () => {
      const src = await this.getBuffer(project, assetId, variantName, baseUrl);
      const out = stretchBuffer(this.ctx, src, params);
      this.buffers.set(key, out);
      this.inFlight.delete(key);
      return out;
    })();
    this.inFlight.set(key, promise);
    return promise;
  }

  // Max-abs per bin, mono-summed across channels — cheap waveform data for
  // drawing without re-walking the full buffer on every repaint/zoom.
  // Memoized per (sha256, bins) since a given buffer is usually redrawn at
  // the same zoom level repeatedly (playhead updates, etc).
  peaks(buffer, bins) {
    const sha256 = this._shaFor(buffer);
    const cacheKey = `${sha256}:${bins}`;
    if (this.peaksCache.has(cacheKey)) return this.peaksCache.get(cacheKey);

    const out = new Float32Array(bins);
    const len = buffer.length;
    const perBin = Math.max(1, Math.ceil(len / bins));
    const chans = buffer.numberOfChannels;
    const data = [];
    for (let c = 0; c < chans; c++) data.push(buffer.getChannelData(c));

    for (let b = 0; b < bins; b++) {
      const start = b * perBin;
      const end = Math.min(len, start + perBin);
      let peak = 0;
      for (let i = start; i < end; i++) {
        let sum = 0;
        for (let c = 0; c < chans; c++) sum += data[c][i];
        const abs = Math.abs(sum);
        if (abs > peak) peak = abs;
      }
      out[b] = peak;
    }
    if (sha256) this.peaksCache.set(cacheKey, out);
    return out;
  }

  // Reverse-lookup a buffer's sha256 from the decode cache so peaks() can
  // memoize without the caller having to thread the hash through separately.
  _shaFor(buffer) {
    for (const [sha256, b] of this.buffers) if (b === buffer) return sha256;
    return null;
  }
}

// Word timings for one clip, windowed to [clip.in, clip.out) and rebased so
// start/end are relative to the clip (0 = clip start), matching how the UI
// already thinks about clip-local time (fades, waveform x-axis, etc).
// Words that only partially overlap the window are kept but clamped, so a
// clip boundary mid-word doesn't drop it entirely.
export function wordsFor(project, clip) {
  const asset = project.assets[clip.sourceOf];
  if (!asset || !asset.words || !asset.words.length) return [];
  const out = [];
  for (const w of asset.words) {
    if (w.e <= clip.in || w.s >= clip.out) continue; // no overlap with window
    const start = Math.max(w.s, clip.in) - clip.in;
    const end = Math.min(w.e, clip.out) - clip.in;
    out.push({ word: w.t, start, end });
  }
  return out;
}
