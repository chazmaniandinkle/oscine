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
    // Fallback when the clipboard API is unavailable: surface the link in the
    // address bar. replaceState avoids pushing a Back/Forward history entry.
    if (!copied && typeof history !== 'undefined' && history.replaceState) {
      history.replaceState(null, '', url);
    }
  } catch (err) {
    toast('Could not build share link: ' + err.message);
  }
}

// Open a project document by relative path through the sidecar's
// /project-doc route (same doc oscine_project_open_file hands the app, baseUrl
// included). Remembered in localStorage so a reload lands back on it.
export const LAST_PROJECT_KEY = 'oscine.lastProjectPath';

export async function listProjects() {
  const res = await fetch('/projects.json');
  if (!res.ok) throw new Error('no sidecar project root');
  return res.json();
}

export async function openProjectPath(path, api, { quiet = false } = {}) {
  const res = await fetch('/project-doc/' + path.split('/').map(encodeURIComponent).join('/'));
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  const project = await res.json();
  const out = await api.execute('project', { action: 'load', project });
  try { localStorage.setItem(LAST_PROJECT_KEY, path); } catch {}
  if (!quiet) toast(`Opened "${out.project}"`);
  return out;
}

// Save the live project back to the document it was opened from.
export async function saveProjectPath(store, api, path = null) {
  path = path || (() => { try { return localStorage.getItem(LAST_PROJECT_KEY); } catch { return null; } })();
  if (!path) { toast('No project file open — use Open project… first.'); return; }
  const project = await api.execute('project', { action: 'get' });
  const res = await fetch('/project-doc/' + path.split('/').map(encodeURIComponent).join('/'), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project),
  });
  if (!res.ok) { toast('Save failed: ' + await res.text()); return; }
  toast(`Saved ${path}`);
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
