// Every deliberate-break patch under test/mutants/ must still apply to the current source (PLAT-464).
// Standalone script, offline: runs `git apply --check` (never a real apply) per patch from the repository root. It needs
// the git program but no .git folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {applyArgs, checkPatches, duplicateIds, hashFiles, outcomeOf, patchedFiles} from '../tools/patch-apply.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const patchDir = path.join(repo, 'integration-sdk', 'test', 'mutants');

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}`);
  if (!ok) failed++;
}

// Guard, before git runs anywhere: the apply step is a dry run. If this fails, nothing below runs, so no file is touched.
if (!applyArgs('x.patch').includes('--check')) {
  console.log('✗ FAIL: guard: the apply step does not carry --check; stopping before git runs');
  process.exit(1);
}
check('guard: the apply step is a dry run (--check)', true);

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

// Error paths, directly.
const onePatchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-one-'));
fs.writeFileSync(path.join(onePatchDir, 'G0.patch'), '');
const noGit = checkPatches({patchDir: onePatchDir, root: repo, gitBin: path.join(os.tmpdir(), 'no-such-git-binary')});
check('errors: git missing is a problem that stops the check', /^git could not be run: /.test(noGit.problem ?? '') && noGit.checked === 0);
fs.rmSync(onePatchDir, {recursive: true, force: true});
check('errors: outcomeOf reports a missing git as a problem', outcomeOf({error: new Error('ENOENT')}).problem === 'git could not be run: ENOENT');
check('errors: empty stderr falls back to "git exited with N"', outcomeOf({status: 3, stderr: ''}).error === 'git exited with 3');
check('errors: blank lines before the message are skipped', outcomeOf({status: 1, stderr: '\n  \nerror: x\nmore'}).error === 'error: x');
check('errors: a clean exit is neither problem nor error', JSON.stringify(outcomeOf({status: 0, stderr: ''})) === '{}');

// The files the patches name, and hashing them.
check('files: patchedFiles lists each named file once, sorted', JSON.stringify(patchedFiles(['diff --git a/b/y.mts b/b/y.mts\n@@\ndiff --git a/a.txt b/a.txt\n', 'diff --git a/a.txt b/a.txt\n'])) === JSON.stringify(['a.txt', 'b/y.mts']));
check('files: text without a diff header names nothing', patchedFiles(['# note only\n']).length === 0);
{
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-hash-'));
  fs.writeFileSync(path.join(h, 'f'), 'one');
  const before = hashFiles(h, ['f', 'gone']);
  check('files: hashFiles marks a missing file as null', before.gone === null && /^[0-9a-f]{64}$/.test(before.f));
  fs.writeFileSync(path.join(h, 'f'), 'two');
  check('files: hashFiles sees a changed file', hashFiles(h, ['f']).f !== before.f);
  fs.rmSync(h, {recursive: true, force: true});
}

// A fixture inside a folder that is itself a git repository must not be judged against that repository.
{
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-outer-'));
  if (spawnSync('git', ['init', '-q', outer], {encoding: 'utf8'}).status !== 0) check('enclosing repo: git init for the fixture', false);
  else {
    const inner = path.join(outer, 'sub', 'tree');
    const pd = path.join(outer, 'patches');
    fs.mkdirSync(inner, {recursive: true});
    fs.mkdirSync(pd);
    fs.writeFileSync(path.join(inner, 'a.txt'), 'one\ntwo\nthree\n');
    fs.writeFileSync(path.join(pd, 'G1-good.patch'), patchFor('one'));
    fs.writeFileSync(path.join(pd, 'X1-stale.patch'), patchFor('uno'));
    const nested = checkPatches({patchDir: pd, root: inner});
    check('enclosing repo: a good patch still applies when the tree sits inside a git checkout', nested.checked === 2 && !nested.problem && !nested.failures.some((f) => f.patch.startsWith('G')));
    check('enclosing repo: a stale patch is still reported (git must not skip files of the plain tree)', nested.failures.length === 1 && nested.failures[0].patch === 'X1-stale.patch');
  }
  fs.rmSync(outer, {recursive: true, force: true});
}

// Every break has its own ID: the part of the file name before the first dash.
check('ids: distinct IDs are fine', duplicateIds(['A01-x.patch', 'A02-y.patch', 'B01-z.patch']).length === 0);
check('ids: a repeated ID is reported once, with both files', JSON.stringify(duplicateIds(['W02-a.patch', 'W02-b.patch', 'W03-c.patch'])) === JSON.stringify([{id: 'W02', patches: ['W02-a.patch', 'W02-b.patch']}]));
check('ids: files that are not patches are ignored', duplicateIds(['W02-a.patch', 'W02-notes.txt']).length === 0);

// The real mutants against the real tree.
const named = patchedFiles(fs.readdirSync(patchDir).filter((f) => f.endsWith('.patch')).map((f) => fs.readFileSync(path.join(patchDir, f), 'utf8')));
const hashesBefore = hashFiles(repo, named);
const real = checkPatches({patchDir, root: repo});
check('a normal run leaves the source files the patches name unchanged', named.length > 0 && JSON.stringify(hashFiles(repo, named)) === JSON.stringify(hashesBefore));
if (real.problem) check(real.problem, false);
for (const f of real.failures) check(`${f.patch} still applies: ${f.error}`, false);
const names = fs.readdirSync(patchDir);
for (const d of duplicateIds(names)) check(`break ID ${d.id} is registered once: ${d.patches.join(', ')}`, false);
const onDisk = fs.readdirSync(patchDir).filter((f) => f.endsWith('.patch')).length;
check('every .patch file in test/mutants was checked', real.checked === onDisk);
if (!real.problem && !real.failures.length) console.log(`checked ${real.checked} patches, all apply`);

process.exit(failed ? 1 : 0);
