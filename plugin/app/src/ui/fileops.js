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

// Audio + link sharing go through the command API so the UI exercises the
// exact same path as MCP/OSC/console callers (the catalog-parity contract).

export async function exportWav(api) {
  toast('Rendering audio…');
  try {
    const res = await api.execute('export_wav', {});
    toast(`Exported ${res.filename} (${res.durationSec}s)`);
  } catch (err) {
    toast('Export failed: ' + err.message);
  }
}

export async function copyShareLink(api) {
  try {
    const { url } = await api.execute('share', { action: 'link' });
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(url); copied = true; } catch { /* fall through */ }
    }
    toast(copied ? 'Share link copied to clipboard' : 'Share link ready (copy from the address bar)');
    if (!copied && typeof location !== 'undefined') location.hash = url.split('#')[1] ?? '';
  } catch (err) {
    toast('Could not build share link: ' + err.message);
  }
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
