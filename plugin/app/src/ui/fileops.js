// UI-side file operations: thin wrappers over core/persist with
// confirmation and toasts kept out of the core layer.

import { exportProject as coreExport, importProjectFile as coreImport } from '../core/persist.js';
import { createProject, demoProject } from '../core/schema.js';
import { toast } from './widgets.js';

export function exportProject(store) {
  coreExport(store);
  toast('Song exported');
}

export function importProjectFile(file, store) {
  return coreImport(file, store);
}

export function demoOrBlank(store, which) {
  const ok = window.confirm(
    `Replace "${store.project.name}" with a ${which === 'demo' ? 'demo song' : 'blank project'}? ` +
    'Unsaved work can still be recovered with undo.'
  );
  if (!ok) return;
  store.checkpoint();
  const fresh = which === 'demo' ? demoProject() : createProject();
  // Keep undo possible: swap content but go through load-like replace.
  store.project = fresh;
  store.afterReplace();
  toast(which === 'demo' ? 'Demo song loaded' : 'New blank project');
}
