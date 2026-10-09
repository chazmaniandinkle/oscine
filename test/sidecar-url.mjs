// sidecarUrl / bridgeUrlHere / servedWithSidecar: the app's sidecar routes resolve
// against the page's own base so it works at a site root and behind a proxy prefix.
import { sidecarUrl, bridgeUrlHere, servedWithSidecar, discoverSidecar, sidecarPort, setRemoteSidecar } from '../src/core/sidecar.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const at = (href) => {
  const u = new URL(href);
  globalThis.location = { href: u.href, protocol: u.protocol, hostname: u.hostname, host: u.host, search: u.search };
};

delete globalThis.location;
check('no location (node): untouched', sidecarUrl('/projects.json') === '/projects.json');
check('no location: no bridge url', bridgeUrlHere() === null && servedWithSidecar() === false);

at('http://127.0.0.1:7450/?p=a.oscine.json');
check('site root: stays root-absolute', sidecarUrl('/projects.json') === 'http://127.0.0.1:7450/projects.json');
check('site root: bridge', bridgeUrlHere() === 'ws://127.0.0.1:7450/bridge');
check('localhost is served with sidecar', servedWithSidecar() === true);

at('https://stage.example.net/r/KEY123/oscine/?p=x%2Fy.oscine.json&bridge=here');
check('prefix: keeps /r/KEY/oscine/', sidecarUrl('/projects.json') === 'https://stage.example.net/r/KEY123/oscine/projects.json');
check('prefix: project-doc', sidecarUrl('/project-doc/a%20b/c.oscine.json') === 'https://stage.example.net/r/KEY123/oscine/project-doc/a%20b/c.oscine.json');
check('prefix: asset bytes', sidecarUrl('/project/songs/s/assets/ab.wav') === 'https://stage.example.net/r/KEY123/oscine/project/songs/s/assets/ab.wav');
check('prefix: query kept', sidecarUrl('/suno/library?id=1') === 'https://stage.example.net/r/KEY123/oscine/suno/library?id=1');
check('prefix: wss bridge', bridgeUrlHere() === 'wss://stage.example.net/r/KEY123/oscine/bridge');
check('?bridge=here opts in on a remote host', servedWithSidecar() === true);
check('relative and absolute-URL routes untouched', sidecarUrl('assets/x.wav') === 'assets/x.wav' && sidecarUrl('https://a/b') === 'https://a/b' && sidecarUrl('//a/b') === '//a/b');

at('https://chazmaniandinkle.github.io/oscine/');
check('hosted copy without the marker does not poll /bridge', servedWithSidecar() === false);
check('hosted copy under a path: base-relative', sidecarUrl('/projects.json') === 'https://chazmaniandinkle.github.io/oscine/projects.json');

at('file:///tmp/index.html');
check('file://: untouched', sidecarUrl('/projects.json') === '/projects.json' && bridgeUrlHere() === null);

// discoverSidecar: a hosted page finds a local sidecar and routes to it.
{
  const store = {};
  globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
  const fakeFetch = (live) => async (url) => {
    const port = Number(new URL(url).port);
    if (!live.includes(port)) throw new Error('refused');
    return { ok: true, json: async () => ({ server: 'oscine-mcp' }) };
  };
  at('https://chazmaniandinkle.github.io/oscine/');
  let port = await discoverSidecar({ fetchImpl: fakeFetch([7450]) });
  check('hosted: finds the managed sidecar on 7450', port === 7450 && sidecarPort() === 7450);
  check('hosted: routes go to the local sidecar', sidecarUrl('/projects.json') === 'http://127.0.0.1:7450/projects.json');
  check('hosted: port remembered', store['oscine.sidecarPort'] === '7450');
  port = await discoverSidecar({ fetchImpl: fakeFetch([7321]) });
  check('hosted: falls back to the plugin default 7321', port === 7321);
  at('https://chazmaniandinkle.github.io/oscine/?sidecar=9001');
  port = await discoverSidecar({ fetchImpl: fakeFetch([9001, 7450]) });
  check('hosted: ?sidecar=PORT wins', port === 9001);
  port = await discoverSidecar({ fetchImpl: fakeFetch([]) });
  check('hosted: none found -> back to page-relative routes', port === null && sidecarPort() === null && sidecarUrl('/projects.json') === 'https://chazmaniandinkle.github.io/oscine/projects.json');
  port = await discoverSidecar({ fetchImpl: async () => ({ ok: true, json: async () => ({ server: 'something-else' }) }) });
  check('hosted: ignores a non-oscine server on the port', port === null);
  at('http://127.0.0.1:7450/');
  port = await discoverSidecar({ fetchImpl: fakeFetch([7450]) });
  check('served by the sidecar: no discovery (already same-origin)', port === null && sidecarUrl('/projects.json') === 'http://127.0.0.1:7450/projects.json');
  setRemoteSidecar(null);
}

console.log(`\nsidecar-url: ${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
