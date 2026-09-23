import json, urllib.request, websocket, time, base64, itertools
PORT = 9391
_ids = itertools.count(1)

def connect():
    tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json'))
    page = [t for t in tabs if t['type'] == 'page'][0]
    return websocket.create_connection(page['webSocketDebuggerUrl'], timeout=60, suppress_origin=True)

class C:
    def __init__(self): self.ws = connect()
    def call(self, method, **params):
        i = next(_ids); self.ws.send(json.dumps({'id': i, 'method': method, 'params': params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get('id') == i:
                if 'error' in m: raise RuntimeError(m['error'])
                return m['result']
    def js(self, expr, await_=True):
        r = self.call('Runtime.evaluate', expression=expr, returnByValue=True, awaitPromise=await_)
        if 'exceptionDetails' in r: raise RuntimeError(json.dumps(r['exceptionDetails'])[:800])
        return r['result'].get('value')
    def mouse(self, typ, x, y, button='left', clicks=1, mods=0):
        self.call('Input.dispatchMouseEvent', type=typ, x=x, y=y, button=button, clickCount=clicks, modifiers=mods,
                  buttons=(1 if button == 'left' else 2) if typ == 'mousePressed' else 0)
    def click(self, x, y, button='left', clicks=1, mods=0):
        self.mouse('mouseMoved', x, y)
        for c in range(1, clicks + 1):
            self.mouse('mousePressed', x, y, button, c, mods); self.mouse('mouseReleased', x, y, button, c, mods)
        time.sleep(0.15)
    def drag(self, x0, y0, x1, y1, steps=8):
        self.mouse('mouseMoved', x0, y0); self.mouse('mousePressed', x0, y0)
        for k in range(1, steps + 1):
            self.call('Input.dispatchMouseEvent', type='mouseMoved', x=x0 + (x1 - x0) * k / steps, y=y0 + (y1 - y0) * k / steps, button='left', buttons=1)
        self.mouse('mouseReleased', x1, y1); time.sleep(0.15)
    def key(self, key, code=None, text=None, vk=0):
        d = dict(key=key, code=code or key, windowsVirtualKeyCode=vk)
        self.call('Input.dispatchKeyEvent', type='keyDown', text=text, **d) if text else self.call('Input.dispatchKeyEvent', type='rawKeyDown', **d)
        self.call('Input.dispatchKeyEvent', type='keyUp', **d)
    def type(self, s): self.call('Input.insertText', text=s)
    def shot(self, path, clip=None):
        kw = {'format': 'png'}
        if clip: kw['clip'] = dict(clip, scale=1)
        open(path, 'wb').write(base64.b64decode(self.call('Page.captureScreenshot', **kw)['data'])); return path

def open_app(c):
    c.call('Emulation.setDeviceMetricsOverride', width=1600, height=1000, deviceScaleFactor=1, mobile=False)
    c.call('Page.navigate', url='http://127.0.0.1:7391/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json')
    for _ in range(80):
        time.sleep(0.25)
        try:
            if c.js('!!(window.oscine?.app?.timeline?.arrangement)'): break
        except Exception: pass
    time.sleep(1.0)

# geometry helpers (page coords)
GEOM = '''(() => { const tl = window.oscine.app.timeline, r = tl.canvas.getBoundingClientRect();
  return { left: r.left, top: r.top, lanes: tl.lanes().map((l, i) => ({ id: l.id, y: tl.laneY(i), h: tl.laneH(l), auto: tl.autoTargets(l) })) }; })()'''
