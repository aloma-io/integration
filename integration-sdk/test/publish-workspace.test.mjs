// The publish workflow also tests and publishes workspace-sdk: its own test job, and a separate publish job that needs
// both test jobs and skips when the version in workspace-sdk/package.json is already on npm.
// Standalone script, offline: it only reads .github/workflows/publish.yml, with a line-based scan (no YAML dependency).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lines = fs.readFileSync(path.join(repo, '.github/workflows/publish.yml'), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l));

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}`);
  if (!ok) failed++;
}

// Top-level block (e.g. `permissions:`) as its list of lines, and each job (two-space key under `jobs:`) as a block.
const topBlock = (key) => {
  const i = lines.findIndex((l) => l === `${key}:`);
  if (i < 0) return [];
  const out = [];
  for (let j = i + 1; j < lines.length && (lines[j] === '' || /^\s/.test(lines[j])); j++) out.push(lines[j]);
  return out;
};
const jobs = {};
let current = null;
for (const l of topBlock('jobs')) {
  const m = /^ {2}([\w-]+):\s*$/.exec(l);
  if (m) jobs[(current = m[1])] = [];
  else if (current) jobs[current].push(l);
}
const text = (job) => (job ?? []).join('\n');
const needsOf = (job) => {
  const t = text(job);
  const m = /^ {4}needs:\s*(.*)$/m.exec(t);
  if (!m) return [];
  if (m[1].trim()) return m[1].replace(/[[\]]/g, '').split(',').map((s) => s.trim());
  return [...t.slice(m.index + m[0].length).matchAll(/^ {6}- ([\w-]+)\s*$/gm)].map((x) => x[1]);
};
const inWorkspace = (t) => /^\s+working-directory: workspace-sdk\s*$/m.test(t);
const hasPublish = (t) => /\bnpm publish\b/.test(t);

const wsPublishName = Object.keys(jobs).find((k) => hasPublish(text(jobs[k])) && inWorkspace(text(jobs[k])));
const wsPublish = jobs[wsPublishName];
const wsTestName = Object.keys(jobs).find((k) => !hasPublish(text(jobs[k])) && inWorkspace(text(jobs[k])) && /yarn@1\.22\.22 test\b/.test(text(jobs[k])));
const wsTest = jobs[wsTestName];
const sdkTest = jobs.test;
const sdkPublish = jobs.publish;

// (a) workspace-sdk test job
check('a workspace-sdk test job exists', Boolean(wsTest));
check('the workspace test job runs in workspace-sdk', inWorkspace(text(wsTest)));
check('the workspace test job installs with a frozen lockfile', /npx --yes yarn@1\.22\.22 install --frozen-lockfile/.test(text(wsTest)));
check('the workspace test job builds', /npx yarn@1\.22\.22 build\b/.test(text(wsTest)));
check('the workspace test job runs the suite', /npx yarn@1\.22\.22 test\b/.test(text(wsTest)));

// (b) separate workspace publish job
check('a separate workspace publish job exists', Boolean(wsPublish) && wsPublishName !== 'publish');
check('the workspace publish job needs the integration-sdk test job', needsOf(wsPublish).includes('test'));
check('the workspace publish job needs the workspace test job', Boolean(wsTestName) && needsOf(wsPublish).includes(wsTestName));
check('the workspace publish job publishes with public access and provenance in workspace-sdk', /^\s+working-directory: workspace-sdk\s*$[\s\S]*npm publish --access public --provenance/m.test(text(wsPublish)) || /npm publish --access public --provenance[\s\S]*^\s+working-directory: workspace-sdk\s*$/m.test(text(wsPublish)));
check('the workspace publish job has its own permissions', /^ {4}permissions:\s*$/m.test(text(wsPublish)) && /^ {6}id-token: write\s*$/m.test(text(wsPublish)) && /^ {6}contents: read\s*$/m.test(text(wsPublish)));
check('workflow-wide permissions are unchanged', topBlock('permissions').filter((l) => l.trim()).join('|') === '  id-token: write|  contents: read');
// The integration-sdk publish job inherits id-token: write from the workflow level, as before; no test job has it.
check('no job but the publish jobs gets id-token: write', Object.keys(jobs).every((k) => !/id-token: write/.test(text(jobs[k])) || k === wsPublishName));
check('the workflow uses no secrets', !lines.some((l) => /secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN/.test(l)));
check('only the two publish jobs publish', Object.keys(jobs).every((k) => hasPublish(text(jobs[k])) === (k === 'publish' || k === wsPublishName)));
check('every workspace job has timeout-minutes and an explicit ubuntu image', [wsTest, wsPublish].every((j) => /^ {4}timeout-minutes: \d+\s*$/m.test(text(j)) && /^ {4}runs-on: ubuntu-\d\d\.\d\d\s*$/m.test(text(j))));
check('the workspace publish job installs npm@latest like the integration-sdk publish job', /Install npm@latest globally via tarball/.test(text(wsPublish)) && /npm\/-\/npm-\$\{NPM_VERSION\}\.tgz/.test(text(wsPublish)));

// (c) version comes from workspace-sdk/package.json; skip when already published
const pub = text(wsPublish);
check('the workspace publish job reads name and version from package.json', /require\('\.\/package\.json'\)\.name/.test(pub) && /require\('\.\/package\.json'\)\.version/.test(pub));
check('the workspace publish job checks the registry with npm view <name>@<version>', /npm view "\$NAME@\$VERSION" version/.test(pub));
check('the workspace publish job logs "already published, skipping"', /already published, skipping/.test(pub));
check('an already published version ends green before npm publish', /already published, skipping[\s\S]*\bexit 0\b[\s\S]*npm publish/.test(pub));
check('the workspace version does not come from the tag', !/GITHUB_REF|github\.ref|ref_name/.test(pub));

// (d) the integration-sdk jobs keep their behaviour
check('the integration-sdk test job still runs in integration-sdk, builds and tests', inWorkspace(text(sdkTest)) === false && /working-directory: integration-sdk/.test(text(sdkTest)) && /yarn@1\.22\.22 build/.test(text(sdkTest)) && /yarn@1\.22\.22 test/.test(text(sdkTest)));
check('the integration-sdk publish job still needs only the integration-sdk test job', needsOf(sdkPublish).join() === 'test');
check('the integration-sdk publish job still publishes in integration-sdk with provenance', /working-directory: integration-sdk\s*\n\s+run: npm publish --access public --provenance/.test(text(sdkPublish)));
check('the integration-sdk publish job is untouched by the workspace skip rule', !/npm view|already published/.test(text(sdkPublish)));

process.exit(failed ? 1 : 0);
