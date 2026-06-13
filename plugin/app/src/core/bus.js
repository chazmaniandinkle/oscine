// Tiny pub/sub event bus. The single communication spine of the app:
// the store emits state changes, the engine and UI subscribe.
// Subscribe to '*' to observe everything (used by autosave).
//
// Event catalog (payloads documented in README):
//   settings:changed   { key }                 bpm / swing / masterVolume / name
//   fx:changed         { key, value }          master FX params
//   track:added        { track }
//   track:removed      { trackId }
//   track:changed      { trackId }             rename / cosmetic
//   channel:changed    { trackId, key }        gain / pan / mute / solo / sends
//   param:changed      { trackId, key, value } instrument param
//   preset:applied     { trackId, params }
//   notes:changed      { trackId }
//   steps:changed      { trackId }
//   slot:changed       { active, queued }
//   slot:resized       { slot }
//   project:replaced   {}                      load / import / undo / redo
//   ui:selection       { trackId }
//   transport:state    { playing }
//   transport:loop     {}
//   schedule:window    { fromLocal, toLocal, loopStartAbs, slotIndex, beatToTime, swingOffset }
//   track:trigger      { trackId }             UI activity blip

export class EventBus {
  constructor() {
    this.map = new Map();
  }

  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this.map.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this.map.get(type);
    if (set) for (const fn of [...set]) fn(payload);
    const star = this.map.get('*');
    if (star) for (const fn of [...star]) fn(type, payload);
  }
}
