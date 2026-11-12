// Every action used by a workflow is pinned to a full commit ID with a version comment, and Dependabot keeps the
// pins current. Standalone script, offline: a line-based scan of .github/workflows/*.yml and .github/dependabot.yml.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowDir = path.join(repo, '.github/workflows');

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}`);
  if (!ok) failed++;
}

// Returns one message per `uses:` line that is not pinned to a 40-hex commit ID with a "# v<digit>" or "# main" comment.
function unpinned(text, file) {
  const problems = [];
  text.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)\s*(#.*)?$/);
    if (!m || m[1].startsWith('./')) return;
    const where = `${file}:${i + 1} ${m[1]}`;
    if (!/@[0-9a-f]{40}$/.test(m[1])) problems.push(`${where} is not pinned to a 40-hex commit ID`);
    else if (!/^#\s*(v\d|main\b)/.test(m[2] ?? '')) problems.push(`${where} has no version comment`);
  });
  return problems;
}

const sha = '3d3c42e5aac5ba805825da76410c181273ba90b1';
check('self-check: a tag pin is reported', unpinned('      - uses: actions/checkout@v6', 's').length === 1);
check('self-check: a branch pin is reported', unpinned(`  uses: actions/checkout@main # main`, 's').length === 1);
check('self-check: a missing comment is reported', unpinned(`      - uses: actions/checkout@${sha}`, 's').length === 1);
check('self-check: a 39-character ID is reported', unpinned(`      - uses: actions/checkout@${sha.slice(1)} # v7.0.1`, 's').length === 1);
check('self-check: a pinned use with a version comment passes', unpinned(`      - uses: actions/checkout@${sha} # v7.0.1`, 's').length === 0);
check('self-check: a local action is exempt', unpinned('      - uses: ./.github/actions/x', 's').length === 0);

const files = fs.readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f)).sort();
check('workflow files were found', files.length > 0);
for (const f of files) {
  const problems = unpinned(fs.readFileSync(path.join(workflowDir, f), 'utf8'), f);
  for (const p of problems) console.log(`  ${p}`);
  check(`${f}: every uses: is pinned by commit ID with a version comment`, problems.length === 0);
}

const dependabot = fs.readFileSync(path.join(repo, '.github/dependabot.yml'), 'utf8');
const entry = dependabot
  .split(/^\s*-\s+(?=package-ecosystem:)/m)
  .find((b) => /^package-ecosystem:\s*["']?github-actions["']?/.test(b));
check('dependabot.yml has a github-actions entry', entry !== undefined);
check('the github-actions entry updates weekly', /interval:\s*["']?weekly["']?/.test(entry ?? ''));

process.exit(failed ? 1 : 0);
