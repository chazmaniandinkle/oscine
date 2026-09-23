# Spike: Oscine sidecar as a Zed ACP client

Branch `spike/acp-client`. Throwaway; nothing under `src/` touched.

## Questions

1. Which TypeScript ACP SDK is current (name, version, license)?
2. Can a node process (the sidecar) spawn a real ACP agent over stdio and run initialize → session/new → session/prompt?
3. Does an agent receive Oscine's MCP server via `session/new.mcpServers`, and can it see and call `oscine_*` tools?
4. Do session/update notifications stream (agent_message_chunk, tool_call, tool_call_update, plan)?
5. Are session/request_permission and fs/* handled by the client (deny writes by default, fs scoped to a temp dir)?
6. Which agents on this machine actually run: `hermes acp`, Claude Code adapter, `gemini --experimental-acp`?
7. Can a browser page drive the session through the sidecar (SSE down, POST up), including Allow/Deny?
8. How should the current selection travel with each prompt?
9. Can the same client talk to the CogOS kernel's ACP server (PR #588) unchanged? What must the kernel expose?

## Findings (appended as we go)

### Q1 SDK
- `@agentclientprotocol/sdk` **1.5.0**, Apache-2.0: the current one.
- `@zed-industries/agent-client-protocol` 0.4.5 is deprecated ("renamed to @agentclientprotocol/sdk").
- Claude adapter likewise: `@zed-industries/claude-code-acp` 0.16.2 is deprecated → `@agentclientprotocol/claude-agent-acp` 0.81.1 (Apache-2.0, bin `claude-agent-acp`).
- Installed into this dir only (`node_modules/` gitignored).

### Q6 Agents available
- `hermes acp` 0.20.4: `hermes acp --check` → OK.
- `gemini` 0.49.0 installed.
- `claude` CLI installed; adapter runs via `npx -y @agentclientprotocol/claude-agent-acp` (0.81.1). No auth step was needed: it used the existing Claude Code login.
- `gemini --experimental-acp` **BLOCKED**. `initialize` works, but `session/new` returns `-32000 "This client is no longer supported for Gemini Code Assist for individuals… migrate to Antigravity"`. Evidence: `evidence/gemini-oscine-status.ndjson`. Account-side, can't be fixed here.

### Q2–Q5: the client (`client.mjs`)
`startSession({agent, onEvent, decide, logPath})` spawns the agent, wraps its stdio in `ndJsonStream` + `ClientSideConnection`, and tees every JSON-RPC frame into NDJSON (`{dir:in|out,t,msg}`). Client-side handlers:
- `requestPermission`: goes through `decide(req)` (the UI) when it's given. Otherwise the default policy rejects `edit|delete|move|execute` or unknown kinds and allows the rest. Both the request and the decision are emitted as events.
- `readTextFile` / `writeTextFile`: resolved paths must be inside a per-session `mkdtemp` sandbox, or the call throws.
- `terminal: false` is advertised, so no terminal/* requests arrive.
- Optional `SPIKE_MODE` calls `session/set_mode` after `session/new`. See the Claude finding below for why that matters.

Runs (all real, all in `evidence/`):

| run | agent | result |
|---|---|---|
| `hermes-oscine-status.summary.json` (sanitized; raw transcript held private substrate reads) | hermes acp 0.20.4 | Protocol fine: 184 frames, 146 message chunks, 17 tool_calls. But the prompt "call oscine_status" was hijacked by Hermes' cog-orient ritual (profile SOUL). It never called oscine and took 153 s. |
| `hermes-tools-list.ndjson` | hermes `/tools` | Lists 19 *built-in* tools only. MCP tools aren't in the slash listing. |
| `hermes-oscine-status-direct.ndjson` | hermes, strict prompt | **PASS.** `tool_call mcp__oscine__oscine_status`, completed in 11 s. The summary quotes live sidecar state (v2.3.0, :7391, OSC :7392, appConnected false). |
| `claude-oscine-status-and-write.ndjson` | claude-agent-acp, mode `auto` (its default) | **PASS** for MCP: ToolSearch → `mcp__oscine__oscine_status` → summary. **But** the Write to hello.txt went through with **no** `session/request_permission`: in `auto` mode Claude decides for itself. The file landed in the sandbox cwd via its own Write tool, not fs/write_text_file. |
| `claude-default-mode-permission.ndjson` | claude-agent-acp, `set_mode default` | **PASS, full loop.** 2 `session/request_permission` frames: oscine_status (kind other) → `allow-once`; `Write …/hello.txt` (kind edit) → `reject` → tool_call_update `failed`. Agent reply: "hello.txt wasn't created because the Write call was denied." 20 s. |

Findings:
- **Q3 yes**: both working agents launched Oscine's sidecar from `session/new.mcpServers` (stdio, env array) and called `oscine_status`. The tool name as the agent sees it is `mcp__oscine__oscine_status`.
- **Q4**: seen: `agent_message_chunk`, `tool_call`, `tool_call_update`, `available_commands_update`, `usage_update`, `session_info_update`, `config_option_update`. Neither agent emitted `plan` for these one-step prompts. The UI renders it anyway (untested live).
- **Q5 permission**: works end to end, but **only if Oscine forces an ask-mode**. Claude's adapter defaults to `auto` and Hermes never asked at all. Hermes decides on its own through its approval config. Rule for the real build: after `session/new`, call `session/set_mode` to the mode whose description is "Always ask" when one exists. Also treat any `mcp__oscine__*` mutation as edit-class in the UI's policy.
- Agents write files **with their own tools**, not through `fs/*`: neither agent sent fs/read_text_file or fs/write_text_file. The scoped fs handlers are correct but can't be relied on as a sandbox. The session `cwd` plus ask-mode is the actual boundary.
- Each `session/new` spawns its **own** oscine-mcp child, which tries to bind 7391/7392. That's fine for the spike (nothing else was on those ports). In the product the sidecar *is* the MCP server, so the agent-spawned copy would collide with the running sidecar. See build plan: pass a thin stdio→HTTP proxy, or an `http` MCP server entry pointing at the live sidecar.

### Q7 Browser relay (`relay.mjs` + `ui.html` + `drive-ui.mjs`)
- `relay.mjs` (~60 LOC): `GET /events` (SSE), `POST /prompt {text}`, `POST /permission {id, optionId}`. `decide()` parks each `session/request_permission` in a Map, broadcasts it, and resolves when the browser POSTs an answer. The session starts on the first prompt, in `set_mode default`.
- `ui.html`: a chat box, streamed agent text, tool-call cards whose status comes from `tool_call_update`, a plan list, and permission cards with one button per ACP option (Allow/Deny classes come from `option.kind`).
- `drive-ui.mjs`: playwright-core from `oscine/node_modules` plus system headless Chrome. It types the prompt, clicks **Yes** on `mcp__oscine__*` and **No** on everything else, then waits for `stopReason`.
- **PASS**: `evidence/relay-ui.png` and `evidence/relay-claude.ndjson`. Cards: ToolSearch completed, `mcp__oscine__oscine_status` completed (permission → Yes), `Write …/hello.txt` **failed** (permission → No). Agent: "hello.txt was not created because the Write call was denied." `stopReason: end_turn`.
- The first run is kept as `evidence/relay-ui-allow-both.png` / `relay-claude-allow-both.ndjson`. The driver regex matched "oscine" inside the sandbox path `oscine-acp-*` and allowed the Write, so it proves the Allow path. Lesson for the real UI: classify permissions by `toolCall.name`/`kind`, never by title text.

### Q8 Selection context — design (not built)
**Pick: ACP content blocks on each `session/prompt`, `resource` (embedded) with an `oscine://` URI; MCP resources for anything the agent wants to re-read later.**

Each prompt = `[{type:'text', text}, {type:'resource', resource:{uri:'oscine://selection/<projectRel>#<rev>', mimeType:'application/vnd.oscine.selection+json', text: JSON}}]`, where JSON is
`{project, rev, range:{a,b}, lanes:[{id,name}], clips:[{id,placement,in,out}], section:{markerId,name,a,b}, ear:{rmsDb,peakDb,crest,centroidHz,pitchHz,pace}, playhead}`.

Why:
- The selection is a *snapshot at prompt time*. The agent should reason about what the user was looking at when they spoke, not what a later re-read shows after its own edits. An embedded resource freezes that, and `rev` (the undo-stack index) lets tools detect staleness.
- It's agent-agnostic and needs no round trip. Claude's adapter advertises `promptCapabilities.embeddedContext: true`, and it is the ACP-native way Zed attaches the current file/selection. Hermes doesn't advertise `embeddedContext`, so the sidecar falls back to a fenced JSON block inside the text part (same payload). That's a one-line branch on the init capabilities.
- `resource_link` alone would force a tool call to dereference it, which costs a turn and races with edits. MCP resources (`resources/read oscine://...`) stay useful for *large* things (full arrangement JSON, word timings, ear profiles per section), so each prompt embeds a small selection plus `resource_link`s to the big ones. The sidecar already owns the MCP server, so exposing `oscine://project/current` and `oscine://ear/<range>` is cheap.
- Edits still go through `oscine_*` tools → store actions → live app with undo. Selection context is read-only.

### Q9 Kernel ACP server (PR #588, ADR-093)
What the kernel is building:
- PR #588 (`spike/acp-golden-corpus`, OPEN): golden claude stream-json corpus, cancellation semantics, `ManagedSession` 5-state machine. It explicitly leaves out the **HTTP surface** and the **ACP translator** ("next: written against this corpus").
- ADR-093 (`myrgic/cogos/docs/adrs/093-managed-session-processes-for-attachment.md`): a `ManagedSession` owns a long-lived `claude` process behind a transport-agnostic `SessionChannel`, with REST lifecycle `POST /v1/managed-sessions/{id}/resume`, `GET /v1/managed-sessions`, `DELETE …`. ACP framing via `coder/acp-go-sdk`; stream-json → `session/update` translator (~300 LOC). Transport "may begin with stdio"; **WebSocket for browser-direct is deferred**. `--mcp-config` injection of MCP servers is listed as "NOT validated".
- `internal/conductor` is the other direction: the kernel as ACP *client* driving Hermes and others (RFC-036). It isn't relevant to Oscine connecting in, but it proves the kernel speaks the standard wire.

Can Oscine's client connect unchanged? **Almost: the ACP layer is unchanged, the transport is one line.**
- The ACP method set Oscine uses (initialize, session/new with mcpServers, session/prompt, session/update, session/request_permission, session/set_mode, session/cancel) is the standard. Once the kernel's translator emits spec `session/update` frames, `client.mjs` needs no protocol change.
- Transport: `@agentclientprotocol/sdk` 1.5.0 already ships `createHttpStream(url)` (Streamable HTTP: POST up, SSE down, `Acp-Connection-Id` / `Acp-Session-Id` headers) and `createWebSocketStream(url)`. Swapping `ndJsonStream(stdin, stdout)` for either is the only client change. Stdio also works with no kernel HTTP at all if cogos ships a `cogos acp` stdio shim (Zed-compatible, like `hermes acp`).
- **Kernel asks** (in priority order):
  1. A spec ACP endpoint: `cogos acp` (stdio), **and/or** `/v1/acp` speaking the SDK's Streamable-HTTP or WS transport exactly (same headers). Not a bespoke REST+SSE shape. The `/v1/managed-sessions` REST lifecycle can sit alongside it, but a client should only need ACP.
  2. **Honour `session/new.mcpServers`** (stdio + http), passed through to claude's `--mcp-config`. This is the whole Oscine value: the agent gets `oscine_*`. ADR-093 lists this as unvalidated.
  3. **Route `session/request_permission` to the attached client.** Don't auto-decide in the kernel Governor when a client is attached. The Governor can pre-filter, but Oscine must see edit-class calls on its own tools. Expose modes (`default`/ask) through `session/set_mode`.
  4. Map claude `tool_use` → `tool_call` (+`kind`, `rawInput`) and `tool_result` → `tool_call_update` status, which the corpus now makes possible, and emit `plan` from TodoWrite.
  5. Advertise `promptCapabilities.embeddedContext: true` and pass `resource` blocks into the claude prompt (for selection context).
  6. Local auth for the HTTP transport (bearer/cookie via `headers`), with `loadSession` for reconnect after a browser reload.

## Verdict: **VALIDATED** (with two caveats)
"Oscine's sidecar can be a standards ACP client that hands its own MCP tools to any ACP agent, with a chat UI in the app": proven against **two** real agents (Hermes 0.20.4, Claude via claude-agent-acp 0.81.1). Both called `mcp__oscine__oscine_status` and got live sidecar state back. Permission Allow/Deny worked end to end from a browser page.
Caveats:
1. Permission prompts only show up when the agent is in an ask-mode. Claude's `auto` default and Hermes's own approval config decided without asking, so the client must `set_mode` and must not rely on fs/* as a sandbox.
2. Agent-spawned oscine-mcp copies collide with the running sidecar's ports. The real build must point agents at the *live* sidecar.
Gemini is blocked (account migration to Antigravity), and that isn't an Oscine problem.

## Build plan (real feature)
**Sidecar** (`plugin/server/`):
- `acp/client.mjs`: this spike's `startSession`, promoted. A registry of agents (`hermes acp`, `npx @agentclientprotocol/claude-agent-acp`, `cogos acp`/kernel URL) in `~/.oscine/agents.json`. One session per project; cancel on stop; `session/load` on reload when `loadSession` is advertised.
- `acp/relay.mjs`: routes on the existing sidecar HTTP server, `GET /acp/events` (SSE), `POST /acp/prompt`, `POST /acp/permission`, `POST /acp/cancel`, `GET /acp/agents`. Same-origin guard like `/reveal`.
- MCP hand-off: add a streamable-HTTP MCP endpoint to oscine-mcp (`/mcp`) and pass `{type:'http', name:'oscine', url:'http://127.0.0.1:<port>/mcp'}` when `mcpCapabilities.http` (Claude: yes). Otherwise pass a stdio proxy `oscine-mcp.mjs --proxy <port>` that forwards to the live sidecar and doesn't bind ports. That fixes the port collision and makes agent edits land in the open app with undo.
- Policy: `set_mode` to the ask mode. Auto-allow read-class `oscine_*` tools (status/list/get/ear), and prompt for mutating `oscine_*` plus any edit/execute kind. Classify by `toolCall.name` and `kind`.

**App** (`src/ui/assistant.js` + `main.css`): a docked command bar (⌘K / keymap action `assistant.focus`) that expands into a chat panel. Streamed text, tool cards that link to the undo entry they created, inline permission cards, and a "context" chip showing what selection gets attached. `src/core/selectionContext.js` builds the Q8 payload from store + ear.

**Commands**: `npm run sync-plugin`. Tests: `test/acp-relay.mjs` (fake agent over the SDK's AgentSideConnection, no network) plus a verify harness modelled on `drive-ui.mjs` against the real app.

**Kernel ask**: the Q9 list, items 1–3 at minimum. Then Oscine points at the kernel by swapping the stream constructor.

## Reproduce
```
npm i                                  # installs @agentclientprotocol/sdk 1.5.0 here only
node client.mjs hermes "<prompt>"      # or: claude | gemini ; SPIKE_MODE=default for ask-mode
AGENT=claude node relay.mjs            # http://127.0.0.1:7399
node drive-ui.mjs                      # headless Chrome; writes evidence/relay-ui.png
```
Evidence frames are NDJSON `{dir:"in"|"out", t, msg}`: every JSON-RPC frame in both directions.
