// PLAT-21: the dispatcher (internal/dispatcher) and the AbstractController (controller) entry points: what each one is
// given, what it passes on and what it returns. Standalone script (no mocha), no network beyond 127.0.0.1.
import {AbstractController} from '../build/controller/index.mjs';
import Dispatcher from '../build/internal/dispatcher/index.mjs';
import Fetcher from '../build/internal/fetcher/fetcher.mjs';
import {Transport} from '../build/internal/websocket/transport/index.mjs';
import {onConnect} from '../build/internal/connector/server/on-connect/index.mjs';
import {assert, assertEqual, captureLog, json, newConfig, outcome, suite, vendor, withEnv} from './helpers/flow-kit.mjs';

const {test, finish} = suite('dispatcher-controller');

/** a packet as the transport hands it to processPacket */
const packet = (method, args) => ({method: () => method, args: () => args});

/** a built dispatcher with the given resolvers; `d` is the Dispatcher itself */
const built = (resolvers = {}, types = {fields: {}}) => {
  const d = new Dispatcher();
  d.types(types).resolvers(resolvers);
  return {d, ...d.build()};
};

/** the answer of a connector.query packet for `args` */
const query = (b, args) => b.processPacket(packet('connector.query', args));

/** a controller whose protected hooks record what they are given */
const recordingController = () => {
  const calls = [];
  class Recording extends AbstractController {
    async start() {
      calls.push(['start', {config: this.config, oauth: this.oauth, client: this.client}]);
    }
    async stop(isShutdown) {
      calls.push(['stop', isShutdown]);
    }
    async autocomplete(arg) {
      calls.push(['autocomplete', arg]);
      return {fields: ['a']};
    }
    async endpoint(arg) {
      calls.push(['endpoint', arg]);
      return {accepted: arg};
    }
    fallback(arg, ctx) {
      calls.push(['fallback', arg, ctx]);
      return Promise.resolve({fell: arg});
    }
  }
  return {controller: new Recording(), calls};
};

// ---------------------------------------------------------------------------------------------------- dispatcher

await test('main: start gives its argument to the main function, once, and announces itself in the log', async () => {
  const seen = [];
  const d = new Dispatcher();
  assert(d.main(async (arg) => seen.push(arg)) === d, 'main() returns the dispatcher');
  const b = d.types({}).resolvers({}).build();
  const {lines} = await captureLog(() => b.start({config: {a: 1}}));
  assertEqual(seen, [{config: {a: 1}}], 'argument given to main');
  assertEqual(lines, ['starting ...'], 'log');
});

await test('main: start without a main function completes', async () => {
  const b = built().start;
  const {result, lines} = await captureLog(() => outcome(b({})));
  assertEqual(result, {value: undefined}, 'outcome');
  assertEqual(lines, ['starting ...'], 'log');
});

await test('build: refuses to run without types, and without resolvers', async () => {
  const thrown = (fn) => {
    try {
      fn();
    } catch (e) {
      return String(e);
    }
  };
  assertEqual(thrown(() => new Dispatcher().resolvers({}).build()), 'Error: missing types or resolvers', 'no types');
  assertEqual(thrown(() => new Dispatcher().types({}).build()), 'Error: missing types or resolvers', 'no resolvers');
});

await test('config: keeps the first description, summary and oauth flag, and the first definition of each field', async () => {
  const d = new Dispatcher();
  assert(d.config({description: 'first', summary: 's1', oauth: true, fields: {a: {name: 'A1'}}}) === d, 'returns the dispatcher');
  d.config({description: 'second', summary: 's2', oauth: false, fields: {a: {name: 'A2'}, b: {name: 'B'}}});
  assertEqual(d.types({}).resolvers({}).build().configSchema(), {
    fields: {a: {name: 'A1'}, b: {name: 'B'}},
    oauth: true,
    description: 'first',
    summary: 's1',
  }, 'config schema');
});

