import json, time, urllib.request, websocket
t=[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')) if x['type']=='page'][0]
ws=websocket.create_connection(t['webSocketDebuggerUrl'],suppress_origin=True,max_size=None,timeout=240); n=[0]
def cdp(m,**p):
    n[0]+=1; ws.send(json.dumps({'id':n[0],'method':m,'params':p}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==n[0]: return r.get('result',r)
def js(e, aw=False): return cdp('Runtime.evaluate',expression=e,returnByValue=True,awaitPromise=aw).get('result',{}).get('value')
cdp('Runtime.enable'); cdp('Page.enable')
js("window.__errs=[]; window.addEventListener('error',e=>window.__errs.push(e.message))")
cdp('Page.navigate', url='http://127.0.0.1:7351/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json'); time.sleep(6)
r=js("""(async()=>{
  const P=window.oscine.store.project, A=P.arrangement;
  // solo carl; find its placement + clip
  A.lanes.forEach(l=>l.solo=(l.id==='carl'));
  const p=A.placements.find(p=>p.track==='carl'), c=P.clips[p.clip];
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const rms=(buf,a,b)=>{const sr=buf.sampleRate,d=buf.getChannelData(0);let s=0,n=0;for(let i=Math.floor(a*sr);i<Math.floor(b*sr);i++){s+=d[i]*d[i];n++;}return +(20*Math.log10(Math.sqrt(s/n)+1e-12)).toFixed(1)};
  const w0=p.at+1, w1=p.at+3;              // clip-local 1..3 s
  const base=(await renderProjectToBuffer(P)).buffer;
  // clip-relative envelope: -20 dB flat across the clip, in CLIP-LOCAL time
  A.automation=[...(A.automation||[]).filter(e=>!e.target.startsWith('clip:')), {target:`clip:${c.id}:gainDb`, points:[{t:0,v:-20},{t:10,v:-20}]}];
  const env=(await renderProjectToBuffer(P)).buffer;
  // move the placement 5 s later: envelope must travel with the clip
  p.at+=5;
  const moved=(await renderProjectToBuffer(P)).buffer;
  const r={clip:c.id, at:p.at-5,
    base:rms(base,w0,w1), withEnv:rms(env,w0,w1),
    moved_newWindow:rms(moved,w0+5,w1+5), moved_baseRef:rms(base,w0,w1)};
  p.at-=5; A.automation=A.automation.filter(e=>!e.target.startsWith('clip:')); A.lanes.forEach(l=>l.solo=false);
  return JSON.stringify(r);
})()""", aw=True)
print(r)
print('errors:', js("(window.__errs||[]).length"))
