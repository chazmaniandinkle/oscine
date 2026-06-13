---
paths:
  - "src/engine/**"
  - "src/core/**"
---

# Layer boundaries and the audio engine

- `src/core/` has no DOM and no audio. It must stay importable from node
  (the tests import it directly).
- `src/engine/` is audio only and never mutates the project. It reacts to
  bus events and mirrors state into Web Audio nodes; state changes flow
  store -> bus -> engine, never the other way.
- Add an instrument as one file in `src/engine/instruments/` that
  subclasses `BaseInstrument`, calls `defineInstrument({...})` with a
  param schema, and is imported from `instruments/index.js`. It then gets
  an inspector, presets, mixer strip, and full API/MCP/OSC control for
  free.
- Zero runtime dependencies, no build step. Do not introduce either.
