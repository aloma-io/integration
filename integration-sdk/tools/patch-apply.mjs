// Checks that every deliberate-break patch in a directory still applies to a source tree (PLAT-464).
// `git apply --check` only reads the tree, never writes it, and works on plain files: no .git folder is needed.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function checkPatches({patchDir, root}) {
  const patches = fs.readdirSync(patchDir).filter((f) => f.endsWith('.patch')).sort();
  if (!patches.length) return {checked: 0, failures: [], problem: `no .patch files in ${patchDir}`};
  const failures = [];
  for (const patch of patches) {
    const r = spawnSync('git', ['apply', '--check', path.join(patchDir, patch)], {cwd: root, encoding: 'utf8'});
    if (r.error) return {checked: 0, failures: [], problem: `git could not be run: ${r.error.message}`};
    if (r.status !== 0) {
      const error = (r.stderr || '').split('\n').find((l) => l.trim()) || `git exited with ${r.status}`;
      failures.push({patch, error});
    }
  }
  return {checked: patches.length, failures, problem: null};
}
