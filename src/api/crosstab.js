// CrossTab: same-origin cross-tab coordination for the app.
//
// Browser-only and fully feature-detected. It wraps two platform APIs:
//   - BroadcastChannel  -> presence roster + typed messages between tabs
//   - navigator.locks   -> exclusive ownership of a named resource (e.g. MIDI)
//
// Everything degrades to a benign no-op when those APIs are absent (older
// Safari): supported/locksSupported report false, peers is just [self], and
// claim() resolves true WITHOUT real exclusivity so callers can treat it as
// "no enforcement available" and keep working exactly as before. No throws.
//
// This file is the SUBSTRATE the UI builds on (src/ui/midi.js): it never
// touches the store, the DOM, or audio. It only coordinates tabs.

const CHANNEL_NAME = 'oscine';
const HEARTBEAT_MS = 2000;
const PEER_TIMEOUT_MS = 6000; // drop a peer after ~3 missed heartbeats
const LOCK_PREFIX = 'oscine:';

export class CrossTab {
  constructor(clientId, opts = {}) {
    this.id = clientId;
    this.title = opts.title || '';
    this.focused = typeof document !== 'undefined' ? !document.hidden : true;

    this.channel = null;
    this.started = false;
    this.heartbeatTimer = null;
    this.sweepTimer = null;

    // Roster of known peers (including self), keyed by id. Each entry:
    // { id, title, focused, owns:Set<resource>, seen:<ms> }.
    this.roster = new Map();

    // Locks we currently hold: resource -> release fn (resolves the pending
    // lock-request promise so the Web Lock is let go).
    this.held = new Map();
    // Resources we have marked ourselves as owning in the roster.
    this.owned = new Set();

    // Subscribers.
    this.presenceSubs = new Set();
    this.typedSubs = new Map();   // type -> Set<fn>
    this.lostSubs = new Map();    // resource -> Set<fn>

    // Bound listeners so we can remove them on stop().
    this._onFocus = () => this._setFocused(true);
    this._onBlur = () => this._setFocused(false);
    this._onVisibility = () => {
      if (typeof document !== 'undefined') this._setFocused(!document.hidden);
    };
    this._onPagehide = () => this._announceBye();
  }

  get supported() {
    return typeof BroadcastChannel !== 'undefined';
  }

  get locksSupported() {
    return typeof navigator !== 'undefined' && !!navigator.locks;
  }

  // Join the channel, announce presence, and start heartbeating. Idempotent.
  start() {
    if (this.started) return;
    this.started = true;

    // Always seed the roster with self so peers always returns at least [self].
    this._touchSelf();

    if (this.supported) {
      try {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (e) => this._onMessage(e.data);
      } catch {
        this.channel = null;
      }
    }

    if (typeof window !== 'undefined') {
      try {
        window.addEventListener('focus', this._onFocus);
        window.addEventListener('blur', this._onBlur);
        window.addEventListener('pagehide', this._onPagehide);
      } catch { /* no-op */ }
    }
    if (typeof document !== 'undefined') {
      try {
        document.addEventListener('visibilitychange', this._onVisibility);
      } catch { /* no-op */ }
    }

    if (this.channel) {
      this._announce('hello');
      this._post('presence', this._selfPresence());
      this.heartbeatTimer = setInterval(() => this._heartbeat(), HEARTBEAT_MS);
      this.sweepTimer = setInterval(() => this._sweep(), HEARTBEAT_MS);
    }

    this._emitPresence();
  }

  // Array of { id, title, focused, owns:[resource] } for live tabs (incl self).
  get peers() {
    const out = [];
    for (const p of this.roster.values()) {
      out.push({
        id: p.id,
        title: p.title,
        focused: p.focused,
        owns: [...p.owns],
      });
    }
    return out;
  }

  onPresence(fn) {
    this.presenceSubs.add(fn);
    return () => this.presenceSubs.delete(fn);
  }

  // Mark/unmark this tab as owner of a named resource in the roster broadcast.
  setOwn(resource, bool) {
    if (bool) this.owned.add(resource);
    else this.owned.delete(resource);
    this._touchSelf();
    if (this.channel) this._post('presence', this._selfPresence());
    this._emitPresence();
  }

  // Acquire an exclusive Web Lock named 'oscine:'+resource.
  //   steal:false -> { ifAvailable:true }: resolve false if already held by
  //                  another tab, true if we acquired and now hold it.
  //   steal:true  -> { steal:true }: forcibly take it, firing the prior
  //                  holder's onLost.
  // The lock is held by keeping the request callback's promise pending; we
  // store its resolver so release(resource) can let it go. With no Web Locks
  // support, resolve true WITHOUT real exclusivity (degraded).
  async claim(resource, { steal = false } = {}) {
    if (!this.locksSupported) {
      // Degraded: caller treats this as "no enforcement available".
      this.held.set(resource, null);
      return true;
    }

    const name = LOCK_PREFIX + resource;
    const options = steal ? { steal: true } : { ifAvailable: true };

    return new Promise((resolve) => {
      let settled = false;
      navigator.locks.request(name, options, (lock) => {
        if (!lock) {
          // ifAvailable could not get the lock: held by another tab.
          if (!settled) { settled = true; resolve(false); }
          return; // returning resolves request() immediately, holding nothing
        }
        // We hold the lock. Keep this callback's promise pending until
        // release() (or a steal) lets it go.
        return new Promise((releaseLock) => {
          this.held.set(resource, releaseLock);
          if (!settled) { settled = true; resolve(true); }
        });
      }).then(
        () => {
          // The request settled because the held-promise resolved. If that
          // happened without us releasing it (a steal by another tab), treat
          // it as a loss.
          if (this.held.has(resource)) {
            this.held.delete(resource);
            this._fireLost(resource);
          }
        },
        () => {
          // Request rejected (e.g. stolen): we no longer hold it.
          if (this.held.has(resource)) this.held.delete(resource);
          if (!settled) { settled = true; resolve(false); }
          this._fireLost(resource);
        }
      );
    });
  }

