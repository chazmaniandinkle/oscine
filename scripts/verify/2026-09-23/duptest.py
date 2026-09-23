import json, time, urllib.request, websocket
t=[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')) if x['type']=='page'][0]
ws=websocket.create_connection(t['webSocketDebuggerUrl'],suppress_origin=True,max_size=None,timeout=60); n=[0]
def cdp(m,**p):
    n[0]+=1; ws.send(json.dumps({'id':n[0],'method':m,'params':p}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==n[0]: return r.get('result',r)
def js(e, aw=False): return cdp('Runtime.evaluate',expression=e,returnByValue=True,awaitPromise=aw).get('result',{}).get('value')
def mouse(kind,x,y,mods=0): cdp('Input.dispatchMouseEvent',type=kind,x=x,y=y,button='left',clickCount=1 if kind!='mouseMoved' else 0,modifiers=mods)
cdp('Runtime.enable'); cdp('Page.enable')
js("window.__errs=[]; window.addEventListener('error',e=>window.__errs.push(e.message))")
cdp('Page.navigate', url='http://127.0.0.1:7351/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json'); time.sleep(6)
g=json.loads(js("JSON.stringify(window.oscine.app.timeline.canvas.getBoundingClientRect())"))
TL="window.oscine.app.timeline"
# the carl placement
pi=js("window.oscine.store.project.arrangement.placements.findIndex(p=>p.track==='carl')")
pl=lambda i: json.loads(js(f"JSON.stringify(window.oscine.store.project.arrangement.placements[{i}])"))
p0=pl(pi); li=js(f"{TL}.lanes().findIndex(l=>l.id==='carl')"); li_to=js(f"{TL}.lanes().findIndex(l=>l.id==='vocal-r1')")
c=js(f"(()=>{{const c=window.oscine.store.project.clips['{p0['clip']}'];return {TL}.x({p0['at']}+(c.out-c.in)*(c.stretch??1)/2)}})()")
y_from=js(f"{TL}.laneY({li})+30"); y_to=js(f"{TL}.laneY({li_to})+30")
def drag(x0,y0,x1,y1,mods=0):
    mouse('mousePressed',g['x']+x0,g['y']+y0,mods)
    for i in range(1,9): mouse('mouseMoved',g['x']+x0+(x1-x0)*i/8,g['y']+y0+(y1-y0)*i/8,mods)
    mouse('mouseReleased',g['x']+x1,g['y']+y1,mods); time.sleep(0.1)
count=lambda: js("window.oscine.store.project.arrangement.placements.length")
n0=count()
print('before:', p0, '| placements', n0)
# 1. vertical move: carl -> vocal-r1 lane, straight down (dx=0), ⌘ = no snap
drag(c,y_from,c,y_to,mods=4)
p1=pl(pi); print('vertical move: track', p0['track'],'->',p1['track'], '| at unchanged:', abs(p1['at']-p0['at'])<1e-6, '| placements', count())
js("window.oscine.store.undo()"); print('undo -> track', pl(pi)['track'])
# 2. ⌥-drag = duplicate, 20 s right on the same lane
dx=js(f"{TL}.pxPerSec*20")
drag(c,y_from,c+dx,y_from,mods=1)
n1=count(); new=pl(n1-1)
print('dup: placements', n0,'->',n1, '| original at unchanged:', abs(pl(pi)['at']-p0['at'])<1e-6, '| copy at', round(new['at'],2), '(orig', round(p0['at'],2),'+~20) | copy clip', new['clip'], '| selected = copy:', js(f"{TL}.selected")==n1-1)
print('copy clip exists + same source:', js(f"(()=>{{const P=window.oscine.store.project;return P.clips['{new['clip']}']?.sourceOf===P.clips['{p0['clip']}'].sourceOf}})()"))
js("window.oscine.store.undo()"); print('undo -> placements', count(), '| copy clip gone:', js(f"!window.oscine.store.project.clips['{new['clip']}']"))
# 3. ⌥-click alone doesn't clone
mouse('mousePressed',g['x']+c,g['y']+y_from,1); mouse('mouseReleased',g['x']+c,g['y']+y_from,1); time.sleep(0.05)
print('⌥-click (no move) placements:', count(), '== n0:', count()==n0)
# 4. ⌥-drag down to another lane = duplicate onto that lane
drag(c,y_from,c,y_to,mods=1)
new=pl(count()-1); print('⌥-drag down: copy on', new['track'], '| original on', pl(pi)['track']); js("window.oscine.store.undo()")
# 5. REAPER scheme: ⌘-drag duplicates
js("(async()=>{(await import('/src/core/keymap.js')).keymap.use('reaper')})()", aw=True)
drag(c,y_from,c+dx,y_from,mods=4); print('reaper ⌘-drag: placements', count(), '(n0+1 =', n0+1, ')'); js("window.oscine.store.undo()")
js("(async()=>{(await import('/src/core/keymap.js')).keymap.use('oscine')})()", aw=True)
print('errors:', js("(window.__errs||[]).length"))
