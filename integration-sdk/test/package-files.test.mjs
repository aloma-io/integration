// The published package ships build output and the CLI template only.
// Standalone script (no mocha). Runs `npm pack --dry-run --json` in the package folder: nothing is written and
// nothing leaves the machine. Needs the build output (`yarn build`) to be present.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const colors = {green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', reset: '\x1b[0m', cyan: '\x1b[36m'};

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    console.log(`${colors.cyan}Running: ${name}${colors.reset}`);
    await fn();
    console.log(`${colors.green}✓ PASS: ${name}${colors.reset}\n`);
    passed++;
  } catch (error) {
    console.log(`${colors.red}✗ FAIL: ${name}${colors.reset}`);
    console.log(`${colors.red}  Error: ${error.message}${colors.reset}\n`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {cwd: root, encoding: 'utf8'});
if (pack.status !== 0) {
  console.log(`${colors.red}npm pack --dry-run failed:\n${pack.stderr}${colors.reset}`);
  process.exit(1);
}
const files = JSON.parse(pack.stdout)[0].files.map((f) => f.path);

await test('package lists no path under test/, tools/, src/ or a scenarios folder', async () => {
  const found = files.filter((p) => /^(test|tools|src)\//.test(p) || /(^|\/)scenarios(\/|$)/.test(p));
  assert(found.length === 0, `unexpected paths: ${found.slice(0, 5).join(', ')}`);
});

await test('package lists no FINDINGS or MUTATION file', async () => {
  const found = files.filter((p) => /FINDINGS|MUTATION/i.test(p));
  assert(found.length === 0, `unexpected paths: ${found.join(', ')}`);
});

await test('package lists the entry points the build produces', async () => {
  for (const p of ['build/index.mjs', 'build/cli.mjs', 'package.json', 'README.md']) {
    assert(files.includes(p), `${p} is not listed`);
  }
});

await test('package lists the connector template the CLI copies', async () => {
  assert(files.some((p) => p.startsWith('template/connector/')), 'template/connector/ is not listed');
});

console.log(`\n${colors.yellow}--- Package files test results ---${colors.reset}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);

if (failed > 0) {
  process.exit(1);
}
