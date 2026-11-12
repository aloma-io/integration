// Checks that every deliberate-break patch in a directory still applies to a source tree (PLAT-464).
// `git apply --check` only reads the tree, never writes it, and works on plain files: no .git folder is needed.
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Pure: the argument list of the apply step. Always a dry run: --check never writes to the tree.
export function applyArgs(patchFile) {
  return ['apply', '--check', patchFile];
}

// Pure: what a finished git call means. A problem stops the whole check, an error is one patch that does not apply.
export function outcomeOf(r) {
  if (r.error) return {problem: `git could not be run: ${r.error.message}`};
  if (r.status !== 0) return {error: (r.stderr || '').split('\n').find((l) => l.trim()) || `git exited with ${r.status}`};
  return {};
}

// Pure: the source files the patches name (the a/ side of every `diff --git` line), sorted and unique.
export function patchedFiles(patchTexts) {
  const files = new Set();
  for (const text of patchTexts) for (const m of text.matchAll(/^diff --git a\/(\S+) b\//gm)) files.add(m[1]);
  return [...files].sort();
}

// SHA-256 of each named file under root (null when the file is missing), so two calls can be compared.
export function hashFiles(root, files) {
  return Object.fromEntries(
    files.map((f) => {
      const full = path.join(root, f);
      return [f, fs.existsSync(full) ? crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') : null];
    }),
  );
}

// `gitBin` is only for tests. GIT_CEILING_DIRECTORIES keeps git from looking for a repository above root, so a root that
// sits inside some other checkout is treated as the plain-file tree it is.
export function checkPatches({patchDir, root, gitBin = 'git'}) {
  const patches = fs.readdirSync(patchDir).filter((f) => f.endsWith('.patch')).sort();
  if (!patches.length) return {checked: 0, failures: [], problem: `no .patch files in ${patchDir}`};
  const env = {...process.env, GIT_CEILING_DIRECTORIES: path.dirname(fs.realpathSync(root))};
  const failures = [];
  for (const patch of patches) {
    const args = applyArgs(path.join(patchDir, patch));
    if (!args.includes('--check')) return {checked: 0, failures: [], problem: 'refusing to run an apply step without --check'};
    const out = outcomeOf(spawnSync(gitBin, args, {cwd: root, encoding: 'utf8', env}));
    if (out.problem) return {checked: 0, failures: [], problem: out.problem};
    if (out.error) failures.push({patch, error: out.error});
  }
  return {checked: patches.length, failures, problem: null};
}

// Pure: the break IDs (file name up to the first dash) that more than one .patch file registers.
export function duplicateIds(names) {
  const byId = new Map();
  for (const name of names.filter((n) => n.endsWith('.patch'))) {
    const id = name.split('-')[0];
    byId.set(id, [...(byId.get(id) ?? []), name]);
  }
  return [...byId].filter(([, patches]) => patches.length > 1).map(([id, patches]) => ({id, patches}));
}
