import json, time, base64, urllib.request, websocket
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
order=lambda: js("window.oscine.store.project.arrangement.lanes.map(l=>l.id).join(',')")
print('before:', order())
# drag lane 4 (carl) name area up to slot 0
y4=js("window.oscine.app.timeline.laneY(4)+17"); y0=js("window.oscine.app.timeline.laneY(0)")
mouse('mousePressed',g['x']+30,g['y']+y4)
steps=8
for i in range(1,steps+1): mouse('mouseMoved',g['x']+30,g['y']+y4+(y0-y4)*i/steps)
time.sleep(0.05)
print('during: drag edge', js("window.oscine.app.timeline.drag?.edge"), 'armed', js("window.oscine.app.timeline.drag?.armed"), 'to slot', js("window.oscine.app.timeline.drag?.to"))
d=cdp('Page.captureScreenshot',format='png')['data']; open('/tmp/oscine-reorder.png','wb').write(base64.b64decode(d))
mouse('mouseReleased',g['x']+30,g['y']+y0); time.sleep(0.1)
print('after drag carl -> top:', order())
print('gain untouched:', js("JSON.stringify(window.oscine.store.project.arrangement.lanes.map(l=>l.gainDb))"))
print('mixer strip order:', js("[...document.querySelectorAll('.mixer .strip-name')].map(e=>e.textContent).slice(0,2).join(' | ')"))
js("window.oscine.store.undo()"); print('undo restores:', order())
# plain click on a name still selects
y1=js("window.oscine.app.timeline.laneY(1)+17")
mouse('mousePressed',g['x']+30,g['y']+y1); mouse('mouseReleased',g['x']+30,g['y']+y1); time.sleep(0.05)
print('click selects lane:', js("window.oscine.app.timeline.selectedLane"))
# gain drag still works on the dB bar
yg=js("window.oscine.app.timeline.laneY(1)+40"); g0=js("window.oscine.store.project.arrangement.lanes[1].gainDb")
mouse('mousePressed',g['x']+60,g['y']+yg)
for i in range(1,5): mouse('mouseMoved',g['x']+60,g['y']+yg-6*i)
mouse('mouseReleased',g['x']+60,g['y']+yg-24); time.sleep(0.05)
print('gain drag on dB bar:', g0, '->', js("window.oscine.store.project.arrangement.lanes[1].gainDb")); js("window.oscine.store.undo()")
print('errors:', js("(window.__errs||[]).length"))
