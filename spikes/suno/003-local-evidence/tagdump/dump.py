import sys, json, glob, os, hashlib, subprocess
import mutagen
S="/Users/slowbro/workspaces/cog/projects/songs/2026-09-19-housekeeping-heat"
D="/Users/slowbro/Downloads"
files=[f"{S}/renders/borrowed-light/render1-v13.m4a",f"{S}/renders/borrowed-light/render2-v14.m4a",
 f"{S}/tfr-run2.m4a",f"{S}/tfr-run3.m4a",f"{S}/the-basin-holds.m4a",f"{S}/the-part-that-wont-fold.mp3",
 f"{S}/standing-waves-pass1.mp3",f"{S}/the-field-remains-final.mp3"]
for pat in ["*.m4a","*.mp3","*.mp4","*.wav"]:
    for f in glob.glob(f"{D}/{pat}"):
        n=os.path.basename(f).lower()
        if any(k in n for k in ["borrowed","field","basin","wave","part"]): files.append(f)
out={}
def short(v):
    s=repr(v)
    return s if len(s)<300 else s[:300]+f"...(len {len(s)})"
for f in files:
    if not os.path.exists(f): out[f]="MISSING"; continue
    r={"size":os.path.getsize(f)}
    r["sha256"]=hashlib.sha256(open(f,"rb").read()).hexdigest()
    try:
        m=mutagen.File(f)
        r["type"]=type(m).__name__ if m else None
        if m is not None:
            r["dur"]=round(m.info.length,3)
            tags={}
            if m.tags:
                for k in m.tags.keys():
                    v=m.tags[k]
                    if k.startswith("APIC") or k=="covr":
                        try: tags[k]=f"<image {len(v[0]) if k=='covr' else len(v.data)} bytes>"
                        except Exception: tags[k]="<image>"
                    else: tags[k]=short(v)
            r["tags"]=tags
    except Exception as e: r["err"]=str(e)
    p=subprocess.run(["ffprobe","-v","error","-show_format","-show_streams","-of","json",f],capture_output=True,text=True)
    j=json.loads(p.stdout or "{}")
    r["ff_format_tags"]=j.get("format",{}).get("tags")
    r["ff_streams"]=[(s.get("codec_name"),s.get("codec_type"),s.get("sample_rate"),s.get("bit_rate"),s.get("tags")) for s in j.get("streams",[])]
    out[f]=r
json.dump(out,open("/tmp/mutv/tags.json","w"),indent=1)
print(json.dumps(out,indent=1))
