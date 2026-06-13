// Sync the app into the plugin bundle: plugin/app/ becomes an exact copy
// of index.html + styles/ + src/. Run after any app change, before
// packaging the plugin. `node tools/sync-plugin.mjs --check` verifies
// without writing (used by the test suite).

import { cp, rm, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = join(ROOT, 'plugin', 'app');
const SOURCES = ['index.html', 'styles', 'src'];

async function* walk(dir) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function treeHash(base, roots) {
  const hash = createHash('sha1');
  const files = [];
  for (const root of roots) {
    const p = join(base, root);
    try {
      if ((await stat(p)).isDirectory()) {
        for await (const f of walk(p)) files.push(f);
      } else {
        files.push(p);
      }
    } catch {
      return null; // missing tree
    }
  }
  files.sort((a, b) => relative(base, a).localeCompare(relative(base, b)));
  for (const f of files) {
    hash.update(relative(base, f));
    hash.update(await readFile(f));
  }
  return hash.digest('hex');
}

const checkOnly = process.argv.includes('--check');

const srcHash = await treeHash(ROOT, SOURCES);
const dstHash = await treeHash(APP_DIR, SOURCES);

if (srcHash === dstHash) {
  console.log('plugin/app is in sync.');
  process.exit(0);
}

if (checkOnly) {
  console.error('plugin/app is OUT OF SYNC with the repo. Run: node tools/sync-plugin.mjs');
  process.exit(1);
}

await rm(APP_DIR, { recursive: true, force: true });
await mkdir(APP_DIR, { recursive: true });
for (const s of SOURCES) {
  await cp(join(ROOT, s), join(APP_DIR, s), { recursive: true });
}
console.log('synced app -> plugin/app');
