// The Node lines the SDK supports: the engines field of both published packages and both templates, the README
// sentence of each package, and the full CI matrix must agree. The lowest matrix Node must satisfy engines, and every
// engines major must be tested in the full matrix.
// Standalone script, offline: it only reads package.json files, READMEs and .github/workflows/ci.yml.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}${ok ? '' : ` (${detail})`}`);
  if (!ok) failed++;
}

const packages = {
  'integration-sdk': {pkg: 'integration-sdk/package.json', readme: 'integration-sdk/README.md'},
  'integration-sdk template': {pkg: 'integration-sdk/template/connector/package.json'},
  'workspace-sdk': {pkg: 'workspace-sdk/package.json', readme: 'workspace-sdk/README.md'},
  'workspace-sdk template': {pkg: 'workspace-sdk/template/workspace/package.json'},
};

// Full matrix: the expression `${{ fromJSON(github.event_name == 'pull_request' && '[..]' || '[..]') }}`, second list.
const ci = yaml.load(read('.github/workflows/ci.yml'));
const expr = ci.jobs?.integration_sdk?.strategy?.matrix?.node;
const m = typeof expr === 'string' && expr.match(/&&\s*'(\[[^']*\])'\s*\|\|\s*'(\[[^']*\])'/);
const matrix = m ? JSON.parse(m[2]).map((n) => Number(n)) : [];
check('the full CI matrix can be read', matrix.length > 0 && matrix.every(Number.isInteger), String(expr));
const lowest = Math.min(...matrix);

for (const [label, {pkg, readme}] of Object.entries(packages)) {
  const range = JSON.parse(read(pkg)).engines?.node;
  const major = typeof range === 'string' ? Number(range.match(/^>=\s*(\d+)(\.\d+){0,2}$/)?.[1]) : NaN;
  check(`${label}: engines.node is declared as ">=<major>"`, Number.isInteger(major), String(range));
  if (!Number.isInteger(major)) continue;
  check(`${label}: the lowest matrix Node (${lowest}) satisfies engines ${range}`, lowest >= major, `lowest ${lowest}`);
  check(`${label}: engines major ${major} appears in the full matrix`, matrix.includes(major), `matrix ${matrix}`);
  if (readme) {
    check(`${label}: README states Node ${major} or later`, new RegExp(`Node(\\.js)? ${major} or later`).test(read(readme)), readme);
  }
}

process.exit(failed ? 1 : 0);
