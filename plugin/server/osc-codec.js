// Minimal OSC 1.0 codec: messages and bundles, zero dependencies.
// Supports the type tags that matter for control surfaces:
//   i int32, f float32, s string, b blob, T true, F false, N nil
// Bundles decode recursively; timetags are surfaced but this gateway
// executes immediately (timetag scheduling is a roadmap item).
// Pure functions over Buffer/Uint8Array: importable from tests.

function padded(len) {
  return (len + 4) & ~3; // string/blob content padded to 4-byte boundary
}

function writeString(parts, str) {
  const bytes = Buffer.from(String(str), 'utf8');
  const buf = Buffer.alloc(padded(bytes.length + 1)); // at least one NUL
  bytes.copy(buf);
  parts.push(buf);
}

export function encodeMessage(address, args = []) {
  const parts = [];
  writeString(parts, address);

  let tags = ',';
  const argParts = [];
  for (const arg of args) {
    if (typeof arg === 'boolean') {
      tags += arg ? 'T' : 'F';
    } else if (arg === null || arg === undefined) {
      tags += 'N';
    } else if (typeof arg === 'number') {
      if (Number.isInteger(arg) && Math.abs(arg) <= 0x7fffffff) {
        tags += 'i';
        const b = Buffer.alloc(4);
        b.writeInt32BE(arg);
        argParts.push(b);
      } else {
        tags += 'f';
        const b = Buffer.alloc(4);
        b.writeFloatBE(arg);
        argParts.push(b);
      }
    } else if (arg instanceof Uint8Array) {
      tags += 'b';
      const b = Buffer.alloc(4 + padded(arg.length));
      b.writeInt32BE(arg.length);
      Buffer.from(arg).copy(b, 4);
      argParts.push(b);
    } else {
      tags += 's';
      const p = [];
      writeString(p, arg);
      argParts.push(p[0]);
    }
  }
  writeString(parts, tags);
  return Buffer.concat([...parts, ...argParts]);
}

function readString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  return { value: buf.toString('utf8', offset, end), next: offset + padded(end - offset + 1) };
}

function decodeOne(buf) {
  const addr = readString(buf, 0);
  if (!addr.value.startsWith('/')) throw new Error('not an OSC message');
  let offset = addr.next;
  const tags = readString(buf, offset);
  offset = tags.next;

  const args = [];
  for (const tag of tags.value.slice(1)) {
    switch (tag) {
      case 'i': args.push(buf.readInt32BE(offset)); offset += 4; break;
      case 'f': args.push(buf.readFloatBE(offset)); offset += 4; break;
      case 'd': args.push(buf.readDoubleBE(offset)); offset += 8; break;
      case 's': case 'S': {
        const s = readString(buf, offset);
        args.push(s.value);
        offset = s.next;
        break;
      }
      case 'b': {
        const len = buf.readInt32BE(offset);
        args.push(Uint8Array.prototype.slice.call(buf, offset + 4, offset + 4 + len));
        offset += 4 + padded(len);
        break;
      }
      case 'T': args.push(true); break;
      case 'F': args.push(false); break;
      case 'N': args.push(null); break;
      case 't': offset += 8; break; // timetag arg: skip
      default: throw new Error(`unsupported OSC type tag '${tag}'`);
    }
  }
  return { address: addr.value, args };
}

// Returns an array of { address, args, timetag? } (bundles are flattened).
export function decodePacket(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length === 0) return [];
  if (buf[0] === 0x23) { // '#' -> "#bundle"
    const tag = readString(buf, 0);
    if (tag.value !== '#bundle') throw new Error('malformed bundle');
    const seconds = buf.readUInt32BE(8);
    const fraction = buf.readUInt32BE(12);
    const timetag = seconds + fraction / 2 ** 32;
    const out = [];
    let offset = 16;
    while (offset + 4 <= buf.length) {
      const size = buf.readInt32BE(offset);
      offset += 4;
      if (size <= 0 || offset + size > buf.length) break;
      for (const msg of decodePacket(buf.subarray(offset, offset + size))) {
        out.push({ ...msg, timetag });
      }
      offset += size;
    }
    return out;
  }
  return [decodeOne(buf)];
}
