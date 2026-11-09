// PLAT-21: the connector start-up path: environment variables to Config (connector/config.mts), Connector.run()
// (connector/index.mts), the signal handlers and shutdown of makeServer (connector/server/index.mts) and
// RuntimeContext.start() (builder/runtime-context.mts). Standalone script (no mocha), no network, nothing listens.
// Fakes: process.on / process.exit, the 2 min / 10 s / 30 s timers, the websocket connector (prototype methods) and the
// metrics listener. Keys are generated here at run time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import PromClient from 'prom-client';
import {AbstractController} from '../build/controller/index.mjs';
import RuntimeContext from '../build/builder/runtime-context.mjs';
import {makeConfig} from '../build/internal/connector/config.mjs';
import {Connector} from '../build/internal/connector/index.mjs';
import {makeMetrics} from '../build/internal/connector/metrics.mjs';
import {makeServer} from '../build/internal/connector/server/index.mjs';
import Dispatcher from '../build/internal/dispatcher/index.mjs';
import JWE from '../build/internal/util/jwe/index.mjs';
import {Config} from '../build/internal/websocket/config.mjs';
import {WebsocketConnector} from '../build/internal/websocket/index.mjs';
import {assert, assertEqual, captureLog, outcome, suite} from './helpers/flow-kit.mjs';

const {test, finish} = suite('connector start-up');

const ENV_NAMES = [
  'HOSTNAME',
  'REGISTRATION_TOKEN',
  'DEVICE_ENDPOINT',
  'WEBSOCKET_ENDPOINT',
  'PRIVATE_KEY',
  'PUBLIC_KEY',
];

const pair = new JWE({algorithm: 'RSA-OAEP-256'});
await pair.newPair();
const PRIVATE_KEY = await pair.exportPrivateAsBase64();
const PUBLIC_KEY = await pair.exportPublicAsBase64();

const UNUSABLE = 'not-a-key';

const FULL_ENV = {
  HOSTNAME: 'host-9',
  REGISTRATION_TOKEN: 'reg-token-1',
  DEVICE_ENDPOINT: 'https://device.example.test/',
  WEBSOCKET_ENDPOINT: 'wss://ws.example.test/transport/',
  PRIVATE_KEY,
  PUBLIC_KEY,
};

const withEnv = async (vars, fn) => {
  const saved = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  ENV_NAMES.forEach((n) => delete process.env[n]);
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    ENV_NAMES.forEach((n) => (saved[n] === undefined ? delete process.env[n] : (process.env[n] = saved[n])));
  }
};

/**
 * Installs the fakes and hands back what they saw. `events` is one ordered list across all of them.
 *  - process.on records [event, handler]; process.exit records the code and does not exit
 *  - setTimeout with 120000 (key wait) or 10000 (leave wait) is recorded and runs after 0 ms; setInterval with 30000 is
 *    recorded and returns a token; clearInterval records the tokens it is given. Everything else is left alone.
 *  - WebsocketConnector start / leaving / close are replaced; the metrics server listen is replaced
 */