await test('resolvers: successive calls are merged and a later method replaces an earlier one of the same name', async () => {
  const d = new Dispatcher();
  d.resolvers({a: () => 'a1', b: () => 'b1'});
  assert(d.resolvers({b: () => 'b2', c: () => 'c1'}) === d, 'returns the dispatcher');
  const b = d.types({}).build();
  assertEqual(await Promise.all(['a', 'b', 'c'].map((query) => b.execute({query}))), ['a1', 'b2', 'c1'], 'results');
});

await test('execute: a single name is run like a list of one, with the variables and the task context, and its result is returned', async () => {
  const calls = [];
  const b = built({
    m: async (variables, ctx) => (calls.push([variables, ctx]), {done: true}),
  });
  const result = await b.execute({query: 'm', variables: {x: 1}, taskId: 't-1', namespace: 'ns', sticky: 's-1'});
  assertEqual(result, {done: true}, 'result');
  assertEqual(calls, [[{x: 1}, {taskId: 't-1', namespace: 'ns', sticky: 's-1'}]], 'arguments');
});

await test('execute: a list of names walks down nested resolvers', async () => {
  const calls = [];
  const b = built({crm: {contacts: {list: async (v, ctx) => (calls.push([v, ctx]), 'listed')}}});
  assertEqual(await b.execute({query: ['crm', 'contacts', 'list'], variables: {p: 2}, taskId: 't'}), 'listed', 'result');
  assertEqual(calls, [[{p: 2}, {taskId: 't'}]], 'arguments');
});

await test('execute: blank and reserved names are dropped from the query before it is resolved', async () => {
  const b = built({a: {b: async () => 'ab'}});
  assertEqual(await b.execute({query: ['a', '', '   ', 'constructor', 'prototype', 'b']}), 'ab', 'result');
});

await test('execute: only the first 20 names of a query are used', async () => {
  let node = async () => 'deep';
  for (let i = 0; i < 19; i++) node = {n: node};
  const b = built({n: node});
  // 20 names reach the handler; the 5 names after them are cut off
  assertEqual(await b.execute({query: Array(25).fill('n')}), 'deep', 'result');
  assert((await outcome(b.execute({query: Array(19).fill('n')}))).error instanceof Error, 'a shorter query does not reach it');
});

await test('execute: a name nothing answers is reported with the names asked for when there is no __default', async () => {
  const b = built({known: async () => 1});
  assertEqual(String((await outcome(b.execute({query: ['unknown', 'deeper']}))).error), 'Error: unknown,deeper not found', 'single');
  assertEqual(String((await outcome(b.execute({query: 'known2'}))).error), 'Error: known2 not found', 'string');
});

await test('execute: a name nothing answers goes to __default with the variables plus __method, and the task context', async () => {
  const calls = [];
  const b = built({__default: async (v, ctx) => (calls.push([v, ctx]), 'fallback')});
  assertEqual(await b.execute({query: ['x', 'y'], variables: {k: 'v'}, taskId: 't', namespace: 'n', sticky: 's'}), 'fallback', 'result');
  assertEqual(calls, [[{k: 'v', __method: ['x', 'y']}, {taskId: 't', namespace: 'n', sticky: 's'}]], 'arguments');
});

await test('execute: __default gets the variables as they are, without __method, when there are none', async () => {
  const calls = [];
  const b = built({__default: async (v, ctx) => (calls.push([v, ctx]), 'fallback')});
  await b.execute({query: ['x']});
  assertEqual(calls.map((c) => c[0] === undefined), [true], 'undefined variables');
  assertEqual(calls[0][1], {}, 'context holds no values');
});

await test('execute: a named method wins over __default', async () => {
  const b = built({m: async () => 'named', __default: async () => 'fallback'});
  assertEqual(await b.execute({query: ['m']}), 'named', 'result');
});

await test('execute: an error thrown by a method reaches the caller unchanged', async () => {
  const b = built({m: async () => { throw new Error('test-failure'); }});
  assertEqual(String((await outcome(b.execute({query: ['m']}))).error), 'Error: test-failure', 'error');
});

