// PLAT-23: what a connector does when the platform delivers its configuration (on-connect/index.mts, with
// decrypt-config.mts and the OAuth patches it installs). Standalone script (no mocha), no network: the transport is a
// stub that records the packets the connector sends. Secrets are sealed with a key pair generated here at run time.
import Dispatcher from '../build/internal/dispatcher/index.mjs';
import Fetcher from '../build/internal/fetcher/fetcher.mjs';
import {Transport} from '../build/internal/websocket/transport/index.mjs';
import {onConnect} from '../build/internal/connector/server/on-connect/index.mjs';
import {decryptConfig} from '../build/internal/connector/server/on-connect/decrypt-config.mjs';
import {assert, assertEqual, captureLog, newConfig, outcome, suite, withEnv} from './helpers/flow-kit.mjs';

const {test, finish} = suite('on-connect');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** a transport whose socket is a stub; `sent()` lists every packet that went out, oldest first */
const stubTransport = async () => {
  const t = new Transport({config: await newConfig(), onMessage: () => {}, onConnect: () => {}});
  clearInterval(t.cleaner);
  const frames = [];
  t.ws = {send: (text) => frames.push(JSON.parse(text))};
  t.connected = true;
  t.sent = async () => (await sleep(15), frames.flatMap((f) => f.p));
  return t;
};

/** connect a connector: returns what start() was given once onConfig has run for `secrets` (sealed as needed) */
const connected = async ({dispatcher = new Dispatcher(), fields = {}, seal = {}, plain = {}} = {}) => {
  const config = await newConfig('connector-7');
  const transport = await stubTransport();
  const configSchema = () => ({fields});
  const jwe = await config.validateKeys('RSA-OAEP-256');
  const secrets = {...plain};
  for (const [key, value] of Object.entries(seal)) secrets[key] = typeof value === 'string' && value.startsWith('RAW:') ? value.slice(4) : await jwe.encrypt(value, '7d', config.id());
  let started;
  await onConnect({dispatcher, configSchema, config, start: (arg) => (started = arg)})(transport);
  const {lines} = await captureLog(() => dispatcher.onConfig(secrets));

  return {dispatcher, config, transport, started, lines, jwe};
};

await test('config: sealed values are opened for this connector, plain fields and endpointUrl are taken as they are, empty values are skipped', async () => {
  const c = await connected({
    fields: {name: {plain: true}, apiKey: {}},
    plain: {name: 'test-name', endpointUrl: 'https://api.example.test', empty: ''},
    seal: {apiKey: {key: 'test-api-key'}},
  });
  assertEqual(c.started.config, {name: 'test-name', endpointUrl: 'https://api.example.test', apiKey: {key: 'test-api-key'}}, 'config given to main()');
});

await test('config: a value sealed for another connector is dropped, logged without the sealed text, and the rest of the config still arrives', async () => {
  const other = await newConfig('connector-other');
  const otherJwe = await other.validateKeys('RSA-OAEP-256');
  const bad = await otherJwe.encrypt({v: 1}, '7d', 'connector-other');
  const c = await connected({fields: {name: {plain: true}}, plain: {name: 'test-name'}, seal: {apiKey: `RAW:${bad}`}});
  assertEqual(c.started.config, {name: 'test-name'}, 'only the good value');
  const log = c.lines.join('\n');
  assert(log.includes('failed to decrypt key apiKey'), 'logged');
  assert(!log.includes(bad), 'the sealed text is not in the log');
});

await test('config: decryptConfig masks the value if the error message quotes it', async () => {
  const config = await newConfig('connector-7');
  const fake = {
    ...config,
    id: () => 'connector-7',
    validateKeys: async () => ({
      decrypt: async (v) => {
        throw new Error(`could not read ${v} at all`);
      },
    }),
  };
  const { result, lines } = await captureLog(() => decryptConfig({configSchema: () => ({fields: {}}), config: fake, secrets: {token: 'test-sealed-value-123'}}));
  assertEqual(result, {}, 'nothing decrypted');
  assert(lines.join('\n').includes('could not read *** at all') && !lines.join('\n').includes('test-sealed-value-123'), 'masked');
});

await test('config: the log shows the granted scope of the OAuth result and never its tokens', async () => {
  const c = await connected({
    fields: {oauthResult: {}},
    seal: {oauthResult: {scope: 'read write', access_token: 'test-access-AAA', refresh_token: 'test-refresh-BBB'}},
  });
  const log = c.lines.join('\n');
  assert(log.includes('Scope: read write'), 'scope logged');
  assert(!log.includes('test-access-AAA') && !log.includes('test-refresh-BBB'), 'no token in the log');
  assertEqual(c.started.config.oauthResult.access_token, 'test-access-AAA', 'main() gets the tokens');
});

