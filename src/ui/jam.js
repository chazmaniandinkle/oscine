// Jam session controller (browser side): owns the JamRecorder, installs its taps, records the master output, and
// streams everything to the sidecar, which writes <PROJECT_ROOT>/.cog/run/jam/<id>/{meta.json,events.jsonl,audio.webm}.
//
// Opt-in: nothing here runs until start(). Audio and network are injected (audio = jamaudio.js's recorder, post =
// a fetch wrapper), so test/jam.mjs drives the whole thing in node with fakes.
//
// A page reload mid-jam: the controller writes {id, seg} to sessionStorage-like `persist` on start and on each
// segment; on the next page load resume() starts a NEW segment of the same jam (events.jsonl and audio.webm keep
// appending: audio becomes audio.<seg>.webm so each segment's t0 stays exact).

import { JamRecorder, installJamTap } from '../core/jam.js';

const FLUSH_MS = 1000;

export class JamSession {
  constructor({ store, bus, engine, transport, audio, post, persist, now = () => Date.now(), setTimer = (f, ms) => setInterval(f, ms), clearTimer = (h) => clearInterval(h) }) {
    // (the defaults are wrapped: a bare setInterval kept as a property and called as this.setTimer(...) throws "Illegal invocation" in a browser)
    this.store = store; this.bus = bus; this.engine = engine; this.transport = transport;
    this.audio = audio; this.post = post; this.persist = persist;
    this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.rec = new JamRecorder({
      clock: () => ({ t: this.now(), ct: this.engine?.ctx ? this.engine.ctx.currentTime : null }),
      beat: () => { try { const p = this.transport?.getPosition?.(); return p && p.playing ? p.localBeat : null; } catch { return null; } },
    });
    this.untap = null; this.timer = null; this.sending = Promise.resolve();
    this.errors = 0; this.segMeta = [];
  }

  get active() { return this.rec.active; }

  async start(meta = {}, { resumeId = null, seg = 0, seq = 0 } = {}) {
    try { return await this._start(meta, { resumeId, seg, seq }); } catch (err) {
      // A failed start must not leave a half-open jam (recorder on, taps installed, no uploader): roll everything back.
      this.clearTimer(this.timer); this.timer = null;
      try { await this.audio?.stop?.(); } catch { /* nothing to stop */ }
      this.untap?.(); this.untap = null;
      if (this.rec.active) { try { this.rec.stop(); } catch { /* already off */ } }
      this.persist?.clear?.();
      throw err;
    }
  }

  async _start(meta, { resumeId, seg, seq }) {
    const sm = { project: this.store.project?.name ?? null, bpm: this.store.project?.bpm ?? null, ...meta };
    const m = this.rec.start(sm, resumeId ? { id: resumeId, seq, seg } : { seg });
    this.untap = installJamTap({ store: this.store, bus: this.bus, recorder: this.rec });
    this.bus.emit('jam:state', { active: true, id: m.id, seg });
    // The first event is the starting state, so a reader needs no earlier context.
    this.rec.record('transport', { name: 'jam:start', playing: !!this.transport?.playing, bpm: this.store.project?.bpm ?? null, slot: this.store.ui?.activeSlot ?? null, project: this.store.project?.name ?? null });
    let audioInfo = { ok: false, reason: 'no audio recorder' };
    if (this.audio) {
      try { audioInfo = await this.audio.start(); } catch (err) { audioInfo = { ok: false, reason: String(err?.message || err) }; }
    }
    this.audioInfo = audioInfo;
    this.fullMeta = { ...m, seg, audio: audioInfo.ok ? { file: this.audioFile(seg), mime: audioInfo.mime, audio_t0_ct: audioInfo.t0_ct, audio_t0_wall: audioInfo.t0_wall } : { error: audioInfo.reason } };
    await this.send('meta', this.fullMeta, 'json');
    this.timer = this.setTimer(() => this.flush(), FLUSH_MS);
    this.persist?.set({ id: m.id, seg, seq: this.rec.seq });
    return this.status();
  }

  audioFile(seg) { return seg ? `audio.${seg}.webm` : 'audio.webm'; }

  // After a page reload: continue the same jam as a new segment (called by the app when persist has an open jam).
  async resume() {
    const st = this.persist?.get?.();
    if (!st || !st.id || this.active) return null;
    this.segMeta = [];
    return this.start({ resumed: true }, { resumeId: st.id, seg: (st.seg ?? 0) + 1, seq: st.seq ?? 0 });
  }

  async flush() {
    const evs = this.rec.drain();
    if (evs.length) this.persist?.set({ id: this.rec.id, seg: this.rec.seg, seq: this.rec.seq });   // so a reload resumes after the last shipped seq
    if (evs.length) await this.send('events', evs.map(e => JSON.stringify(e)).join('\n') + '\n', 'text');
    if (this.audio?.drain) {
      const chunks = this.audio.drain();
      for (const c of chunks) await this.send(`audio?seg=${this.rec.seg}`, c, 'bytes');
    }
  }

  send(route, body, kind) {
    const id = this.rec.id;
    const run = async () => {
      try { await this.post(`jam/${id}/${route}`, body, kind); } catch { this.errors++; }
    };
    this.sending = this.sending.then(run);
    return this.sending;
  }

  async stop() {
    if (!this.active) throw new Error('No jam is recording.');
    this.clearTimer(this.timer); this.timer = null;
    this.rec.record('transport', { name: 'jam:stop' });
    let stopInfo = null;
    if (this.audio) { try { stopInfo = await this.audio.stop(); } catch { /* keep going: events still matter */ } }
    await this.flush();
    if (stopInfo?.chunks) for (const c of stopInfo.chunks) await this.send(`audio?seg=${this.rec.seg}`, c, 'bytes');
    const meta = this.rec.stop();
    this.untap?.(); this.untap = null;
    this.persist?.clear?.();
    await this.send('meta', { ...this.fullMeta, ...meta, audio: { ...(this.fullMeta?.audio || {}), duration_sec: stopInfo?.duration_sec ?? null } }, 'json');
    this.bus.emit('jam:state', { active: false, id: meta.id });
    return { ...this.status(), meta };
  }

  status() {
    const s = this.rec.status();
    return { ...s, audio: this.audioInfo ? { ok: !!this.audioInfo.ok, ...(this.audioInfo.ok ? { audio_t0_ct: this.audioInfo.t0_ct } : { reason: this.audioInfo.reason }) } : null, upload_errors: this.errors };
  }
}
