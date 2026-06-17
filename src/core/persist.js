// Persistence: autosave to localStorage on any project-mutating event,
// plus JSON file export/import. Ephemeral event namespaces are excluded
// so playback never causes writes.
//
// Autosave is per-tab keyed so two tabs never clobber each other. Each tab
// writes its own '<prefix>:<clientId>' key holding { savedAt, project }.
// A reloaded tab restores its own work (the clientId lives in sessionStorage
// and survives reload); a brand-new tab inherits the freshest session for
// continuity. The legacy single-key value is migrated on first load. Writes
// are debounced, and we flush immediately when the tab is hidden or unloaded
// so the last edit is never lost. NOTE: this deliberately avoids Web Locks /
// BroadcastChannel; per-tab keys can't drop a tab's edits, so no autosave
// leader election is needed.

import { downloadText } from './util.js';
import { demoProject, validateProject } from './schema.js';

const KEY_PREFIX = 'oscine.project.v1';
const MAX_TAB_KEYS = 6;     // keep only the most recent N per-tab keys
const SAVE_DEBOUNCE_MS = 600;

const EPHEMERAL_PREFIXES = ['transport:', 'schedule:', 'ui:', 'midi:', 'ledger:', 'track:trigger'];

const tabKey = (clientId) => `${KEY_PREFIX}:${clientId}`;

// localStorage is absent in node (tests import this module) and may throw in
// private-mode browsers; never let storage access break the caller.
function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

// All per-tab keys currently in storage, newest first by savedAt.
function tabEntries(ls) {
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    if (!key || !key.startsWith(`${KEY_PREFIX}:`)) continue;
    let savedAt = 0;
    try {
      savedAt = JSON.parse(ls.getItem(key))?.savedAt ?? 0;
    } catch { /* corrupt entry sorts oldest */ }
    out.push({ key, savedAt });
  }
  out.sort((a, b) => b.savedAt - a.savedAt);
  return out;
}

export function loadInitialProject(clientId) {
  const ls = storage();
  if (!ls) return demoProject();
  try {
    // (1) This tab's own key wins: a reloaded tab keeps its clientId and so
    // restores exactly the work it was doing.
    if (clientId) {
      const own = ls.getItem(tabKey(clientId));
      if (own) return validateProject(JSON.parse(own).project);
    }
    // (2) Otherwise inherit the most-recently-saved tab session (continuity
    // for a brand-new tab).
    const entries = tabEntries(ls);
    if (entries.length) {
      const raw = ls.getItem(entries[0].key);
      if (raw) return validateProject(JSON.parse(raw).project);
    }
    // (3) Migrate from the legacy single-key value if present.
    const legacy = ls.getItem(KEY_PREFIX);
    if (legacy) return validateProject(JSON.parse(legacy));
  } catch (err) {
    console.warn('autosave unreadable, starting fresh:', err);
  }
  // (4) Nothing usable; start from the demo song.
  return demoProject();
}

export function attachAutosave(store, bus, clientId) {
  const ls = storage();
  if (!ls) return;

  // Per-tab key when we have a stable id; fall back to the legacy single key
  // for node/tests or browsers without sessionStorage so nothing breaks.
  const key = clientId ? tabKey(clientId) : KEY_PREFIX;

  const writeNow = () => {
    try {
      const serialized = store.serialize();
      const value = clientId
        ? JSON.stringify({ savedAt: Date.now(), project: serialized })
        : serialized;
      ls.setItem(key, value);
      prune(ls, key);
    } catch (err) {
      console.warn('autosave failed:', err);
    }
  };

  // Own the debounce timer so we can flush (cancel pending + write now) on
  // tab hide/unload.
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(writeNow, SAVE_DEBOUNCE_MS);
  };
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    writeNow();
  };

  bus.on('*', (type) => {
    if (EPHEMERAL_PREFIXES.some(p => type.startsWith(p))) return;
    save();
  });

  // Persist the last edit the moment the tab is backgrounded or torn down;
  // the debounce window would otherwise drop the final ~600ms on close.
  if (typeof document !== 'undefined') {
    try {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
      window.addEventListener('pagehide', flush);
    } catch { /* no document/window: node, do nothing */ }
  }
}

// Keep only the most recent per-tab keys so they don't accumulate across many
// short-lived tabs. Never remove the key this tab is actively writing.
function prune(ls, currentKey) {
  try {
    const entries = tabEntries(ls);
    if (entries.length <= MAX_TAB_KEYS) return;
    for (const { key } of entries.slice(MAX_TAB_KEYS)) {
      if (key !== currentKey) ls.removeItem(key);
    }
  } catch { /* pruning is best-effort */ }
}

export function exportProject(store) {
  const safe = store.project.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'song';
  downloadText(`${safe}.oscine.json`, store.serialize());
}

export function importProjectFile(file, store) {
  return file.text().then(text => {
    store.load(JSON.parse(text));
  });
}

export function clearAutosave(clientId) {
  const ls = storage();
  if (!ls) return;
  try {
    if (clientId) ls.removeItem(tabKey(clientId));
    ls.removeItem(KEY_PREFIX);
  } catch { /* nothing to clear */ }
}
