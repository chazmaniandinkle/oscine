// sidecarUrl / bridgeUrlHere / servedWithSidecar: the app's sidecar routes resolve
// against the page's own base so it works at a site root and behind a proxy prefix.
import { sidecarUrl, bridgeUrlHere, servedWithSidecar } from '../src/core/sidecar.js';

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

console.log(`\nsidecar-url: ${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
