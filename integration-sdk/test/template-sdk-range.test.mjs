// PLAT-146: the SDK dependency of each template must accept the version its own package publishes, so a connector or
// workspace made by `create` installs the SDK that made it. Standalone script, offline (no semver package needed: only
// caret ranges "^N" and "^N.M.P" are accepted, anything else fails).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = process.env.TEMPLATE_SDK_ROOT ? path.resolve(process.env.TEMPLATE_SDK_ROOT) : repo;
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// True when version (x.y.z) satisfies the caret range. For major 0 a caret pins the minor, as in semver.
export const caretSatisfies = (range, version) => {
  const r = typeof range === 'string' ? range.match(/^\^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/) : null;
  const v = typeof version === 'string' ? version.match(/^(\d+)\.(\d+)\.(\d+)$/) : null;
  if (!r || !v) return false;
  const lo = [r[1], r[2] ?? 0, r[3] ?? 0].map(Number);
  const hi = lo[0] > 0 ? [lo[0] + 1, 0, 0] : r[2] === undefined ? [1, 0, 0] : [0, lo[1] + 1, 0];
  const x = v.slice(1).map(Number);
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return cmp(x, lo) >= 0 && cmp(x, hi) < 0;
};

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}${ok ? '' : ` (${detail})`}`);
  if (!ok) failed++;
};

check('caret: ^4 accepts 4.0.0 and 4.9.1', caretSatisfies('^4', '4.0.0') && caretSatisfies('^4', '4.9.1'), '');
check('caret: ^3 rejects 4.0.0', !caretSatisfies('^3', '4.0.0'), '');
check('caret: ^0 rejects 2.0.0 and 1.0.0', !caretSatisfies('^0', '2.0.0') && !caretSatisfies('^0', '1.0.0'), '');
check('caret: ^2.1.0 rejects 2.0.0', !caretSatisfies('^2.1.0', '2.0.0'), '');
check('caret: other range shapes are not accepted', !caretSatisfies('>=4', '4.0.0') && !caretSatisfies('*', '4.0.0'), '');

const PAIRS = [
  ['integration-sdk/package.json', 'integration-sdk/template/connector/package.json'],
  ['workspace-sdk/package.json', 'workspace-sdk/template/workspace/package.json'],
];
for (const [pkgFile, templateFile] of PAIRS) {
  const pkg = read(pkgFile);
  const range = read(templateFile).dependencies?.[pkg.name];
  check(`${templateFile}: ${pkg.name} ${range} accepts ${pkg.version}`, caretSatisfies(range, pkg.version), `range ${range}, version ${pkg.version}`);
}

process.exit(failed ? 1 : 0);