const rig = async (fn) => {
  const events = [];
  const handlers = [];
  const waits = [];
  const intervals = [];
  const cleared = [];
  const exits = [];
  const real = {
    on: process.on,
    exit: process.exit,
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    start: WebsocketConnector.prototype.start,
    leaving: WebsocketConnector.prototype.leaving,
    close: WebsocketConnector.prototype.close,
    listen: express.application.listen,
  };
  const state = {leavingFails: false};

  process.on = (event, handler) => {
    handlers.push([event, handler]);
    events.push(`on ${event}`);
    return process;
  };
  process.exit = (code) => {
    exits.push(code);
    events.push(`exit ${code}`);
  };
  globalThis.setTimeout = (callback, ms, ...rest) => {
    if (ms !== 120000 && ms !== 10000) return real.setTimeout(callback, ms, ...rest);
    waits.push(ms);
    events.push(`wait ${ms}`);
    return real.setTimeout(callback, 0, ...rest);
  };
  globalThis.setInterval = (callback, ms, ...rest) => {
    if (ms !== 30000) return real.setInterval(callback, ms, ...rest);
    const token = {
      ms,
      callback,
      unref() {
        this.unrefd = true;
        return this;
      },
    };
    intervals.push(token);
    events.push(`interval ${ms}`);
    return token;
  };
  globalThis.clearInterval = (token) => {
    if (!token || !token.callback) return real.clearInterval(token);
    cleared.push(token);
    events.push('clearInterval');
  };
  WebsocketConnector.prototype.start = async function () {
    events.push('server.start');
    this.started = true;
  };
  WebsocketConnector.prototype.leaving = async function () {
    events.push('server.leaving');
    if (state.leavingFails) throw new Error('leave failed');
    await null;
    events.push('server.left');
  };
  WebsocketConnector.prototype.close = async function () {
    events.push('server.close');
  };
  express.application.listen = function (port, host) {
    events.push(`metrics.listen ${host}:${port}`);
    return {};
  };
  PromClient.register.clear();

  try {
    return await fn({events, handlers, waits, intervals, cleared, exits, state});
  } finally {
    Object.assign(process, {on: real.on, exit: real.exit});
    Object.assign(globalThis, {
      setTimeout: real.setTimeout,
      setInterval: real.setInterval,
      clearInterval: real.clearInterval,
    });
    Object.assign(WebsocketConnector.prototype, {start: real.start, leaving: real.leaving, close: real.close});
    express.application.listen = real.listen;
    PromClient.register.clear();
  }
};

const handlersFor = (r, event) => r.handlers.filter(([name]) => name === event).map(([, fn]) => fn);
const tick = () => new Promise((resolve) => setImmediate(resolve));

const make = (over = {}) =>
  makeConfig({
    id: 'conn-1',
    version: '2.3.4',
    name: 'conn-1/2.3.4',
    introspect: () => ({introspected: true}),
    configSchema: () => ({fields: {}}),
    icon: 'icon-data',
    ...over,
  });

const withFields = () => ({fields: {apiKey: {name: 'API key'}}});

// ---------------------------------------------------------------------------------------------------------------------
// environment variables to Config

await test('config: every variable is mapped to its setting and the connector details are taken from the arguments', async () => {
  await rig(async () => {
    const config = await withEnv(FULL_ENV, () => make());
    assertEqual(config.registrationToken(), 'reg-token-1', 'registration token');
    assertEqual(config.url(), 'https://device.example.test/', 'device endpoint');
    assertEqual(config.wsUrl(), 'wss://ws.example.test/transport/', 'websocket endpoint');
    assertEqual(config.name(), 'host-9', 'name is the host name');
    assertEqual(config.publicKey(), PUBLIC_KEY, 'public key');
    assertEqual([config.id(), config.version(), config.icon()], ['conn-1', '2.3.4', 'icon-data'], 'id, version, icon');
    assertEqual(config.introspect(), {introspected: true}, 'introspect is passed through');
    assertEqual(config.configSchema(), {fields: {}}, 'config schema is passed through');
    assertEqual(config.token(), null, 'no token before the handshake');
    await config.validateKeys('RSA-OAEP-256');
  });
});

await test('config: without DEVICE_ENDPOINT, WEBSOCKET_ENDPOINT and HOSTNAME the defaults apply', async () => {
  await rig(async () => {
    const config = await withEnv({REGISTRATION_TOKEN: 'reg-token-1'}, () => make());
    assertEqual(config.url(), 'https://connect.aloma.io/', 'default device endpoint');
    assertEqual(config.wsUrl(), 'wss://connect.aloma.io/transport/', 'default websocket endpoint');
    assertEqual(config.name(), 'conn-1/2.3.4', 'name falls back to the connector name');
  });
});

