// The Node lines the SDK supports: the engines field of both published packages and both templates, the README
// sentence of each package, and the full CI matrix must agree. The lowest matrix Node must satisfy engines, and every
// engines major must be tested in the full matrix. Neither matrix list (pull request, full) holds a Node below engines.
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

// The matrix expression is `${{ fromJSON(github.event_name == 'pull_request' && '[..]' || '[..]') }}`: first list for
// pull requests, second list the full matrix. CI_WORKFLOW lets a deliberate check point at another copy of the file.
const ci = yaml.load(process.env.CI_WORKFLOW ? fs.readFileSync(process.env.CI_WORKFLOW, 'utf8') : read('.github/workflows/ci.yml'));
const expr = ci.jobs?.integration_sdk?.strategy?.matrix?.node;
const m = typeof expr === 'string' && expr.match(/&&\s*'(\[[^']*\])'\s*\|\|\s*'(\[[^']*\])'/);
const matrix = m ? JSON.parse(m[2]).map((n) => Number(n)) : [];
const prMatrix = m ? JSON.parse(m[1]).map((n) => Number(n)) : [];
check('the full CI matrix can be read', matrix.length > 0 && matrix.every(Number.isInteger), String(expr));
check('the pull-request CI matrix can be read', prMatrix.length > 0 && prMatrix.every(Number.isInteger), String(expr));
const lowest = Math.min(...matrix);
const prLowest = Math.min(...prMatrix);

let typesChecked = 0;
for (const [label, {pkg, readme}] of Object.entries(packages)) {
  const json = JSON.parse(read(pkg));
  const range = json.engines?.node;
  const major = typeof range === 'string' ? Number(range.match(/^>=\s*(\d+)(\.\d+){0,2}$/)?.[1]) : NaN;
  check(`${label}: engines.node is declared as ">=<major>"`, Number.isInteger(major), String(range));
  if (!Number.isInteger(major)) continue;
  check(`${label}: the lowest matrix Node (${lowest}) satisfies engines ${range}`, lowest >= major, `lowest ${lowest}`);
  check(`${label}: the lowest pull-request matrix Node (${prLowest}) satisfies engines ${range}`, prLowest >= major, `lowest ${prLowest}`);
  check(`${label}: engines major ${major} appears in the full matrix`, matrix.includes(major), `matrix ${matrix}`);
  if (label === 'integration-sdk' || label === 'workspace-sdk') {
    const spec = {...json.devDependencies, ...json.dependencies}['@types/node'];
    const typesMajor = typeof spec === 'string' ? Number(spec.match(/^[\^~]?(\d+)/)?.[1]) : NaN;
    typesChecked++;
    check(`${label}: @types/node major (${spec}) is not below engines major ${major}`, typesMajor >= major, String(spec));
  }
  if (readme) {
    check(`${label}: README states Node ${major} or later`, new RegExp(`Node(\\.js)? ${major} or later`).test(read(readme)), readme);
  }
}

check('@types/node is checked in both SDK package.json files', typesChecked === 2, `checked ${typesChecked}`);

// PLAT-146: dropping Node 18/20 is a major release: integration-sdk 4, workspace-sdk 2, each with a release note.
for (const [pkg, minMajor, notes, heading] of [
  ['integration-sdk/package.json', 4, 'integration-sdk/CHANGELOG.md', '## 4.0.0'],
  ['workspace-sdk/package.json', 2, 'workspace-sdk/README.md', '### 2.0.0'],
]) {
  const version = JSON.parse(read(pkg)).version;
  check(`${pkg}: version ${version} is at least major ${minMajor}`, Number(String(version).split('.')[0]) >= minMajor, String(version));
  const text = read(notes);
  const at = text.indexOf(`\n${heading}\n`);
  const next = text.indexOf('\n#', at + 1);
  const section = at < 0 ? '' : text.slice(at, next < 0 ? undefined : next);
  check(`${notes}: has a "${heading}" heading`, at >= 0, notes);
  check(`${notes}: "${heading}" says Node 22 or later is required`, /BREAKING.*Node 22 or later is required/.test(section), notes);
}

process.exit(failed ? 1 : 0);
