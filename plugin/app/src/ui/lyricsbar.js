// Lyrics bar: the words of the song, in song time, under the timeline.
// Built from every placement's clip words (through in/out/stretch), so it's
// what the arrangement actually sings -- not one source's transcript. The
// word at the playhead is lit; click a word to seek; the strip scrolls to
// keep the current word in view during playback.
import { el } from './widgets.js';
import { wordsFor } from '../core/assets.js';

export class LyricsBar {
  constructor(host, app) {
    this.app = app; this.store = app.store; this.host = host;
    host.className = 'lyricsbar';
    // Lane picker: the bar shows ONE lane's words. Auto-follows lane / source
    // selection; the picker overrides until the next selection.
    this.picker = el('select', 'lyrics-lane');
    this.picker.title = 'Which lane the lyrics bar follows';
    this.picker.addEventListener('change', () => { this.laneFilter = this.picker.value || null; this.store.ui.lyricsLane = this.laneFilter; this.rebuild(); });
    this.strip = el('div', 'lyrics-strip');
    host.append(this.picker, this.strip);
    this.words = [];      // [{s, e, word, lane, el}] in song time, sorted
    this.current = -1;
    this.laneFilter = this.store.ui.lyricsLane ?? null;
    const { bus } = app;
    for (const t of ['project:replaced', 'arrangement:changed']) bus.on(t, () => { this.rebuild(); this.app.routeLyrics?.(); });
    // Follow what the user points at: a lane, or a source (→ the lane that
    // uses it most).
    bus.on('lane:selected', ({ id }) => { if (id && this.lanesWithWords().includes(id)) this.setLane(id); });
    bus.on('asset:selected', ({ id }) => {
      if (!id) return;
      const p = this.store.project, counts = {};
      for (const pl of p.arrangement?.placements ?? []) if (p.clips[pl.clip]?.sourceOf === id) counts[pl.track] = (counts[pl.track] || 0) + 1;
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (best && this.lanesWithWords().includes(best)) this.setLane(best);
    });
    this.rebuild();
  }
  lanesWithWords() {
    const p = this.store.project, out = new Set();
    for (const pl of p.arrangement?.placements ?? []) { const c = p.clips[pl.clip]; if (c && wordsFor(p, c).length) out.add(pl.track); }
    return [...out];
  }
  setLane(id) { if (id === this.laneFilter) return; this.laneFilter = id; this.store.ui.lyricsLane = id; this.rebuild(); }
  rebuild() {
    const p = this.store.project, arr = p.arrangement;
    this.strip.textContent = '';
    this.words = []; this.current = -1;
    if (!arr?.placements?.length) { this.host.classList.add('empty'); return; }
    // Picker options = lanes that have any words; default to the first.
    const withWords = this.lanesWithWords();
    if (!this.laneFilter || !withWords.includes(this.laneFilter)) this.laneFilter = withWords[0] ?? null;
    this.picker.textContent = '';
    for (const id of withWords) {
      const l = (arr.lanes || []).find(x => x.id === id);
      const o = el('option', '', l?.name || id); o.value = id; o.selected = id === this.laneFilter;
      if (l?.color) o.style.color = l.color;
      this.picker.appendChild(o);
    }
    for (const pl of arr.placements) {
      const c = p.clips[pl.clip]; if (!c) continue;
      if (this.laneFilter && pl.track !== this.laneFilter) continue;
      const sp = (c.stretch ?? 1) / (c.rate ?? 1);
      for (const w of wordsFor(p, c)) this.words.push({ s: pl.at + w.start * sp, e: pl.at + w.end * sp, word: w.word, lane: pl.track });
    }
    this.words.sort((a, b) => a.s - b.s);
    this.host.classList.toggle('empty', !this.words.length);
    const lanes = arr.lanes || [];
    let lastLane = null, lastEnd = -1;
    for (const w of this.words) {
      // A gap > 2.5s or a lane change starts a new "line".
      if (w.s - lastEnd > 2.5 || w.lane !== lastLane) {
        if (lastLane !== null) this.strip.appendChild(el('span', 'lyr-break', ' · '));
        lastLane = w.lane;
      }
      const sp = el('span', 'lyr-word', w.word);
      const lane = lanes.find(l => l.id === w.lane);
      if (lane?.color) sp.style.setProperty('--lyr', lane.color);
      sp.title = `${w.lane} · ${w.s.toFixed(2)}s`;
      sp.addEventListener('click', () => { this.app.transport.songPos = w.s; this.app.timeline.dirty = true; });
      this.strip.appendChild(sp); w.el = sp;
      lastEnd = w.e;
    }
  }
  onFrame(pos) {
    if (this.host.classList.contains('hidden') || !this.words.length) return;
    const t = pos?.sec ?? this.app.transport.songPos ?? 0;
    // Find the word containing t, else the last word before t.
    let i = -1, lo = 0, hi = this.words.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (this.words[m].s <= t) { i = m; lo = m + 1; } else hi = m - 1; }
    if (i === this.current) return;
    if (this.current >= 0) this.words[this.current].el.classList.remove('current');
    this.current = i;
    if (i >= 0) {
      const w = this.words[i];
      w.el.classList.add('current');
      // keep it in view
      const sl = this.strip, r = w.el.offsetLeft, vw = sl.clientWidth;
      if (r < sl.scrollLeft + 40 || r > sl.scrollLeft + vw - 80) sl.scrollLeft = Math.max(0, r - vw * 0.3);
    }
  }
}
