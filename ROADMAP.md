# Roadmap

Where Oscine is headed, distilled from `docs/landscape.md` (the competitive
research behind these calls). The contract still holds: every capability lands
as a catalog command first, UI second (see `AGENTS.md`).

## Shipped

- Agent-native core: synthesis instruments (poly, FM, 8-lane drums), piano
  roll, velocity step grid, four pattern slots with queued switching, mixer,
  shared delay/reverb, master compressor, undo, KB-scale JSON projects, and the
  command catalog surfaced as MCP tools plus an OSC in/out gateway.
- Share loop (v1.4.0): WAV export via an offline render, and song-in-URL (the
  whole project encoded in a link, no upload, because projects are a few KB).

## Now: song mode

Turn the four pattern slots into an arrangement, so a project plays as a full
track instead of a single looping scene.

- Shape: an ordered list of sections, each a slot reference plus a repeat count
  (for example A x4, B x2, A x4, C x8). The transport already segments
  scheduling at loop boundaries and applies queued slot switches there, so an
  arrangement is a map from bar position to slot that the scheduler walks
  instead of looping one slot.
- Surface: a `song` catalog command to read and edit the section list and to
  toggle song-versus-loop playback, wired to a timeline strip in the UI. This
  pairs with the agent-jam angle, since the model can write and rearrange whole
  sections, not just patterns.
- Format: a new optional `song` field on the project (the ordered sections).
  Absent means "loop the active slot" as today, so existing projects and share
  links keep loading unchanged.

## Next

- MIDI input with live record and quantize (WebMIDI works on the hosted page
  with no sidecar). Completes the MCP + OSC + MIDI control trifecta.
- Per-step locks, probability, and ratchets: a step-schema extension plus
  scheduler support, and a genuinely new vocabulary for an agent to drive.
- Per-track insert effects and parameter automation: the channel strip is
  already a node chain, and automation is time-indexed param events scheduled
  in the same windows as notes.

## Later

- Sample playback. The one table-stakes item that trades against the
  tiny-project, song-in-URL story; reference files by hash and keep
  synthesis-only projects small. Defer until the items above land.
- Pattern-to-code export (an Oscine pattern out as Strudel code), as a cheap
  cross-community experiment.

Full rationale and the competitive picture live in `docs/landscape.md`.