  // Release a held lock and clear ownership in the roster.
  release(resource) {
    const releaseLock = this.held.get(resource);
    this.held.delete(resource);
    if (typeof releaseLock === 'function') {
      try { releaseLock(); } catch { /* no-op */ }
    }
    this.setOwn(resource, false);
  }

  owns(resource) {
    return this.held.has(resource);
  }

  // Register a callback fired when we lose (or never hold) the named lock,
  // e.g. another tab stole it.
  onLost(resource, fn) {
    if (!this.lostSubs.has(resource)) this.lostSubs.set(resource, new Set());
    this.lostSubs.get(resource).add(fn);
    return () => this.lostSubs.get(resource)?.delete(fn);
  }

  // Broadcast a typed message to other tabs.
  post(type, payload) {
    if (!this.channel) return;
    this._post(type, payload);
  }

  // Subscribe to typed messages from OTHER tabs (self-originated are ignored).
  on(type, fn) {
    if (!this.typedSubs.has(type)) this.typedSubs.set(type, new Set());
    this.typedSubs.get(type).add(fn);
    return () => this.typedSubs.get(type)?.delete(fn);
  }

  // Close the channel and release all locks (best-effort). Web Locks also
  // auto-release on tab close, which is the key durability property.
  stop() {
    if (!this.started) return;
    this.started = false;

    this._announceBye();

    clearInterval(this.heartbeatTimer);
    clearInterval(this.sweepTimer);
    this.heartbeatTimer = null;
    this.sweepTimer = null;

    // Close the channel before releasing held locks. release() -> setOwn(false)
    // posts a presence update, and a trailing presence after the 'bye' makes
    // peers re-add this just-closed tab (a ghost roster entry until the sweep).
    // Nulling the channel first makes those release-time posts no-op.
    if (this.channel) {
      try { this.channel.close(); } catch { /* no-op */ }
      this.channel = null;
    }

    for (const resource of [...this.held.keys()]) this.release(resource);

    if (typeof window !== 'undefined') {
      try {
        window.removeEventListener('focus', this._onFocus);
        window.removeEventListener('blur', this._onBlur);
        window.removeEventListener('pagehide', this._onPagehide);
      } catch { /* no-op */ }
    }
    if (typeof document !== 'undefined') {
      try {
        document.removeEventListener('visibilitychange', this._onVisibility);
      } catch { /* no-op */ }
    }
  }

  // --- internals -----------------------------------------------------------

  _selfPresence() {
    return {
      id: this.id,
      title: this.title,
      focused: this.focused,
      owns: [...this.owned],
    };
  }

  _touchSelf() {
    this.roster.set(this.id, {
      id: this.id,
      title: this.title,
      focused: this.focused,
      owns: new Set(this.owned),
      seen: now(),
    });
  }

  _setFocused(focused) {
    if (this.focused === focused) return;
    this.focused = focused;
    this._touchSelf();
    if (this.channel) this._post('presence', this._selfPresence());
    this._emitPresence();
  }

  _post(type, payload) {
    if (!this.channel) return;
    try {
      this.channel.postMessage({ type, payload, from: this.id });
    } catch { /* no-op */ }
  }

  _announce(type) {
    this._post(type, this._selfPresence());
  }

  _announceBye() {
    this._post('bye', { id: this.id });
  }

  _heartbeat() {
    this._touchSelf();
    this._post('presence', this._selfPresence());
  }

  // Drop peers we have not heard from within the timeout window.
  _sweep() {
    const cutoff = now() - PEER_TIMEOUT_MS;
    let changed = false;
    for (const [id, p] of this.roster) {
      if (id === this.id) continue;
      if (p.seen < cutoff) { this.roster.delete(id); changed = true; }
    }
    if (changed) this._emitPresence();
  }

  _onMessage(data) {
    if (!data || typeof data !== 'object') return;
    if (data.from === this.id) return; // ignore our own messages

    const { type, payload, from } = data;

    if (type === 'bye') {
      const id = payload?.id || from;
      if (this.roster.has(id)) {
        this.roster.delete(id);
        this._emitPresence();
      }
      return;
    }

    if (type === 'hello') {
      // A new tab announced itself: record it and reply so it learns about us.
      this._recordPeer(payload, from);
      this._post('presence', this._selfPresence());
      return;
    }

    if (type === 'presence') {
      this._recordPeer(payload, from);
      return;
    }

    // Typed application messages.
    const subs = this.typedSubs.get(type);
    if (subs) for (const fn of [...subs]) {
      try { fn(payload, from); } catch { /* subscriber error is not ours */ }
    }
  }

  _recordPeer(presence, from) {
    const id = presence?.id || from;
    if (!id || id === this.id) return;
    this.roster.set(id, {
      id,
      title: presence?.title || '',
      focused: !!presence?.focused,
      owns: new Set(presence?.owns || []),
      seen: now(),
    });
    this._emitPresence();
  }

  _fireLost(resource) {
    const subs = this.lostSubs.get(resource);
    if (subs) for (const fn of [...subs]) {
      try { fn(); } catch { /* subscriber error is not ours */ }
    }
  }

  _emitPresence() {
    const snapshot = this.peers;
    for (const fn of [...this.presenceSubs]) {
      try { fn(snapshot); } catch { /* subscriber error is not ours */ }
    }
  }
}

const now = () => (typeof Date !== 'undefined' ? Date.now() : 0);
