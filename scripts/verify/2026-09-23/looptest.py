import json, time, base64, urllib.request, websocket
t=[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')) if x['type']=='page'][0]
ws=websocket.create_connection(t['webSocketDebuggerUrl'],suppress_origin=True,max_size=None,timeout=90); n=[0]
def cdp(m,**p):
    n[0]+=1; ws.send(json.dumps({'id':n[0],'method':m,'params':p}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==n[0]: return r.get('result',r)
def js(e, aw=False): return cdp('Runtime.evaluate',expression=e,returnByValue=True,awaitPromise=aw).get('result',{}).get('value')
def mouse(kind,x,y,mods=0): cdp('Input.dispatchMouseEvent',type=kind,x=x,y=y,button='left',clickCount=1 if kind!='mouseMoved' else 0,modifiers=mods)
def key(code,k,mods=0): cdp('Input.dispatchKeyEvent',type='keyDown',code=code,key=k,modifiers=mods); cdp('Input.dispatchKeyEvent',type='keyUp',code=code,key=k,modifiers=mods)
cdp('Runtime.enable'); cdp('Page.enable')
js("window.__errs=[]; window.addEventListener('error',e=>window.__errs.push(e.message))")
cdp('Page.navigate', url='http://127.0.0.1:7351/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json'); time.sleep(6)
TL="window.oscine.app.timeline"; T="window.oscine.transport"; A="window.oscine.store.project.arrangement"
g=json.loads(js(f"JSON.stringify({TL}.canvas.getBoundingClientRect())"))
js("document.activeElement?.blur()")
# range 60..62 -> C creates loop from range, on
js(f"{TL}.range={{a:60,b:62}}"); key('KeyC','c')
print('C with range:', js(f"JSON.stringify({A}.loop)"))
# clearing the range does NOT clear the loop
key('Escape','Escape'); print('Esc clears range:', js(f"{TL}.range"), '| loop kept:', js(f"JSON.stringify({A}.loop)"))
# play from 59: should wrap to 60 at ~62, repeatedly; sample positions
js(f"{T}.songPos=59; {T}.play()")
samples=[]; loops=[0]
js(f"window.__loops=0; window.oscine.bus.on('transport:looped',()=>window.__loops++)")
t0=time.time()
while time.time()-t0<8.5:
    samples.append(round(js(f"{T}.getPosition().sec"),2)); time.sleep(0.25)
print('positions (should stay 59..62, wrap to ~60):', samples[:6], '...', samples[-6:])
print('max pos', max(samples), '| loops fired:', js("window.__loops"), '| ever past 62.1:', any(s>62.1 for s in samples))
# timing: anchor after a wrap should equal loop.a
print('anchor after wrap:', round(js(f"{T}.clipAnchorSec"),3))
# toggle off mid-play -> plays through
key('KeyC','c'); time.sleep(3.2); p=js(f"{T}.getPosition().sec")
print('C off mid-play -> passes 62:', round(p,2), p>62.1)
js(f"{T}.stop()")
# click the cycle bar toggles back on; drag its right edge 62 -> 66
X=lambda s: js(f"{TL}.x({s})")
mouse('mousePressed',g['x']+X(61),g['y']+3); mouse('mouseReleased',g['x']+X(61),g['y']+3); time.sleep(0.05)
print('click bar toggles on:', js(f"{A}.loop.on"))
x0=X(62); x1=X(66)
mouse('mousePressed',g['x']+x0,g['y']+3,mods=4)
for i in range(1,6): mouse('mouseMoved',g['x']+x0+(x1-x0)*i/5,g['y']+3,mods=4)
mouse('mouseReleased',g['x']+x1,g['y']+3,mods=4); time.sleep(0.05)
print('drag right edge -> b:', round(js(f"{A}.loop.b"),2), '| a unchanged:', round(js(f"{A}.loop.a"),2))
# ⌘U sets loop from a new range
js(f"{TL}.range={{a:100,b:104}}"); key('KeyU','u',mods=4); print('⌘U from range:', js(f"JSON.stringify({A}.loop)"))
# song end doesn't stop playback while looping past it? (loop inside song so N/A) -> check no stop at end when loop on & range at end
print('in project JSON:', 'loop' in json.loads(js(f"JSON.stringify({A})")))
d=cdp('Page.captureScreenshot',format='png')['data']; open('/tmp/oscine-loop.png','wb').write(base64.b64decode(d))
for _ in range(8): js("window.oscine.store.undo()")
print('errors:', js("(window.__errs||[]).length"), js("JSON.stringify(window.__errs||[])")[:300])
