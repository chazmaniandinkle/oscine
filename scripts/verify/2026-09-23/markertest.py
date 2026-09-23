import json, time, base64, urllib.request, websocket
t=[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')) if x['type']=='page'][0]
ws=websocket.create_connection(t['webSocketDebuggerUrl'],suppress_origin=True,max_size=None,timeout=60); n=[0]
def cdp(m,**p):
    n[0]+=1; ws.send(json.dumps({'id':n[0],'method':m,'params':p}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==n[0]: return r.get('result',r)
def js(e, aw=False): return cdp('Runtime.evaluate',expression=e,returnByValue=True,awaitPromise=aw).get('result',{}).get('value')
def mouse(kind,x,y,mods=0,cc=1): cdp('Input.dispatchMouseEvent',type=kind,x=x,y=y,button='left',clickCount=cc if kind!='mouseMoved' else 0,modifiers=mods)
def key(code,k,mods=0): cdp('Input.dispatchKeyEvent',type='keyDown',code=code,key=k,modifiers=mods); cdp('Input.dispatchKeyEvent',type='keyUp',code=code,key=k,modifiers=mods)
cdp('Runtime.enable'); cdp('Page.enable')
js("window.__errs=[]; window.addEventListener('error',e=>window.__errs.push(e.message)); window.prompt=(q,d)=>window.__nextName||d")
cdp('Page.navigate', url='http://127.0.0.1:7351/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json'); time.sleep(6)
js("window.prompt=(q,d)=>window.__nextName||d")
g=json.loads(js("JSON.stringify(window.oscine.app.timeline.canvas.getBoundingClientRect())"))
TL="window.oscine.app.timeline"; X=lambda s: js(f"{TL}.x({s})")
MK=lambda: json.loads(js("JSON.stringify((window.oscine.store.project.arrangement.markers||[]).map(m=>[m.name,+m.t.toFixed(2)]))"))
my=g['y']+22+8
js("document.activeElement?.blur()")
# M at playhead positions → markers
for t_ in (0, 44.5, 101.2):
    js(f"window.oscine.transport.songPos={t_}"); key('KeyM','m')
print('M×3:', MK())
# double-click the second marker → rename (prompt stubbed)
js("window.__nextName='Verse 1'")
mouse('mousePressed',g['x']+X(44.5),my,cc=1); mouse('mouseReleased',g['x']+X(44.5),my,cc=1)
mouse('mousePressed',g['x']+X(44.5),my,cc=2); mouse('mouseReleased',g['x']+X(44.5),my,cc=2); time.sleep(0.05)
print('dbl-click rename:', MK())
# double-click empty strip → add + name
js("window.__nextName='Bridge'")
mouse('mousePressed',g['x']+X(150),my,mods=4,cc=2); mouse('mouseReleased',g['x']+X(150),my,mods=4,cc=2); time.sleep(0.05)
print('dbl-click add:', MK())
# drag Bridge from 150 → 160 (⌘ no snap)
x0=X(150); x1=X(160)
mouse('mousePressed',g['x']+x0,my,mods=4)
for i in range(1,6): mouse('mouseMoved',g['x']+x0+(x1-x0)*i/5,my,mods=4)
mouse('mouseReleased',g['x']+x1,my,mods=4); time.sleep(0.05)
print('drag Bridge → ~160:', MK())
# ⇧-click inside Verse 1 section selects it as range
mouse('mousePressed',g['x']+X(70),my,mods=8); mouse('mouseReleased',g['x']+X(70),my,mods=8); time.sleep(0.05)
print('⇧-click section → range:', js(f"JSON.stringify({TL}.range && [{TL}.range.a.toFixed(2),{TL}.range.b.toFixed(2)])"))
js(f"{TL}.range=null")
# ⌥. / ⌥, navigation
js("window.oscine.transport.songPos=50"); key('Period','.',mods=1); a=js("window.oscine.transport.songPos"); key('Comma',',',mods=1); b=js("window.oscine.transport.songPos")
print('⌥. from 50 →', round(a,2), '| ⌥, →', round(b,2))
# select Bridge + ⌫ deletes it
mouse('mousePressed',g['x']+X(MK()[-1][1]),my); mouse('mouseReleased',g['x']+X(MK()[-1][1]),my); time.sleep(0.05)
key('Backspace','Backspace'); print('⌫ on selected marker:', MK())
js("window.oscine.store.undo()"); print('undo:', [m[0] for m in MK()])
# ruler scrub still works from the TICK row; lanes geometry unaffected by the strip
js("window.oscine.transport.songPos=0")
mouse('mousePressed',g['x']+X(30),g['y']+10); mouse('mouseReleased',g['x']+X(30),g['y']+10); time.sleep(0.05)
print('tick-row click seeks:', round(js("window.oscine.transport.songPos"),1), '| lane0 top y', js(f"{TL}.laneY(0)"))
# survives save-shape serialization
print('in project JSON:', 'markers' in json.loads(js("JSON.stringify(window.oscine.store.project.arrangement)")))
d=cdp('Page.captureScreenshot',format='png')['data']; open('/tmp/oscine-markers.png','wb').write(base64.b64decode(d))
for _ in range(8): js("window.oscine.store.undo()")
print('errors:', js("(window.__errs||[]).length"), js("JSON.stringify(window.__errs||[])")[:200])
