import json, time, base64, urllib.request, websocket
t=[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')) if x['type']=='page'][0]
ws=websocket.create_connection(t['webSocketDebuggerUrl'],suppress_origin=True,max_size=None,timeout=120); n=[0]
def cdp(m,**p):
    n[0]+=1; ws.send(json.dumps({'id':n[0],'method':m,'params':p}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==n[0]: return r.get('result',r)
def js(e, aw=False): return cdp('Runtime.evaluate',expression=e,returnByValue=True,awaitPromise=aw).get('result',{}).get('value')
def mouse(kind,x,y,mods=0): cdp('Input.dispatchMouseEvent',type=kind,x=x,y=y,button='left',clickCount=1 if kind!='mouseMoved' else 0,modifiers=mods)
cdp('Runtime.enable'); cdp('Page.enable'); cdp('Network.setCacheDisabled', cacheDisabled=True)
cdp('Emulation.setDeviceMetricsOverride', width=1440, height=900, deviceScaleFactor=1, mobile=False)
js("window.__errs=[]; window.addEventListener('error',e=>window.__errs.push(e.message))")
cdp('Page.navigate', url='http://127.0.0.1:7351/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json'); time.sleep(6)
js("window.oscine.store.ui.mixerOpen=true; window.oscine.store.ui.mixerHeight=220; window.oscine.app.mixer.paintOpen(); window.oscine.app.mixer.render()"); time.sleep(0.4)
print(js("""JSON.stringify((()=>{const b=document.querySelector('.mixer-body');return {body:[b.clientHeight,b.scrollHeight], strips:[...b.querySelectorAll('.strip')].map(s=>[s.querySelector('.strip-name')?.textContent, Math.round(s.querySelector('.strip-name')?.getBoundingClientRect().height), Math.round(s.getBoundingClientRect().height), Math.round(s.querySelector('.strip-fade')?.getBoundingClientRect().height)])}})())"""))
# gutter button clicks still work at their new place
g=json.loads(js("JSON.stringify(window.oscine.app.timeline.canvas.getBoundingClientRect())"))
y1=js("window.oscine.app.timeline.laneY(1)")
for lbl,bx in (('A',150-72+10),('M',150-50+10),('S',150-28+10)):
    mouse('mousePressed',g['x']+bx,g['y']+y1+31+8); mouse('mouseReleased',g['x']+bx,g['y']+y1+31+8); time.sleep(0.05)
print('after clicking A, M, S on lane 1:', js("JSON.stringify({auto:[...window.oscine.app.timeline.autoOpen||[]], mute:window.oscine.store.project.arrangement.lanes[1].mute, solo:window.oscine.store.project.arrangement.lanes[1].solo})"))
for _ in range(2): js("window.oscine.store.undo()")
js("window.oscine.app.timeline.autoOpen=new Set(); window.oscine.app.timeline.dirty=true")
# gain drag on the dB readout, left of buttons
g0=js("window.oscine.store.project.arrangement.lanes[1].gainDb")
mouse('mousePressed',g['x']+30,g['y']+y1+40)
for i in range(1,5): mouse('mouseMoved',g['x']+30,g['y']+y1+40-5*i)
mouse('mouseReleased',g['x']+30,g['y']+y1+20); time.sleep(0.05)
print('gain drag on dB readout:', g0,'->',js("window.oscine.store.project.arrangement.lanes[1].gainDb")); js("window.oscine.store.undo()")
time.sleep(0.3)
d=cdp('Page.captureScreenshot',format='png')['data']; open('/tmp/look-4-fixed.png','wb').write(base64.b64decode(d))
print('errors:', js("(window.__errs||[]).length"))
