import sys, json, time; sys.path.insert(0, '/tmp/wt-autoui')
from cdp import *
c = C(); open_app(c)
A = 'window.oscine.store.project.arrangement'
def pts(t): return json.loads(c.js(f"JSON.stringify(({A}.automation||[]).find(a=>a.target==='{t}')?.points ?? null)"))
undo0 = c.js('window.oscine.store.undoStack?.length ?? window.oscine.store.history?.length ?? -1')
c.js(f"""(() => {{ const o = window.oscine, a = {A}; o.store.checkpoint();
  a.lanes[0].inserts = a.lanes[0].inserts || []; a.lanes[0].inserts.push({{type:'eq3',params:{{}},bypass:false}}); o.app.bus.emit('inserts:changed', {{}}); }})()""")
lane0 = c.js(f'{A}.lanes[0].id')
G, P, E, F = f'lane:{lane0}:gainDb', f'lane:{lane0}:pan', f'lane:{lane0}:insert:0:lowGain', f'lane:{lane0}:insert:0:lowFreq'
c.js(f"(() => {{ const tl = window.oscine.app.timeline; tl.autoOpen = new Set(['{G}','{E}','{F}']); tl.dirty = true; }})()")
time.sleep(0.3)
g = c.js(GEOM); L, T = g['left'], g['top']; l0 = g['lanes'][0]; print('auto', l0['auto'], 'h', l0['h'])
X = lambda s: L + c.js(f'window.oscine.app.timeline.x({s})')
def suby(k, f): return T + l0['y'] + 64 + k * 44 + 4 + (1 - f) * 36
# gain: 3 points
for sec, f in [(10, 0.9), (20, 0.3), (30, 0.8)]: c.click(X(sec), suby(0, f))
print('gain pts', [(round(p['t'], 2), p['v']) for p in pts(G)])
# drag middle gain point up
p1 = pts(G)[1]; c.drag(X(p1['t']), suby(0, 0.3), X(p1['t'] + 2), suby(0, 0.6))
print('after drag', [(round(p['t'], 2), p['v']) for p in pts(G)])
# alt-click removes last
p2 = pts(G)[2]; c.click(X(p2['t']), suby(0, 0.8), mods=1); print('after alt-click', len(pts(G)))
c.click(X(30), suby(0, 0.8))
# right-click on gain point 0 -> menu
def rclick_menu(x, y):
    c.mouse('mouseMoved', x, y); c.mouse('mousePressed', x, y, 'right'); c.mouse('mouseReleased', x, y, 'right'); time.sleep(0.2)
    return c.js("[...document.querySelectorAll('.menu .menu-item')].map(b=>({t:b.textContent, dis:b.classList.contains('menu-disabled'), title:b.title}))")
def pick(label):
    r = c.js(f"(() => {{ const b=[...document.querySelectorAll('.menu .menu-item')].find(b=>b.textContent.includes(`{label}`)); const r=b.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; }})()")
    c.click(*r)
p0 = pts(G)[0]; m = rclick_menu(X(p0['t']), suby(0, 0.9)); print('gain menu', m)
pick('Exponential'); print('gain p0 shape after picking disabled exp:', pts(G)[0]['shape'], 'menu open', c.js("document.querySelectorAll('.menu').length"))
c.js("document.querySelectorAll('.menu').forEach(m=>m.remove())")
m = rclick_menu(X(p0['t']), suby(0, 0.9)); pick('Hold'); print('gain p0 shape', pts(G)[0]['shape'])
# EQ lowGain (range -18..18 crosses zero -> exp disabled too); lowFreq 20..1000 -> exp allowed
for sec, f in [(10, 0.8), (25, 0.2)]: c.click(X(sec), suby(2, f))
print('lowFreq pts', pts(F))
m = rclick_menu(X(pts(F)[0]['t']), suby(2, 0.8)); print('lowFreq menu', m); pick('Exponential'); print('lowFreq p0', pts(F)[0])
for sec, f in [(10, 0.9), (25, 0.1)]: c.click(X(sec), suby(1, f))
m = rclick_menu(X(pts(E)[0]['t']), suby(1, 0.9)); print('lowGain menu dis', [x['dis'] for x in m]); c.js("document.querySelectorAll('.menu').forEach(m=>m.remove())")
time.sleep(0.3)
c.shot('/tmp/wt-autoui/s2-shapes.png', clip=dict(x=L, y=T + l0['y'], width=900, height=l0['h']))
# close gain via x -> dot indicator on A
c.click(L + 150 - 13, T + l0['y'] + 64 + 9)
print('open after x', c.js("[...window.oscine.app.timeline.autoOpen]"), 'hidden-dot', c.js(f"window.oscine.app.timeline.hasHiddenAuto({A}.lanes[0])"))
c.shot('/tmp/wt-autoui/s3-dot.png', clip=dict(x=L, y=T + l0['y'], width=400, height=140))
