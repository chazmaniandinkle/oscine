// Shared driver: real MCP sidecar + headless app, call tools by name, render a slot for the ear.
import { spawn } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';
const ROOT = '/Users/slowbro/workspaces/oscine';
export const OUT = '/Users/slowbro/workspaces/cog/projects/songs/2026-10-08-cog-first-oscine';
export const friction = (s) => { appendFileSync(`${OUT}/friction-raw.log`, `${new Date().toISOString()} ${s}\n`); console.log('FRICTION:', s); };
export async function session(port = 7401) {
  const sc = spawn('node', [`${ROOT}/plugin/server/oscine-mcp.mjs`], {
    env: { ...process.env, OSCINE_PORT: String(port), OSCINE_OSC_PORT: String(port + 1), OSCINE_PROJECT_ROOT: '/Users/slowbro/workspaces/cog' },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let buf = '', id = 0; const waiters = new Map();
  sc.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); waiters.get(m.id)?.(m); } catch {} } });
  const rpc = (method, params = {}) => new Promise(ok => { const n = ++id; waiters.set(n, ok); sc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  const { chromium } = await import('playwright-core');
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cog-song', version: '1' } });
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.oscine?.store?.project, null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  const call = async (name, args = {}) => {
    const r = await rpc('tools/call', { name: 'oscine_' + name, arguments: args });
    const t = r.result?.content?.[0]?.text ?? JSON.stringify(r.error); let v; try { v = JSON.parse(t); } catch { v = t; }
    const err = !!r.result?.isError || !!r.error;
    if (err) console.log(`  ! ${name} ${JSON.stringify(args).slice(0, 120)} -> ${String(t).slice(0, 200)}`);
    return err ? { error: t } : v;
  };
  // Render one slot N loops to a wav under OUT (what a `listen` tool would do).
  const render = async (slotIndex, loops, file, tailSeconds = 0.01) => {
    const b64 = await page.evaluate(async ({ slotIndex, loops, tailSeconds }) => {
      const { renderProjectToBuffer } = await import('/src/engine/render.js');
      const { encodeWav } = await import('/src/core/wav.js');
      const res = await renderProjectToBuffer(structuredClone(window.oscine.store.project), { loops, slotIndex, tailSeconds });
      const blob = encodeWav([res.buffer.getChannelData(0), res.buffer.getChannelData(1)], res.sampleRate);
      const bytes = new Uint8Array(blob instanceof Blob ? await blob.arrayBuffer() : blob.buffer ?? blob);
      let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    }, { slotIndex, loops, tailSeconds });
    writeFileSync(`${OUT}/${file}`, Buffer.from(b64, 'base64'));
    return `${OUT}/${file}`;
  };
  const close = async () => { await browser.close(); sc.kill(); };
  return { call, render, close, page, errs };
}
