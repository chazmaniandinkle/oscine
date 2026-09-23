import json, time, urllib.request, websocket
t=[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')) if x['type']=='page'][0]
ws=websocket.create_connection(t['webSocketDebuggerUrl'],suppress_origin=True,max_size=None,timeout=60); n=[0]
def cdp(m,**p):
    n[0]+=1; ws.send(json.dumps({'id':n[0],'method':m,'params':p}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==n[0]: return r.get('result',r)
def js(e, aw=False): return cdp('Runtime.evaluate',expression=e,returnByValue=True,awaitPromise=aw).get('result',{}).get('value')
cdp('Runtime.enable')
js("window.oscine.store.ui.mixerOpen=true; window.oscine.app.mixer.paintOpen(); window.oscine.app.mixer.render()"); time.sleep(0.3)
print(js("""JSON.stringify((()=>{const b=document.querySelector('.mixer-body');const out={body:[b.clientHeight,b.scrollHeight]};
 const s=[...b.querySelectorAll('.strip')];
 out.strips=s.map(st=>({cls:st.className, h:st.scrollHeight, kids:[...st.children].map(c=>c.className+':'+Math.round(c.getBoundingClientRect().height)+(c.textContent.trim()?'('+c.textContent.trim().slice(0,18)+')':''))}));
 return out})())"""))