await test('execute: a query that names no method is refused with an error', async () => {
  const b = built({a: async () => 1});
  assert((await outcome(b.execute({query: []}))).error instanceof Error, 'empty list');
  assert((await outcome(b.execute({query: ['', 'toString']}))).error instanceof Error, 'only dropped names');
});

await test('processPacket: connector.introspect answers with the config schema and the types', async () => {
  const b = built({}, {types: 'test-types'});
  b.d.config({description: 'test-description', fields: {f: {name: 'F'}}});
  assertEqual(await b.processPacket(packet('connector.introspect')), {
    configSchema: {fields: {f: {name: 'F'}}, description: 'test-description'},
    introspect: {types: 'test-types'},
  }, 'answer');
  assertEqual(b.introspect(), {types: 'test-types'}, 'introspect()');
  assertEqual(b.configSchema().fields, {f: {name: 'F'}}, 'configSchema()');
});

await test('processPacket: connector.query returns an object result as it is', async () => {
  const b = built({m: async () => ({a: 1, b: [2]})});
  assertEqual(await query(b, {query: ['m']}), {a: 1, b: [2]}, 'answer');
});

await test('processPacket: connector.query hands the packet arguments to execute', async () => {
  const calls = [];
  const b = built({m: async (v, ctx) => (calls.push([v, ctx]), {})});
  await query(b, {query: ['m'], variables: {v: 1}, taskId: 't', namespace: 'n', sticky: 's'});
  assertEqual(calls, [[{v: 1}, {taskId: 't', namespace: 'n', sticky: 's'}]], 'arguments');
});

await test('processPacket: connector.query wraps an array or scalar result under the query name', async () => {
  const b = built({arr: async () => [1, 2], str: async () => 'text', zero: async () => 0, no: async () => false, undef: async () => undefined});
  assertEqual(await query(b, {query: 'arr'}), {arr: [1, 2]}, 'array, query as string');
  assertEqual(await query(b, {query: ['str']}), {str: 'text'}, 'string, query as list');
  assertEqual(await query(b, {query: ['zero']}), {zero: 0}, 'zero');
  assertEqual(await query(b, {query: ['no']}), {no: false}, 'false');
  assertEqual(Object.keys(await query(b, {query: ['undef']})), ['undef'], 'undefined keeps its key');
});

await test('processPacket: connector.query names a wrapped nested result by the joined names', async () => {
  const b = built({a: {b: async () => 'nested'}});
  assertEqual(await query(b, {query: ['a', 'b']}), {'a,b': 'nested'}, 'answer');
});

await test('processPacket: connector.query returns a null result as null', async () => {
  const b = built({m: async () => null});
  assertEqual(await query(b, {query: ['m']}), null, 'answer');
});

await test('processPacket: connector.query rejects with the error of a method that fails', async () => {
  const b = built({m: async () => { throw new Error('test-failure'); }});
  assertEqual(String((await outcome(query(b, {query: ['m']}))).error), 'Error: test-failure', 'error');
});

await test('processPacket: connector.set-config gives onConfig a copy of the secrets and answers nothing', async () => {
  const b = built();
  const secrets = {apiKey: 'test-sealed', plain: 'p'};
  const seen = [];
  b.d.onConfig = async (arg) => seen.push(arg);
  assertEqual(await b.processPacket(packet('connector.set-config', {secrets, other: 'ignored'})), undefined, 'answer');
  assertEqual(seen, [secrets], 'secrets');
  assert(seen[0] !== secrets, 'a copy, not the same object');
  await b.processPacket(packet('connector.set-config', {}));
  assertEqual(seen[1], {}, 'no secrets given');
});

await test('processPacket: connector.set-config waits for onConfig and passes its failure on', async () => {
  const b = built();
  let finished = false;
  b.d.onConfig = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    finished = true;
  };
  await b.processPacket(packet('connector.set-config', {secrets: {}}));
  assert(finished, 'onConfig had finished');
  b.d.onConfig = async () => { throw new Error('test-config-failure'); };
  assertEqual(String((await outcome(b.processPacket(packet('connector.set-config', {secrets: {}})))).error), 'Error: test-config-failure', 'error');
});

