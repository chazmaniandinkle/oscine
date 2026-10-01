// Prefs registry: registration contract, validation, persistence, listeners.
// Runs under node: stub localStorage before import (core/ must stay
// node-importable, so this also guards that).
const mem = {};
globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } };

const { prefs, definePref, defineSection, listPrefDefs, listSections, getPrefDef, prefOptions, Prefs, PREFS_KEY } =
  await import('../src/core/prefs/index.js');

let fails = 0;
const check = (name, ok, detail = '') => { console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? `  (${detail})` : '')); if (!ok) fails++; };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

// --- registration contract (mirrors defineEffect's) ---
check('built-ins are registered', listPrefDefs().length >= 7 && !!getPrefDef('snap.grid'));
check('sections are ordered and non-empty', listSections().map(s => s.id).join(',') === 'editing,view,keys,transcription', listSections().map(s => s.id).join(','));
check('every def has label + help + section', listPrefDefs().every(d => d.label && d.help && d.section));
check('listPrefDefs is grouped by section order', (() => {
  const secs = listSections().map(s => s.id), seen = listPrefDefs().map(d => secs.indexOf(d.section));
  return seen.every((v, i) => i === 0 || v >= seen[i - 1]);
})());
check('duplicate key is rejected', throws(() => definePref({ key: 'snap.grid', type: 'boolean', default: true, section: 'view', label: 'x', help: 'y' }), /already registered/));
check('unknown section is rejected', throws(() => definePref({ key: 'x.y', type: 'boolean', default: true, section: 'nope', label: 'x', help: 'y' }), /unknown section/));
check('missing help is rejected', throws(() => definePref({ key: 'x.z', type: 'boolean', default: true, section: 'view', label: 'x' }), /needs label \+ help/));
check('bad type is rejected', throws(() => definePref({ key: 'x.t', type: 'color', default: 1, section: 'view', label: 'x', help: 'y' }), /type boolean\|number\|string/));
check('a default that fails its own spec is rejected', throws(() => definePref({ key: 'x.bad', type: 'number', default: 99, min: 0, max: 10, section: 'view', label: 'x', help: 'y' }), /default is invalid/));
check('a rejected def is not half-registered', throws(() => getPrefDef('x.bad'), /unknown setting/));
check('duplicate section is rejected', throws(() => defineSection({ id: 'view', label: 'View' }), /already registered/));

// --- a pref registered by a feature module, after load ---
definePref({ key: 'test.demo', type: 'number', default: 2, min: 1, max: 4, section: 'view', label: 'Demo', help: 'test-only pref' });
check('late registration appears in the panel listing', listPrefDefs().some(d => d.key === 'test.demo'));
check('late registration appears in all()', prefs.all().some(p => p.key === 'test.demo' && p.value === 2));

// --- validation / coercion ---
check('unknown key names the known keys', throws(() => prefs.get('nope'), /Known: .*snap\.grid/));
check('option set is enforced', throws(() => prefs.set('snap.grid', 3), /one of: 0, 0.25, 0.5, 1, 4/));
check('min/max is enforced', throws(() => prefs.set('snap.distancePx', 99), /≤ 30/));
check("boolean accepts 'false'", prefs.set('view.follow', 'false') === false);
check('number accepts a numeric string', prefs.set('snap.distancePx', '12') === 12);
check('lazy options resolve (key schemes from the keymap)', prefOptions(getPrefDef('keys.scheme')).some(o => o.value === 'reaper'));

// --- persistence: defaults are not stored, stored values survive a reload ---
prefs.set('snap.grid', 1);
check('defaults are not written to storage', !('view.lyrics' in JSON.parse(mem[PREFS_KEY])));
check('changed values are written', JSON.parse(mem[PREFS_KEY])['snap.grid'] === 1);
const reloaded = new Prefs();
check('a fresh instance reads them back', reloaded.get('snap.grid') === 1 && reloaded.get('snap.distancePx') === 12);
check('an unset pref falls back to its default', reloaded.get('view.lyrics') === true);
// Registration order must not drop a stored value for a pref registered later.
mem[PREFS_KEY] = JSON.stringify({ ...JSON.parse(mem[PREFS_KEY]), 'test.late': 3 });
const late = new Prefs();
definePref({ key: 'test.late', type: 'number', default: 1, min: 1, max: 4, section: 'view', label: 'Late', help: 'registered after load' });
check('a value stored before registration is still honoured', late.get('test.late') === 3);
// A stored value that no longer validates degrades to the default, not a throw.
mem[PREFS_KEY] = JSON.stringify({ 'snap.grid': 7 });
check('a stale stored value falls back to the default', new Prefs().get('snap.grid') === 0.25);

// --- listeners ---
const seen = [];
const off = prefs.onChange((k, v, old) => seen.push([k, v, old]));
prefs.set('snap.on', false);
prefs.set('snap.on', false); // no-op: same value
check('onChange fires once per real change', seen.length === 1 && seen[0][0] === 'snap.on' && seen[0][1] === false && seen[0][2] === true, JSON.stringify(seen));
off();
prefs.set('snap.on', true);
check('unsubscribe works', seen.length === 1);
const thrower = prefs.onChange(() => { throw new Error('listener blew up'); });
let survived = true; try { prefs.set('snap.on', false); } catch { survived = false; }
check('a throwing listener does not break set()', survived && prefs.get('snap.on') === false);
thrower();

// --- reset ---
prefs.reset('snap.grid');
check('reset one restores its default', prefs.get('snap.grid') === 0.25);
prefs.reset();
check('reset all restores every default', prefs.all().every(p => p.value === p.default));
check('reset all empties storage', mem[PREFS_KEY] === '{}', mem[PREFS_KEY]);

// --- describe(): the shape the panel and MCP both consume ---
const d = prefs.describe('snap.distancePx');
check('describe carries value/default/type/label/help/min/max', d.value === 8 && d.default === 8 && d.type === 'number' && d.min === 2 && d.max === 30 && !!d.help);
check('describe lists options for a closed set', prefs.describe('snap.grid').options.join(',') === '0,0.25,0.5,1,4');

console.log(fails ? `\n${fails} FAILED` : '\nprefs: all checks passed');
process.exit(fails ? 1 : 0);
