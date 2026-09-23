import sys, json, time; sys.path.insert(0, '/tmp/wt-autoui')
from cdp import *
c = C(); open_app(c)
A = 'window.oscine.store.project.arrangement'
g = c.js(GEOM); L, T = g['left'], g['top']
X = lambda s: L + c.js(f'window.oscine.app.timeline.x({s})')
ms = lambda: json.loads(c.js(f"JSON.stringify({A}.markers ?? [])"))
depth = lambda: c.js("(() => { const s = window.oscine.store; return (s.undoStack ?? s.past ?? s._undo ?? []).length; })()")
print('markers before', ms(), 'undo depth', depth())
my = T + 22 + 8
# dblclick empty strip -> new marker, inline input
c.click(X(40), my, clicks=2)
inp = c.js("(() => { const i = document.querySelector('.marker-edit'); if (!i) return null; const r = i.getBoundingClientRect(); return {v: i.value, x: r.left, y: r.top, focus: document.activeElement === i}; })()")
print('input after dblclick-add', inp, 'marker x', X(40), 'prompt used?', False)
c.js("document.querySelector('.marker-edit').select()")
c.type('Chorus One'); c.key('Enter', 'Enter', vk=13); time.sleep(0.2)
print('after Enter', [m['name'] for m in ms()], 'input gone', c.js("!document.querySelector('.marker-edit')"), 'undo depth', depth())
c.shot('/tmp/wt-autoui/s4-marker.png', clip=dict(x=L, y=T, width=800, height=60))
# rename existing via dblclick, Esc cancels
mx = X(ms()[-1]['t']) + 3
c.click(mx, my, clicks=2); c.type('XX'); c.key('Escape', 'Escape', vk=27); time.sleep(0.2)
print('after Esc', [m['name'] for m in ms()])
# rename + blur commits
c.click(mx, my, clicks=2); c.js("document.querySelector('.marker-edit').select()"); c.type('Bridge'); 
c.js("document.querySelector('.marker-edit').blur()"); time.sleep(0.2)
print('after blur', [m['name'] for m in ms()], 'undo depth', depth())
# typing space in the input must not start transport
c.click(mx, my, clicks=2); c.type(' '); c.key(' ', 'Space', text=' ', vk=32); time.sleep(0.2)
print('playing after space in input?', c.js('!!window.oscine.app.transport.playing'))
c.key('Escape', 'Escape', vk=27)
# undo x2: rename to Bridge, then add+name as a single step
c.js('window.oscine.store.undo()'); print('undo1', [m['name'] for m in ms()])
c.js('window.oscine.store.undo()'); print('undo2', [m['name'] for m in ms()])
