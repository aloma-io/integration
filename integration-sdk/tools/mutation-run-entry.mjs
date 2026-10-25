// Mutation check for the SDK tests that `yarn test` now runs (openapi-to-connector generator tests, scenarios).
//
//   yarn build && node tools/mutation-run-entry.mjs
//
// Applies each single-point bug to src/openapi-to-connector.mts, rebuilds, runs `yarn test` and expects it to FAIL.
// The source file is restored after every mutant (and on exit). Prints a markdown table.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/openapi-to-connector.mts');
const original = fs.readFileSync(file, 'utf8');
const restore = () => fs.writeFileSync(file, original);
process.on('exit', restore);
process.on('SIGINT', () => process.exit(130));

// [id, exact text (must occur once), replacement, bug]
const MUTANTS = [
  ['E01', "method: method.toUpperCase(),\n          path,", "method: method.toLowerCase(),\n          path,", 'the HTTP verb is taken in lower case'],
  ['E02', "lines.push(`    if (${paramName}) {`);\n        lines.push(`      url = url.replace('{${paramName}}', ${paramName});`);\n        lines.push(`    }`);\n      }", "lines.push(`    if (!${paramName}) {`);\n        lines.push(`      url = url.replace('{${paramName}}', ${paramName});`);\n        lines.push(`    }`);\n      }", 'path parameter substitution is guarded by the wrong condition'],
  ['E03', "return `${methodPrefix}_${pathSuffix}`;", "return `${methodPrefix}${pathSuffix}`;", 'fallback method name drops the separator'],
  ['E04', "const requiredText = propRequired ? '(required)' : '(optional)';", "const requiredText = propRequired ? '(optional)' : '(required)';", 'body properties are documented with the wrong required flag'],
  ['E05', "    // Always include headers in options type (generated code references options.headers)\n    optionProps.push('headers?: Record<string, string>');", "    // Always include headers in options type (generated code references options.headers)", 'headers are dropped from the generated options type'],
  ['E06', "lines.push(`    options = options || {};`);", "lines.push(`    // no options default`);", 'options is not defaulted in generated methods'],
  ['E07', "if (criticalErrors.length > 0) {", "if (false) {", 'invalid specs are no longer rejected'],
  ['E08', "const propRequired = (schema.required && schema.required.includes(propName)) || requestBody.required;", "const propRequired = (schema.required && schema.required.includes(propName)) && requestBody.required;", 'a property is required only if both the schema and the body say so'],
];

const sh = (args) => spawnSync('npx', ['--yes', 'yarn@1.22.22', '-s', ...args], {cwd: root, encoding: 'utf8'});
const rows = [];
let survived = 0;
for (const [id, find, repl, bug] of MUTANTS) {
  const n = original.split(find).length - 1;
  if (n !== 1) { console.error(`${id}: pattern occurs ${n} times, expected 1`); process.exit(2); }
  fs.writeFileSync(file, original.replace(find, repl));
  const b = sh(['build']);
  let result;
  if (b.status !== 0) result = 'build failed (not counted)';
  else {
    const t = sh(['test']);
    result = t.status !== 0 ? 'killed' : 'SURVIVED';
    if (t.status === 0) survived++;
  }
  restore();
  rows.push(`| ${id} | ${bug} | ${result} |`);
  console.log(rows.at(-1));
}
sh(['build']);
console.log(`\n${MUTANTS.length - survived}/${MUTANTS.length} killed`);
process.exit(survived ? 1 : 0);
