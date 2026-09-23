#!/usr/bin/env python3
"""Reload the headless tab, open the project via the new File route, click a clip, screenshot the inspector."""
import json, time, base64, urllib.request, websocket
t=[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')) if x['type']=='page'][0]
ws=websocket.create_connection(t['webSocketDebuggerUrl'],suppress_origin=True,max_size=None); n=[0]
def cdp(m,**p):
    n[0]+=1; ws.send(json.dumps({'id':n[0],'method':m,'params':p}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==n[0]: return r.get('result',r)
def js(e,aw=False):
    r=cdp('Runtime.evaluate',expression=e,awaitPromise=aw,returnByValue=True); return r.get('result',{}).get('value', r)
def shot(p):
    open(p,'wb').write(base64.b64decode(cdp('Page.captureScreenshot',format='png')['data'])); print('shot',p)
cdp('Runtime.enable'); cdp('Page.enable')
cdp('Page.navigate', url='http://127.0.0.1:7351/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json')
time.sleep(5)
print('title:', js("document.querySelector('.editor-title')?.textContent"))
print('lanes:', js("window.oscine.store.project.arrangement?.lanes?.length"))
# click the bridge clip: find its screen rect from the timeline's own geometry
r = js("""(()=>{ const tl=window.oscine.app.timeline; const arr=tl.arrangement;
  const i=arr.placements.findIndex(p=>p.clip==='seg_bridge_r1'); const p=arr.placements[i];
  const lanes=tl.lanes(); const li=lanes.findIndex(l=>l.id===p.track);
  const rect=tl.canvas.getBoundingClientRect();
  const x=tl.x(p.at+3), y=tl.laneY(li)+30;
  return JSON.stringify({i, x:rect.left+x, y:rect.top+y}); })()""")
print('bridge clip:', r); pt=json.loads(r)
cdp('Input.dispatchMouseEvent', type='mousePressed', x=pt['x'], y=pt['y'], button='left', clickCount=1)
cdp('Input.dispatchMouseEvent', type='mouseReleased', x=pt['x'], y=pt['y'], button='left', clickCount=1)
time.sleep(0.8)
print('selected:', js("window.oscine.app.timeline.selected"))
print('inspector title:', js("document.querySelector('.inspector .panel-title')?.textContent"))
print('rows:', js("[...document.querySelectorAll('.inspector .clip-row')].map(r=>r.textContent.trim()).join(' | ')"))
shot('/tmp/oscine-clip-inspector.png')
