// Spike: Oscine sidecar as an ACP client.
// Spawns an ACP agent over stdio, hands it Oscine's MCP server in session/new,
// streams session/update, answers session/request_permission and fs/*.
// Every raw JSON-RPC frame is logged as NDJSON ({dir:'out'|'in', t, msg}).
//
// CLI:   node client.mjs <agent> "<prompt>" [--allow] [--log evidence/x.ndjson]
//        agent = hermes | claude | gemini | "cmd arg arg"
// Module: import { startSession } from './client.mjs'

import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as acp from '@agentclientprotocol/sdk';

export const AGENTS = {
  hermes: ['hermes', ['acp']],
  claude: ['npx', ['-y', '@agentclientprotocol/claude-agent-acp']],
  gemini: ['gemini', ['--experimental-acp']],
};

export const OSCINE_MCP = {
  name: 'oscine',
  command: process.execPath, // node
  args: ['~/workspaces/oscine/plugin/server/oscine-mcp.mjs'],
  env: [
    { name: 'OSCINE_PORT', value: process.env.SPIKE_OSCINE_PORT || '7391' },
    { name: 'OSCINE_OSC_PORT', value: process.env.SPIKE_OSCINE_OSC_PORT || '7392' },
    { name: 'OSCINE_PROJECT_ROOT', value: '~/workspaces/cog' },
  ],
};

const WRITE_KINDS = new Set(['edit', 'delete', 'move', 'execute']);

/**
 * @param {object} o
 * @param {string} o.agent  key of AGENTS or a raw command line
 * @param {(ev:object)=>void} o.onEvent   UI-level events
 * @param {(req:object)=>Promise<string|null>} [o.decide] returns optionId or null(cancel)
 * @param {string} [o.logPath]
 */