await test('onConfig: a dispatcher no platform has connected to refuses with "Method not implemented."', async () => {
  const d = new Dispatcher();
  let error;
  try {
    d.onConfig({});
  } catch (e) {
    error = e;
  }
  assertEqual(String(error), 'Error: Method not implemented.', 'error');
});

await test('finishOAuth: refuses with "oauth not configured" until the platform config installed it, also as a packet', async () => {
  const b = built();
  assertEqual(String((await outcome(b.d.finishOAuth({code: 'c', redirectURI: 'r'}))).error), 'Error: oauth not configured', 'direct');
  assertEqual(String((await outcome(b.processPacket(packet('connector.finish-oauth', {code: 'c', redirectURI: 'r'})))).error), 'Error: oauth not configured', 'packet');
  assertEqual(String((await outcome(b.processPacket(packet('connector.start-oauth', {})))).error), 'Error: oauth not configured', 'start packet');
});

await test('finishOAuth: the packet arguments go to the dispatcher as they are and its answer is returned', async () => {
  const b = built();
  const seen = [];
  b.d.finishOAuth = async (arg) => (seen.push(arg), {value: 'test-sealed-result'});
  b.d.startOAuth = async (arg) => (seen.push(arg), {url: 'https://auth.example.test/', useCodeChallenge: false});
  const args = {code: 'test-code', redirectURI: 'https://app.example.test/cb', codeVerifier: 'test-verifier'};
  assertEqual(await b.processPacket(packet('connector.finish-oauth', args)), {value: 'test-sealed-result'}, 'finish answer');
  assertEqual(await b.processPacket(packet('connector.start-oauth', {redirectURI: 'r'})), {url: 'https://auth.example.test/', useCodeChallenge: false}, 'start answer');
  assertEqual(seen, [args, {redirectURI: 'r'}], 'arguments');
});

await test('processPacket: a packet method it does not know fails with "cannot handle packet" and the packet is logged', async () => {
  const b = built();
  const p = packet('connector.unknown', {a: 1});
  const {result, lines} = await captureLog(() => outcome(b.processPacket(p)));
  assertEqual(String(result.error), 'Error: cannot handle packet', 'error');
  assertEqual(lines.length, 1, 'one logged item');
});

await test('endpoint: adds an optional plain line field for the token and runs the handler as _endpoint', async () => {
  const d = new Dispatcher();
  const calls = [];
  assert(d.endpoint(async (v, ctx) => (calls.push([v, ctx]), {got: v})) === d, 'returns the dispatcher');
  const b = d.types({}).build();
  assertEqual(b.configSchema().fields, {_endpointToken: {name: 'Endpoint Token', placeholder: 'e.g. 1234', type: 'line', plain: true, optional: true}}, 'field');
  assertEqual(await b.execute({query: ['_endpoint'], variables: {body: 'test'}, taskId: 't'}), {got: {body: 'test'}}, 'result');
  assertEqual(calls, [[{body: 'test'}, {taskId: 't'}]], 'arguments');
});

await test('endpoint: a required endpoint has a managed, not optional token field', async () => {
  const d = new Dispatcher();
  d.endpoint(async () => 1, true);
  assertEqual(d.types({}).build().configSchema().fields._endpointToken, {name: 'Endpoint Token', placeholder: 'e.g. 1234', type: 'managed', plain: true, optional: false}, 'field');
});

await test('endpoint: keeps the other resolvers', async () => {
  const d = new Dispatcher();
  d.resolvers({m: async () => 'm'}).endpoint(async () => 'e');
  const b = d.types({}).build();
  assertEqual([await b.execute({query: 'm'}), await b.execute({query: '_endpoint'})], ['m', 'e'], 'results');
});

// ------------------------------------------------------------------------------------------ AbstractController

await test('__endpoint: gives the argument to endpoint and returns its result', async () => {
  const {controller, calls} = recordingController();
  assertEqual(await controller.__endpoint({body: 'test'}), {accepted: {body: 'test'}}, 'result');
  assertEqual(calls, [['endpoint', {body: 'test'}]], 'calls');
});