await test('config: empty values of the optional variables count as unset', async () => {
  await rig(async () => {
    const config = await withEnv(
      {REGISTRATION_TOKEN: 'reg-token-1', HOSTNAME: '', DEVICE_ENDPOINT: '', WEBSOCKET_ENDPOINT: ''},
      () => make()
    );
    assertEqual(
      [config.name(), config.url(), config.wsUrl()],
      ['conn-1/2.3.4', 'https://connect.aloma.io/', 'wss://connect.aloma.io/transport/'],
      'defaults'
    );
  });
});

await test('config: a connector without config fields starts without keys and prints nothing', async () => {
  await rig(async (r) => {
    const {result, lines} = await captureLog(() => withEnv({REGISTRATION_TOKEN: 'reg-token-1'}, () => make()));
    assertEqual(lines, [], 'no output');
    assertEqual(r.waits, [], 'no wait');
    assertEqual(result.publicKey(), undefined, 'no public key');
  });
});

await test('config: a connector with config fields and a valid key pair starts without output or wait', async () => {
  await rig(async (r) => {
    const {result, lines} = await captureLog(() => withEnv(FULL_ENV, () => make({configSchema: withFields})));
    assertEqual(lines, [], 'no output');
    assertEqual(r.waits, [], 'no wait');
    assertEqual(result.registrationToken(), 'reg-token-1', 'config returned');
  });
});

await test('config: a missing REGISTRATION_TOKEN is refused with an error that names it and carries no key material', async () => {
  await rig(async () => {
    const {PRIVATE_KEY: priv, PUBLIC_KEY: pub, ...rest} = FULL_ENV;
    for (const env of [
      {...rest, REGISTRATION_TOKEN: undefined, PRIVATE_KEY: priv, PUBLIC_KEY: pub},
      {...rest, REGISTRATION_TOKEN: '', PRIVATE_KEY: priv, PUBLIC_KEY: pub},
    ]) {
      const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));
      const r = await outcome(withEnv(cleaned, () => make()));
      assertEqual(r.error.message, 'empty registration token (set env.REGISTRATION_TOKEN)', 'message');
      assert(!r.error.message.includes(priv) && !r.error.message.includes(pub), 'no key in the message');
      assert(!/BEGIN|PRIVATE/.test(r.error.message), 'no key marker in the message');
    }
  });
});

await test('config: without keys a connector with config fields prints the variable names, waits two minutes and fails with "could not start"', async () => {
  await rig(async (r) => {
    const {result, lines} = await captureLog(() =>
      outcome(withEnv({REGISTRATION_TOKEN: 'reg-token-1'}, () => make({configSchema: withFields})))
    );
    assertEqual(r.waits, [120000], 'waited two minutes before failing');
    assertEqual(result.error.message, 'could not start', 'error message');
    const text = lines.join('\n');
    assert(text.includes('PRIVATE_KEY') && text.includes('PUBLIC_KEY'), 'both variable names are printed');
    assert(!result.error.message.includes('KEY'), 'the error message names no variable and holds no key text');
  });
});

await test('config: an unusable key pair that is set is not echoed, the hint says to check the variables, then it fails after two minutes', async () => {
  await rig(async (r) => {
    for (const env of [{PRIVATE_KEY, PUBLIC_KEY: UNUSABLE}, {PRIVATE_KEY: UNUSABLE, PUBLIC_KEY}, {PRIVATE_KEY}]) {
      r.waits.length = 0;
      const {result, lines} = await captureLog(() =>
        outcome(withEnv({REGISTRATION_TOKEN: 'reg-token-1', ...env}, () => make({configSchema: withFields})))
      );
      const text = lines.join('\n');
      assert(text.includes('Please double check the env variables'), 'hint printed');
      assert(!text.includes('fresh keys generated'), 'no new keys are offered when a private key is set');
      for (const value of Object.values(env))
        assert(!text.includes(value), 'a value from the environment is not printed');
      assertEqual(r.waits, [120000], 'two minute wait');
      assertEqual(result.error.message, 'could not start', 'error message');
    }
  });
});

