// Every deliberate-break patch under test/mutants/ must still apply to the current source (PLAT-464).
// Standalone script, offline: runs `git apply --check` (never a real apply) per patch from the repository root. It needs
// the git program but no .git folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkPatches, duplicateIds} from '../tools/patch-apply.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const patchDir = path.join(repo, 'integration-sdk', 'test', 'mutants');

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}`);
  if (!ok) failed++;
}

// Rules of the checker, on a small scratch tree (no .git there either).
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-apply-'));
const tree = path.join(scratch, 'tree');
const dir = path.join(scratch, 'patches');
fs.mkdirSync(tree);
fs.mkdirSync(dir);
fs.writeFileSync(path.join(tree, 'a.txt'), 'one\ntwo\nthree\n');
const patchFor = (middle) => `diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n ${middle}\n-two\n+TWO\n three\n`;
fs.writeFileSync(path.join(dir, 'G1-good.patch'), patchFor('one'));
fs.writeFileSync(path.join(dir, 'G2-good.patch'), patchFor('one'));
fs.writeFileSync(path.join(dir, 'X1-stale.patch'), patchFor('uno'));
fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a patch');

const r = checkPatches({patchDir: dir, root: tree});
check('fixture: reads the directory and counts every .patch file', r.checked === 3);
check('fixture: a patch whose context is stale is reported, by name', r.failures.length === 1 && r.failures[0].patch === 'X1-stale.patch');
check('fixture: the failure carries git\'s first error line', /^error: patch failed: a\.txt:1/.test(r.failures[0]?.error ?? ''));
check('fixture: patches that apply are not reported', !r.failures.some((f) => f.patch.startsWith('G')));
check('fixture: the tree is not changed (check only)', fs.readFileSync(path.join(tree, 'a.txt'), 'utf8') === 'one\ntwo\nthree\n' && fs.readdirSync(tree).join() === 'a.txt');
fs.rmSync(path.join(dir, 'X1-stale.patch'));
const ok = checkPatches({patchDir: dir, root: tree});
check('fixture: with only good patches there is no failure and no problem', ok.checked === 2 && !ok.failures.length && !ok.problem);
for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
const empty = checkPatches({patchDir: dir, root: tree});
check('fixture: a directory without patches is a problem, not a pass', Boolean(empty.problem) && empty.checked === 0);
fs.rmSync(scratch, {recursive: true, force: true});

// Every break has its own ID: the part of the file name before the first dash.
check('ids: distinct IDs are fine', duplicateIds(['A01-x.patch', 'A02-y.patch', 'B01-z.patch']).length === 0);
check('ids: a repeated ID is reported once, with both files', JSON.stringify(duplicateIds(['W02-a.patch', 'W02-b.patch', 'W03-c.patch'])) === JSON.stringify([{id: 'W02', patches: ['W02-a.patch', 'W02-b.patch']}]));
check('ids: files that are not patches are ignored', duplicateIds(['W02-a.patch', 'W02-notes.txt']).length === 0);

// The real mutants against the real tree.
const real = checkPatches({patchDir, root: repo});
if (real.problem) check(real.problem, false);
for (const f of real.failures) check(`${f.patch} still applies: ${f.error}`, false);
const names = fs.readdirSync(patchDir);
for (const d of duplicateIds(names)) check(`break ID ${d.id} is registered once: ${d.patches.join(', ')}`, false);
const onDisk = fs.readdirSync(patchDir).filter((f) => f.endsWith('.patch')).length;
check('every .patch file in test/mutants was checked', real.checked === onDisk);
if (!real.problem && !real.failures.length) console.log(`checked ${real.checked} patches, all apply`);

process.exit(failed ? 1 : 0);
