import json, time, base64, urllib.request, websocket
t=[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')) if x['type']=='page'][0]
ws=websocket.create_connection(t['webSocketDebuggerUrl'],suppress_origin=True,max_size=None,timeout=120); n=[0]
def cdp(m,**p):
    n[0]+=1; ws.send(json.dumps({'id':n[0],'method':m,'params':p}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==n[0]: return r.get('result',r)
def js(e, aw=False): return cdp('Runtime.evaluate',expression=e,returnByValue=True,awaitPromise=aw).get('result',{}).get('value')
def shot(name):
    d=cdp('Page.captureScreenshot',format='png')['data']; p=f'/tmp/look-{name}.png'; open(p,'wb').write(base64.b64decode(d)); return p
cdp('Runtime.enable'); cdp('Page.enable')
cdp('Emulation.setDeviceMetricsOverride', width=1440, height=900, deviceScaleFactor=1, mobile=False)
js("window.__errs=[]; window.__warns=[]; window.addEventListener('error',e=>window.__errs.push(e.message)); window.addEventListener('unhandledrejection',e=>window.__errs.push('rej: '+(e.reason?.message||e.reason)))")
t0=time.time()
cdp('Page.navigate', url='http://127.0.0.1:7351/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json')
for _ in range(60):
    time.sleep(0.25)
    if js("!!(window.oscine?.app?.timeline?.active && window.oscine.store.project.arrangement?.placements?.length)"): break
print(f'load to arrangement ready: {time.time()-t0:.1f}s')
for _ in range(40):
    time.sleep(0.5)
    if js("window.oscine.app.timeline.peaks?.size>0"): break
print(f'first waveforms: {time.time()-t0:.1f}s')
P=json.loads(js("""JSON.stringify((()=>{const p=window.oscine.store.project,a=p.arrangement;return {
 name:p.name, version:p.version, lanes:a.lanes.map(l=>l.name+(l.inserts?.length?` [${l.inserts.map(i=>i.type).join(',')}]`:'')), placements:a.placements.length,
 clips:Object.keys(p.clips).length, assets:Object.values(p.assets).map(x=>`${x.name||x.id}: ${x.duration?.toFixed(1)}s, ${x.words?.length||0}w`),
 markers:(a.markers||[]).length, loop:a.loop, automation:(a.automation||[]).length, master:a.master?.inserts?.length||0,
 end:window.oscine.transport.arrangementEnd().toFixed(2), length:a.length}})())"""))
print(json.dumps(P,indent=1))
print('shot:', shot('1-loaded'))
time.sleep(20)
print('ear after ~25s:', js("[...window.oscine.app.ear.profiles.keys()].filter(k=>window.oscine.app.ear.hasProfile(k)).length"), '/', len(P['assets']))
print('status bar:', js("document.querySelector('.statusbar')?.innerText.replace(/\\s+/g,' ')"))
print('toolbar:', js("[...document.querySelectorAll('.toolbar button')].map(b=>b.textContent.trim()).filter(Boolean).join(' | ')"))
print('lyrics lane:', js("window.oscine.app.lyrics.laneFilter"), '| words:', js("window.oscine.app.lyrics.words.length"))
# open mixer + select a clip + range-on-lane for inspector views
js("window.oscine.store.ui.mixerOpen=true; window.oscine.app.mixer.paintOpen(); window.oscine.app.mixer.render()")
js("(()=>{const tl=window.oscine.app.timeline;tl.selected=1;window.oscine.bus.emit('clip:selected',{index:1})})()"); time.sleep(0.3)
print('shot:', shot('2-clip+mixer'))
js("(()=>{const tl=window.oscine.app.timeline;tl.range={a:60,b:90};tl.multi=[];tl.selected=null;window.oscine.bus.emit('clip:selected',{index:null});const i=tl.arrangement.placements.findIndex(p=>p.track==='vocal-r2'&&p.at<60);tl.multi=[i];window.oscine.bus.emit('ui:selection',{})})()")
time.sleep(4)
print('range inspector text:', (js("document.querySelector('.inspector')?.innerText?.slice(0,400)") or '')[:400].replace('\n',' | '))
print('shot:', shot('3-range-ear'))
# play 3 seconds: meters move? any errors?
js("window.oscine.transport.songPos=100; window.oscine.transport.play()"); time.sleep(3)
print('playing pos:', round(js("window.oscine.transport.getPosition().sec"),2), '| master meter:', js("document.querySelector('.mixer .strip.master .meter')?.style?.getPropertyValue('--v') || document.querySelectorAll('.mixer .meter').length"))
js("window.oscine.transport.stop()")
print('console errors:', js("(window.__errs||[]).length"), js("JSON.stringify((window.__errs||[]).slice(0,5))"))
print('layout: body scroll', js("document.documentElement.scrollHeight"), 'vs viewport', 900, '| timeline host h', js("window.oscine.app.timeline.host.clientHeight"))
