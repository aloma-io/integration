// The workflows install with the plain frozen-lockfile command: no run step passes --ignore-engines, so an engines
// mismatch fails the install instead of being skipped. Standalone script, offline: a line-based scan of
// .github/workflows/*.yml.
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

// Returns "<line number>: <line>" for every non-comment line of the text that contains --ignore-engines.
function installLinesWithIgnoreEngines(text) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    if (line.includes('--ignore-engines')) found.push(`${i + 1}: ${line.trim()}`);
  });
  return found;
}

const plain = '        run: npx --yes yarn@1.22.22 install --frozen-lockfile';
const flagged = `${plain} --ignore-engines`;
check('self-check: the plain install is not reported', installLinesWithIgnoreEngines(plain).length === 0);
check('self-check: the flagged install is reported', installLinesWithIgnoreEngines(flagged).length === 1);
check('self-check: every flagged line is reported', installLinesWithIgnoreEngines(`${flagged}\n  x: 1\n${flagged}`).length === 2);
check('self-check: the report names the line number', installLinesWithIgnoreEngines(`a\n${flagged}`)[0].startsWith('2: '));
check('self-check: a comment line is not reported', installLinesWithIgnoreEngines('# no --ignore-engines here').length === 0);
check('self-check: a flag inside a multi-line run block is reported', installLinesWithIgnoreEngines(`run: |\n  yarn install --ignore-engines`).length === 1);

for (const file of ['ci.yml', 'publish.yml']) {
  const hits = installLinesWithIgnoreEngines(fs.readFileSync(path.join(workflowDir, file), 'utf8'));
  check(`${file}: no step passes --ignore-engines${hits.length ? ` (${hits.join('; ')})` : ''}`, hits.length === 0);
}

process.exit(failed ? 1 : 0);
