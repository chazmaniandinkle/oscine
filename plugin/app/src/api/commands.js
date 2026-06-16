// The command catalog: Oscine's public API contract, as pure data.
//
// This file is the single source of truth for every programmatic feature.
// Three consumers:
//   1. src/api/api.js binds each command to a handler in the running app
//   2. plugin/server/oscine-mcp.mjs exposes each command as an MCP tool
//      (a synced copy lives in the plugin; tools/sync-plugin.mjs keeps it
//      identical, and the test suite fails if it drifts)
//   3. window.oscine.api in the browser console
//
// No imports, no DOM, no audio: importable from node. Schemas are plain
// JSON Schema, used directly as MCP inputSchema.
//
// Conventions:
//   track  string: track id or exact track name (case-insensitive)
//   slot   'A'..'D' or 0..3; omitted = the active slot
//   time   beats (quarter notes, floats); a slot loops bars*4 beats
//   pitch  MIDI note number 24..107 (60 = C4)
//   vel    0..1

export const API_VERSION = 1;

const TRACK = { type: 'string', description: 'Track id or exact track name (case-insensitive), e.g. "Bass".' };
const SLOT = { type: ['string', 'integer'], description: "Pattern slot 'A'-'D' (or 0-3). Omit for the active slot." };

const NOTE_ITEM = {
  type: 'object',
  properties: {
    start: { type: 'number', minimum: 0, description: 'Start position in beats from loop start (0 = the 1). 16th note = 0.25.' },
    pitch: { type: 'integer', minimum: 24, maximum: 107, description: 'MIDI note number (60 = C4, 69 = A4).' },
    dur: { type: 'number', exclusiveMinimum: 0, default: 0.25, description: 'Length in beats.' },
    vel: { type: 'number', minimum: 0, maximum: 1, default: 0.85, description: 'Velocity 0-1 (drives loudness and filter).' },
  },
  required: ['start', 'pitch'],
};

