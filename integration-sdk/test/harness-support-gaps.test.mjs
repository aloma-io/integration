// Regression row 1.01 (SDK): the fake ALOMA server's protocol checks, call() timeout, ConnectorHarness.stop() and
// connectorFromRuntimeContext(). Standalone script (no mocha); everything stays on 127.0.0.1; a minimal hand-made
// runtime-context object stands in for a connector build.
import http from 'node:http';
import {WebSocket} from 'ws';
import {AbstractController} from '../build/controller/index.mjs';
import {Connector} from '../build/internal/connector/index.mjs';
import {ConnectorHarness, FakeAloma, connectorFromRuntimeContext} from '../build/testing/index.mjs';
import {assert, assertEqual, suite} from './helpers/mini.mjs';

const {test, finish} = suite('harness support gaps');

const request = (fake, {method = 'POST', path, headers = {}, body}) =>
  new Promise((resolve, reject) => {
    const req = http.request(fake.url + path.replace(/^\//, ''), {method, headers}, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// opens a websocket; resolves {status} for a refused upgrade, {ws} for an open socket
const openSocket = (fake, {headers = {}, protocols}) =>
  new Promise((resolve) => {
    const ws = new WebSocket(fake.wsUrl, protocols, {headers});
    ws.on('unexpected-response', (_req, res) => {
      res.resume();
      resolve({status: res.statusCode});
    });
    ws.on('open', () => resolve({ws}));
    ws.on('error', () => {});
  });

const withFake = async (fn) => {
  const fake = await FakeAloma.start();
  try {
    await fn(fake);
  } finally {
    await fake.close();
  }
};

const goodBody = {name: 'n', version: '1.0.0', id: 'some-id', publicKey: 'abc', schema: {}};
const goodHeaders = (fake) => ({
  Authorization: `Connector ${fake.registrationToken}`,
  'User-Agent': 'some-id/1.0.0',
  'Content-Type': 'application/json',
});

// ---- protocol errors recorded by the fake ----

await test('upgrade without the session authorization: HTTP 401 and a protocol error', () =>
  withFake(async (fake) => {
    const result = await openSocket(fake, {protocols: ['connector'], headers: {Authorization: 'Connector not-a-token'}});
    assertEqual(result.status, 401, 'status');
    assertEqual(fake.protocolErrors, ['bad or missing Authorization on websocket']);
  }));

await test('upgrade without the "connector" subprotocol: refused and a protocol error', () =>
  withFake(async (fake) => {
    const result = await openSocket(fake, {headers: {Authorization: `Connector ${fake.sessionToken}`}});
    assertEqual(result.status, 401, 'status');
    assertEqual(fake.protocolErrors, ['websocket subprotocol "connector" not requested']);
  }));

await test('upgrade with session authorization and subprotocol is accepted without a protocol error', () =>
  withFake(async (fake) => {
    const result = await openSocket(fake, {protocols: ['connector'], headers: {Authorization: `Connector ${fake.sessionToken}`}});
    assert(result.ws, 'socket should open');
    await fake.waitForConnection(2000);
    result.ws.close();
    assertEqual(fake.protocolErrors, []);
  }));

for (const key of ['name', 'version', 'id', 'publicKey', 'schema']) {
  await test(`register body missing ${key}: the message lists it`, () =>
    withFake(async (fake) => {
      const body = {...goodBody};
      delete body[key];
      await request(fake, {path: '/register', headers: {...goodHeaders(fake), 'User-Agent': `${body.id}/${body.version}`}, body});
      assertEqual(fake.protocolErrors, [`register body is missing: ${key}`]);
    }));
}

await test('register body missing several keys lists them all in order', () =>
  withFake(async (fake) => {
    await request(fake, {path: '/register', headers: {...goodHeaders(fake), 'User-Agent': 'undefined/undefined'}, body: {version: '1'}});
    assertEqual(fake.protocolErrors[0], 'register body is missing: name, id, publicKey, schema');
  }));

await test('register with a User-Agent that is not id/version: protocol error', () =>
  withFake(async (fake) => {
    await request(fake, {path: '/register', headers: {...goodHeaders(fake), 'User-Agent': 'other/9'}, body: goodBody});
    assertEqual(fake.protocolErrors, ['register User-Agent should be id/version, got other/9']);
  }));

await test('register with a wrong registration token: 401 and nothing is registered', () =>
  withFake(async (fake) => {
    const status = await request(fake, {path: '/register', headers: {...goodHeaders(fake), Authorization: 'Connector not-a-token'}, body: goodBody});
    assertEqual(status, 401, 'status');
    assertEqual(fake.registrations.length, 0);
    assertEqual(fake.protocolErrors, ['register called with a wrong registration token']);
  }));

await test('an unexpected HTTP request is answered 404 and recorded', () =>
  withFake(async (fake) => {
    const status = await request(fake, {method: 'GET', path: '/elsewhere'});
    assertEqual(status, 404, 'status');
    assertEqual(fake.protocolErrors, ['unexpected request GET /elsewhere']);
  }));

await test('a websocket frame without a "p" array is recorded', () =>
  withFake(async (fake) => {
    const {ws} = await openSocket(fake, {protocols: ['connector'], headers: {Authorization: `Connector ${fake.sessionToken}`}});
    await fake.waitForConnection(2000);
    ws.send(JSON.stringify({x: 1}));
    for (let i = 0; i < 100 && !fake.protocolErrors.length; i++) await sleep(10);
    ws.close();
    assertEqual(fake.protocolErrors, ['frame without a "p" array']);
    assertEqual(fake.received.length, 0);
  }));

// ---- correct register, disconnect ----

await test('a correct register returns the session key and is kept in registrations', () =>
  withFake(async (fake) => {
    let text = '';
    const status = await new Promise((resolve, reject) => {
      const req = http.request(fake.url + 'register', {method: 'POST', headers: goodHeaders(fake)}, (res) => {
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end(JSON.stringify(goodBody));
    });
    assertEqual(status, 200, 'status');
    assertEqual(JSON.parse(text), {key: fake.sessionToken});
    assertEqual(fake.registrations, [goodBody]);
    assertEqual(fake.registration, goodBody);
    assertEqual(fake.protocolErrors, []);
  }));

await test('/disconnect answers 200 without a protocol error', () =>
  withFake(async (fake) => {
    assertEqual(await request(fake, {path: '/disconnect', body: {}}), 200, 'status');
    assertEqual(fake.protocolErrors, []);
  }));

// ---- call() timeout ----

await test('call() rejects with "no answer to <method> within <n>ms" and clears its pending entry', () =>
  withFake(async (fake) => {
    const {ws} = await openSocket(fake, {protocols: ['connector'], headers: {Authorization: `Connector ${fake.sessionToken}`}});
    await fake.waitForConnection(2000);
    // call() passes no timeout of its own (5 s), so the short wait goes through request(), which call() uses
    const short = fake.request('connector.query', {query: 'slow'}, 30);
    assertEqual(fake.pending.size, 1, 'pending while waiting');
    let message = '';
    try {
      await short;
    } catch (e) {
      message = e.message;
    }
    assertEqual(message, 'no answer to connector.query within 30ms');
    assertEqual(fake.pending.size, 0, 'pending entry removed after the timeout');
    ws.close();
  }));

// ---- harness stop() ----

const minimalConnector = () => {
  const connector = new Connector({id: 'gap-connector', version: '1.0.0', name: 'Gap Connector'});
  connector
    .configure()
    .config({fields: {}})
    .types('type Query { echo: String }')
    .resolvers({echo: async (args) => args});
  return connector;
};

const startHarness = () => ConnectorHarness.start({connector: minimalConnector(), config: {}});

const stopError = async (harness, options) => {
  try {
    await harness.stop(options);
  } catch (e) {
    return e.message;
  }
  return null;
};

await test('stop() with an unmocked vendor request throws the vendor mock message', async () => {
  const harness = await startHarness();
  harness.vendor.unmocked.push({method: 'GET', url: 'https://vendor.example.test/x', rawUrl: '', headers: {}});
  const message = await stopError(harness);
  assert(message && message.startsWith('UNMOCKED vendor requests were made'), `got ${message}`);
  assert(message.includes('GET https://vendor.example.test/x'), message);
});

await test('stop() with only protocol errors throws "protocol errors seen by the fake ALOMA: [...]"', async () => {
  const harness = await startHarness();
  harness.aloma.protocolErrors.push('made up problem');
  assertEqual(await stopError(harness), 'protocol errors seen by the fake ALOMA: ["made up problem"]');
});

await test('stop() with neither returns', async () => {
  const harness = await startHarness();
  assertEqual(await stopError(harness), null);
});

await test('stop() with verification off does not throw with an unmocked request', async () => {
  const harness = await startHarness();
  harness.vendor.unmocked.push({method: 'GET', url: 'https://vendor.example.test/x', rawUrl: '', headers: {}});
  assertEqual(await stopError(harness, {verify: false}), null);
});

await test('stop() with verification off does not throw with protocol errors', async () => {
  const harness = await startHarness();
  harness.aloma.protocolErrors.push('made up problem');
  assertEqual(await stopError(harness, {verify: false}), null);
});

// ---- connectorFromRuntimeContext ----

class Controller extends AbstractController {
  async alpha() {}
  async beta() {}
}

const runtimeContext = (data = {}, controller = new Controller()) => ({
  controller,
  data: {id: 'ctx-id', version: '2.0.0', methods: ['alpha', 'beta'], types: 'type Query { alpha: String }', ...data},
});

await test('a controller that does not extend AbstractController is refused', () => {
  let message = '';
  try {
    connectorFromRuntimeContext(runtimeContext({}, {alpha() {}}));
  } catch (e) {
    message = e.message;
  }
  assertEqual(message, 'the controller needs to extend AbstractController');
});

await test('the connector takes id, version and name "id/version" from the context', () => {
  const connector = connectorFromRuntimeContext(runtimeContext());
  assertEqual([connector.id, connector.version, connector.name], ['ctx-id', '2.0.0', 'ctx-id/2.0.0']);
});

await test('the resolver list is the context methods plus __autocomplete, __endpoint and __default', () => {
  const connector = connectorFromRuntimeContext(runtimeContext());
  assertEqual(Object.keys(connector.dispatcher._resolvers).sort(), ['__autocomplete', '__default', '__endpoint', 'alpha', 'beta']);
});

await test('no endpoint wiring unless options.endpoint.enabled is set', () => {
  for (const data of [{}, {options: {}}, {options: {endpoint: {enabled: false, required: true}}}]) {
    const dispatcher = connectorFromRuntimeContext(runtimeContext(data)).dispatcher;
    assertEqual(dispatcher._config.fields._endpointToken, undefined, JSON.stringify(data));
    assertEqual(dispatcher._resolvers._endpoint, undefined, JSON.stringify(data));
  }
});

await test('endpoint wiring when enabled; "required" is passed through', () => {
  const optional = connectorFromRuntimeContext(runtimeContext({options: {endpoint: {enabled: true}}})).dispatcher;
  assertEqual(typeof optional._resolvers._endpoint, 'function');
  assertEqual(optional._config.fields._endpointToken.optional, true);
  assertEqual(optional._config.fields._endpointToken.type, 'line');

  const required = connectorFromRuntimeContext(runtimeContext({options: {endpoint: {enabled: true, required: true}}})).dispatcher;
  assertEqual(required._config.fields._endpointToken.optional, false);
  assertEqual(required._config.fields._endpointToken.type, 'managed');
});

await test('the endpoint resolver calls the controller __endpoint', async () => {
  const controller = new Controller();
  controller.__endpoint = async (arg) => ({got: arg});
  const dispatcher = connectorFromRuntimeContext(runtimeContext({options: {endpoint: {enabled: true}}}, controller)).dispatcher;
  assertEqual(await dispatcher._resolvers._endpoint({x: 1}), {got: {x: 1}});
});

await test('oauth wiring only when auth.oauth is set', () => {
  const without = connectorFromRuntimeContext(runtimeContext({auth: {}})).dispatcher;
  assertEqual(without._oauth, undefined);
  assertEqual(without._config.oauth, undefined);

  const oauth = {authorizationURL: 'https://vendor.example.test/auth', tokenURL: 'https://vendor.example.test/token'};
  const wired = connectorFromRuntimeContext(runtimeContext({auth: {oauth}})).dispatcher;
  assertEqual(wired._oauth, oauth);
  assertEqual(wired._config.oauth, true);
  assert(wired._config.fields.oauthResult, 'oauthResult field');
});

finish();
