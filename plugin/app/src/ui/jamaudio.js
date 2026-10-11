// Jam audio: record the master output (webm/opus) on the SAME AudioContext clock the events are stamped with.
// MediaStreamDestination hangs off the engine's masterGain (the pattern engine) and, when the transport is playing an
// arrangement, off the clip player's master chain too (that one goes straight to the destination, same as earlive).
// The recorder's `start` is stamped with ctx.currentTime (t0_ct) so an event at ct maps to (ct - t0_ct) seconds in.
//
// Chunks (Blobs, 1 s timeslice) are queued for the uploader via drain(); stop() returns whatever the final flush added.
// Opt-in and free when off: nothing is created until start().

export class JamAudio {
  constructor({ engine, transport, MediaRecorderImpl = (typeof MediaRecorder !== 'undefined' ? MediaRecorder : null), mimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'] }) {
    this.engine = engine; this.transport = transport; this.MR = MediaRecorderImpl; this.mimes = mimes;
    this.rec = null; this.dest = null; this.queue = []; this.clipTap = null; this.unsync = null; this.info = null;
  }

  pickMime() {
    if (!this.MR) return null;
    if (typeof this.MR.isTypeSupported !== 'function') return this.mimes[0];
    return this.mimes.find(m => this.MR.isTypeSupported(m)) ?? null;
  }

  async start() {
    const ctx = this.engine?.ctx;
    if (!ctx) return { ok: false, reason: 'the audio engine is not running (open the app and click once to unlock audio)' };
    const mime = this.pickMime();
    if (!mime) return { ok: false, reason: 'this browser has no MediaRecorder for webm/opus' };
    this.dest = ctx.createMediaStreamDestination();
    this.engine.masterGain.connect(this.dest);
    this.syncClips();
    this.rec = new this.MR(this.dest.stream, { mimeType: mime, audioBitsPerSecond: 128000 });
    this.queue = [];
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.queue.push(e.data); };
    await new Promise((resolve, reject) => {
      this.rec.onstart = () => resolve();
      this.rec.onerror = (e) => reject(e.error || new Error('MediaRecorder error'));
      this.rec.start(1000);
    });
    // The 'start' event fires a tick after start(); stamp both clocks as close together as we can.
    this.info = { ok: true, mime, t0_ct: ctx.currentTime, t0_wall: Date.now() };
    // The clip player is rebuilt per play/loop pass: re-tap it whenever the transport state changes.
    const bus = this.transport?.bus;
    if (bus?.on) this.unsync = bus.on('transport:state', () => this.syncClips());
    return this.info;
  }

  // Arrangement songs: tap the current ClipPlayer master chain into the recorder destination.
  syncClips() {
    const cp = this.transport?.clipPlayer ?? null;
    if (cp === this.clipTap || !this.dest) return;
    this.clipTap = cp;
    if (!cp) return;
    try { cp.masterChain.output.connect(this.dest); } catch { /* the player was torn down already */ }
  }

  drain() { const q = this.queue; this.queue = []; return q; }

  async stop() {
    if (!this.rec) return { chunks: [], duration_sec: null };
    const rec = this.rec; this.rec = null;
    await new Promise((resolve) => {
      if (rec.state === 'inactive') return resolve();
      rec.onstop = () => resolve();
      try { rec.stop(); } catch { resolve(); }
    });
    try { this.engine.masterGain.disconnect(this.dest); } catch { /* already gone */ }
    this.unsync?.(); this.unsync = null;
    const ctx = this.engine?.ctx;
    const duration_sec = ctx && this.info ? Math.round((ctx.currentTime - this.info.t0_ct) * 1000) / 1000 : null;
    this.dest = null; this.clipTap = null;
    return { chunks: this.drain(), duration_sec };
  }
}
