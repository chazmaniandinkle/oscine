---
paths:
  - "src/api/**"
  - "src/ui/**"
  - "plugin/server/osc-gateway.js"
---

# The command catalog is the contract

- Every user-facing capability must exist as a command in
  `src/api/commands.js` with a matching `cmd_` handler in
  `src/api/api.js`. A UI feature added without a corresponding command
  breaks UI / MCP / OSC parity. Add the command first, then wire the UI
  to it.
- A new command needs a headless execution check in `test/smoke.mjs`
  (the suite fails if a catalog command has no handler).
- A new OSC address needs a route in `plugin/server/osc-gateway.js`
  (`routeOsc`) plus a routing-table assertion in the smoke suite.
- Command schemas are plain JSON Schema and double as the MCP
  `inputSchema`; keep descriptions accurate, they are what agents read.
