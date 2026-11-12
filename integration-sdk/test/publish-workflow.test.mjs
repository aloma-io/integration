// The publish workflow runs the SDK suite on the tagged commit first, and the publish job needs that test job.
// The publish job also sets the package version from the pushed tag (tags look like 3.8.72, older ones v3.8.66).
// Standalone script, offline: it reads .github/workflows/publish.yml and runs its version step in a temp folder.
import fs from 'node:fs';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const wf = yaml.load(fs.readFileSync(path.join(repo, '.github/workflows/publish.yml'), 'utf8'));
const jobs = wf.jobs ?? {};

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}`);
  if (!ok) failed++;
}

const needsOf = (job) => [].concat(job?.needs ?? []);
const runs = (job) => (job?.steps ?? []).map((s) => s.run ?? '');

check('publish.yml has a test job', Boolean(jobs.test));
check('the test job runs in integration-sdk', jobs.test?.defaults?.run?.['working-directory'] === 'integration-sdk');
check('the test job builds', runs(jobs.test).some((r) => /\byarn(@[\d.]+)? build\b/.test(r)));
check('the test job runs the suite', runs(jobs.test).some((r) => /\byarn(@[\d.]+)? test\b/.test(r)));
check('the publish job needs the test job', needsOf(jobs.publish).includes('test'));
check('only the publish job publishes', Object.entries(jobs).every(([k, j]) => k === 'publish' || !runs(j).some((r) => /npm publish/.test(r))));

const steps = jobs.publish?.steps ?? [];
const vIdx = steps.findIndex((s) => /npm version/.test(s.run ?? ''));
const pIdx = steps.findIndex((s) => /npm publish/.test(s.run ?? ''));
const vStep = steps[vIdx];
check('the publish job has a step that sets the version from the tag', vIdx >= 0);
check('the version step runs in integration-sdk', vStep?.['working-directory'] === 'integration-sdk');
check('the version step comes before npm publish', vIdx >= 0 && pIdx > vIdx);
check('the tag reaches the script through GITHUB_REF_NAME, not template text', /GITHUB_REF_NAME/.test(vStep?.run ?? '') && !/\$\{\{/.test(vStep?.run ?? ''));

// Run the step's script for real against a throwaway package.json.
function runStep(tag, current = '3.8.71') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-version-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name: 'x', version: current}));
  const r = spawnSync('bash', ['-c', vStep?.run ?? 'exit 99'], {cwd: dir, env: {...process.env, GITHUB_REF_NAME: tag}, encoding: 'utf8'});
  const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  fs.rmSync(dir, {recursive: true, force: true});
  return {status: r.status, version};
}
let r = runStep('3.8.72');
check('tag 3.8.72 sets package version 3.8.72', r.status === 0 && r.version === '3.8.72');
r = runStep('v3.8.66', '3.8.60');
check('tag v3.8.66 sets package version 3.8.66 (leading v dropped)', r.status === 0 && r.version === '3.8.66');
r = runStep('3.8.71');
check('tag equal to the current version still succeeds', r.status === 0 && r.version === '3.8.71');
r = runStep('3.8.72-rc.1');
check('a tag that is not a plain x.y.z version fails the step and leaves package.json alone', r.status !== 0 && r.version === '3.8.71');

// The tag must not be lower than the version already in package.json, compared as numbers (3.10.0 is higher than 3.9.0).
const lowerCases = [
  ['lower by patch', '3.8.70', '3.8.71'],
  ['lower by major', '3.9.0', '4.0.0'],
  ['lower by minor, written as v-tag', 'v3.8.9', '3.9.0'],
];
for (const [label, tag, current] of lowerCases) {
  r = runStep(tag, current);
  check(`tag ${tag} below package.json ${current} (${label}) fails the step and leaves package.json alone`, r.status !== 0 && r.version === current);
}
r = runStep('3.10.0', '3.9.0');
check('tag 3.10.0 is higher than package.json 3.9.0 (numeric, not text) and succeeds', r.status === 0 && r.version === '3.10.0');
r = runStep('4.0.0', '3.8.71');
check('tag 4.0.0 above package.json 3.8.71 succeeds', r.status === 0 && r.version === '4.0.0');
r = runStep('4.0.0', '4.0.0');
check('tag equal to package.json 4.0.0 succeeds', r.status === 0 && r.version === '4.0.0');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-version-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name: 'x', version: '3.9.0'}));
  const lo = spawnSync('bash', ['-c', vStep?.run ?? 'exit 99'], {cwd: dir, env: {...process.env, GITHUB_REF_NAME: '3.8.72'}, encoding: 'utf8'});
  fs.rmSync(dir, {recursive: true, force: true});
  check('the refusal message names both versions', /3\.8\.72/.test(lo.stderr) && /3\.9\.0/.test(lo.stderr));
}
{
  const run = vStep?.run ?? '';
  check('the lower-than check comes before npm version', run.search(/package\.json|pkg get|require\(/) >= 0 && run.search(/package\.json|pkg get|require\(/) < run.indexOf('npm version'));
}

process.exit(failed ? 1 : 0);
