// Backfill Borrowed Light's Suno provenance through MCP tools, not by
// hand-editing JSON. Opens borrowed-light.oscine.json, adds the two Suno
// renders as assets (asset import: tags fill id/created/lyrics, the file is
// copied into assets/<sha>.m4a, never moved), links each to the Suno
// library entry with what Oscine sent, marks the four demucs stems as
// derived, and saves to borrowed-light.suno-backfill.oscine.json. The
// original project file is never written.
//
//   node scripts/verify/2026-09-23/suno-backfill.mjs
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const COG = '/Users/slowbro/workspaces/cog';
const SONG = 'projects/songs/2026-09-19-housekeeping-heat';
const ORIG = `${SONG}/borrowed-light.oscine.json`;
const COPY = `${SONG}/borrowed-light.suno-backfill.oscine.json`;
const PORT = 7391;

const sc = spawn('node', [`${ROOT}/plugin/server/oscine-mcp.mjs`], {
  env: { ...process.env, OSCINE_PORT: String(PORT), OSCINE_OSC_PORT: '7392', OSCINE_PROJECT_ROOT: COG },
  stdio: ['pipe', 'pipe', 'inherit'],
});
let buf = '', id = 0; const waiters = new Map();
sc.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); waiters.get(m.id)?.(m); } catch {} } });
const rpc = (method, params = {}) => new Promise(ok => { const n = ++id; waiters.set(n, ok); sc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
const call = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const t = r.result?.content?.[0]?.text ?? JSON.stringify(r.error);
  if (r.result?.isError) throw new Error(`${name}: ${t}`);
  try { return JSON.parse(t); } catch { return t; }
};

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? '  ok  ' : 'FAIL  ') + n + (d ? `  (${d})` : '')); if (!ok) fails++; };

const origBefore = await readFile(`${COG}/${ORIG}`, 'utf8');
const { chromium } = await import('playwright-core');
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'suno-backfill', version: '1' } });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => window.oscine?.bridge, null, { timeout: 20000 });
  await page.waitForTimeout(800);
  const open = await call('oscine_project_open_file', { path: ORIG });
  check('opened the original (read only)', open.ok !== false, JSON.stringify(open).slice(0, 100));

  const R1 = 'efcdfc1f-9c2d-4422-b1b5-f926811563fa', R2 = '39802a94-8c2f-49b7-bb77-79bfe022b18d';
  const i1 = await call('oscine_asset', { action: 'import', path: `${SONG}/renders/borrowed-light/render1-v13.m4a`, id: 'ast_src_r1', name: 'Suno render 1 (v13)' });
  const i2 = await call('oscine_asset', { action: 'import', path: `${SONG}/renders/borrowed-light/render2-v14.m4a`, id: 'ast_src_r2', name: 'Suno render 2 (v14)' });
  check('render1 imported, Suno id from its tags', i1.ok && i1.suno === R1, JSON.stringify(i1));
  check('render2 imported, Suno id from its tags', i2.ok && i2.suno === R2, JSON.stringify(i2));

  // What Oscine sent (spikes/suno/003-local-evidence section 4).
  const l1 = await call('oscine_suno', { action: 'link', asset: 'ast_src_r1', id: R1, sent: { lyrics: 'borrowed-light-suno-lyrics-v13-SEND.txt', style: 'borrowed-light-suno-style-v13-female.txt', confidence: 'high' } });
  const l2 = await call('oscine_suno', { action: 'link', asset: 'ast_src_r2', id: R2, sent: { lyrics: 'borrowed-light-suno-lyrics-v14-SEND.txt', style: 'borrowed-light-suno-style-v13b-dynamics.txt', confidence: 'guess' } });
  check('render1 linked to the library (sent v13 + v13-female, high)', l1.ok, JSON.stringify(l1));
  check('render2 linked (sent v14 + v13b-dynamics, guess)', l2.ok && l2.title, JSON.stringify(l2));

  // Stems: which render each came from (lane C, section 3; sha-verified).
  const stems = { ast_bed_r1: 'ast_src_r1', ast_vocal_r1: 'ast_src_r1', ast_bed_r2: 'ast_src_r2', ast_vocal_r2: 'ast_src_r2' };
  for (const [a, from] of Object.entries(stems)) {
    const r = await call('oscine_asset', { action: 'source', asset: a, source: { kind: 'derived', from, by: 'demucs' } });
    check(`${a} derived from ${from} by demucs`, r.ok && r.kind === 'derived', JSON.stringify(r));
  }

  const g1 = await call('oscine_asset', { action: 'get', asset: 'ast_src_r1' });
  const g2 = await call('oscine_asset', { action: 'get', asset: 'ast_src_r2' });
  check('render1 source: id, created, lyrics from file, sent', g1.source.id === R1 && g1.source.created && g1.source.lyrics.from === 'file' && g1.source.sent.confidence === 'high' && g1.source.provenance.lyrics === 'file', JSON.stringify(g1.source.provenance));
  check('render2 source: page fields present (fetched earlier)', g2.source.title && g2.source.model && g2.source.provenance.style === 'page', `${g2.source.title} / ${g2.source.model}`);
  check('render variants carry origin + codec', g1.variants[0].origin === 'suno-download' && g1.variants[0].codec === 'opus' && g1.variants[0].filename === 'render1-v13.m4a', JSON.stringify(g1.variants[0]));

  const saved = await call('oscine_project_save_file', { path: COPY });
  check('saved to the COPY', saved.ok && saved.path.endsWith('borrowed-light.suno-backfill.oscine.json'), saved.path);
  const origAfter = await readFile(`${COG}/${ORIG}`, 'utf8');
  check('original project file untouched', origAfter === origBefore);
  const doc = JSON.parse(await readFile(`${COG}/${COPY}`, 'utf8'));
  check('copy: 8 assets, 2 suno + 4 derived sources', Object.keys(doc.assets).length === 8
    && Object.values(doc.assets).filter(a => a.source?.kind === 'suno').length === 2
    && Object.values(doc.assets).filter(a => a.source?.kind === 'derived').length === 4);
  check('copy: placements unchanged', JSON.stringify(doc.arrangement.placements) === JSON.stringify(JSON.parse(origBefore).arrangement.placements));
} finally {
  await browser.close();
  sc.kill();
}
console.log(fails ? `\n${fails} FAILED` : '\nsuno-backfill: all checks passed');
process.exit(fails ? 1 : 0);