export async function startSession({ agent, onEvent = () => {}, decide, logPath, cwd }) {
  const [cmd, args] = AGENTS[agent] || [agent.split(' ')[0], agent.split(' ').slice(1)];
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'oscine-acp-'));
  cwd = cwd || sandbox;
  const log = logPath ? fs.createWriteStream(logPath, { flags: 'a' }) : null;
  const frame = (dir, line) => {
    if (!log || !line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { msg = { raw: line }; }
    log.write(JSON.stringify({ dir, t: Date.now(), msg }) + '\n');
  };

  const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  child.stderr.on('data', (d) => onEvent({ type: 'stderr', text: String(d) }));
  child.on('exit', (code) => onEvent({ type: 'exit', code }));

  // tee frames: agent -> client
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { frame('in', buf.slice(0, i)); buf = buf.slice(i + 1); }
  });
  const input = Readable.toWeb(child.stdout);
  // tee frames: client -> agent
  const output = new WritableStream({
    write(chunk) {
      const s = new TextDecoder().decode(chunk);
      s.split('\n').forEach((l) => frame('out', l));
      return new Promise((res, rej) => child.stdin.write(chunk, (e) => (e ? rej(e) : res())));
    },
  });

  const inSandbox = (p) => {
    const r = path.resolve(p);
    if (!r.startsWith(sandbox + path.sep) && r !== sandbox) throw new Error(`fs outside sandbox: ${r}`);
    return r;
  };

  const client = {
    async requestPermission(req) {
      onEvent({ type: 'permission', request: req });
      let optionId;
      if (decide) optionId = await decide(req);
      else {
        // default policy: deny anything that writes/executes; allow reads
        const kind = req.toolCall?.kind;
        const want = WRITE_KINDS.has(kind) || kind == null ? 'reject' : 'allow';
        optionId = req.options.find((o) => o.kind.startsWith(want))?.optionId;
      }
      onEvent({ type: 'permission_decision', optionId: optionId ?? null });
      return optionId
        ? { outcome: { outcome: 'selected', optionId } }
        : { outcome: { outcome: 'cancelled' } };
    },
    async sessionUpdate(n) { onEvent({ type: 'update', update: n.update }); },
    async readTextFile({ path: p, line, limit }) {
      let text = fs.readFileSync(inSandbox(p), 'utf8');
      if (line || limit) {
        const ls = text.split('\n'); const s = (line || 1) - 1;
        text = ls.slice(s, limit ? s + limit : undefined).join('\n');
      }
      onEvent({ type: 'fs_read', path: p });
      return { content: text };
    },
    async writeTextFile({ path: p, content }) {
      fs.writeFileSync(inSandbox(p), content);
      onEvent({ type: 'fs_write', path: p });
      return {};
    },
  };

  const conn = new acp.ClientSideConnection(() => client, acp.ndJsonStream(output, input));
  const init = await conn.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    clientInfo: { name: 'oscine-spike', version: '0.0.1' },
  });
  onEvent({ type: 'initialized', init });
  const sess = await conn.newSession({ cwd, mcpServers: [OSCINE_MCP] });
  onEvent({ type: 'session', sessionId: sess.sessionId, raw: sess });
  // Oscine should own the permission policy: force the agent's "ask" mode if it has one.
  const mode = process.env.SPIKE_MODE;
  if (mode && sess.modes?.availableModes?.some((m) => m.id === mode)) {
    await conn.setSessionMode({ sessionId: sess.sessionId, modeId: mode });
    onEvent({ type: 'mode_set', modeId: mode });
  }

  return {
    sessionId: sess.sessionId, init, sandbox, conn,
    prompt: async (text, extraBlocks = []) =>
      conn.prompt({ sessionId: sess.sessionId, prompt: [{ type: 'text', text }, ...extraBlocks] }),
    cancel: () => conn.cancel({ sessionId: sess.sessionId }),
    close: () => { child.stdin.end(); child.kill(); log?.end(); },
  };
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const [agent = 'hermes', text = 'Call the oscine_status tool and summarize what it returns in two sentences. Do not modify anything.'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const logArg = process.argv.indexOf('--log');
  const logPath = logArg > 0 ? process.argv[logArg + 1] : `evidence/${agent}-${Date.now()}.ndjson`;
  const tally = {};
  const onEvent = (ev) => {
    if (ev.type === 'update') {
      const u = ev.update; tally[u.sessionUpdate] = (tally[u.sessionUpdate] || 0) + 1;
      if (u.sessionUpdate === 'agent_message_chunk') process.stdout.write(u.content?.text ?? '');
      else if (u.sessionUpdate === 'tool_call') console.log(`\n[tool_call] ${u.title} (${u.kind}) ${u.status}`);
      else if (u.sessionUpdate === 'tool_call_update') console.log(`\n[tool_call_update] ${u.toolCallId} ${u.status ?? ''}`);
      else if (u.sessionUpdate === 'plan') console.log(`\n[plan] ${u.entries?.length} entries`);
    } else if (ev.type === 'stderr') { if (process.env.SPIKE_STDERR) process.stderr.write(ev.text); }
    else if (ev.type === 'initialized') console.log('[init]', JSON.stringify(ev.init).slice(0, 400));
    else if (ev.type === 'session') console.log('[session]', ev.sessionId);
    else console.log(`[${ev.type}]`, JSON.stringify(ev).slice(0, 300));
  };
  const t0 = Date.now();
  const s = await startSession({ agent, onEvent, logPath });
  const timeout = setTimeout(() => { console.log('\n[timeout]'); s.cancel(); }, Number(process.env.SPIKE_TIMEOUT || 180000));
  try {
    const r = await s.prompt(text);
    console.log(`\n[done] stopReason=${r.stopReason} in ${Date.now() - t0}ms updates=${JSON.stringify(tally)} log=${logPath}`);
  } catch (e) { console.log('\n[error]', e?.message || JSON.stringify(e)); }
  clearTimeout(timeout); s.close(); process.exit(0);
}
