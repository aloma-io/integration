// `yarn test`: runs every test file in test/.
//
// Two kinds of test file live in test/:
//   - mocha files (describe/it): files that import from 'mocha'. They run together in ONE mocha process.
//   - standalone scripts (their own tiny test() helper, finish with process.exit): every other test/*.test.mjs, plus
//     test/verify-scenarios.mjs. Each runs in its own node process, because process.exit() inside a mocha process
//     ends the whole run while mocha is still loading files, so none of the describe/it tests would run.
// A new test file is picked up by name (test/*.test.mjs|mts). Exit code is non-zero if anything fails.
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'test');

const files = fs.readdirSync(testDir).filter((f) => /\.test\.m[jt]s$/.test(f)).sort();
const isMocha = (f) => /from ['"]mocha['"]/.test(fs.readFileSync(path.join(testDir, f), 'utf8'));
// .mts test files are transpiled (type-stripped) to sibling .mjs files and run by plain mocha. The ts-node/esm loader
// cannot be used: it fails on Node 18 (ERR_UNKNOWN_FILE_EXTENSION) and Node 20 (ERR_INTERNAL_ASSERTION). The sibling
// location keeps relative imports and import.meta.url paths identical to the source file.
const require = createRequire(import.meta.url);
const ts = require('typescript');
const generated = [];
const compile = (f) => {
  if (!f.endsWith('.mts')) return path.join('test', f);
  const out = path.join('test', `.compiled-${f.replace(/\.mts$/, '.mjs')}`);
  const src = fs.readFileSync(path.join(testDir, f), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
    fileName: f,
  }).outputText;
  fs.writeFileSync(path.join(root, out), js);
  generated.push(path.join(root, out));
  return out;
};
const mochaFiles = files.filter(isMocha).map(compile);
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
    ...mochaFiles,
  ]);
}
for (const s of scripts) run(s, process.execPath, [s]);

for (const g of generated) fs.rmSync(g, {force: true});

console.log(`\n${mochaFiles.length} mocha files, ${scripts.length} standalone scripts, ${failures.length} failed`);
if (failures.length) {
  console.log(`FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
