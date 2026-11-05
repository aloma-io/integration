// The test runner must be mocha 12 or later (integration #43: mocha 12.0.3 upgrade).
// Standalone script (no mocha import): it checks the mocha that is actually installed, plus the declared range,
// so a lockfile or package.json that falls back to an older major fails CI on every Node version in the matrix.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_MAJOR = 12;

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}${ok ? '' : ` (${detail})`}`);
  if (!ok) failed++;
}

const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/mocha/package.json'), 'utf8')).version;
const installedMajor = Number(installed.split('.')[0]);
check(`installed mocha is ${MIN_MAJOR} or later`, installedMajor >= MIN_MAJOR, `installed ${installed}`);

const declared = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies?.mocha ?? '';
const declaredMajor = Number((declared.match(/\d+/) || ['0'])[0]);
check(`package.json declares mocha ${MIN_MAJOR} or later`, declaredMajor >= MIN_MAJOR, `declared "${declared}"`);

process.exit(failed ? 1 : 0);
