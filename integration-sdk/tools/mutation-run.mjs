// Mutation check for the connector test harness.
//
//   yarn build && yarn test:mutation
//
// Applies each deliberate single-point bug below to src/, rebuilds, runs the harness tests (or, for the F mutants,
// test/fetcher-query-params.test.mjs) and expects them to FAIL. The original file is restored after every mutant (and on Ctrl-C). Writes test/MUTATION.md.
// Not part of CI: it rebuilds the SDK ~30 times. Run it when the harness or the SDK paths it covers change.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => path.join(root, 'src', p);

// [id, area, file (under src/), exact text to find (must occur once), replacement, what the bug is]
const MUTANTS = [
  ['M01', 'sdk handshake', 'internal/websocket/connection/index.mjs', 'response.status === 401', 'response.status === 403', 'a 401 from /connect no longer triggers registration'],
  ['M02', 'sdk handshake', 'internal/websocket/connection/index.mjs', 'config.setToken(await new Registration(local.config).run());', 'await new Registration(local.config).run();', 'the token from registration is not stored'],
  ['M03', 'sdk handshake', 'internal/websocket/connection/registration.mjs', 'return (await response.json()).key;', 'return (await response.json()).token;', 'registration reads the wrong field of the answer'],
  ['M04', 'sdk handshake', 'internal/websocket/connection/registration.mjs', 'id: config.id(),', 'id: config.name(),', 'registration sends the name as the connector id'],
  ['M05', 'sdk handshake', 'internal/websocket/connection/registration.mjs', 'publicKey: config.publicKey(),', 'publicKey: undefined,', 'registration omits the public key'],
  ['M06', 'sdk handshake', 'internal/websocket/connection/constants.mjs', "'User-Agent': config.id() + '/' + config.version(),\n    };\n\n    what.headers[AUTHORIZATION] = `Connector ${config.token()}`;", "'User-Agent': config.id(),\n    };\n\n    what.headers[AUTHORIZATION] = `Connector ${config.token()}`;", 'authenticated requests drop the version from the User-Agent'],
  ['M07', 'sdk handshake', 'internal/websocket/connection/constants.mjs', 'what.headers[AUTHORIZATION] = `Connector ${config.token()}`;', 'what.headers[AUTHORIZATION] = `Bearer ${config.token()}`;', 'wrong authorization scheme for the session token'],
  ['M08', 'sdk handshake', 'internal/websocket/transport/index.mjs', "config.wsUrl(), ['connector']", 'config.wsUrl(), []', 'websocket opened without the "connector" subprotocol'],
  ['M09', 'sdk transport', 'internal/websocket/transport/index.mjs', 'msgs.p?.forEach((item) => {', 'msgs.p?.slice(1).forEach((item) => {', 'the first packet of every incoming frame is dropped'],
  ['M10', 'sdk transport', 'internal/websocket/transport/index.mjs', 'local.ws.send(JSON.stringify({p: packets}));', 'local.ws.send(JSON.stringify({packets}));', 'outgoing frames use the wrong envelope'],
  ['M11', 'sdk transport', 'internal/websocket/transport/index.mjs', 'if (packet.cb() && this.callbacks[packet.cb()]) {', 'if (false && packet.cb() && this.callbacks[packet.cb()]) {', 'answers to connector-initiated requests are never routed to their callback'],
  ['M12', 'sdk dispatch', 'internal/dispatcher/index.mts', 'case \'connector.set-config\':\n          await local.onConfig({...packet.args().secrets});', 'case \'connector.set-config\':\n          await local.onConfig({});', 'configuration secrets are dropped before onConfig'],
  ['M13', 'sdk dispatch', 'internal/dispatcher/index.mts', 'const ctx = {taskId, namespace, sticky};', 'const ctx = {taskId, namespace};', 'sticky is not forwarded to the method'],
  ['M14', 'sdk dispatch', 'internal/dispatcher/index.mts', 'if (!method && !_resolvers.__default) throw new Error(`${originalQuery} not found`);', 'if (false) throw new Error(`${originalQuery} not found`);', 'unknown methods are no longer reported as "not found"'],
  ['M15', 'sdk result return', 'internal/dispatcher/index.mts', 'return typeof ret === \'object\' && !Array.isArray(ret) ? ret : {[packet.args().query]: ret};', 'return typeof ret === \'object\' && !Array.isArray(ret) ? ret : {result: ret};', 'scalar results are wrapped under the wrong key'],
  ['M16', 'sdk result return', 'internal/util/index.mts', 'transport.send(transport.newPacket({c: packet.cb(), a: {...arg}}));', 'transport.send(transport.newPacket({c: packet.cb(), a: {}}));', 'successful results are replied empty'],
  ['M17', 'sdk result return', 'internal/util/index.mts', "a: {error: '' + e}", "a: {error: 'failed'}", 'errors lose their message'],
  ['M18', 'sdk result return', 'internal/connector/server/on-message.mts', 'if (ret) reply(ret, packet, transport);', 'if (false) reply(ret, packet, transport);', 'results are never sent back'],
  ['M19', 'sdk config', 'internal/connector/server/on-connect/decrypt-config.mts', 'jwe.decrypt(value, config.id())', "jwe.decrypt(value, 'other-audience')", 'config is decrypted for the wrong audience'],
  ['M20', 'sdk config', 'internal/connector/server/on-connect/decrypt-config.mts', 'if (fields[key]?.plain ||', 'if (false ||', 'plain fields are decrypted like secrets'],
  ['M21', 'sdk config', 'internal/connector/server/on-connect/index.mts', 'config: decrypted,\n        oauth: theOAuth,', 'config: {},\n        oauth: theOAuth,', 'main() receives an empty config'],
  ['M22', 'harness vendor mock', 'testing/vendor-mock.mts', 'error.alomaHarnessUnmocked = true;\n    throw error;', 'error.alomaHarnessUnmocked = true;\n    return new Response(\'{}\');', 'an unmocked request is answered instead of rejected'],
  ['M23', 'harness vendor mock', 'testing/vendor-mock.mts', 'if (this.unmocked.length) {', 'if (false) {', 'verify() never fails'],
  ['M24', 'harness vendor mock', 'testing/vendor-mock.mts', 'const status = spec.status ?? 200;', 'const status = 200;', 'mocked status codes are ignored'],
  ['M25', 'harness vendor mock', 'testing/vendor-mock.mts', 'r.used < r.times && ', '', 'the times limit on a route is ignored'],
  ['M26', 'harness network guard', 'testing/network-guard.mts', 'if (!local && !LOOPBACK.has(host)) {', 'if (false) {', 'the network guard lets everything through (the mutant may try one TCP connect to the TEST-NET-3 documentation address 203.0.113.9)'],
  ['M27', 'harness fake ALOMA', 'testing/fake-aloma.mts', 'const authorized = auth === `Connector ${this.sessionToken}`;', 'const authorized = true;', 'the fake accepts a connect without registration'],
  ['M28', 'harness fake ALOMA', 'testing/fake-aloma.mts', '.setAudience(this.id)', ".setAudience('wrong')", 'the fake encrypts config for the wrong audience'],
  ['M29', 'harness fake ALOMA', 'testing/fake-aloma.mts', '      done(packet.a);', '      done(undefined);', 'the fake drops the connector\'s answer'],
  ['M30', 'harness fake ALOMA', 'testing/fake-aloma.mts', "{query: method, variables, ...ctx}", "{query: method, variables}", 'call() drops the ctx fields'],
  ['M31', 'harness', 'testing/harness.mts', 'this.vendor.verify();', '', 'stop() no longer fails on unmocked requests'],
  ['M32', 'harness', 'testing/harness.mts', "await aloma.setConfig(options.config || {});", "", 'the harness never sends configuration'],
  // PLAT-47: Fetcher query parameters, checked by test/fetcher-query-params.test.mjs
  ['F01', 'sdk fetcher', 'internal/fetcher/fetcher.mts', 'const fullURL = withQuery(theURL, toQuery(options0.params));', 'const fullURL = theURL;', 'params are not sent at all (the PLAT-47 bug)'],
  ['F02', 'sdk fetcher', 'internal/fetcher/fetcher.mts', 'if (Array.isArray(value)) value.forEach((item) => add(key, item));\n    else add(key, value);', 'add(key, value);', 'array handling dropped (arrays are refused as objects)'],
  ['F03', 'sdk fetcher', 'internal/fetcher/fetcher.mts', 'if (Array.isArray(value)) value.forEach((item) => add(key, item));', "if (Array.isArray(value)) add(key, value.join(','));", 'arrays are comma-joined instead of repeated keys'],
  ['F04', 'sdk fetcher', 'internal/fetcher/fetcher.mts', 'if (value == null) return;', 'if (value === null) return;', 'undefined values are not skipped'],
  ['F05', 'sdk fetcher', 'internal/fetcher/fetcher.mts', 'if (value == null) return;', 'if (value === undefined) return;', 'null values are not skipped'],
  ['F06', 'sdk fetcher', 'internal/fetcher/fetcher.mts', "    if (typeof value === 'object') {", '    if (false) {', 'nested objects are sent instead of refused'],
  ['F07', 'sdk fetcher', 'internal/fetcher/fetcher.mts', 'if (e instanceof ParamsError) throw e;', '', 'a refused params object is retried'],
  ['F08', 'sdk fetcher', 'internal/fetcher/fetcher.mts', "const sep = !base.includes('?') ? '?'", "const sep = true ? '?'", 'a query already in the url gets a second "?"'],
  ['F09', 'sdk fetcher', 'internal/fetcher/fetcher.mts', '        ...init,\n', '        ...options0,\n', 'params is passed on to native fetch'],
  ['F10', 'sdk fetcher', 'internal/fetcher/fetcher.mts', 'const {params, ...init} = options0;', 'const {params, ...init} = options0;\n      delete options0.params;', 'params are dropped from options0, so a retry loses the query'],
  ['F11', 'sdk fetcher', 'internal/fetcher/fetcher.mts', "console.log(theURL.split('?')[0], e);", 'console.log(theURL, e);', 'a failed attempt logs query values'],
  ['F12', 'sdk fetcher', 'internal/fetcher/fetcher.mts', 'if (params instanceof URLSearchParams) return params.toString();', '', 'a URLSearchParams instance is silently dropped'],
];

