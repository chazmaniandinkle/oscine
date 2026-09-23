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
# 1. lyrics: one lane
print('lyrics lane:', js("window.oscine.app.lyrics.laneFilter"), '| options:', js("[...document.querySelectorAll('.lyrics-lane option')].map(o=>o.textContent).join(' / ')"), '| words:', js("window.oscine.app.lyrics.words.length"), '| all lanes in words:', js("JSON.stringify([...new Set(window.oscine.app.lyrics.words.map(w=>w.lane))])"))
js("window.oscine.app.timeline.selectLane('carl')"); time.sleep(0.1)
print('after selecting Carl lane:', js("window.oscine.app.lyrics.laneFilter"), '| words:', js("window.oscine.app.lyrics.words.length"), '| first:', js("window.oscine.app.lyrics.words.slice(0,5).map(w=>w.word).join(' ')"))
js("window.oscine.app.assetBin.selectedAsset='ast_vocal_r2'; window.oscine.bus.emit('asset:selected',{id:'ast_vocal_r2'})"); time.sleep(0.1)
print('after selecting vocal-r2 source:', js("window.oscine.app.lyrics.laneFilter"))
# 2. transport ends
end=js("window.oscine.transport.arrangementEnd()")
js(f"window.oscine.transport.songPos={end}-1.5; window.oscine.transport.play()"); time.sleep(3.5)
print(f'end={end:.2f} | after playing past it: playing', js("window.oscine.transport.playing"), '| songPos', js("window.oscine.transport.songPos.toFixed(2)"))
# 3. mixer resize
js("window.oscine.store.ui.mixerOpen=true; window.oscine.app.mixer.paintOpen(); window.oscine.app.mixer.render()"); time.sleep(0.2)
h0=js("document.querySelector('.mixer-body').getBoundingClientRect().height")
r=json.loads(js("JSON.stringify(document.querySelector('.mixer-handle').getBoundingClientRect())"))
cx,cy=r['x']+r['width']/2, r['y']+r['height']/2
mouse('mousePressed',cx,cy)
for i in range(1,9): mouse('mouseMoved',cx,cy-10*i)
mouse('mouseReleased',cx,cy-80); time.sleep(0.1)
h1=js("document.querySelector('.mixer-body').getBoundingClientRect().height")
print(f'mixer height default {h0:.0f} -> after drag-up 80px {h1:.0f} | still open:', js("window.oscine.store.ui.mixerOpen"), '| persisted:', js("window.oscine.store.ui.mixerHeight"))
mouse('mousePressed',cx,cy-80); mouse('mouseReleased',cx,cy-80); time.sleep(0.1)
print('plain click toggles closed:', js("!window.oscine.store.ui.mixerOpen"))
print('errors:', js("(window.__errs||[]).length"))
