import json, re, glob, os, subprocess, difflib
import mutagen
S="/Users/slowbro/workspaces/cog/projects/songs/2026-09-19-housekeeping-heat"
t=json.load(open("/tmp/mutv/tags.json"))
print("== summary")
for f,r in t.items():
    if r=="MISSING": print(f,"MISSING"); continue
    tg=r.get("tags",{})
    cmt=tg.get("\u00a9cmt","")
    idm=re.search(r"id=([0-9a-f-]{36})",cmt); cr=re.search(r"created=(\S+?);",cmt)
    print(os.path.relpath(f,"/Users/slowbro"), r["sha256"][:12], r.get("dur"), "id="+(idm.group(1) if idm else "-"), "created="+(cr.group(1) if cr else "-"),
      "lyr" if "\u00a9lyr" in tg else "", "c2pa" if any("c2pa" in k for k in tg) else "", "nam="+tg.get("\u00a9nam","") , "gen="+tg.get("\u00a9gen",""), "cover" if any(k in tg for k in ("covr",)) or any(k.startswith("APIC") for k in tg) else "", "subs" if any(s[1]=="subtitle" for s in r["ff_streams"]) else "")
print("== c2pa strings")
for f in ["/Users/slowbro/Downloads/The_Field_Remains.mp3", f"{S}/standing-waves-pass1.mp3"]:
    m=mutagen.File(f); g=[v for k,v in m.tags.items() if k.startswith("GEOB")][0]
    strs=set(re.findall(rb"[\x20-\x7e]{6,}",g.data))
    print(f); print(sorted(s.decode()[:160] for s in strs)[:80])
print("== subtitle track render1")
p=subprocess.run(["ffmpeg","-v","error","-i",f"{S}/renders/borrowed-light/render1-v13.m4a","-map","0:s:0","-f","srt","-"],capture_output=True,text=True)
print(p.stdout[:900], p.stderr[:300])
print("== lyric match: embedded lyrics vs SEND/lyrics txt files")
def norm(s): return re.sub(r"\s+"," ",s).strip()
txts=sorted(glob.glob(f"{S}/*suno-lyrics*.txt"))+glob.glob("/Users/slowbro/Downloads/*suno-lyrics*.txt")
for f,r in t.items():
    if r=="MISSING" or "\u00a9lyr" not in r.get("tags",{}): continue
    if "/Downloads/" in f and r["sha256"] in [x["sha256"] for k,x in t.items() if "/Downloads/" not in k and x!="MISSING"]: continue
    lyr=norm(r["ff_format_tags"]["lyrics"])
    best=sorted(((difflib.SequenceMatcher(None,lyr,norm(open(x).read())).ratio(),os.path.basename(x)) for x in txts),reverse=True)[:3]
    print(os.path.basename(f), [(round(a,3),b) for a,b in best])
