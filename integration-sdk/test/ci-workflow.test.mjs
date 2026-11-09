// The CI workflow runs Node 22 alone on pull requests and the full matrix on main, cancels superseded PR runs,
// keeps the required summary check reporting on every PR, and keeps a timeout on every job.
// Standalone script, offline: it only reads .github/workflows/ci.yml and publish.yml.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (f) => yaml.load(fs.readFileSync(path.join(repo, '.github/workflows', f), 'utf8'));
const ci = load('ci.yml');
const publish = load('publish.yml');
// js-yaml (YAML 1.2 core) keeps `on` as a string key.
const on = ci.on ?? ci[true] ?? {};

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}`);
  if (!ok) failed++;
}

// Evaluates the matrix expression `${{ fromJSON(github.event_name == 'pull_request' && '[..]' || '[..]') }}`
// for a given event name; returns null when the expression has another shape.
function nodesFor(expr, event) {
  if (typeof expr !== 'string') return null;
  const m = expr.match(/^\$\{\{\s*fromJSON\(\s*github\.event_name\s*==\s*'pull_request'\s*&&\s*'(\[[^']*\])'\s*\|\|\s*'(\[[^']*\])'\s*\)\s*\}\}$/);
  if (!m) return null;
  return JSON.parse(event === 'pull_request' ? m[1] : m[2]);
}

const matrix = ci.jobs?.integration_sdk?.strategy?.matrix?.node;
const sameList = (a, b) => Array.isArray(a) && JSON.stringify(a) === JSON.stringify(b);

check('pull requests run Node 22 alone', sameList(nodesFor(matrix, 'pull_request'), ['22']));
check('push runs 22, 24 and 26', sameList(nodesFor(matrix, 'push'), ['22', '24', '26']));
check('workflow_dispatch runs 22, 24 and 26', sameList(nodesFor(matrix, 'workflow_dispatch'), ['22', '24', '26']));
check('workflow_dispatch is a trigger', on.workflow_dispatch !== undefined);
check('pull_request is a trigger', on.pull_request !== undefined);
check('push triggers on main only', JSON.stringify(on.push?.branches) === JSON.stringify(['main']));

const conc = ci.concurrency ?? {};
check('concurrency group uses the PR number', /github\.event\.pull_request\.number/.test(conc.group ?? ''));
check(
  'cancel-in-progress is true for pull_request only',
  typeof conc['cancel-in-progress'] === 'string' &&
    /^\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}$/.test(conc['cancel-in-progress']),
);
check('push runs are not grouped with PR runs', !/^\s*ci\s*$/.test(conc.group ?? '') && /\|\|/.test(conc.group ?? ''));

// docs-only PRs must still produce the required check, so the pull_request trigger has no path filters.
check('no path filters on pull_request', on.pull_request?.paths === undefined && on.pull_request?.['paths-ignore'] === undefined);
const summary = ci.jobs?.['ci-passed'];
check('the ci-passed job exists and always runs', summary?.if === 'always()');
check('ci-passed needs every other job', ['integration_sdk', 'workspace_sdk'].every((j) => [].concat(summary?.needs ?? []).includes(j)));

for (const [file, wf] of [['ci.yml', ci], ['publish.yml', publish]]) {
  for (const [name, job] of Object.entries(wf.jobs ?? {})) {
    check(`${file}: job ${name} has timeout-minutes`, Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] > 0);
  }
}

process.exit(failed ? 1 : 0);
