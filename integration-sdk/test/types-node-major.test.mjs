// PLAT-146: @types/node must not be older than the Node a package requires. Every package.json in the repo outside
// node_modules is checked: the floor is the package's own engines.node minimum when it declares one, otherwise the
// repo minimum, read from integration-sdk/package.json engines (never repeated here). Standalone script, offline.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = process.env.TYPES_NODE_ROOT ? path.resolve(process.env.TYPES_NODE_ROOT) : repo;

// Pure decision logic. Returns {floor, typesMajor, ok}; typesMajor is null when no @types/node is declared (nothing to check).
export const minMajor = (range) => {
  const m = typeof range === 'string' ? range.match(/^>=\s*(\d+)(\.\d+){0,2}$/) : null;
  return m ? Number(m[1]) : null;
};
export const typesNodeVerdict = (json, repoMin) => {
  const spec = {...json.devDependencies, ...json.dependencies}['@types/node'];
  if (spec === undefined) return {floor: null, typesMajor: null, ok: true};
  const floor = minMajor(json.engines?.node) ?? repoMin;
  const typesMajor = typeof spec === 'string' ? Number(spec.match(/^[\^~>=\s]*(\d+)/)?.[1]) : NaN;
  return {floor, typesMajor, ok: Number.isInteger(typesMajor) && typesMajor >= floor};
};

// The example pins the published SDK ^3 (Node 18 and later) and declares no engines, so the repo minimum does not apply
// to it; an engines field added to it is still checked.
const FALLBACK_EXEMPT = new Set(['integration-sdk/examples/hello-world/package.json']);

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'package.json') out.push(p);
  }
  return out.sort();
};

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}${ok ? '' : ` (${detail})`}`);
  if (!ok) failed++;
};

// Unit tests of the pure function
check('minMajor reads ">=22" and ">=22.1.0"', minMajor('>=22') === 22 && minMajor('>= 22.1.0') === 22, '');
check('minMajor rejects other shapes', minMajor('^22') === null && minMajor(undefined) === null, '');
check('verdict: ^22 against repo minimum 22 is ok', typesNodeVerdict({devDependencies: {'@types/node': '^22'}}, 22).ok, '');
check('verdict: ^20 against repo minimum 22 fails', !typesNodeVerdict({devDependencies: {'@types/node': '^20'}}, 22).ok, '');
check('verdict: dependencies are read too', !typesNodeVerdict({dependencies: {'@types/node': '~18.1.0'}}, 22).ok, '');
check('verdict: own engines minimum wins over the repo minimum', !typesNodeVerdict({engines: {node: '>=24'}, devDependencies: {'@types/node': '^22'}}, 22).ok, '');
check('verdict: a lower own engines minimum is used', typesNodeVerdict({engines: {node: '>=18'}, devDependencies: {'@types/node': '^18'}}, 22).ok, '');
check('verdict: a newer @types/node is ok', typesNodeVerdict({devDependencies: {'@types/node': '^24'}}, 22).ok, '');
check('verdict: no @types/node means nothing to check', typesNodeVerdict({engines: {node: '>=22'}}, 22).ok, '');
check('verdict: an unreadable @types/node range fails', !typesNodeVerdict({devDependencies: {'@types/node': 'latest'}}, 22).ok, '');

// File walk (thin wrapper)
const repoMin = minMajor(JSON.parse(fs.readFileSync(path.join(repo, 'integration-sdk', 'package.json'), 'utf8')).engines?.node);
check('the repo minimum can be read from integration-sdk/package.json', Number.isInteger(repoMin), String(repoMin));
const files = walk(ROOT);
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
console.log(`package.json files covered (${files.length}):\n${files.map((f) => `  ${rel(f)}`).join('\n')}`);
check('the walk finds the SDKs, the templates and the example', files.length >= 5, String(files.length));
for (const f of files) {
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!json.engines?.node && FALLBACK_EXEMPT.has(rel(f))) continue;
  const v = typesNodeVerdict(json, repoMin);
  check(`${rel(f)}: @types/node ${v.typesMajor === null ? 'not declared' : `^${v.typesMajor}`} is not below Node ${v.floor ?? '-'}`, v.ok, `@types/node major ${v.typesMajor}, floor ${v.floor}`);
}

process.exit(failed ? 1 : 0);
