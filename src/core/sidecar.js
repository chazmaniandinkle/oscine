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
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol || '')) return null;
  try { return new URL('.', location.href); } catch { return null; }
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
