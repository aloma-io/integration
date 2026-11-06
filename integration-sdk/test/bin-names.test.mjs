// The package declares no executable named "aloma"; that name belongs to the ALOMA CLI (@aloma.io/aloma).
// Standalone script (no mocha). Reads package.json and checks the template scripts call the CLI by path.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}${ok ? '' : ` (${detail})`}`);
  if (!ok) failed++;
}

const bin = typeof pkg.bin === 'string' ? {[pkg.name.split('/').pop()]: pkg.bin} : pkg.bin || {};
check('no bin is named "aloma"', !Object.keys(bin).includes('aloma'), `bins: ${Object.keys(bin).join(', ')}`);
check('the package declares a bin for npx', Object.keys(bin).length > 0, 'no bin declared');
check('every bin points at build/cli.mjs', Object.values(bin).every((p) => p === './build/cli.mjs'), JSON.stringify(bin));

const template = fs.readFileSync(path.join(root, 'template/connector/package.json'), 'utf8');
check('the connector template calls the CLI by path', template.includes('node_modules/@aloma.io/integration-sdk/build/cli.mjs'), 'path call missing');

process.exit(failed ? 1 : 0);
