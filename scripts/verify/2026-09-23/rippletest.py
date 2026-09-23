import json, time, urllib.request, websocket
t=[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')) if x['type']=='page'][0]
ws=websocket.create_connection(t['webSocketDebuggerUrl'],suppress_origin=True,max_size=None,timeout=240); n=[0]
def cdp(m,**p):
    n[0]+=1; ws.send(json.dumps({'id':n[0],'method':m,'params':p}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==n[0]: return r.get('result',r)
def js(e, aw=False): return cdp('Runtime.evaluate',expression=e,returnByValue=True,awaitPromise=aw).get('result',{}).get('value')
def key(code,k,mods=0): cdp('Input.dispatchKeyEvent',type='keyDown',code=code,key=k,modifiers=mods); cdp('Input.dispatchKeyEvent',type='keyUp',code=code,key=k,modifiers=mods)
cdp('Runtime.enable'); cdp('Page.enable')
js("window.__errs=[]; window.addEventListener('error',e=>window.__errs.push(e.message))")
cdp('Page.navigate', url='http://127.0.0.1:7351/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json'); time.sleep(6)
TL="window.oscine.app.timeline"; A="window.oscine.store.project.arrangement"
js("document.activeElement?.blur()")
snap=lambda: json.loads(js(f"""JSON.stringify({{
  end: window.oscine.transport.arrangementEnd(),
  carl: {A}.placements.filter(p=>p.track==='carl').map(p=>+p.at.toFixed(2)),
  n: {A}.placements.length,
  markers: ({A}.markers||[]).map(m=>+m.t.toFixed(2)),
  loop: {A}.loop, auto: ({A}.automation||[]).map(e=>e.points.map(p=>+p.t.toFixed(2)))
}})"""))
# set up: markers at 50, 120, 200; cycle 150-160; a lane gain envelope 100/140/190; the RANGE = 110..130 (20 s)
js(f"{A}.markers=[{{id:'m1',t:50,name:'A'}},{{id:'m2',t:120,name:'B'}},{{id:'m3',t:200,name:'C'}}]; {A}.loop={{a:150,b:160,on:false}}; {A}.automation=[{{target:'lane:bed-r2:gainDb',points:[{{t:100,v:0}},{{t:125,v:-6}},{{t:140,v:-3}},{{t:190,v:0}}]}}]")
before=snap(); print('before:', before)
# render reference: RMS of the bed at 140..144 BEFORE (should equal 120..124 AFTER ripple)
rms_js=lambda a,b: f"""(async()=>{{const {{renderProjectToBuffer}}=await import('/src/engine/render.js');const P=window.oscine.store.project;P.arrangement.lanes.forEach(l=>l.solo=l.id==='bed-r2');const buf=(await renderProjectToBuffer(P)).buffer;P.arrangement.lanes.forEach(l=>l.solo=false);const sr=buf.sampleRate,d=buf.getChannelData(0);let s=0,n=0;for(let i=Math.floor({a}*sr);i<Math.floor({b}*sr);i++){{s+=d[i]*d[i];n++}}return +(20*Math.log10(Math.sqrt(s/n)+1e-12)).toFixed(2)}})()"""
js(f"{A}.automation=[]"); ref=js(rms_js(145,149),aw=True)
js(f"{A}.automation=[{{target:'lane:bed-r2:gainDb',points:[{{t:100,v:0}},{{t:125,v:-6}},{{t:140,v:-3}},{{t:190,v:0}}]}}]")
js(f"{TL}.range={{a:110,b:130}}"); key('Backspace','Backspace',mods=8); time.sleep(0.2)
after=snap(); print('after ⇧⌫ 110–130:', after)
print('end shrank by 20:', round(before['end']-after['end'],2))
print('markers: 50 kept, 120 (inside) -> 110, 200 -> 180:', after['markers'])
print('cycle 150–160 -> 130–140:', after['loop'])
print('automation 100 kept, 125 (inside) dropped, 140 -> 120, 190 -> 170:', after['auto'])
print('range cleared:', js(f"{TL}.range"), '| playhead at a:', js("window.oscine.transport.songPos"))
js(f"{A}.automation=[]"); got=js(rms_js(125,129),aw=True)
print(f'audio after 130 moved 20 s left: bed RMS 145–149 before {ref} == 125–129 after {got}:', abs(ref-got)<0.3)
js("window.oscine.store.undo()"); u=snap()
print('one undo restores:', u['end']==before['end'] and u['markers']==before['markers'] and u['n']==before['n'])
print('no range -> ⇧⌫ is a no-op:', js(f"{TL}.range=null; {TL}.rippleDeleteRange()"))
for _ in range(3): js("window.oscine.store.undo()")
print('errors:', js("(window.__errs||[]).length"), js("JSON.stringify(window.__errs||[])")[:300])