await test('__endpoint: a controller without an endpoint method fails with "method not found"', async () => {
  assertEqual(String((await outcome(new (class extends AbstractController {})().__endpoint({}))).error), 'Error: method not found', 'error');
});

await test('__autocomplete: gives the argument to autocomplete and returns its result', async () => {
  const {controller, calls} = recordingController();
  assertEqual(await controller.__autocomplete({entity: 'deal'}), {fields: ['a']}, 'result');
  assertEqual(calls, [['autocomplete', {entity: 'deal'}]], 'calls');
});

await test('__autocomplete: a controller without an autocomplete method answers with an empty object', async () => {
  assertEqual(await new (class extends AbstractController {})().__autocomplete({entity: 'deal'}), {}, 'result');
});

await test('__default: gives the argument and the task context to fallback and returns its result', async () => {
  const {controller, calls} = recordingController();
  const ctx = {taskId: 't', namespace: 'n', sticky: 's'};
  assertEqual(await controller.__default({__method: ['x']}, ctx), {fell: {__method: ['x']}}, 'result');
  assert(calls[0][2] === ctx, 'the same context object');
  assertEqual(calls.map((c) => c.slice(0, 2)), [['fallback', {__method: ['x']}]], 'calls');
});

await test('__default: without a context fallback is called without one', async () => {
  const {controller, calls} = recordingController();
  await controller.__default({a: 1});
  assertEqual(calls[0].length, 3, 'three entries');
  assertEqual(calls[0][2] === undefined, true, 'no context');
});

await test('__default: a controller without a fallback method fails with "method not found"', async () => {
  assertEqual(String((await outcome(new (class extends AbstractController {})().__default({}, {}))).error), 'Error: method not found', 'error');
});

await test('newTask, updateTask, createBlob, getBlob and getBlobContent fail with "not implemented" before the controller is started', async () => {
  const c = new (class extends AbstractController {})();
  const errors = await Promise.all([
    outcome(c.newTask('t', {})),
    outcome(c.updateTask('t', {})),
    outcome(c.createBlob({content: 'x'})),
    outcome(c.getBlob('b')),
    outcome(c.getBlobContent('b')),
  ]);
  assertEqual(errors.map((e) => String(e.error)), Array(5).fill('Error: not implemented'), 'errors');
});

await test('getClient: fails with "not implemented" right away, not as a rejected promise, before the controller is started', async () => {
  const c = new (class extends AbstractController {})();
  let error;
  try {
    c.getClient({baseUrl: 'http://127.0.0.1:1'});
  } catch (e) {
    error = e;
  }
  assertEqual(String(error), 'Error: not implemented', 'error');
});

await test('_doStart: stores the config and the oauth, uses oauth as the deprecated client too, and starts after that', async () => {
  const {controller, calls} = recordingController();
  const config = {a: 1};
  const oauth = {tok: 'test'};
  const fns = Array.from({length: 6}, () => async () => {});
  assertEqual(await controller._doStart(config, oauth, ...fns), undefined, 'answer');
  assertEqual(calls.length, 1, 'start ran once');
  assert(calls[0][1].config === config, 'config');
  assert(calls[0][1].oauth === oauth && calls[0][1].client === oauth, 'oauth and client');
});

await test('_doStart: newTask, updateTask, getClient, getBlob, getBlobContent and createBlob become the given functions, each in its own place', async () => {
  const {controller} = recordingController();
  const seen = [];
  const mk = (name, result) => (...args) => (seen.push([name, args]), result);
  await controller._doStart(
    {},
    null,
    mk('newTask', 'new-id'),
    mk('updateTask', 'upd-id'),
    mk('getClient', 'client'),
    mk('getBlob', 'blob'),
    mk('getBlobContent', 'content'),
    mk('createBlob', 'created')
  );
  const out = [
    controller.newTask('n', {a: 1}),
    controller.updateTask('u', {b: 2}),
    controller.getClient({baseUrl: 'x'}),
    controller.getBlob('b-1'),
    controller.getBlobContent('b-2'),
    controller.createBlob({content: 'c'}),
  ];
  assertEqual(out, ['new-id', 'upd-id', 'client', 'blob', 'content', 'created'], 'results');
  assertEqual(seen, [
    ['newTask', ['n', {a: 1}]],
    ['updateTask', ['u', {b: 2}]],
    ['getClient', [{baseUrl: 'x'}]],
    ['getBlob', ['b-1']],
    ['getBlobContent', ['b-2']],
    ['createBlob', [{content: 'c'}]],
  ], 'arguments');
});

