// `yarn test`: runs every test file in test/.
//
// Two kinds of test file live in test/:
//   - mocha files (describe/it): files that import from 'mocha'. They run together in ONE mocha process.
//   - standalone scripts (their own tiny test() helper, finish with process.exit): every other test/*.test.mjs, plus
//     test/verify-scenarios.mjs. Each runs in its own node process, because process.exit() inside a mocha process
//     ends the whole run while mocha is still loading files, so none of the describe/it tests would run.
// A new test file is picked up by name (test/*.test.mjs|mts). Exit code is non-zero if anything fails.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'test');

const files = fs.readdirSync(testDir).filter((f) => /\.test\.m[jt]s$/.test(f)).sort();
const isMocha = (f) => /from ['"]mocha['"]/.test(fs.readFileSync(path.join(testDir, f), 'utf8'));
const mochaFiles = files.filter(isMocha).map((f) => path.join('test', f));
const scripts = files.filter((f) => !isMocha(f)).map((f) => path.join('test', f));
scripts.push(path.join('test', 'verify-scenarios.mjs'));

const failures = [];
const run = (label, cmd, args) => {
  console.log(`\n=== ${label}`);
  const r = spawnSync(cmd, args, {cwd: root, stdio: 'inherit'});
  if (r.status !== 0) failures.push(label);
};

if (mochaFiles.length) {
  run(`mocha (${mochaFiles.length} files)`, process.execPath, [
    path.join(root, 'node_modules/mocha/bin/_mocha'),
    '--exit',
    '--loader',
    'ts-node/esm',
    ...mochaFiles,
  ]);
}
for (const s of scripts) run(s, process.execPath, [s]);

console.log(`\n${mochaFiles.length} mocha files, ${scripts.length} standalone scripts, ${failures.length} failed`);
if (failures.length) {
  console.log(`FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
