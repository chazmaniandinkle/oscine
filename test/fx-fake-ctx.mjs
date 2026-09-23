// Shared fake AudioContext stub for effect node tests. Mirrors the pattern
// in test/stretch.mjs: minimal objects with .connect/.disconnect and
// AudioParam-like fields, enough for effect constructors + applyAll() to
// run without throwing outside a browser.

function fakeParam(initial = 0) {
  return {
    value: initial,
    setTargetAtTime() { return this; },
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    cancelScheduledValues() { return this; },
  };
}

function fakeNode(extraParams = {}) {
  const node = {
    connect() { return node; },
    disconnect() { return undefined; },
  };
  for (const [k, v] of Object.entries(extraParams)) node[k] = v;
  return node;
}

export function makeFakeCtx() {
  return {
    currentTime: 0,
    sampleRate: 44100,
    createGain() {
      return fakeNode({ gain: fakeParam(1) });
    },
    createBiquadFilter() {
      return fakeNode({
        type: 'lowpass',
        frequency: fakeParam(350),
        Q: fakeParam(1),
        gain: fakeParam(0),
        detune: fakeParam(0),
      });
    },
    createWaveShaper() {
      return fakeNode({ curve: null, oversample: 'none' });
    },
    createDelay() {
      return fakeNode({ delayTime: fakeParam(0) });
    },
    createOscillator() {
      return fakeNode({
        type: 'sine',
        frequency: fakeParam(440),
        detune: fakeParam(0),
        start() {},
        stop() {},
      });
    },
    createStereoPanner() {
      return fakeNode({ pan: fakeParam(0) });
    },
    createDynamicsCompressor() {
      return fakeNode({
        threshold: fakeParam(-24),
        knee: fakeParam(30),
        ratio: fakeParam(12),
        attack: fakeParam(0.003),
        release: fakeParam(0.25),
      });
    },
    createConvolver() {
      return fakeNode({ buffer: null });
    },
    createAnalyser() {
      return fakeNode({ fftSize: 2048 });
    },
    createBuffer(channels, len) {
      const data = Array.from({ length: channels }, () => new Float32Array(len));
      return {
        numberOfChannels: channels,
        length: len,
        getChannelData(i) { return data[i]; },
      };
    },
    createChannelSplitter(_n) {
      return fakeNode();
    },
    createChannelMerger(_n) {
      return fakeNode();
    },
  };
}
