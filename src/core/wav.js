// WAV encoder: turn rendered audio (one Float32Array per channel, samples
// in -1..1) into a 16-bit PCM WAV file as a Uint8Array. Pure and
// dependency-free, so it's importable from node and covered by the smoke
// suite without a browser. The audio render itself (OfflineAudioContext)
// lives in the engine layer; this only does the container + quantization.

const clampSample = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

// channels: Float32Array[] (1 = mono, 2 = stereo, ...), all the same length.
export function encodeWav(channels, sampleRate) {
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error('encodeWav needs at least one channel of samples.');
  }
  const numChannels = channels.length;
  const numFrames = channels[0].length;
  for (const ch of channels) {
    if (ch.length !== numFrames) throw new Error('All channels must be the same length.');
  }

  const bytesPerSample = 2;          // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  // RIFF header
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);   // file size minus the first 8 bytes
  writeStr(8, 'WAVE');
  // fmt chunk
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);               // PCM fmt chunk size
  view.setUint16(20, 1, true);                // audio format 1 = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  // data chunk
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  // Interleave channels, frame by frame.
  let offset = 44;
  for (let f = 0; f < numFrames; f++) {
    for (let c = 0; c < numChannels; c++) {
      const s = clampSample(channels[c][f]);
      // Asymmetric 16-bit range: scale negatives by 0x8000, positives by 0x7FFF.
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}
