import sys, json, time; sys.path.insert(0, '/tmp/wt-autoui')
from cdp import *
c = C(); open_app(c)
c.call('Runtime.enable')
g = c.js(GEOM); print('lanes', [(l['id'], l['y'], l['h']) for l in g['lanes']])
L, T = g['left'], g['top']
# add eq3 insert to lane 0 (JS, as allowed)
lane0 = g['lanes'][0]['id']
print(c.js(f'''(() => {{ const o = window.oscine, a = o.store.project.arrangement; o.store.checkpoint();
  const i = a.lanes.findIndex(l => l.id === '{lane0}'); a.lanes[i].inserts = a.lanes[i].inserts || []; a.lanes[i].inserts.push({{type:'eq3',params:{{}},bypass:false}});
  o.app.bus.emit('inserts:changed', {{}}); return a.lanes[i].inserts.length; }})()'''))
nIns = c.js(f"window.oscine.store.project.arrangement.lanes.find(l=>l.id==='{lane0}').inserts.length") - 1
autoLen0 = c.js('JSON.stringify(window.oscine.store.project.arrangement.automation||[])')
print('automation before', autoLen0[:200])
# click A on lane 0
ly = g['lanes'][0]['y']
ax, ay = L + 150 - 72 + 10, T + ly + 31 + 8
def menu(): return c.js("[...document.querySelectorAll('.menu .menu-item')].map(b=>b.textContent)")
def pick(label):
    r = c.js(f"(() => {{ const b=[...document.querySelectorAll('.menu .menu-item')].find(b=>b.textContent.trim().replace(/^✓\\s*/,'')===`{label}`); const r=b.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; }})()")
    c.click(*r)
c.click(ax, ay); m = menu(); print('menu', m)
pick('Gain')
c.click(ax, ay); pick('Pan')
c.click(ax, ay); pick('EQ (3-band) · Low Shelf Gain')
c.click(ax, ay); print('menu after 3 picks', menu()); c.key('Escape'); c.js("document.querySelectorAll('.menu').forEach(m=>m.remove())")
g = c.js(GEOM); l0 = g['lanes'][0]; print('lane0 h', l0['h'], 'auto', l0['auto'], 'lane1 y', g['lanes'][1]['y'] if len(g['lanes'])>1 else None)
c.shot('/tmp/wt-autoui/s1-sublanes.png')
# click points: on each sub-lane at two x positions, known y fractions
X = lambda sec: c.js(f'window.oscine.app.timeline.x({sec})')
res = {}
for k, tgt in enumerate(l0['auto']):
    y0 = l0['y'] + 64 + k * 44
    # top-quarter point at 10s, bottom-quarter at 20s (snap may move t)
    c.click(L + X(10), T + y0 + 4 + 0.25 * 36)
    c.click(L + X(20), T + y0 + 4 + 0.75 * 36)
    res[tgt] = c.js(f"JSON.stringify((window.oscine.store.project.arrangement.automation||[]).find(a=>a.target==='{tgt}')?.points)")
for k, v in res.items(): print(k, v)
json.dump({'lane0': lane0, 'auto': l0['auto'], 'nIns': nIns}, open('/tmp/wt-autoui/state.json', 'w'))
