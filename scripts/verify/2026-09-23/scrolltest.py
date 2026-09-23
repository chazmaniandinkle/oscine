import json, time, base64, urllib.request, websocket
t=[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')) if x['type']=='page'][0]
ws=websocket.create_connection(t['webSocketDebuggerUrl'],suppress_origin=True,max_size=None,timeout=60); n=[0]
def cdp(m,**p):
    n[0]+=1; ws.send(json.dumps({'id':n[0],'method':m,'params':p}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==n[0]: return r.get('result',r)
def js(e, aw=False): return cdp('Runtime.evaluate',expression=e,returnByValue=True,awaitPromise=aw).get('result',{}).get('value')
cdp('Runtime.enable'); cdp('Page.enable')
js("window.__errs=[]; window.addEventListener('error',e=>window.__errs.push(e.message))")
cdp('Page.navigate', url='http://127.0.0.1:7351/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json'); time.sleep(6)
# open the mixer tall + all automation lanes so content overflows
js("window.oscine.store.ui.mixerOpen=true; window.oscine.store.ui.mixerHeight=380; window.oscine.app.mixer.paintOpen(); window.oscine.app.mixer.render(); const tl=window.oscine.app.timeline; tl.autoOpen=new Set(tl.lanes().map(l=>l.id)); tl.dirty=true"); time.sleep(0.4)
print('host h', js("window.oscine.app.timeline.host.clientHeight"), '| content h', js("window.oscine.app.timeline.contentH()"), '| maxScrollY', js("window.oscine.app.timeline.maxScrollY()"))
g=json.loads(js("JSON.stringify(window.oscine.app.timeline.canvas.getBoundingClientRect())"))
cx,cy=g['x']+400, g['y']+150
def wheel(dy,dx=0,mods=0): cdp('Input.dispatchMouseEvent',type='mouseWheel',x=cx,y=cy,deltaX=dx,deltaY=dy,modifiers=mods)
sx0=js("window.oscine.app.timeline.scrollX")
for _ in range(6): wheel(60)
time.sleep(0.2)
print('after 6 wheel-down: scrollY', js("window.oscine.app.timeline.scrollY"), '| scrollX unchanged:', js("window.oscine.app.timeline.scrollX")==sx0, '| lane 0 y', js("window.oscine.app.timeline.laneY(0)"), '| last lane y', js("window.oscine.app.timeline.laneY(4)"))
print('hit-test follows scroll: laneIndexAt(y=30) =', js("window.oscine.app.timeline.laneIndexAt(30)"), '(should be >0 when scrolled)')
for _ in range(20): wheel(100)
print('clamped at max:', js("window.oscine.app.timeline.scrollY")==js("window.oscine.app.timeline.maxScrollY()"))
wheel(0,dx=120); print('horizontal wheel moved scrollX:', js("window.oscine.app.timeline.scrollX")!=sx0)
wheel(80,mods=8); print('shift+wheel is horizontal too (scrollY unchanged):', js("window.oscine.app.timeline.scrollY")==js("window.oscine.app.timeline.maxScrollY()"))
d=cdp('Page.captureScreenshot',format='png')['data']; open('/tmp/oscine-scroll.png','wb').write(base64.b64decode(d))
# close mixer -> scrollY clamps back
js("window.oscine.store.ui.mixerOpen=false; window.oscine.app.mixer.paintOpen()"); time.sleep(0.4)
print('mixer closed: scrollY', js("window.oscine.app.timeline.scrollY"), '<= max', js("window.oscine.app.timeline.maxScrollY()"))
print('errors:', js("(window.__errs||[]).length"))
