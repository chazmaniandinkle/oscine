// Persistence: autosave to localStorage on any project-mutating event,
// plus JSON file export/import. Ephemeral event namespaces are excluded
// so playback never causes writes.

import { debounce, downloadText } from './util.js';
import { demoProject, validateProject } from './schema.js';

const STORAGE_KEY = 'oscine.project.v1';

const EPHEMERAL_PREFIXES = ['transport:', 'schedule:', 'ui:', 'track:trigger'];

export function loadInitialProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return validateProject(JSON.parse(raw));
  } catch (err) {
    console.warn('autosave unreadable, starting fresh:', err);
  }
  return demoProject();
}

export function attachAutosave(store, bus) {
  const save = debounce(() => {
    try {
      localStorage.setItem(STORAGE_KEY, store.serialize());
    } catch (err) {
      console.warn('autosave failed:', err);
    }
  }, 600);

  bus.on('*', (type) => {
    if (EPHEMERAL_PREFIXES.some(p => type.startsWith(p))) return;
    save();
  });
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

export function clearAutosave() {
  localStorage.removeItem(STORAGE_KEY);
}
