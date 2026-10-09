// Spike: run Oracle of Ages' REAL sound driver (bank $39) on oracles-web's SM83
// interpreter, one updateSound per 60 Hz frame, and log every APU register write.
// If the log is sane, the driver is a provider: song id in, register stream out.
const { Mem, CPU } = require('/Users/slowbro/workspaces/myrgic/oracles-web/engine/sm83.js');
const fs = require('fs');
const rom = fs.readFileSync('/Users/slowbro/workspaces/zelda-resources/decomps/oracles/ages.gbc');
const song = Number(process.argv[2] ?? 0x0b), frames = Number(process.argv[3] ?? 600);
const m = new Mem(rom); m.bankAddr = 0x2222; m.bank = 0x39;
const writes = []; let frame = 0;
const wr0 = m.wr.bind(m);
m.wr = (a, v) => { a &= 0xffff; if (a >= 0xff10 && a <= 0xff3f) writes.push([frame, a - 0xff00, v & 255]); return wr0(a, v); };
const cpu = new CPU(m); cpu.sp = 0xdff0;
function call(pc, a = 0, max = 2e6) {
  cpu.a = a; cpu.push(0xfff0); cpu.pc = pc;
  for (let i = 0; i < max; i++) { if (cpu.pc === 0xfff0) return i; cpu.step(); }
  throw new Error('runaway at ' + cpu.pc.toString(16));
}
m.bank = 0x39; let steps = call(0x4015, 0x39);           // b39_initSound (a = base bank)
m.bank = 0x39; steps += call(0x4b50, song);             // playSound(song)
let perFrame = 0;
for (frame = 0; frame < frames; frame++) { m.bank = 0x39; perFrame += call(0x4127); } // updateSound
const byReg = {}; for (const [, r] of writes) byReg[r.toString(16)] = (byReg[r.toString(16)] || 0) + 1;
console.log(JSON.stringify({ song, frames, writes: writes.length, avgInstrPerFrame: Math.round(perFrame / frames), regs: byReg }));
console.log('first writes:', writes.slice(0, 24).map(([f, r, v]) => `${f}:${r.toString(16)}=${v.toString(16)}`).join(' '));
fs.writeFileSync(`/tmp/apu-${song}.json`, JSON.stringify(writes));
