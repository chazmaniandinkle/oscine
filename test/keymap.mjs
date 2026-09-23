// Keymap: scheme inheritance, scope resolution, Mod handling, overrides.
// Runs under node: stub navigator + localStorage before import.
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel' }, configurable: true });
const mem = {};
globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } };

const { Keymap, SCHEMES, ACTIONS } = await import('../src/core/keymap.js');

let fails = 0;
const check = (name, ok, detail = '') => { console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? `  (${detail})` : '')); if (!ok) fails++; };
const ev = (code, m = {}) => ({ code, metaKey: !!m.meta, ctrlKey: !!m.ctrl, altKey: !!m.alt, shiftKey: !!m.shift });

const km = new Keymap();
check('default scheme is oscine', km.scheme === 'oscine');
check('Space -> transport.toggle', km.action(ev('Space')) === 'transport.toggle');
check('Mod+S on mac = meta -> project.save', km.action(ev('KeyS', { meta: true })) === 'project.save');
check('plain S in timeline scope -> clip.split', km.action(ev('KeyS'), ['timeline', 'global']) === 'clip.split');
check('plain S outside timeline scope -> nothing', km.action(ev('KeyS'), ['pattern', 'global']) === null);
check('Shift+] -> clip.gainUp (not pitchUp)', km.action(ev('BracketRight', { shift: true }), ['timeline']) === 'clip.gainUp');
check('] -> clip.pitchUp', km.action(ev('BracketRight'), ['timeline']) === 'clip.pitchUp');
check('Mod+Shift+Z -> redo', km.action(ev('KeyZ', { meta: true, shift: true })) === 'edit.redo');
check('Mod+Z -> undo', km.action(ev('KeyZ', { meta: true })) === 'edit.undo');
check('ctrl+S on mac is NOT save', km.action(ev('KeyS', { ctrl: true })) !== 'project.save');
check('Escape: range.clear wins in timeline scope', km.action(ev('Escape'), ['timeline', 'global']) === 'range.clear');
check('Escape: transport.stop outside timeline', km.action(ev('Escape'), ['pattern', 'global']) === 'transport.stop');

check('gesture: shift = rangeSelect', km.gesture('timeline.rangeSelect', ev('x', { shift: true })));
check('gesture: plain is not rangeSelect', !km.gesture('timeline.rangeSelect', ev('x')));
check('gesture: alt = clipStretch', km.gesture('timeline.clipStretch', ev('x', { alt: true })));
check('gesture: meta = zoom on mac', km.gesture('timeline.zoom', ev('x', { meta: true })));

km.use('ableton');
check('ableton: split is Mod+E', km.action(ev('KeyE', { meta: true }), ['timeline']) === 'clip.split');
check('ableton: plain S no longer splits', km.action(ev('KeyS'), ['timeline']) !== 'clip.split');
check('ableton inherits undo from oscine', km.action(ev('KeyZ', { meta: true })) === 'edit.undo');
// Corpus correction: Ableton slip is Ctrl+Shift(Win)/Shift+Option(Mac), i.e.
// Mod+Shift, not bare Mod. [ableton_arrangement_view_full.txt line 80]
check('ableton: slip is Mod+Shift-drag', km.gesture('timeline.clipSlip', ev('x', { meta: true, shift: true })) && !km.gesture('timeline.clipSlip', ev('x', { meta: true })));
check('scheme persisted', JSON.parse(mem['oscine.keymap']).scheme === 'ableton');

km.use('logic');
// Corpus correction: Logic's grid-override modifier is Control, not Mod.
// [logic_move_regions.txt line 5]
check('logic: noSnap is Ctrl-drag', km.gesture('timeline.noSnap', ev('x', { ctrl: true })) && !km.gesture('timeline.noSnap', ev('x', { meta: true })));
// Corpus correction: Logic has no corpus-backed drag-modifier for slip (it's
// a key command on the nudge value); scheme no longer overrides it, so it
// must inherit oscine's own Shift default. [logic_move_regions.txt]
check('logic: clipSlip inherits oscine default (Shift)', km.gesture('timeline.clipSlip', ev('x', { shift: true })) && !km.gesture('timeline.clipSlip', ev('x', { alt: true, meta: true })));

km.use('reaper');
// Corpus correction: REAPER's grid-override modifier is Shift.
// [reaper_userguide.txt line 6921]
check('reaper: noSnap is Shift-drag', km.gesture('timeline.noSnap', ev('x', { shift: true })) && !km.gesture('timeline.noSnap', ev('x', { meta: true })));
// Corpus correction: REAPER clipStretch is plain Alt, not Alt+Shift (Shift
// there means ignore-snap, a separate modifier). [reaper_userguide.txt line 7373]
check('reaper: clipStretch is Alt-drag (not Alt+Shift)', km.gesture('timeline.clipStretch', ev('x', { alt: true })) && !km.gesture('timeline.clipStretch', ev('x', { alt: true, shift: true })));

km.use('oscine');
check('switching back to oscine restores default clipSlip (Shift)', km.gesture('timeline.clipSlip', ev('x', { shift: true })) && !km.gesture('timeline.clipSlip', ev('x', { meta: true, shift: true })));
check('switching back to oscine restores default noSnap (Mod)', km.gesture('timeline.noSnap', ev('x', { meta: true })) && !km.gesture('timeline.noSnap', ev('x', { ctrl: true })) && !km.gesture('timeline.noSnap', ev('x', { shift: true })));
check('switching back to oscine restores default clipStretch (Alt)', km.gesture('timeline.clipStretch', ev('x', { alt: true })));
km.bind('clip.split', 'KeyK');
check('override: K splits', km.action(ev('KeyK'), ['timeline']) === 'clip.split');
check('override: S no longer splits', km.action(ev('KeyS'), ['timeline']) !== 'clip.split');
const km2 = new Keymap();
check('override survives reload', km2.action(ev('KeyK'), ['timeline']) === 'clip.split');
km2.reset();
check('reset restores S', km2.action(ev('KeyS'), ['timeline']) === 'clip.split');

check('label ⌘S', km2.label('project.save') === '⌘S', km2.label('project.save'));
check('label ⇧]', km2.label('clip.gainUp') === '⇧]', km2.label('clip.gainUp'));
check('every scheme key names a real action', Object.values(SCHEMES).every(s => Object.keys(s.keys || {}).every(a => ACTIONS[a])));

console.log(fails ? `\n${fails} FAILED` : '\nkeymap: all checks passed');
process.exit(fails ? 1 : 0);
