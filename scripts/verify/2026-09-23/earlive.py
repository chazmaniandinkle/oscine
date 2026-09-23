import json, time, urllib.request, websocket
t=[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')) if x['type']=='page'][0]
ws=websocket.create_connection(t['webSocketDebuggerUrl'],suppress_origin=True,max_size=None,timeout=120); n=[0]
def cdp(m,**p):
    n[0]+=1; ws.send(json.dumps({'id':n[0],'method':m,'params':p}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==n[0]: return r.get('result',r)
def js(e, aw=False): return cdp('Runtime.evaluate',expression=e,returnByValue=True,awaitPromise=aw).get('result',{}).get('value')
cdp('Runtime.enable'); cdp('Page.enable'); cdp('Network.enable'); cdp('Network.setCacheDisabled', cacheDisabled=True)
t0=time.time()
cdp('Page.navigate', url='http://127.0.0.1:7351/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json')
done=None
for i in range(240):
    time.sleep(0.5)
    try: k=js("window.oscine?.app?.ear ? [...window.oscine.app.ear.profiles.keys()].filter(k=>window.oscine.app.ear.hasProfile(k)).length : -1")
    except Exception: k=-1
    if i%10==0:
        st=js("document.querySelector('.statusbar')?.innerText.replace(/\\s+/g,' ')")
        print(f'{time.time()-t0:5.1f}s ear {k}/6 | status: {st}')
    if k==6: done=time.time()-t0; break
print('all 6 sources profiled in', round(done,1) if done else 'NOT DONE', 's')
# a cached range query: time it
r=js("""(async()=>{const tl=window.oscine.app.timeline; const i=tl.arrangement.placements.findIndex(p=>p.track==='vocal-r2'&&p.at<60);
 tl.range={a:60,b:90}; tl.multi=[i]; window.oscine.bus.emit('ui:selection',{}); const t0=performance.now();
 for(let k=0;k<100;k++){ await new Promise(r=>setTimeout(r,50)); const tx=document.querySelector('.inspector')?.innerText||''; if(!tx.includes('listening')&&tx.includes('median')) return Math.round(performance.now()-t0)+' ms: '+tx.replace(/\\s+/g,' ').slice(0,220);} return 'still listening after 5 s'})()""", aw=True)
print('range query:', r)
print('errors:', js("0"))
