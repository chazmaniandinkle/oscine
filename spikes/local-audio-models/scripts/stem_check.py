"""Check a separation: per-stem RMS and how well the stems sum back to the mix.

Usage: python3 scripts/stem_check.py <mix.wav> <stem_dir>
Uses ffmpeg to decode to float32 so it needs no numpy wheels beyond the venv.
"""
import subprocess, sys, os, glob, math, array, json

def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', '44100', '-'],
                         check=True, capture_output=True).stdout
    a = array.array('f'); a.frombytes(raw); return a

def rms_db(a):
    s = math.fsum(x * x for x in a) / max(len(a), 1)
    return 10 * math.log10(s + 1e-20)

mix = load(sys.argv[1])
stems = {os.path.basename(p): load(p) for p in sorted(glob.glob(os.path.join(sys.argv[2], '*.wav')))}
n = min([len(mix)] + [len(s) for s in stems.values()])
summed = array.array('f', [0.0]) * n
for s in stems.values():
    for i in range(n): summed[i] += s[i]
resid = array.array('f', (mix[i] - summed[i] for i in range(n)))
out = {'mix_rms_db': round(rms_db(mix[:n]), 2),
       'stems_rms_db': {k: round(rms_db(v[:n]), 2) for k, v in stems.items()},
       'residual_rms_db': round(rms_db(resid), 2),
       'reconstruction_snr_db': round(rms_db(mix[:n]) - rms_db(resid), 2),
       'samples_compared': n}
print(json.dumps(out, indent=1))