await test('config: the settings object refuses missing registration token, endpoint, websocket endpoint, id and version', async () => {
  const base = {registrationToken: 't', version: '1', name: 'n', id: 'i', endpoint: 'e', wsEndpoint: 'w'};
  const message = (over) => {
    try {
      new Config({...base, ...over});
    } catch (e) {
      return e.message;
    }
    return null;
  };
  assertEqual(message({}), null, 'complete settings are accepted');
  assertEqual(
    message({registrationToken: ''}),
    'empty registration token (set env.REGISTRATION_TOKEN)',
    'registration token'
  );
  assertEqual(message({endpoint: ''}), 'empty endpoint (set env.DEVICE_ENDPOINT)', 'endpoint');
  // message text as it is today: the websocket check reuses the registration token wording
  assertEqual(message({wsEndpoint: ''}), 'empty registration token (set env.WEBSOCKET_ENDPOINT)', 'websocket endpoint');
  assertEqual(message({id: ''}), 'need connector id and version', 'id');
  assertEqual(message({version: undefined}), 'need connector id and version', 'version');
});

await test('config: the token check comes first, then endpoint, websocket endpoint, then id and version', async () => {
  const message = (over) => {
    try {
      new Config({registrationToken: 't', version: '1', name: 'n', id: 'i', endpoint: 'e', wsEndpoint: 'w', ...over});
    } catch (e) {
      return e.message;
    }
  };
  assert(
    message({registrationToken: '', endpoint: '', wsEndpoint: '', id: ''}).includes('REGISTRATION_TOKEN'),
    'token first'
  );
  assert(message({endpoint: '', wsEndpoint: '', id: ''}).includes('DEVICE_ENDPOINT'), 'endpoint second');
  assert(message({wsEndpoint: '', id: ''}).includes('WEBSOCKET_ENDPOINT'), 'websocket endpoint third');
});

// ---------------------------------------------------------------------------------------------------------------------
// metrics