export const COMMANDS = [
  {
    name: 'status',
    description: 'Snapshot of the whole app: project, transport state, tracks with mixer settings, pattern slots with content counts, and audio-context state. Call this first to orient.',
    readOnly: true,
    input: { type: 'object', properties: {} },
  },
  {
    name: 'transport',
    description: 'Control playback and timing. Optionally set bpm/swing/metronome, then apply an action. Playback loops the active pattern slot. Returns transport state; if the browser audio context is suspended, the response says how to unlock it.',
    input: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['play', 'stop', 'toggle'], description: 'Transport action to apply after any settings.' },
        bpm: { type: 'integer', minimum: 40, maximum: 240, description: 'Tempo in beats per minute.' },
        swing: { type: 'number', minimum: 0, maximum: 1, description: 'Swing amount: delays off-16ths. 0 = straight, ~0.15 subtle, 0.5 strong.' },
        metronome: { type: 'boolean', description: 'Click track on/off.' },
      },
    },
  },
  {
    name: 'project',
    description: "Project-level operations: 'get' returns the full project JSON (the save-file format); 'new' starts a blank or demo project; 'load' replaces the project with provided JSON; 'rename' sets the song name; 'undo'/'redo' step history. All destructive actions are undoable.",
    input: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'new', 'load', 'rename', 'undo', 'redo'] },
        kind: { type: 'string', enum: ['blank', 'demo'], default: 'blank', description: "For 'new'." },
        name: { type: 'string', description: "For 'rename' (or to name a 'new' project)." },
        project: { type: 'object', description: "For 'load': a full project object previously returned by action 'get'." },
      },
      required: ['action'],
    },
  },
  {
    name: 'list_instruments',
    description: 'The instrument registry: every available instrument type with its full parameter schema (keys, ranges, defaults, groups), preset names, and drum lane ids. Use this to know what add_track and set_params accept.',
    readOnly: true,
    input: { type: 'object', properties: {} },
  },
  {
    name: 'add_track',
    description: 'Add a track of an instrument type from list_instruments (e.g. poly, fm, drums). Creates empty patterns in all four slots and selects the track.',
    input: {
      type: 'object',
      properties: {
        type: { type: 'string', description: "Instrument type id, e.g. 'poly', 'fm', 'drums'." },
        name: { type: 'string', description: 'Optional track name.' },
      },
      required: ['type'],
    },
  },
  {
    name: 'remove_track',
    description: 'Delete a track and its patterns in all slots (undoable).',
    input: { type: 'object', properties: { track: TRACK }, required: ['track'] },
  },
  {
    name: 'rename_track',
    description: 'Rename a track. The new name becomes its address for other tools and its label across the UI.',
    input: {
      type: 'object',
      properties: { track: TRACK, name: { type: 'string' } },
      required: ['track', 'name'],
    },
  },
  {
    name: 'select_track',
    description: "Select a track in the UI: the center editor follows (piano roll for synths, step grid for drums), and the on-screen keyboard plays it.",
    input: { type: 'object', properties: { track: TRACK }, required: ['track'] },
  },
  {
    name: 'set_mix',
    description: "Set a track's mixer channel: fader gain, pan, mute, solo, and FX send levels. Only provided fields change.",
    input: {
      type: 'object',
      properties: {
        track: TRACK,
        gain: { type: 'number', minimum: 0, maximum: 1, description: 'Fader level (audio-tapered; 0.8 is unity-ish).' },
        pan: { type: 'number', minimum: -1, maximum: 1, description: '-1 hard left, 0 center, 1 hard right.' },
        mute: { type: 'boolean' },
        solo: { type: 'boolean' },
        sendDelay: { type: 'number', minimum: 0, maximum: 1, description: 'Send level into the shared tempo-synced delay.' },
        sendReverb: { type: 'number', minimum: 0, maximum: 1, description: 'Send level into the shared reverb.' },
      },
      required: ['track'],
    },
  },
  {
    name: 'set_master',
    description: 'Set master volume and the shared FX buses: delay division/feedback/return and reverb size/return. Only provided fields change.',
    input: {
      type: 'object',
      properties: {
        volume: { type: 'number', minimum: 0, maximum: 1.2, description: 'Master output level.' },
        delayDiv: { type: 'number', enum: [0.25, 0.5, 0.75, 1, 1.5, 2], description: 'Delay time in beats: 0.25=1/16, 0.5=1/8, 0.75=dotted 1/8, 1=1/4, 1.5=dotted 1/4, 2=1/2.' },
        delayFeedback: { type: 'number', minimum: 0, maximum: 0.9 },
        delayReturn: { type: 'number', minimum: 0, maximum: 1 },
        verbSize: { type: 'number', minimum: 0.4, maximum: 6, description: 'Reverb tail length in seconds.' },
        verbReturn: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
  {
    name: 'set_params',
    description: "Shape a track's sound: optionally apply a preset (from list_instruments), then set individual instrument parameters on top. Values are validated against the instrument's schema and clamped to range. Returns the resulting params.",
    input: {
      type: 'object',
      properties: {
        track: TRACK,
        preset: { type: 'string', description: "Preset name, or 'init' for defaults. Applied before params." },
        params: {
          type: 'object',
          description: 'Map of param key -> value, e.g. {"cutoff": 800, "resonance": 8}. Keys per list_instruments.',
          additionalProperties: { type: ['number', 'string', 'boolean'] },
        },
      },
      required: ['track'],
    },
  },
  {
    name: 'get_notes',
    description: 'Read the melodic pattern of a synth track in a slot: notes sorted by start, plus loop length. (Drum tracks use get_steps.)',
    readOnly: true,
    input: { type: 'object', properties: { track: TRACK, slot: SLOT }, required: ['track'] },
  },
  {
    name: 'set_notes',
    description: "Write the melodic pattern of a synth track (undoable). mode 'replace' sets the whole pattern (the usual way to compose), 'add' appends notes, 'remove' deletes by id, 'clear' empties it. Notes use beats/MIDI/velocity per the note schema.",
    input: {
      type: 'object',
      properties: {
        track: TRACK,
        mode: { type: 'string', enum: ['replace', 'add', 'remove', 'clear'] },
        notes: { type: 'array', items: NOTE_ITEM, description: "For 'replace'/'add'." },
        ids: { type: 'array', items: { type: 'string' }, description: "For 'remove': note ids from get_notes." },
        slot: SLOT,
      },
      required: ['track', 'mode'],
    },
  },
  {
    name: 'get_steps',
    description: 'Read the drum pattern of a drum track in a slot: one velocity array (16th-note steps, 0 = off) per lane, plus loop length. (Synth tracks use get_notes.)',
    readOnly: true,
    input: { type: 'object', properties: { track: TRACK, slot: SLOT }, required: ['track'] },
  },
  {
    name: 'set_steps',
    description: "Write drum lanes (undoable). lanes maps lane id -> velocity array (one value per 16th step; 0 = off; arrays are padded/truncated to the slot length). mode 'merge' changes only the provided lanes, 'replace' also clears the lanes you omit, 'clear' empties the whole pattern. Lane ids per list_instruments (kick, snare, clap, chat, ohat, ltom, htom, ride).",
    input: {
      type: 'object',
      properties: {
        track: TRACK,
        mode: { type: 'string', enum: ['merge', 'replace', 'clear'] },
        lanes: {
          type: 'object',
          description: 'e.g. {"kick": [1,0,0,0, 1,0,0,0, ...], "chat": [0,0,0.7,0, ...]}',
          additionalProperties: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 } },
        },
        slot: SLOT,
      },
      required: ['track', 'mode'],
    },
  },
  {
    name: 'slots',
    description: "Pattern slots A-D are four scenes sharing the same tracks. 'list' shows each slot's bars and content; 'select' switches the playing slot (while playing, the switch queues and lands at the next loop boundary); 'set_bars' changes a slot's loop length (1/2/4/8 bars); 'copy' duplicates one slot's patterns into another.",
    input: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'select', 'set_bars', 'copy'] },
        slot: SLOT,
        bars: { type: 'integer', enum: [1, 2, 4, 8], description: "For 'set_bars'." },
        from: SLOT,
        to: SLOT,
      },
      required: ['action'],
    },
  },
  {
    name: 'midi',
    description: "Live WebMIDI hardware input, plus OSC MIDI input for surfaces where WebMIDI is blocked. A connected controller (e.g. an AKAI MPK Mini) plays the selected track through the engine's preview path; record-arm captures played notes/steps into the active pattern quantized to the grid; the controller's knobs (CC) drive the selected instrument's params. Incoming note velocity is shaped in software (floor + curve, or an optional fixed velocity) so soft presses on stiff mini-keys still sound, and a velocity monitor reports the raw values you play so the curve can be tuned to your controller. Device binding happens in the browser app: when no app is connected (a headless agent context) these actions just configure the state the app applies once it is present. Only one browser tab binds the hardware at a time (single-tab ownership): a second tab defers and 'status' reports owner/peers/ownerElsewhere so you can tell which tab holds it; 'claim' takes ownership over for the calling tab. Actions: 'status' reports current config (including velocity shaping and the raw-velocity monitor), enumerated devices, and ownership; 'enable'/'disable' turn WebMIDI on/off; 'select' picks an input device by id or name substring; 'set' changes the listen channel, record-arm, and/or velocity shaping (floor/curve/fixed); 'monitor' returns the raw incoming-velocity monitor (pass reset:true to zero it first); 'input' injects a raw MIDI message (the /oscine/midi/in OSC address and the midi-osc-bridge tool use this) into the same input pipeline as WebMIDI, so velocity shaping, the monitor, and record-arm all apply even when WebMIDI is off or unavailable; 'map' binds a CC number to a numeric param of the selected track's instrument; 'learn' arms the next incoming CC to bind to a param; 'clear_map' removes one CC mapping (with 'cc') or all of them; 'claim' takes MIDI ownership for this tab away from another tab that holds it.",
    input: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'enable', 'disable', 'select', 'set', 'input', 'monitor', 'map', 'learn', 'clear_map', 'claim'] },
        device: { type: 'string', description: "For 'select': input device id or a case-insensitive name substring." },
        channel: { type: 'integer', minimum: 0, maximum: 16, description: '0 = omni; 1..16 listen on that channel only.' },
        record: { type: 'boolean', description: 'Record-arm: capture played notes/steps into the active pattern, quantized.' },
        floor: { type: 'number', minimum: 0, maximum: 1, description: "For 'set': minimum output velocity, so the softest press still sounds (0 = no floor)." },
        curve: { type: 'number', minimum: 0.2, maximum: 5, description: "For 'set': velocity gamma. <1 boosts soft presses (more sensitive), >1 less; 1 = linear." },
        fixed: { type: 'number', minimum: 0, maximum: 1, description: "For 'set': fixed-velocity mode; >0 ignores incoming velocity and uses this constant, 0 = disabled." },
        bytes: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 255 }, minItems: 1, maxItems: 3, description: "For 'input': a raw MIDI message [status, data1, data2]." },
        reset: { type: 'boolean', description: "For 'monitor': zero the raw-velocity monitor before returning it." },
        cc: { type: 'integer', minimum: 0, maximum: 127, description: "For 'map': controller CC number." },
        param: { type: 'string', description: "For 'map'/'learn': a numeric param key of the selected track's instrument (see list_instruments)." },
      },
      required: ['action'],
    },
  },
  {
    name: 'preview',
    description: 'Audition a sound immediately on the user\'s speakers without touching any pattern: a pitch on a synth track, or a lane hit on a drum track. Useful to check a patch before composing.',
    input: {
      type: 'object',
      properties: {
        track: TRACK,
        pitch: { type: 'integer', minimum: 24, maximum: 107, description: 'For synth tracks.' },
        lane: { type: 'string', description: "For drum tracks: lane id, e.g. 'kick'." },
        vel: { type: 'number', minimum: 0, maximum: 1, default: 0.9 },
        dur: { type: 'number', minimum: 0.05, maximum: 8, default: 0.6, description: 'Synth note length in seconds.' },
      },
      required: ['track'],
    },
  },
  {
    name: 'export_wav',
    description: 'Bounce the song to a 16-bit WAV file and download it in the browser. Renders one pattern slot (default the active one) repeated `loops` times through the full mix and shared master FX, then a tail so reverb and delay ring out. Returns the file metadata (does not return the audio bytes).',
    input: {
      type: 'object',
      properties: {
        slot: SLOT,
        loops: { type: 'integer', minimum: 1, maximum: 16, default: 2, description: 'How many times to repeat the slot loop.' },
        tailSeconds: { type: 'number', minimum: 0, maximum: 12, description: 'Extra time after the last note for FX to decay. Defaults to reverb size + 1.5s.' },
        sampleRate: { type: 'integer', enum: [44100, 48000], default: 44100, description: 'Output sample rate.' },
      },
    },
  },
  {
    name: 'share',
    description: "Song-as-link sharing. Action 'link' encodes the whole project into a URL fragment and returns a shareable link: the entire song travels in the URL with no upload, because Oscine projects are a few KB of pattern data rather than audio. Action 'open' loads a song from such a link (undoable).",
    input: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['link', 'open'], default: 'link' },
        url: { type: 'string', description: "For 'open': a full Oscine share URL or just its '#s=...' fragment." },
      },
    },
  },
];

export function getCommand(name) {
  return COMMANDS.find(c => c.name === name);
}
