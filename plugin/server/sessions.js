// Session registry for the Oscine sidecar.
//
// The sidecar can have more than one app instance (browser tab) connected
// to its /bridge endpoint at once. Historically it kept a single `appConn`
// and closed the previous one whenever a new tab connected ("newest tab
// wins"). Because the app auto-reconnects when its socket drops, two open
// tabs would fight forever — each connect kicked the other off, the kicked
// tab reconnected and kicked the first off — and commands landed on
// whichever tab happened to be winning that millisecond. That is the
// "split-brain" failure.
//
// This registry tracks every connected instance instead. Connections are
// never force-closed just because another tab appeared; each tab is a
// stable, addressable session. Commands target the active session by
// default (the most recently opened tab) but can be routed to any session
// explicitly. The state is made discoverable (see `list`) so an agent can
// SEE that several instances are open rather than silently corrupting two
// projects.
//
// This module is pure logic — it never touches sockets — so it is unit
// tested headlessly in test/smoke.mjs. Connections are stored as opaque
// `conn` handles.

let counter = 0;

export class SessionRegistry {
  constructor() {
    this.sessions = new Map(); // id -> { id, conn, info, connectedAt }
    this.activeId = null;
  }

  // Register a freshly-opened connection (its `hello` arrives a moment
  // later). The newest connection becomes active, matching the prior
  // "drive the tab I just opened" behaviour — minus the killing.
  add(conn) {
    const id = `s${++counter}`;
    this.sessions.set(id, { id, conn, info: null, connectedAt: Date.now() });
    this.activeId = id;
    return id;
  }

  // Apply a hello payload to a session. If another session already carries
  // the same persistent clientId, this is the SAME tab reconnecting: fold
  // the new connection into the existing session and report the now-stale
  // connection so the caller can close it. This keeps one tab as one
  // session across network blips (no duplicate sessions, no churn).
  // Returns { id, staleConn }.
  hello(id, info) {
    const here = this.sessions.get(id);
    if (!here) return { id: null, staleConn: null };
    here.info = info;
    const clientId = info && info.clientId;
    if (clientId) {
      for (const [otherId, s] of this.sessions) {
        if (otherId === id) continue;
        if (s.info && s.info.clientId === clientId) {
          const staleConn = s.conn;
          s.conn = here.conn;
          s.info = info;
          s.connectedAt = here.connectedAt;
          this.sessions.delete(id);
          if (this.activeId === id) this.activeId = otherId;
          return { id: otherId, staleConn };
        }
      }
    }
    return { id, staleConn: null };
  }

  // Drop the session owning `conn` (its socket closed). Returns the removed
  // id, or null if the conn wasn't registered (e.g. already replaced by a
  // reconnect of the same tab).
  removeByConn(conn) {
    for (const [id, s] of this.sessions) {
      if (s.conn === conn) {
        this.sessions.delete(id);
        if (this.activeId === id) {
          const next = this.sessions.keys().next();
          this.activeId = next.done ? null : next.value;
        }
        return id;
      }
    }
    return null;
  }

  get(id) { return this.sessions.get(id) || null; }
  get size() { return this.sessions.size; }
  get active() { return this.activeId ? this.sessions.get(this.activeId) || null : null; }

  // A serialisable snapshot for `oscine_sessions` / `status`.
  list() {
    return [...this.sessions.values()].map(s => ({
      id: s.id,
      project: (s.info && s.info.project) || null,
      title: (s.info && s.info.title) || null,
      clientId: (s.info && s.info.clientId) || null,
      connectedAt: s.connectedAt,
      active: s.id === this.activeId,
    }));
  }

  // Pin the active session by selector. Returns the session or null.
  setActive(selector) {
    const s = this.find(selector);
    if (!s) return null;
    this.activeId = s.id;
    return s;
  }

  // Match a session by id, persistent clientId, or unambiguous exact
  // project name (case-insensitive). Returns a session or null.
  find(selector) {
    if (selector == null) return null;
    const key = String(selector);
    if (this.sessions.has(key)) return this.sessions.get(key);
    for (const s of this.sessions.values()) {
      if (s.info && s.info.clientId === key) return s;
    }
    const byName = [...this.sessions.values()].filter(
      s => ((s.info && s.info.project) || '').toLowerCase() === key.toLowerCase()
    );
    return byName.length === 1 ? byName[0] : null;
  }

  // Decide which session a command targets.
  //  - explicit selector that matches  -> { session }
  //  - explicit selector, no match     -> { error:'no-match', sessions }
  //  - no selector, nothing connected  -> { error:'not-connected', sessions:[] }
  //  - no selector, one session        -> { session }
  //  - no selector, many, active alive  -> { session: active }
  //  - no selector, many, no active     -> { error:'ambiguous', sessions }
  resolve(selector) {
    if (selector != null && selector !== '') {
      const s = this.find(selector);
      return s ? { session: s } : { error: 'no-match', sessions: this.list() };
    }
    if (this.sessions.size === 0) return { error: 'not-connected', sessions: [] };
    if (this.sessions.size === 1) {
      return { session: this.sessions.values().next().value };
    }
    if (this.activeId && this.sessions.has(this.activeId)) {
      return { session: this.sessions.get(this.activeId) };
    }
    return { error: 'ambiguous', sessions: this.list() };
  }
}
