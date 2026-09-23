import json, time, urllib.request, websocket
time.sleep(3)
print('health:', urllib.request.urlopen('http://127.0.0.1:7351/health').read().decode()[:60])
t=[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')) if x['type']=='page'][0]
ws=websocket.create_connection(t['webSocketDebuggerUrl'],suppress_origin=True,max_size=None,timeout=300); n=[0]
def cdp(m,**p):
    n[0]+=1; ws.send(json.dumps({'id':n[0],'method':m,'params':p}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==n[0]: return r.get('result',r)
def js(e, aw=False): return cdp('Runtime.evaluate',expression=e,returnByValue=True,awaitPromise=aw).get('result',{}).get('value')
cdp('Runtime.enable'); cdp('Page.enable')
js("window.__errs=[]; window.addEventListener('error',e=>window.__errs.push(e.message))")
cdp('Page.navigate', url='http://127.0.0.1:7351/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json'); time.sleep(6)
# asset inspector: tools present
js("window.oscine.app.assetBin.selectedAsset='ast_sagan_iso'; window.oscine.bus.emit('asset:selected',{id:'ast_sagan_iso'})"); time.sleep(0.2)
print('asset tools:', js("[...document.querySelectorAll('.transcript-tools .btn')].map(b=>b.textContent).join(' | ')"), '| words now:', js("window.oscine.store.project.assets.ast_sagan_iso.words.length"))
# export SRT of the source: exercise the exporter in-page (no download)
srt=js("(async()=>{const m=await import('/src/core/timedtext.js');return m.toSRT(window.oscine.store.project.assets.ast_sagan_iso.words).split('\\n').slice(0,4).join(' / ')})()", aw=True)
print('SRT head:', srt)
# clip inspector: select the Carl clip, run Transcribe span through the REAL button (whisper via sidecar)
js("(()=>{const tl=window.oscine.app.timeline;const i=tl.arrangement.placements.findIndex(p=>window.oscine.store.project.clips[p.clip].sourceOf==='ast_sagan_iso');tl.selected=i;window.oscine.bus.emit('clip:selected',{index:i})})()"); time.sleep(0.2)
clip=json.loads(js("(()=>{const tl=window.oscine.app.timeline;const c=window.oscine.store.project.clips[tl.arrangement.placements[tl.selected].clip];return JSON.stringify({id:c.id,in:c.in,out:c.out})})()"))
print('clip:', clip, '| clip tools:', js("[...document.querySelectorAll('.transcript-tools .btn')].map(b=>b.textContent).join(' | ')"))
before=js("window.oscine.store.project.assets.ast_sagan_iso.words.length")
# scramble the words inside the clip span so we can see the regenerate replace them
js(f"(()=>{{const a=window.oscine.store.project.assets.ast_sagan_iso; a.words=a.words.map(w=>(w.e>{clip['in']}&&w.s<{clip['out']})?{{...w,t:'XXX'}}:w)}})()")
print('scrambled in-span words to XXX:', js(f"window.oscine.store.project.assets.ast_sagan_iso.words.filter(w=>w.t==='XXX').length"))
t0=time.time()
js("[...document.querySelectorAll('.transcript-tools .btn')].find(b=>b.textContent.startsWith('Transcribe')).click()")
for _ in range(120):
    time.sleep(1)
    st=js("document.querySelector('.transcript-status')?.textContent||''")
    if st and not st.startswith('whisper'): break
print(f'transcribe span: "{st}" in {time.time()-t0:.0f}s')
after=json.loads(js(f"JSON.stringify(window.oscine.store.project.assets.ast_sagan_iso.words.filter(w=>w.e>{clip['in']}&&w.s<{clip['out']}).slice(0,8).map(w=>w.t))"))
print('in-span words after:', ' '.join(after), '| XXX left:', js("window.oscine.store.project.assets.ast_sagan_iso.words.filter(w=>w.t==='XXX').length"), '| total', js("window.oscine.store.project.assets.ast_sagan_iso.words.length"), 'was', before)
print('first in-span word source time:', js(f"window.oscine.store.project.assets.ast_sagan_iso.words.find(w=>w.e>{clip['in']}&&w.s<{clip['out']}).s"), 'clip.in', clip['in'])
js("window.oscine.store.undo()"); print('undo restores XXX count:', js("window.oscine.store.project.assets.ast_sagan_iso.words.filter(w=>w.t==='XXX').length"))
js("window.oscine.store.undo()"); print('errors:', js("(window.__errs||[]).length"))
