# UI edits go through store actions

Every change the arrangement UI makes to the project (timeline, mixer,
inspectors, source bin, app shortcuts) calls a store action in
`src/core/store.js`. The action runs a pure function from
`src/core/arrangement.js` as one undo step and emits the bus events. The UI
never writes to `store.project` itself, not even while previewing a drag.
The MCP/OSC catalog commands call the same actions, so the UI and an agent
edit the song the same way.

## Discrete edits

A click, a key or a menu pick calls one action and gets one undo step:

| Edit | Action |
|---|---|
| split at playhead | `clipSplit(index, t)` |
| split selection at range edges | `clipSplitMany(indices, [b, a])` |
| delete clip | `clipRemove(index)` |
| cut range from selected clips | `clipCutRange(indices, a, b)` |
| ripple delete | `rangeRippleDelete(a, b)` |
| clip rename, nudge pitch/gain | `clipSet(clip, fields)` (`null` resets a field) |
| place a source | `clipPlace({ asset, lane, at, name })` |
| lane add / remove / rename / reorder | `laneAdd`, `laneRemove`, `laneRename`, `laneReorder` |
| lane mute / solo / color | `laneSet(lane, fields)` |
| marker add / rename / delete | `markerAdd`, `markerRename`, `markerRemove` |
| cycle toggle / from range / click | `cycleSet({ a, b, on })` |
| insert add / bypass / reorder / remove / preset | `insertAdd`, `insertSet`, `insertMove`, `insertRemove` |
| automation point remove / shape | `automationRemovePoint`, `automationMovePoint` |
| source rename, transcript import | `assetRename`, `wordsSet` |
| fades on both sides of an overlap | `arrangementBatch([...])` (several ops, one undo step) |

A two-part edit that the user sees as one (double-click to add a marker, then
type its name) uses `arrangementAmend(ops)` for the second part, which folds
it into the undo step the first part made.

## Continuous gestures

Drags (clip move, trim, slip, stretch, duplicate-drag, marker drag, cycle
drag, automation point add and drag, lane gain in the gutter, mixer fader and
pan, insert knobs, inspector NumberDrags, the lane color picker) use the
gesture helpers:

```
first real movement   store.gestureBegin()             snapshot, no history
every move            store.gesturePreview(ops)        apply to the live project, no history
pointerup             store.gestureCommit(ops)         ONE undo step
abandon               store.gestureCancel()            back to the snapshot, no history
```

`ops` is a list of `[name, ...args]` naming functions in
`core/arrangement.js`, for example
`[['clipSet', id, { in: 3.2 }], ['movePlacement', 4, { at: 10.5 }]]` for a
left-edge trim. Two rules keep this simple:

- **Ops carry absolute values** (the new `at`, `in`, `gainDb`), never deltas,
  so applying the latest ops over the previous preview is the same as
  applying them to the original.
- **The commit gets the whole gesture**, including any setup op from the
  first movement (the `copyPlacement` of a duplicate-drag, the
  `addAutomationPoint` of a click on an empty sub-lane). `gestureCommit`
  replays that list on the pre-gesture snapshot, pushes the snapshot as the
  undo entry, and keeps the live objects when the replay matches the preview.

A press that never moves commits an empty list: the snapshot is restored and
no undo entry is made, so click-to-select stays free. An undo, redo or load in
the middle of a drag drops the gesture, and the pointerup is then ignored.
The UI remembers only ops that previewed without an error, so a frame the pure
function rejects (a trim past the source end, say) is skipped rather than
committed.

## Adding a new edit

1. Write the pure function in `core/arrangement.js` (no DOM, no audio, throws
   an actionable error on bad input).
2. Add a store action that wraps it in `arrangementEdit`, with the bus events
   the views need.
3. Add a check to `test/arrangement.mjs`: one undo step, undo restores, redo
   re-applies.
4. Call the action from the UI. For a drag, preview and commit ops through the
   gesture helpers.

## Proof

`scripts/verify/2026-09-23/store-actions-gestures.mjs` loads Borrowed Light in
headless Chrome and drives each gesture with the real mouse or keyboard: clip
drag, trim, split, marker drag and add, mixer fader, mute, insert add, bypass
and remove, inspector gain drag and rename, drag a source onto a lane, new and
removed lanes, and the cycle toggle. For each one it checks that the project
changed as expected, that exactly one undo reverts it and that redo restores
it. It then undoes everything and checks the song is back to the loaded state.