await test('metrics: default labels carry the connector details and the host name, "test" when there is none', async () => {
  await rig(async (r) => {
    await withEnv({HOSTNAME: 'host-9'}, () => makeMetrics({id: 'c1', name: 'c1/1.0.0', version: '1.0.0'}));
    let text = await PromClient.register.metrics();
    for (const label of ['service="c1/1.0.0"', 'connectorId="c1"', 'connectorVersion="1.0.0"', 'node="host-9"'])
      assert(text.includes(label), `label ${label}`);
    assertEqual(r.events, ['metrics.listen 0.0.0.0:4050'], 'metrics endpoint on port 4050');
    PromClient.register.clear();
    await withEnv({}, () => makeMetrics({id: 'c1', name: 'c1/1.0.0', version: '1.0.0'}));
    text = await PromClient.register.metrics();
    assert(text.includes('node="test"'), 'node falls back to test');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Connector

const newConnector = () => {
  const connector = new Connector({version: '1.0.0', id: 'c1', name: 'c1/1.0.0', icon: 'ic'});
  connector.configure().types({}).resolvers({});
  return connector;
};

await test('connector: constructor keeps its details and configure() returns a fresh dispatcher each time', () => {
  const connector = new Connector({version: '1.0.0', id: 'c1', name: 'c1/1.0.0', icon: 'ic'});
  assertEqual(
    [connector.id, connector.version, connector.name, connector.icon],
    ['c1', '1.0.0', 'c1/1.0.0', 'ic'],
    'details'
  );
  const first = connector.configure();
  assert(first instanceof Dispatcher && connector.dispatcher === first, 'dispatcher stored');
  assert(connector.configure() !== first, 'a second configure() gives a new dispatcher');
});

await test('connector: run() announces itself, then sets up the metrics endpoint, then starts the websocket connector', async () => {
  await rig(async (r) => {
    const {lines} = await captureLog(() => withEnv(FULL_ENV, () => newConnector().run()));
    assertEqual(lines[0], 'Running c1/1.0.0', 'first output line');
    assertEqual(
      r.events,
      [
        'metrics.listen 0.0.0.0:4050',
        'on uncaughtException',
        'on unhandledRejection',
        'on SIGTERM',
        'on SIGINT',
        'server.start',
      ],
      'order'
    );
  });
});

await test('connector: run() fails on a missing registration token before any metrics endpoint or server is set up', async () => {
  await rig(async (r) => {
    const {result} = await captureLog(() => outcome(withEnv({PRIVATE_KEY, PUBLIC_KEY}, () => newConnector().run())));
    assertEqual(result.error.message, 'empty registration token (set env.REGISTRATION_TOKEN)', 'message');
    assertEqual(r.events, [], 'nothing was set up');
  });
});

await test('connector: run() on a dispatcher without types and resolvers fails before reading the environment', async () => {
  await rig(async (r) => {
    const connector = new Connector({version: '1.0.0', id: 'c1', name: 'c1/1.0.0'});
    connector.configure();
    const {result} = await captureLog(() => outcome(withEnv({}, () => connector.run())));
    assertEqual(result.error.message, 'missing types or resolvers', 'message');
    assertEqual(r.events, [], 'nothing was set up');
  });
});

await test('connector: the websocket connector gets the configuration built from the environment', async () => {
  await rig(async () => {
    let seen;
    const real = WebsocketConnector.prototype.start;
    WebsocketConnector.prototype.start = async function () {
      seen = this.config;
    };
    try {
      await captureLog(() => withEnv(FULL_ENV, () => newConnector().run()));
    } finally {
      WebsocketConnector.prototype.start = real;
    }
    assertEqual(
      [seen.id(), seen.version(), seen.name(), seen.wsUrl(), seen.registrationToken(), seen.icon()],
      ['c1', '1.0.0', 'host-9', 'wss://ws.example.test/transport/', 'reg-token-1', 'ic'],
      'config values'
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// makeServer: signal handlers and shutdown

const serverFor = (dispatcher = new Dispatcher().types({}).resolvers({})) =>
  makeServer({
    config: new Config({
      registrationToken: 't',
      version: '1',
      name: 'n',
      id: 'i',
      endpoint: 'http://127.0.0.1:1/',
      wsEndpoint: 'ws://127.0.0.1:1/',
    }),
    configSchema: () => ({fields: {}}),
    start: () => {},
    processPacket: () => {},
    dispatcher,
  });

await test('server: makeServer registers handlers for uncaughtException, unhandledRejection, SIGTERM and SIGINT, in that order, and does not start', async () => {
  await rig(async (r) => {
    const server = await serverFor();
    assert(server instanceof WebsocketConnector, 'returns the websocket connector');
    assertEqual(
      r.events,
      ['on uncaughtException', 'on unhandledRejection', 'on SIGTERM', 'on SIGINT'],
      'registration order'
    );
    assert(handlersFor(r, 'SIGTERM')[0] === handlersFor(r, 'SIGINT')[0], 'one shutdown function for both signals');
    assert(!server.started, 'not started by makeServer');
  });
});

await test('server: an uncaught exception and an unhandled rejection are logged and the process keeps running', async () => {
  await rig(async (r) => {
    await serverFor();
    const boom = new Error('boom');
    const {lines} = await captureLog(async () => {
      handlersFor(r, 'uncaughtException')[0](boom);
      handlersFor(r, 'unhandledRejection')[0]('rejected');
    });
    assertEqual(lines.length, 2, 'two lines');
    assert(lines[0].includes('boom') && lines[1].includes('rejected'), 'both are shown');
    assertEqual(r.exits, [], 'no exit');
    assert(!r.events.some((e) => e.startsWith('server.')), 'the server is left alone');
  });
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  await test(`server: ${signal} makes the server leave, waits ten seconds, closes it and then exits with 0`, async () => {
    await rig(async (r) => {
      await serverFor();
      r.events.length = 0;
      await handlersFor(r, signal)[0]();
      assertEqual(
        r.events,
        ['server.leaving', 'server.left', 'wait 10000', 'server.close', 'exit 0'],
        'shutdown order'
      );
      assertEqual(r.exits, [0], 'exit code');
    });
  });
}

await test('server: the close step does not run before the ten second wait has passed', async () => {
  await rig(async (r) => {
    await serverFor();
    r.events.length = 0;
    const real = globalThis.setTimeout;
    let release;
    globalThis.setTimeout = (callback, ms) => {
      if (ms !== 10000) return real(callback, ms);
      r.events.push('wait 10000');
      release = callback;
      return 0;
    };
    const done = handlersFor(r, 'SIGTERM')[0]();
    await tick();
    globalThis.setTimeout = real;
    assertEqual(r.events, ['server.leaving', 'server.left', 'wait 10000'], 'still waiting');
    assertEqual(r.exits, [], 'not exited yet');
    release();
    await done;
    assertEqual(r.events.slice(3), ['server.close', 'exit 0'], 'close, exit after the wait');
  });
});

await test('server: when leaving fails the shutdown stops there, with no close and no exit', async () => {
  await rig(async (r) => {
    r.state.leavingFails = true;
    await serverFor();
    r.events.length = 0;
    const result = await outcome(handlersFor(r, 'SIGTERM')[0]());
    assertEqual(result.error.message, 'leave failed', 'the failure reaches the caller');
    assertEqual(r.events, ['server.leaving'], 'nothing after leaving');
    assertEqual(r.exits, [], 'no exit');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// RuntimeContext.start()

class Controller extends AbstractController {
  constructor(events) {
    super();
    this.events = events;
  }
  async start() {
    this.events.push('controller.start');
  }
  async stop(isShutdown) {
    this.events.push(`controller.stop ${isShutdown}`);
  }
}

/** RuntimeContext.start() with Connector.run replaced: returns the connector that was built and what run was called with */
const started = async (r, data = {}, controller = new Controller(r.events)) => {
  const real = Connector.prototype.run;
  const built = [];
  Connector.prototype.run = function () {
    built.push(this);
    r.events.push('connector.run');
    return Promise.resolve();
  };
  try {
    await new RuntimeContext(controller, {id: 'c1', version: '1.0.0', methods: ['ping'], types: {}, ...data}).start();
  } finally {
    Connector.prototype.run = real;
  }
  return {connector: built[0], built, controller};
};

const args = (r) => ({
  newTask: () => {},
  updateTask: () => {},
  config: {k: 'v'},
  oauth: {o: 1},
  getClient: () => {},
  getBlob: () => {},
  getBlobContent: () => {},
  createBlob: () => {},
  healthCheck: async (c) => {
    r.events.push('healthCheck');
    r.healthChecked = c;
  },
});

await test('runtime: a controller that does not extend AbstractController is refused before anything is built or registered', async () => {
  await rig(async (r) => {
    const result = await outcome(started(r, {}, {}));
    assertEqual(result.error.message, 'the controller needs to extend AbstractController', 'message');
    assertEqual(r.events, [], 'no run, no handlers');
  });
});

await test('runtime: start() runs the connector once, then registers SIGTERM and SIGINT and nothing else', async () => {
  await rig(async (r) => {
    const {built} = await started(r);
    assertEqual(built.length, 1, 'one connector run');
    assertEqual(r.events, ['connector.run', 'on SIGTERM', 'on SIGINT'], 'order');
    assert(handlersFor(r, 'SIGTERM')[0] === handlersFor(r, 'SIGINT')[0], 'one shutdown function');
  });
});

await test('runtime: the connector is named id/version and gets the id and version from the data', async () => {
  await rig(async (r) => {
    const {connector} = await started(r, {id: 'crm', version: '4.5.6'});
    assertEqual([connector.id, connector.version, connector.name], ['crm', '4.5.6', 'crm/4.5.6'], 'details');
  });
});

await test('runtime: the icon file is read as base64 and an unreadable or missing icon leaves the icon unset', async () => {
  await rig(async (r) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plat21-'));
    try {
      const file = path.join(dir, 'icon.svg');
      fs.writeFileSync(file, '<svg/>');
      assertEqual(
        (await started(r, {icon: file})).connector.icon,
        Buffer.from('<svg/>').toString('base64'),
        'icon read'
      );
      assertEqual(
        (await started(r, {icon: path.join(dir, 'missing.svg')})).connector.icon,
        undefined,
        'unreadable icon'
      );
      assertEqual((await started(r, {})).connector.icon, undefined, 'no icon');
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
});

await test('runtime: the data config, types and endpoint option are applied to the dispatcher', async () => {
  await rig(async (r) => {
    const fields = {apiKey: {name: 'API key'}};
    const withEndpoint = (
      await started(r, {config: {fields}, types: {t: 1}, options: {endpoint: {enabled: true, required: true}}})
    ).connector.dispatcher;
    assertEqual(withEndpoint._config.fields.apiKey, {name: 'API key'}, 'config field');
    assertEqual(withEndpoint._types, {t: 1}, 'types');
    assertEqual(withEndpoint._config.fields._endpointToken.type, 'managed', 'required endpoint token is managed');
    assert(typeof withEndpoint._resolvers._endpoint === 'function', 'endpoint resolver');
    const without = (await started(r, {options: {endpoint: {enabled: false}}})).connector.dispatcher;
    assert(!('_endpointToken' in without._config.fields) && !without._resolvers._endpoint, 'no endpoint when disabled');
  });
});

await test('runtime: an oauth setting in the data is applied to the dispatcher and none leaves it unset', async () => {
  await rig(async (r) => {
    const oauth = {authorizationURL: 'https://auth.example.test/', tokenURL: 'https://token.example.test/'};
    const withOauth = (await started(r, {auth: {oauth}})).connector.dispatcher;
    assertEqual(withOauth._oauth, oauth, 'oauth settings');
    assert('oauthResult' in withOauth._config.fields, 'oauth result field');
    assertEqual((await started(r, {})).connector.dispatcher._oauth, undefined, 'no oauth');
  });
});

await test('runtime: the methods and the three built-in handlers are resolvable and call the controller', async () => {
  await rig(async (r) => {
    const calls = [];
    class Calls extends Controller {
      async ping(a) {
        calls.push(['ping', a]);
        return 'pong';
      }
      async __autocomplete(a) {
        calls.push(['auto', a]);
        return 'a';
      }
      async __default(a) {
        calls.push(['default', a]);
        return 'd';
      }
    }
    const {connector} = await started(r, {}, new Calls(r.events));
    const {execute} = connector.dispatcher.build();
    assertEqual(await execute({query: ['ping'], variables: {x: 1}}), 'pong', 'method');
    assertEqual(await execute({query: ['__autocomplete'], variables: {y: 2}}), 'a', 'autocomplete');
    assertEqual(await execute({query: ['unknown'], variables: {z: 3}}), 'd', 'default for unknown');
    assertEqual(
      calls.map((c) => c[0]),
      ['ping', 'auto', 'default'],
      'controller calls'
    );
  });
});

await test('runtime: the main function stops the controller, starts it with the platform arguments, schedules a 30 s health check and checks once', async () => {
  await rig(async (r) => {
    const {connector, controller} = await started(r);
    r.events.length = 0;
    const a = args(r);
    await connector.dispatcher._main(a);
    assertEqual(r.events, ['controller.stop false', 'controller.start', 'interval 30000', 'healthCheck'], 'order');
    assertEqual(
      [
        controller.config,
        controller.oauth,
        controller.newTask === a.newTask,
        controller.getBlob === a.getBlob,
        controller.createBlob === a.createBlob,
      ],
      [{k: 'v'}, {o: 1}, true, true, true],
      'start arguments'
    );
    assert(r.intervals[0].unrefd, 'the health interval does not keep the process alive');
    assert(r.healthChecked === controller, 'health check gets the controller');
    r.intervals[0].callback();
    assertEqual(r.events.slice(-1), ['healthCheck'], 'the interval calls the health check');
  });
});

await test('runtime: a second main call clears the earlier health interval before stopping and starting again', async () => {
  await rig(async (r) => {
    const {connector} = await started(r);
    const a = args(r);
    await connector.dispatcher._main(a);
    r.events.length = 0;
    await connector.dispatcher._main(a);
    assertEqual(r.events.slice(0, 3), ['clearInterval', 'controller.stop false', 'controller.start'], 'order');
    assert(r.cleared[0] === r.intervals[0], 'the earlier interval was cleared');
    assertEqual(r.intervals.length, 2, 'a new interval');
  });
});

await test('runtime: a failing controller start is logged, schedules no health check and does not reject', async () => {
  await rig(async (r) => {
    class Failing extends Controller {
      async start() {
        throw new Error('start failed');
      }
    }
    const {connector} = await started(r, {}, new Failing(r.events));
    r.events.length = 0;
    const {result, lines} = await captureLog(() => outcome(connector.dispatcher._main(args(r))));
    assertEqual(result.error, undefined, 'no rejection');
    assert(lines.join('\n').includes('start failed'), 'logged');
    assertEqual(r.intervals.length, 0, 'no health interval');
    assert(!r.events.includes('healthCheck'), 'no health check');
  });
});

await test('runtime: SIGTERM clears the health interval, stops the controller as a shutdown, then exits with 0', async () => {
  await rig(async (r) => {
    const {connector} = await started(r);
    await connector.dispatcher._main(args(r));
    r.events.length = 0;
    await handlersFor(r, 'SIGTERM')[0]();
    assertEqual(r.events, ['clearInterval', 'controller.stop true', 'exit 0'], 'order');
    assert(r.cleared[0] === r.intervals[0], 'health interval cleared');
    assertEqual(r.exits, [0], 'exit code');
  });
});

await test('runtime: SIGINT before the first main call stops the controller as a shutdown and exits with 0', async () => {
  await rig(async (r) => {
    await started(r);
    r.events.length = 0;
    await handlersFor(r, 'SIGINT')[0]();
    assertEqual(r.events, ['controller.stop true', 'exit 0'], 'order');
    assertEqual(r.exits, [0], 'exit code');
  });
});

await test('runtime: a connector started through the runtime context has two SIGTERM handlers, the runtime context one first, and the process exits before the server closes', async () => {
  await rig(async (r) => {
    await captureLog(() =>
      withEnv(FULL_ENV, async () => {
        await new RuntimeContext(new Controller(r.events), {
          id: 'c1',
          version: '1.0.0',
          methods: [],
          types: {},
        }).start();
        for (let i = 0; i < 50 && !r.events.includes('server.start'); i++) await tick();
      })
    );
    assertEqual(r.events.filter((e) => e === 'on SIGTERM').length, 2, 'two SIGTERM handlers');
    assertEqual(r.events.filter((e) => e === 'on SIGINT').length, 2, 'two SIGINT handlers');
    r.events.length = 0;
    // process.emit calls the handlers one after the other without waiting for the earlier one
    await Promise.all(handlersFor(r, 'SIGTERM').map((fn) => fn()));
    assertEqual(
      r.events.slice(0, 2),
      ['controller.stop true', 'server.leaving'],
      'both handlers start, the runtime context one first'
    );
    assert(
      r.events.indexOf('exit 0') < r.events.indexOf('server.close'),
      'the first exit comes before the server close'
    );
  });
});

finish();