await test('oauth: onConfig installs start and finish with the opened client id, so the authorize URL carries the id the platform sent', async () => {
  await withEnv({}, async () => {
    const dispatcher = new Dispatcher();
    dispatcher.oauth({
      authorizationURL: 'https://auth.example.test/authorize?client_id={{clientId}}&scope={{scope}}',
      tokenURL: 'http://127.0.0.1:1/token',
      configurableClient: true,
    });
    const before = await outcome(dispatcher.startOAuth());
    assertEqual(String(before.error), 'Error: oauth not configured', 'before the config arrives');
    const c = await connected({
      dispatcher,
      fields: {clientId: {plain: true}, clientSecret: {}},
      plain: {clientId: 'test-client-from-platform'},
      seal: {clientSecret: {value: 'test-secret-from-platform'}},
    });
    const out = await c.dispatcher.startOAuth();
    assertEqual(out.url, 'https://auth.example.test/authorize?client_id=test-client-from-platform&scope=', 'url');
    assertEqual(typeof c.dispatcher.finishOAuth, 'function', 'finish installed');
    const noCode = await outcome(c.dispatcher.finishOAuth({redirectURI: 'https://app.example.test/cb'}));
    assertEqual(String(noCode.error), 'Error: need code and redirectUri', 'finish runs with the opened config');
  });
});

await test('start: getBlob, getBlobContent, createBlob, newTask and updateTask send the right packet and resolve with the answer', async () => {
  const c = await connected();
  const { started, transport } = c;
  const asks = [
    started.getBlob('blob-1'),
    started.getBlobContent('blob-1'),
    started.createBlob({name: 'test.txt'}),
    started.newTask('test-task', {n: 1}),
    started.updateTask('task-1', {n: 2}),
  ];
  const sent = await transport.sent();
  assertEqual(sent.map((p) => [p.m, p.a]), [
    ['connector.blob.get', {id: 'blob-1'}],
    ['connector.blob.get-content', {id: 'blob-1'}],
    ['connector.blob.create', {name: 'test.txt'}],
    ['connector.task.new', {name: 'test-task', a: {n: 1}}],
    ['connector.task.update', {id: 'task-1', a: {n: 2}}],
  ], 'packets');
  assert(sent.every((p) => p.c.startsWith('_req-') && p.c.length > 20), 'each has its own _req- callback key');
  assertEqual(new Set(sent.map((p) => p.c)).size, 5, 'keys are distinct');
  const answers = [{id: 'blob-1'}, {content: 'test-content'}, {id: 'blob-2'}, {id: 'task-1'}, {ok: true}];
  sent.forEach((p, i) => transport.onMessage({id: `a${i}`, c: p.c, a: answers[i]}));
  assertEqual(await Promise.all(asks), [{id: 'blob-1'}, 'test-content', 'blob-2', {id: 'task-1'}, {ok: true}], 'resolved values');
});

await test('start: an {error} answer rejects the request', async () => {
  const c = await connected();
  const asks = [c.started.getBlob('x'), c.started.getBlobContent('x'), c.started.createBlob(), c.started.newTask('t', {}), c.started.updateTask('t', {})];
  const sent = await c.transport.sent();
  sent.forEach((p, i) => c.transport.onMessage({id: `e${i}`, c: p.c, a: {error: `test-error-${i}`}}));
  const results = await Promise.all(asks.map((a) => outcome(a)));
  assertEqual(results.map((r) => r.error), ['test-error-0', 'test-error-1', 'test-error-2', 'test-error-3', 'test-error-4'], 'rejections');
});

await test('start: getClient returns a Fetcher when the connector has no OAuth', async () => {
  const c = await connected();
  const client = c.started.getClient({baseUrl: 'http://127.0.0.1:1'});
  assert(client instanceof Fetcher, 'a plain Fetcher');
});

await test('start: healthCheck reports ok, or the error message, to the platform as connector.health.check', async () => {
  const c = await connected();
  await c.started.healthCheck({__healthCheck: async () => {}});
  await c.started.healthCheck({
    __healthCheck: async () => {
      throw new Error('test-unhealthy');
    },
  });
  const sent = await c.transport.sent();
  assertEqual(sent.map((p) => [p.m, p.a]), [
    ['connector.health.check', {ok: true, error: null}],
    ['connector.health.check', {ok: false, error: 'test-unhealthy'}],
  ], 'two health packets');
});

finish();