await test('_doStart: a failure of start reaches the caller', async () => {
  class Failing extends AbstractController {
    async start() {
      throw new Error('test-start-failure');
    }
  }
  const error = (await outcome(new Failing()._doStart({}, null, ...Array(6).fill(() => {})))).error;
  assertEqual(String(error), 'Error: test-start-failure', 'error');
});

await test('_doStop: passes isShutdown on to stop, false when none is given', async () => {
  const {controller, calls} = recordingController();
  assertEqual(await controller._doStop(), undefined, 'answer');
  await controller._doStop(true);
  await controller._doStop(false);
  assertEqual(calls, [['stop', false], ['stop', true], ['stop', false]], 'calls');
});

// ------------------------------------------------------------------ getClient as the connector hands it to main()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** connect a dispatcher (as on-connect.test.mjs does) and return what start() was given */
const connect = async ({dispatcher = new Dispatcher(), fields = {}, seal = {}} = {}) => {
  const config = await newConfig('connector-7');
  const transport = new Transport({config, onMessage: () => {}, onConnect: () => {}});
  clearInterval(transport.cleaner);
  transport.ws = {send: () => {}};
  transport.connected = true;
  const jwe = await config.validateKeys('RSA-OAEP-256');
  const secrets = {};
  for (const [key, value] of Object.entries(seal)) secrets[key] = await jwe.encrypt(value, '7d', config.id());
  let started;
  await onConnect({dispatcher, configSchema: () => ({fields}), config, start: (arg) => (started = arg)})(transport);
  await captureLog(() => dispatcher.onConfig(secrets));
  await sleep(0);
  return started;
};

await test('getClient: without OAuth the client is a Fetcher that uses the given base url, customize and onResponse', async () => {
  const v = await vendor((req, res) => json(res, 200, {path: req.url}));
  try {
    const started = await connect();
    const statuses = [];
    const client = started.getClient({
      baseUrl: v.baseUrl,
      customize: (options) => (options.headers = {...options.headers, 'X-Test': 'test-value'}),
      onResponse: (response) => statuses.push(response.status),
    });
    assert(client instanceof Fetcher, 'a Fetcher');
    const body = await client.fetch('/things', {method: 'GET'});
    assertEqual(body, {path: '/things'}, 'body');
    assertEqual(v.requests.map((r) => [r.method, r.url, r.headers['x-test']]), [['GET', '/things', 'test-value']], 'request');
    assertEqual(statuses, [200], 'onResponse');
  } finally {
    await v.close();
  }
});

await test('getClient: with OAuth the client sends the access token the platform gave as a bearer token', async () => {
  const v = await vendor((req, res) => json(res, 200, {ok: true}));
  try {
    await withEnv({}, async () => {
      const dispatcher = new Dispatcher();
      dispatcher.oauth({authorizationURL: 'https://auth.example.test/authorize', tokenURL: 'http://127.0.0.1:1/token', noPeriodicTokenRefresh: true});
      const started = await connect({
        dispatcher,
        fields: {oauthResult: {}},
        seal: {oauthResult: {access_token: 'test-access-token', refresh_token: 'test-refresh-token'}},
      });
      const client = started.getClient({baseUrl: v.baseUrl});
      assert(!(client.constructor === Fetcher), 'not a plain Fetcher');
      assert(client instanceof Fetcher, 'still a Fetcher');
      await client.fetch('/me', {method: 'GET'});
    });
    assertEqual(v.requests.map((r) => [r.url, r.headers.authorization]), [['/me', 'Bearer test-access-token']], 'request');
  } finally {
    await v.close();
  }
});

finish();
