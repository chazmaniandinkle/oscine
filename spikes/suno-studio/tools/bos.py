#!/usr/bin/env python3
"""Minimal BrowserOS MCP client (streamable HTTP on 127.0.0.1:9000/mcp).

Usage: bos.py <tool> '<json args>'
Prints the tool result's text content (images saved to --out dir if given).
"""
import json, sys, urllib.request, base64, os

URL = os.environ.get("BROWSEROS_MCP", "http://127.0.0.1:9000/mcp")
H = {"content-type": "application/json", "accept": "application/json, text/event-stream"}


def rpc(method, params=None, id_=1, sid=None):
    body = {"jsonrpc": "2.0", "method": method}
    if id_ is not None:
        body["id"] = id_
    if params is not None:
        body["params"] = params
    h = dict(H)
    if sid:
        h["mcp-session-id"] = sid
    req = urllib.request.Request(URL, json.dumps(body).encode(), h, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        sid = r.headers.get("mcp-session-id") or sid
        raw = r.read().decode()
    if not raw.strip():
        return None, sid
    # SSE or JSON
    for line in raw.splitlines():
        if line.startswith("data:"):
            raw = line[5:].strip()
    return json.loads(raw), sid


def call(tool, args):
    init, sid = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                   "clientInfo": {"name": "cog", "version": "1"}})
    rpc("notifications/initialized", id_=None, sid=sid)
    res, _ = rpc("tools/call", {"name": tool, "arguments": args}, id_=2, sid=sid)
    return res


if __name__ == "__main__":
    tool = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    out = sys.argv[3] if len(sys.argv) > 3 else None
    res = call(tool, args)
    if "error" in res:
        print("ERROR", json.dumps(res["error"])[:2000]); sys.exit(1)
    for i, c in enumerate(res["result"].get("content", [])):
        if c.get("type") == "text":
            print(c["text"])
        elif c.get("type") == "image" and out:
            p = f"{out}-{i}.png"
            open(p, "wb").write(base64.b64decode(c["data"]))
            print("IMAGE", p)
