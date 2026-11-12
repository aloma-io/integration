// The publish workflow also tests and publishes workspace-sdk: its own test job, and a separate publish job that needs
// both test jobs and calls .github/scripts/workspace-publish.sh. The script raises workspace-sdk's patch version
// itself and fails when it cannot publish; it skips (and says so in the log) only when the content of workspace-sdk/ at
// the tag is identical to the commit the latest published version was built from (npm's gitHead) (PLAT-461).
// The decision itself is .github/scripts/workspace-publish-decision.mjs (pure, tested directly below).
// Standalone script, offline: it reads .github/workflows/publish.yml with a line-based scan (no YAML dependency) and
// runs the real script in a temporary git repository with a fake npm on PATH (answers from files, records its calls).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

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
const SCRIPT = 'workspace-publish.sh';
const hasPublish = (t) => /\bnpm publish\b/.test(t) || t.includes(SCRIPT);
// A job's steps: each starts with a six-space dash; a step is its lines joined.
const stepsOf = (job) => {
  const out = [];
  for (const l of job ?? []) {
    if (/^ {6}- /.test(l)) out.push([l]);
    else if (out.length) out[out.length - 1].push(l);
  }
  return out.map((x) => x.join('\n'));
};

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
// The publish STEP itself (not just anywhere in the job) calls the script and runs in workspace-sdk.
const publishSteps = stepsOf(wsPublish).filter((st) => st.includes(SCRIPT));
check('the workspace publish job has exactly one step that calls the script', publishSteps.length === 1);
check('the publish step calls the checked-in script', /^\s+run: .*\.github\/scripts\/workspace-publish\.sh"?\s*$/m.test(publishSteps[0] ?? ''));
check('the publish step runs with working directory workspace-sdk', /^ {8}working-directory: workspace-sdk\s*$/m.test(publishSteps[0] ?? ''));
check('no step of the workspace publish job runs in integration-sdk', !/working-directory: integration-sdk/.test(text(wsPublish)));
check('the workspace publish job checks out all history and tags (fetch-depth 0)', /uses: actions\/checkout@[\w.]+(?: +#.*)?\s*\n\s+with:\s*\n(\s+[\w-]+: .*\n)*?\s+fetch-depth: 0\s*$/m.test(text(wsPublish)));
check('the workspace publish job has no inline npm publish or skip rule', !/npm publish|already published, skipping/.test(text(wsPublish)));
check('the workspace publish job has its own permissions', /^ {4}permissions:\s*$/m.test(text(wsPublish)) && /^ {6}id-token: write\s*$/m.test(text(wsPublish)) && /^ {6}contents: read\s*$/m.test(text(wsPublish)));
check('workflow-wide permissions are unchanged', topBlock('permissions').filter((l) => l.trim()).join('|') === '  id-token: write|  contents: read');
// The integration-sdk publish job inherits id-token: write from the workflow level, as before; no test job has it.
check('no job but the publish jobs gets id-token: write', Object.keys(jobs).every((k) => !/id-token: write/.test(text(jobs[k])) || k === wsPublishName));
check('the workflow uses no secrets', !lines.some((l) => /secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN/.test(l)));
check('only the two publish jobs publish', Object.keys(jobs).every((k) => hasPublish(text(jobs[k])) === (k === 'publish' || k === wsPublishName)));
check('every workspace job has timeout-minutes and an explicit ubuntu image', [wsTest, wsPublish].every((j) => /^ {4}timeout-minutes: \d+\s*$/m.test(text(j)) && /^ {4}runs-on: ubuntu-\d\d\.\d\d\s*$/m.test(text(j))));
check('the workspace publish job installs an exact npm version, not npm@latest', /^\s+run: npm install --global npm@\d+\.\d+\.\d+\s*$/m.test(text(wsPublish)) && !/npm@latest|npm\/latest|registry\.npmjs\.org\/npm\//.test(text(wsPublish)));

// (c) the version does not come from the tag
check('the workspace version does not come from the tag in the workflow', !/GITHUB_REF|github\.ref|ref_name/.test(text(wsPublish)));

// (d) the integration-sdk jobs keep their behaviour
check('the integration-sdk test job still runs in integration-sdk, builds and tests', inWorkspace(text(sdkTest)) === false && /working-directory: integration-sdk/.test(text(sdkTest)) && /yarn@1\.22\.22 build/.test(text(sdkTest)) && /yarn@1\.22\.22 test/.test(text(sdkTest)));
check('the integration-sdk publish job still needs only the integration-sdk test job', needsOf(sdkPublish).join() === 'test');
check('the integration-sdk publish job still publishes in integration-sdk with provenance', /working-directory: integration-sdk\s*\n\s+run: npm publish --access public --provenance/.test(text(sdkPublish)));
check('the integration-sdk publish job is untouched by the workspace skip rule', !/npm view|already published|workspace-publish/.test(text(sdkPublish)));

// (e) the decision function, directly
const decisionFile = path.join(repo, '.github/scripts/workspace-publish-decision.mjs');
const {decide, nextVersion, isHigher} = await import(pathToFileURL(decisionFile).href);
const D = (o) => decide({treeIdentical: false, gitHeadKnown: true, pkg: '2.0.0', latest: '2.0.3', targetOnNpm: false, ...o});
check('D1 changed content publishes the latest with the patch raised', D({}).action === 'publish' && D({}).target === '2.0.4');
check('D2 a package.json version higher than latest is published as it is', D({pkg: '2.1.0'}).target === '2.1.0' && D({pkg: '2.1.0'}).action === 'publish');
check('D3 identical content with a known gitHead skips', D({treeIdentical: true}).action === 'skip');
check('D4 identical content without a known gitHead publishes (never skips on a missing gitHead)', D({treeIdentical: true, gitHeadKnown: false}).action === 'publish');
check('D5 different content with a known gitHead publishes (a skipped release after a red one)', D({treeIdentical: false, gitHeadKnown: true}).action === 'publish');
check('D6 a target already on npm fails', D({targetOnNpm: true}).action === 'fail' && /already on npm; refusing to skip/.test(D({targetOnNpm: true}).reason));
check('D7 a beta version in package.json fails', D({pkg: '2.1.0-beta.0'}).action === 'fail');
check('D8 a beta version as latest fails', D({latest: '2.1.0-beta.0'}).action === 'fail');
check('D9 a bad version fails even when the content is identical', D({latest: '2.1.0-beta.0', treeIdentical: true}).action === 'fail');
check('D10 never published (0.0.0) with package.json 2.0.0 publishes 2.0.0', D({latest: '0.0.0'}).target === '2.0.0');
check('D11 numeric comparison: 2.10.0 is higher than 2.9.0, and 2.9.0 is not higher than 2.10.0', isHigher('2.10.0', '2.9.0') && !isHigher('2.9.0', '2.10.0') && !isHigher('2.0.0', '2.0.0'));
check('D12 numeric patch raise: latest 2.0.9 gives 2.0.10', nextVersion('2.0.0', '2.0.9') === '2.0.10');
check('D13 equal versions publish the patch above', D({pkg: '2.0.3'}).target === '2.0.4');

// (f) the script, run for real in a temporary git repository with a fake npm on PATH
const script = path.join(repo, '.github/scripts', SCRIPT);
const PKG_NAME = '@aloma.io/workspace-sdk';
const FAKE_NPM = `#!/bin/sh
# Answers from files in $FAKE_NPM_DIR: latest (the "latest" dist-tag; absent = never published), exists (versions that
# exist, one per line), githead (what npm view <name> gitHead prints; absent = prints nothing), view-error (text to fail
# every npm view with), target-error and latest-error (the same, only for npm view <name>@<version> / npm view <name> version), record-githead (publish then records the released tag's commit, as real npm does), stale-latest
# (publish does not move the latest tag). Like the real npm: a package or version that does not exist answers E404 on
# stderr and exit 1. Records every call.
echo "$* [cwd=$PWD]" >> "$FAKE_NPM_DIR/calls"
case "$1" in
  view)
    if [ -f "$FAKE_NPM_DIR/view-error" ]; then cat "$FAKE_NPM_DIR/view-error" >&2; exit 1; fi
    if [ ! -f "$FAKE_NPM_DIR/latest" ]; then echo "npm error code E404" >&2; exit 1; fi
    case "\${2#@}" in *@*) ;; *) if [ "$3" != gitHead ] && [ -f "$FAKE_NPM_DIR/latest-error" ]; then cat "$FAKE_NPM_DIR/latest-error" >&2; exit 1; fi;; esac
    case "\${2#@}" in *@*) if [ -f "$FAKE_NPM_DIR/target-error" ]; then cat "$FAKE_NPM_DIR/target-error" >&2; exit 1; fi;; esac
    if [ "$3" = gitHead ]; then
      if [ -f "$FAKE_NPM_DIR/githead" ]; then cat "$FAKE_NPM_DIR/githead"; fi
      exit 0
    fi
    case "\${2#@}" in
      *@*)
        v="\${2##*@}"
        if grep -qx "$v" "$FAKE_NPM_DIR/exists"; then echo "$v"; exit 0; fi
        echo "npm error code E404" >&2; exit 1;;
      *)
        cat "$FAKE_NPM_DIR/latest"; exit 0;;
    esac;;
  version)
    sed "s/\\"version\\": \\"[^\\"]*\\"/\\"version\\": \\"$2\\"/" package.json > package.json.new && mv package.json.new package.json
    exit 0;;
  publish)
    v="$(sed -n 's/.*"version": "\\([^"]*\\)".*/\\1/p' package.json)"
    echo "published $v" >> "$FAKE_NPM_DIR/calls"
    echo "$v" >> "$FAKE_NPM_DIR/exists"
    if [ ! -f "$FAKE_NPM_DIR/stale-latest" ]; then echo "$v" > "$FAKE_NPM_DIR/latest"; fi
    if [ -f "$FAKE_NPM_DIR/record-githead" ]; then git rev-parse "$GITHUB_REF_NAME^{commit}" > "$FAKE_NPM_DIR/githead"; fi
    exit 0;;
esac
exit 0
`;

// The fixture history: tag 3.0.0 (first), tag 3.0.1 (second; touches workspace-sdk/ when changed), and with `third` tag
// 3.0.2 (touches integration-sdk/ only). The released tag is the last one.
// opts: pkg, latest (undefined = never published), exists (versions on npm), viewError, targetError, latestError, latestError, changed (the second commit touches
// workspace-sdk/), third, gitHead ('none' | 'first' | 'second' | 'unknown' = a commit that is not in the checkout |
// 'garbage'), recordGitHead (publish records the tag's commit), staleLatest (publish does not move latest), runs (times the
// script runs for the same tag; the result is the last run), previousTag (false = 3.0.0 is not tagged)
function run({pkg = '2.0.0', latest, exists = [], viewError, targetError, latestError, changed = true, third = false, gitHead = 'none', recordGitHead = false, staleLatest = false, runs = 1, previousTag = true}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-publish-'));
  const repoDir = path.join(dir, 'repo');
  const fake = path.join(dir, 'fake');
  fs.mkdirSync(path.join(repoDir, 'workspace-sdk'), {recursive: true});
  fs.mkdirSync(path.join(repoDir, 'integration-sdk'));
  fs.mkdirSync(fake);
  fs.writeFileSync(path.join(fake, 'npm'), FAKE_NPM, {mode: 0o755});
  if (latest !== undefined) fs.writeFileSync(path.join(fake, 'latest'), latest + '\n');
  fs.writeFileSync(path.join(fake, 'exists'), exists.join('\n') + '\n');
  if (viewError) fs.writeFileSync(path.join(fake, 'view-error'), viewError + '\n');
  if (latestError) fs.writeFileSync(path.join(fake, 'latest-error'), latestError + '\n');
  if (targetError) fs.writeFileSync(path.join(fake, 'target-error'), targetError + '\n');
  if (recordGitHead) fs.writeFileSync(path.join(fake, 'record-githead'), '');
  if (staleLatest) fs.writeFileSync(path.join(fake, 'stale-latest'), '');
  fs.writeFileSync(path.join(repoDir, 'workspace-sdk/package.json'), JSON.stringify({name: PKG_NAME, version: pkg}, null, 2) + '\n');
  fs.writeFileSync(path.join(repoDir, 'integration-sdk/a.txt'), 'one\n');
  const git = (...a) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], {cwd: repoDir, encoding: 'utf8'});
    if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  // Plumbing only (no commit, no branch): the fixture history is reached by its tags.
  const commit = (message, parent) => {
    git('add', '.');
    return git('commit-tree', git('write-tree'), ...(parent ? ['-p', parent] : []), '-m', message);
  };
  git('init', '-q');
  const first = commit('first');
  if (previousTag) git('tag', '3.0.0', first);
  fs.writeFileSync(path.join(repoDir, changed ? 'workspace-sdk/change.txt' : 'integration-sdk/b.txt'), 'two\n');
  const second = commit('second', first);
  git('tag', '3.0.1', second);
  let tag = '3.0.1';
  if (third) {
    fs.writeFileSync(path.join(repoDir, 'integration-sdk/c.txt'), 'three\n');
    git('tag', '3.0.2', commit('third', second));
    tag = '3.0.2';
  }
  const heads = {first, second, unknown: 'a'.repeat(40), garbage: '--upload-pack=x'};
  if (gitHead !== 'none') fs.writeFileSync(path.join(fake, 'githead'), heads[gitHead] + '\n');
  const callsFile = path.join(fake, 'calls');
  const readCalls = () => (fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8').split('\n').filter(Boolean) : []);
  const base = Object.assign({}, process.env);
  let r;
  let before = 0;
  for (let i = 0; i < runs; i++) {
    before = readCalls().length;
    r = spawnSync('bash', [script], {
      cwd: path.join(repoDir, 'workspace-sdk'),
      encoding: 'utf8',
      env: Object.assign({}, base, {PATH: `${fake}:${base.PATH}`, FAKE_NPM_DIR: fake, GITHUB_REF_NAME: tag}),
    });
  }
  const calls = readCalls().slice(before);
  fs.rmSync(dir, {recursive: true, force: true});
  return {status: r.status, out: r.stdout + r.stderr, stdout: r.stdout, calls, published: calls.filter((c) => c.startsWith('published ')), versionSet: calls.filter((c) => c.startsWith('version '))};
}
const publishedExactly = (r, v) => r.status === 0 && r.published.join() === `published ${v}` && r.versionSet.join().startsWith(`version ${v} --no-git-tag-version`);
const skipped = (r) => r.status === 0 && r.published.length === 0 && r.versionSet.length === 0 && /publish skipped/.test(r.stdout);

const scriptText = fs.existsSync(script) ? fs.readFileSync(script, 'utf8') : '';
check('the script exists', fs.existsSync(script));
check('the script is bash with set -euo pipefail', /^#!.*bash/.test(scriptText) && /^set -euo pipefail$/m.test(scriptText));
check('the script is a thin wrapper: the decision lives in the .mjs', /workspace-publish-decision\.mjs/.test(scriptText) && !/is_higher|PATCH \+ 1/.test(scriptText));

if (fs.existsSync(script)) {
  const t1 = run({pkg: '2.0.0', latest: '2.0.3'});
  check('T1 a change under workspace-sdk/ with LATEST 2.0.3 and PKG 2.0.0 publishes 2.0.4', publishedExactly(t1, '2.0.4'));
  check('T1 the publish is public with provenance, in workspace-sdk', t1.calls.some((c) => /^publish --access public --provenance \[cwd=.*\/workspace-sdk\]$/.test(c)));
  check('T1 npm version never commits or tags', t1.versionSet.length === 1 && t1.versionSet.every((c) => c.includes('--no-git-tag-version')));

  const t2 = run({pkg: '2.1.0', latest: '2.0.3'});
  check('T2 PKG 2.1.0 higher than LATEST 2.0.3 publishes 2.1.0 (hand-raised)', publishedExactly(t2, '2.1.0'));
  const t2b = run({pkg: '2.0.0', latest: '1.1.9'});
  check('T2 LATEST 1.1.9 with PKG 2.0.0 publishes 2.0.0, not 1.1.10 (the first hand-made release)', publishedExactly(t2b, '2.0.0'));
  const t2c = run({pkg: '2.0.0', latest: undefined});
  check('T2 never published (E404): PKG 2.0.0 publishes 2.0.0', publishedExactly(t2c, '2.0.0'));

  const t3 = run({pkg: '2.0.0', latest: '2.0.3', exists: ['2.0.4']});
  check('T3 TARGET already on npm exits non-zero', t3.status !== 0);
  check('T3 and publishes nothing', !t3.calls.some((c) => c.startsWith('publish') || c.startsWith('published')));
  check('T3 and says it refuses to skip', /workspace-sdk@2\.0\.4 is already on npm; refusing to skip/.test(t3.out));
  const t3b = run({pkg: '2.1.0', latest: '2.0.3', exists: ['2.1.0']});
  check('T3 a hand-raised version already on npm also fails', t3b.status !== 0 && t3b.published.length === 0);

  // identical content: workspace-sdk/ at the tag equals workspace-sdk/ at the commit npm's latest was built from
  const t4 = run({pkg: '2.0.0', latest: '2.0.3', changed: false, gitHead: 'first'});
  check('T4 identical content with the gitHead in the checkout exits 0', t4.status === 0);
  check('T4 and publishes nothing', t4.published.length === 0 && t4.versionSet.length === 0);
  check('T4 and prints the skip line naming the gitHead and the version', /^workspace-sdk: workspace-sdk\/ at 3\.0\.1 is identical to [0-9a-f]{12}, the commit 2\.0\.3 was built from; publish skipped$/m.test(t4.stdout));
  check('T4 and also as a GitHub notice annotation', /^::notice::workspace-sdk: workspace-sdk\/ at 3\.0\.1 is identical to [0-9a-f]{12}, the commit 2\.0\.3 was built from; publish skipped$/m.test(t4.stdout));

  const t5 = run({pkg: '2.0.0', latest: '2.0.3', viewError: 'npm error code E500\nnpm error registry unavailable'});
  check('T5 npm view failing with an error other than E404 exits non-zero', t5.status !== 0 && t5.published.length === 0);
  check('T5 and shows the npm error', /E500/.test(t5.out));
  const t5b = run({pkg: '2.0.0', latest: '2.0.3', changed: false, gitHead: 'first', viewError: 'npm error code ETIMEDOUT'});
  check('T5 a failed lookup never skips, even for identical content', t5b.status !== 0 && t5b.published.length === 0 && !/publish skipped/.test(t5b.out));

  const t5a = run({pkg: '2.0.0', latest: '2.0.3', latestError: 'npm error code E503\nnpm error unavailable'});
  check('T5 a failed lookup of the latest version (not E404) exits non-zero and publishes nothing', t5a.status !== 0 && t5a.published.length === 0 && /cannot read the latest version/.test(t5a.out));
  const t5c = run({pkg: '2.0.0', latest: '2.0.3', targetError: 'npm error code E503\nnpm error unavailable'});
  check('T5 a failed lookup of the target version (not E404) exits non-zero and publishes nothing', t5c.status !== 0 && t5c.published.length === 0 && /cannot check/.test(t5c.out));

  // the lost publish: release 3.0.1 changed workspace-sdk/ and went red; the next release (3.0.2) touches only integration-sdk/
  const t6 = run({pkg: '2.0.0', latest: '2.0.3', changed: true, third: true, gitHead: 'first'});
  check('T6 a release that does not touch workspace-sdk/, after a red release that did, publishes the lost change', publishedExactly(t6, '2.0.4'));
  const t6b = run({pkg: '2.0.0', latest: '2.0.3', changed: false, previousTag: false});
  check('T6 no gitHead on npm counts as changed: publishes, never skips', publishedExactly(t6b, '2.0.4'));
  const t6c = run({pkg: '2.0.0', latest: '2.0.3', changed: false, gitHead: 'unknown'});
  check('T6 a gitHead that is not in the checkout counts as changed: publishes', publishedExactly(t6c, '2.0.4'));
  const t6d = run({pkg: '2.0.0', latest: '2.0.3', changed: false, gitHead: 'garbage'});
  check('T6 a gitHead that is not a commit id counts as changed: publishes', publishedExactly(t6d, '2.0.4'));
  const t6e = run({pkg: '2.0.0', latest: '2.0.3', changed: false, third: true, gitHead: 'second'});
  check('T6 a release that touches nothing under workspace-sdk/ skips when the latest build has the same content', skipped(t6e));
  const t6f = run({pkg: '2.0.0', latest: '2.0.3', changed: true, gitHead: 'first'});
  check('T6 a re-run of the job for a tag whose first run was red publishes (npm still has the older build)', publishedExactly(t6f, '2.0.4'));

  // a second run for the same tag after a successful first run
  const t8 = run({pkg: '2.0.0', latest: '2.0.3', staleLatest: true, runs: 2});
  check('T8 a second run for the same tag after a successful first run fails at the already-on-npm step', t8.status !== 0 && t8.published.length === 0 && /workspace-sdk@2\.0\.4 is already on npm; refusing to skip/.test(t8.out));
  const t8b = run({pkg: '2.0.0', latest: '2.0.3', recordGitHead: true, runs: 2});
  check('T8 where npm records the gitHead the second run skips (identical to what was published) and publishes nothing', skipped(t8b));
  const t8c = run({pkg: '2.0.0', latest: '2.0.3', runs: 2});
  check('T8 where npm has no gitHead the second run publishes the next patch (no gitHead means changed)', publishedExactly(t8c, '2.0.5'));

  // the latest dist-tag below the highest published version: the script publishes above latest
  const t9 = run({pkg: '2.0.0', latest: '2.0.3', exists: ['2.0.3', '2.0.5', '2.1.0']});
  check('T9 latest 2.0.3 with 2.1.0 published under another tag publishes 2.0.4 (above latest, below the highest)', publishedExactly(t9, '2.0.4'));
  const t9b = run({pkg: '2.0.0', latest: '2.0.3', exists: ['2.0.3', '2.0.4', '2.1.0']});
  check('T9 the same, but 2.0.4 exists: fails at the already-on-npm step', t9b.status !== 0 && t9b.published.length === 0);

  // versions that are not plain major.minor.patch
  const t10 = run({pkg: '2.1.0-beta.0', latest: '2.0.3'});
  check('T10 a beta version in package.json exits 1 and publishes nothing', t10.status === 1 && t10.published.length === 0 && /not a plain major\.minor\.patch/.test(t10.out));
  const t10b = run({pkg: '2.0.0', latest: '2.1.0-beta.0'});
  check('T10 a beta version as npm latest exits 1 and publishes nothing', t10b.status === 1 && t10b.published.length === 0 && /not a plain major\.minor\.patch/.test(t10b.out));

  // E404 for a missing version, as the real npm answers (stderr, exit 1)
  const t11 = run({pkg: '2.0.0', latest: '2.0.3', exists: ['2.0.3']});
  check('T11 a target version missing on npm (E404, exit 1) is published', publishedExactly(t11, '2.0.4'));

  const t7 = run({pkg: '2.10.0', latest: '2.9.0'});
  check('T7 numeric comparison: PKG 2.10.0 is higher than LATEST 2.9.0', publishedExactly(t7, '2.10.0'));
  const t7b = run({pkg: '2.9.0', latest: '2.10.0'});
  check('T7 numeric comparison: PKG 2.9.0 is lower than LATEST 2.10.0, so 2.10.1', publishedExactly(t7b, '2.10.1'));
  const t7c = run({pkg: '2.0.0', latest: '2.0.0'});
  check('T7 equal versions are not higher: publishes 2.0.1', publishedExactly(t7c, '2.0.1'));
}

process.exit(failed ? 1 : 0);
