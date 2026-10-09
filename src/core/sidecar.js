// Where the sidecar lives, relative to where THIS page was served from.
//
// The app talks to its sidecar (plugin/server/oscine-mcp.mjs) with routes like
// /projects.json, /project-doc/<rel>, /project/<dir>/assets/<sha>.wav,
// /render-save, /transcribe, /suno/*, /bridge. Served by the sidecar itself at
// http://127.0.0.1:7321/ the site root is the sidecar, so '/x' was right. Behind
// a reverse proxy at a prefix (the mod3 stage serves it at /r/<key>/oscine/) an
// absolute '/x' escapes the prefix and hits the wrong server. So every sidecar
// call goes through here and resolves against the app's own base: the directory
// of the page URL. At a site root that is '/', so nothing changes there.
//
// Pure + tolerant: outside a browser (node tests) or on a non-http(s) page the
// route is returned untouched.

function httpBase() {
  if (remoteBase) return new URL(remoteBase);
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol || '')) return null;
  try { return new URL('.', location.href); } catch { return null; }
}

// ---- A hosted page talking to a LOCAL sidecar --------------------------------
// The hosted copy (GitHub Pages, myrgic.com/oscine) has no sidecar behind it, but
// the user may run one on this machine (the managed daemon on 7450, or the plugin
// default 7321). discoverSidecar() probes 127.0.0.1 for /health and, if one answers,
// points every sidecar route and the bridge at it. The sidecar must allow the
// page's origin (it allows the official hosted origins by default; others via
// OSCINE_ALLOWED_ORIGINS). Chrome/Edge/Firefox let an https page reach 127.0.0.1;
// Safari doesn't, so there Import song… stays the way in.
export const SIDECAR_PORTS = [7450, 7321];
const PORT_KEY = 'oscine.sidecarPort';
let remoteBase = null; // 'http://127.0.0.1:<port>/' once discovered
export function sidecarPort() { return remoteBase ? Number(new URL(remoteBase).port) : null; }
export function setRemoteSidecar(port) { remoteBase = port ? `http://127.0.0.1:${Number(port)}/` : null; }

function candidatePorts() {
  const out = [];
  try { const q = new URLSearchParams(location.search).get('sidecar'); if (q && /^\d{2,5}$/.test(q)) out.push(Number(q)); } catch {}
  try { const s = localStorage.getItem(PORT_KEY); if (s && /^\d{2,5}$/.test(s)) out.push(Number(s)); } catch {}
  return [...new Set([...out, ...SIDECAR_PORTS])];
}

export async function discoverSidecar({ timeoutMs = 900, fetchImpl = (typeof fetch === 'function' ? fetch : null) } = {}) {
  if (servedWithSidecar() || !fetchImpl) return null;
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol || '')) return null;
  const probe = async (port) => {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = setTimeout(() => ctl?.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/health`, { signal: ctl?.signal, cache: 'no-store' });
      if (!res.ok) return null;
      const j = await res.json();
      return j?.server === 'oscine-mcp' ? port : null;
    } catch { return null; } finally { clearTimeout(t); }
  };
  const found = (await Promise.all(candidatePorts().map(probe))).find(Boolean) ?? null;
  setRemoteSidecar(found);
  if (found) { try { localStorage.setItem(PORT_KEY, String(found)); } catch {} }
  return found;
}

// '/projects.json' -> 'http://host/<prefix>/projects.json'. Only root-absolute
// routes ('/x', not '//host' or 'http://...' or 'relative') are rewritten.
export function sidecarUrl(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) return route;
  const base = httpBase();
  return base ? new URL(route.slice(1), base).href : route;
}

// ws(s)://<host>/<prefix>/bridge for the page's own origin, or null off-http.
export function bridgeUrlHere() {
  const base = httpBase();
  if (!base) return null;
  const u = new URL('bridge', base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.href;
}

// Is this page served by something that fronts a sidecar (so /bridge here is worth
// trying)? Yes on localhost (the sidecar itself, as before) and when the page was
// opened with ?bridge=here (the stage proxy marks its links so). A hosted copy
// (GitHub Pages) has neither, and must not poll a /bridge that doesn't exist.
export function servedWithSidecar() {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol || '')) return false;
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return true;
  try { return new URLSearchParams(location.search).get('bridge') === 'here'; } catch { return false; }
}
