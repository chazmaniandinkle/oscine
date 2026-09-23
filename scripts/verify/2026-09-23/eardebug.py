import json, time, urllib.request, websocket
t=[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')) if x['type']=='page'][0]
ws=websocket.create_connection(t['webSocketDebuggerUrl'],suppress_origin=True,max_size=None,timeout=120); n=[0]
def cdp(m,**p):
    n[0]+=1; ws.send(json.dumps({'id':n[0],'method':m,'params':p}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==n[0]: return r.get('result',r)
def js(e, aw=False): return cdp('Runtime.evaluate',expression=e,returnByValue=True,awaitPromise=aw).get('result',{}).get('value')
cdp('Runtime.enable'); cdp('Page.enable'); cdp('Log.enable')
msgs=[]
cdp('Page.navigate', url='http://127.0.0.1:7351/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json'); time.sleep(8)
print('ear object:', js("typeof window.oscine.app.ear"), js("!!window.oscine.app.ear?.profile"))
print('workers:', js("JSON.stringify({bg:!!window.oscine.app.ear?.bg, fg:!!window.oscine.app.ear?.fg, keys:Object.keys(window.oscine.app.ear||{})})"))
print('onDecoded set:', js("typeof window.oscine.assetCache?.onDecoded"), '| decoded buffers:', js("window.oscine.assetCache?.buffers?.size"))
print('pending:', js("window.oscine.app.ear && JSON.stringify([...(window.oscine.app.ear.pending?.keys?.()||[])].slice(0,5))"))
# direct worker probe
r=js("""(async()=>{
  try{
    const w=new Worker(new URL('/src/engine/ear-worker.js', location.href),{type:'module'});
    const res=await new Promise((ok,bad)=>{w.onmessage=e=>ok(e.data);w.onerror=e=>bad('onerror: '+(e.message||e.filename||'?'));w.onmessageerror=e=>bad('msgerror');
      const x=new Float32Array(44100);for(let i=0;i<x.length;i++)x[i]=Math.sin(2*Math.PI*220*i/44100);
      w.postMessage({id:1,cmd:'analyze',x,sr:44100},[x.buffer]); setTimeout(()=>bad('timeout 8s'),8000)});
    return 'worker ok: '+JSON.stringify(res).slice(0,160);
  }catch(e){return 'worker FAIL: '+e}
})()""",aw=True)
print(r)
# try a profile through the real client
r2=js("""(async()=>{const e=window.oscine.app.ear, id=Object.keys(window.oscine.store.project.assets)[0];
  const buf=await window.oscine.assetCache.getBuffer(window.oscine.store.project,id);
  const t0=performance.now(); try{ await Promise.race([e.profile(id,buf), new Promise((_,b)=>setTimeout(()=>b(new Error('timeout 40s')),40000))]); return 'profile ok in '+Math.round(performance.now()-t0)+'ms, has='+e.hasProfile(id);}catch(err){return 'profile FAIL: '+err.message}})()""",aw=True)
print(r2)
