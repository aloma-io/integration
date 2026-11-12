// The publish workflow runs the SDK suite on the tagged commit first, and the publish job needs that test job.
// Standalone script, offline: it only reads .github/workflows/publish.yml.
import fs from 'node:fs';
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
check('only the publish jobs publish', Object.entries(jobs).every(([k, j]) => k === 'publish' || k === 'workspace-publish' || !runs(j).some((r) => /npm publish/.test(r))));

process.exit(failed ? 1 : 0);