const run = (cmd, args, timeout) =>
  spawnSync(cmd, args, {cwd: root, encoding: 'utf8', timeout, env: {...process.env, FORCE_COLOR: '0'}});

const build = () => {
  const r = run('node', ['./node_modules/typescript/bin/tsc'], 120000);
  if (r.status !== 0) throw new Error('build failed:\n' + r.stdout + r.stderr);
};
const mocha = () => run('node', ['./node_modules/mocha/bin/_mocha', '--bail', '--exit', 'test/harness.test.mjs', 'test/harness-connector-smoke.test.mjs'], 150000);
const fetcherTests = () => run('node', ['test/fetcher-query-params.test.mjs'], 150000);
const testsFor = (id) => (id.startsWith('F') ? fetcherTests() : mocha());

let current = null;
const restore = () => {
  if (current) fs.writeFileSync(current.file, current.original);
  current = null;
};
process.on('SIGINT', () => {
  restore();
  process.exit(130);
});

const results = [];
try {
  build();
  const baseline = mocha();
  if (baseline.status !== 0) throw new Error('baseline run must pass before mutating:\n' + baseline.stdout.slice(-2000));
  const fetcherBaseline = fetcherTests();
  if (fetcherBaseline.status !== 0) throw new Error('fetcher baseline must pass:\n' + fetcherBaseline.stdout.slice(-2000));

  for (const [id, area, rel, find, replace, bug] of MUTANTS) {
    const file = src(rel);
    const original = fs.readFileSync(file, 'utf8');
    const count = original.split(find).length - 1;
    if (count !== 1) throw new Error(`${id}: expected exactly one match in ${rel}, found ${count}`);

    current = {file, original};
    let outcome;
    try {
      fs.writeFileSync(file, original.replace(find, () => replace));
      build();
      const r = testsFor(id);
      const failing = (r.stdout.match(/^\s+\d+\) .+$|FAIL: .+$/gm) || [])[0]?.trim() || '';
      outcome = r.error?.code === 'ETIMEDOUT' ? 'killed (timeout)' : r.status !== 0 ? 'killed' : 'SURVIVED';
      results.push({id, area, rel, bug, outcome, by: failing});
    } finally {
      restore();
    }
    console.log(id, results[results.length - 1].outcome, '-', bug);
  }
} finally {
  restore();
  build();
}

const killed = results.filter((r) => r.outcome.startsWith('killed')).length;
const md = [
  '# Mutation check for the connector test harness',
  '',
  `Result: **${killed}/${results.length} mutants killed**${killed === results.length ? '' : ' (survivors listed below)'}.`,
  '',
  'Each row is one deliberate single-point bug in the SDK code paths the harness exercises (handshake, transport,',
  'dispatch, result return, config) or in the harness itself. `tools/mutation-run.mjs` applies it to `src/`, rebuilds,',
  'runs `test/harness.test.mjs` with `--bail` (F rows: `test/fetcher-query-params.test.mjs`), expects a failure, and',
  'restores the file. Re-run with',
  '`yarn build && yarn test:mutation` after changing the harness or those SDK paths.',
  '',
  '| # | Area | File | Bug | Result |',
  '|---|------|------|-----|--------|',
  ...results.map((r) => `| ${r.id} | ${r.area} | \`src/${r.rel}\` | ${r.bug} | ${r.outcome} |`),
  '',
].join('\n');
fs.writeFileSync(path.join(root, 'test', 'MUTATION.md'), md);
console.log(`\n${killed}/${results.length} killed`);
process.exit(killed === results.length ? 0 : 1);
