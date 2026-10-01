// Built-in preferences. Importing this registers them; the barrel
// (core/prefs/index.js) pulls it in, so anything that imports `prefs` gets
// the full set. Add a pref here — or call definePref() from the module that
// owns the behaviour — and it appears in the settings panel and the
// `settings` command with no further wiring.
import { definePref, defineSection } from './registry.js';
import { SCHEMES } from '../keymap.js';

defineSection({ id: 'editing', label: 'Editing' });
defineSection({ id: 'view', label: 'View' });
defineSection({ id: 'keys', label: 'Keyboard' });
defineSection({ id: 'transcription', label: 'Transcription' });

definePref({
  key: 'snap.on', type: 'boolean', default: true, section: 'editing', label: 'Snap',
  help: 'Drags and ranges snap. N toggles it; hold the no-snap modifier (⌘ by default) while dragging to bypass it once.',
});

definePref({
  key: 'snap.grid', type: 'number', default: 0.25, section: 'editing', label: 'Grid',
  options: [
    { value: 0, label: 'Off' }, { value: 0.25, label: '1/16' }, { value: 0.5, label: '1/8' },
    { value: 1, label: 'Beat' }, { value: 4, label: 'Bar' },
  ],
  help: 'With a grid picked, drags and range ends land on it; clip edges, the playhead and a range\u2019s fixed edge still attract within the snap distance. Off turns snapping off entirely.',
});

definePref({
  key: 'snap.distancePx', type: 'number', default: 8, min: 2, max: 30, step: 1, suffix: ' px',
  section: 'editing', label: 'Snap distance',
  help: 'How close (in screen pixels) a clip edge, the playhead or a range edge must be to catch a drag. Wins over the grid.',
});

definePref({
  key: 'view.follow', type: 'boolean', default: true, section: 'view', label: 'Follow playhead',
  help: 'The timeline pages along during playback. L toggles it.',
});

definePref({
  key: 'view.lyrics', type: 'boolean', default: true, section: 'view', label: 'Lyrics bar',
  help: 'Words of one lane under the timeline; click a word to jump. ⇧L toggles it.',
});

definePref({
  key: 'keys.scheme', type: 'string', default: 'oscine', section: 'keys', label: 'Key scheme',
  // Read lazily from the keymap so a scheme added there shows up here.
  options: () => Object.entries(SCHEMES).map(([id, s]) => ({ value: id, label: s.label })),
  help: 'Shortcuts and drag modifiers from another DAW\u2019s conventions. Each binding cites the manual page it came from.',
});

definePref({
  key: 'transcribe.model', type: 'string', default: 'small', section: 'transcription', label: 'Whisper model',
  options: ['tiny', 'base', 'small', 'medium', 'large-v3', 'turbo'].map(v => ({ value: v, label: v })),
  help: 'Model the sidecar uses for Transcribe. Bigger is slower and more accurate on sung vocals. A model not yet on disk downloads on first use (medium ≈1.5 GB, large-v3 ≈3 GB). Results are cached per model.',
});
