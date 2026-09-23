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
check('ableton: slip is Mod-drag', km.gesture('timeline.clipSlip', ev('x', { meta: true })) && !km.gesture('timeline.clipSlip', ev('x', { shift: true })));
check('scheme persisted', JSON.parse(mem['oscine.keymap']).scheme === 'ableton');

km.use('oscine');
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
