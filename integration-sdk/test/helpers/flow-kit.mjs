// Shared helpers for the PLAT-23 OAuth start/finish and websocket transport test scripts.
// Not a test itself (the runner only picks up test/*.test.mjs). Everything here stays on 127.0.0.1; keys are generated
// at run time and credentials are made-up strings.
import crypto from 'node:crypto';
import http from 'node:http';
import util from 'node:util';
import {WebSocketServer} from 'ws';
import JWE from '../../build/internal/util/jwe/index.mjs';
import {Config} from '../../build/internal/websocket/config.mjs';

const colors = {green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', reset: '\x1b[0m', cyan: '\x1b[36m'};

// The old check failed a test that took over 2000 ms of wall clock (PLAT-401). Measured with 4 parallel loops of a file
// on a machine that other runs share (load average 12-23 on 4 cores): the OAuth tests took up to 14 s and the
// 100 MiB frame test up to 45 s, while alone they take ~0.1 s and ~1 s. Most of it was CPU wait (RSA key generation
// once per test, now once per process; fixed 15 ms sleeps in the websocket file). What is left is the machine, so the
// limit is a hang guard with headroom over the measured worst case (3x), on the monotonic clock. A test that is expected
// to be slower says so with {limitMs}. It no longer notices a test that waits for real for a few seconds.
const DEFAULT_LIMIT_MS = 45000;

export const suite = (title) => {
  let passed = 0;
  let failed = 0;
  return {
    async test(name, fn, {limitMs = DEFAULT_LIMIT_MS} = {}) {
      const started = performance.now();
      try {
        console.log(`${colors.cyan}Running: ${name}${colors.reset}`);
        await fn();
        const took = Math.round(performance.now() - started);
        if (took > limitMs) throw new Error(`took ${took} ms, the limit is ${limitMs} ms`);
        console.log(`${colors.green}✓ PASS: ${name}${colors.reset}\n`);
        passed++;
      } catch (error) {
        console.log(`${colors.red}✗ FAIL: ${name}${colors.reset}`);
        console.log(`${colors.red}  Error: ${error.message}${colors.reset}\n`);
        failed++;
      }
    },
    finish() {
      console.log(`\n${colors.yellow}--- ${title} results ---${colors.reset}`);
      console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
      console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
      process.exit(failed > 0 ? 1 : 0);
    },
  };
};

export const assert = (condition, message) => {
  if (!condition) throw new Error(message || 'Assertion failed');
};

export const assertEqual = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message || 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

/** run a promise to its end: {value} or {error} (never throws) */
export const outcome = async (promise) => {
  try {
    return {value: await promise};
  } catch (error) {
    return {error};
  }
};

/** capture everything written with console.log/error/warn/dir while fn runs; returns {result, lines} */
export const captureLog = async (fn) => {
  const lines = [];
  const saved = {log: console.log, error: console.error, warn: console.warn, dir: console.dir};
  const push = (...args) => lines.push(args.map((a) => (typeof a === 'string' ? a : util.inspect(a, {depth: 6}))).join(' '));
  console.log = console.error = console.warn = push;
  console.dir = (a) => push(a);
  try {
    return {result: await fn(), lines};
  } finally {
    Object.assign(console, saved);
  }
};

/** run fn while its lines are captured and an error is allowed; returns {error, lines} */
export const captureFailure = async (fn) => {
  let error;
  const {lines} = await captureLog(async () => {
    try {
      await fn();
    } catch (e) {
      error = e;
    }
  });
  return {error, lines};
};

/** a local HTTP server; handler(req, res, body) answers; every request is recorded in .requests */
export const vendor = async (handler) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const entry = {method: req.method, url: req.url, headers: req.headers, body, form: new URLSearchParams(body)};
      requests.push(entry);
      handler(req, res, entry);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    requests,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve))),
  };
};

export const json = (res, status, body) => {
  res.writeHead(status, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(body));
};

const b64 = (s) => Buffer.from(s).toString('base64');

// RSA key generation is CPU-bound and took seconds per test when other runs shared the machine (PLAT-401), so the pair
// is generated once per test process (each test file is its own process) and every Config of the file holds that pair.
let sharedPair;
const keyPair = () => {
  sharedPair ??= (async () => {
    const jwe = new JWE({algorithm: 'RSA-OAEP-256'});
    await jwe.newPair();
    return jwe.exportPair();
  })();
  return sharedPair;
};

/** a Config holding a key pair generated at run time (once per process); ids and tokens are made up */
export const newConfig = async (id = 'connector-1', wsEndpoint = 'ws://127.0.0.1:1') => {
  const pair = await keyPair();

  return new Config({
    registrationToken: 'test-registration',
    version: '1.0.0',
    name: 'test',
    id,
    endpoint: 'http://127.0.0.1:1',
    wsEndpoint,
    privateKey: b64(pair.privateKey),
    publicKey: b64(pair.publicKey),
    configSchema: () => ({fields: {}}),
  });
};

/** the environment variables that change the OAuth behaviour are cleared for the test and put back afterwards */
export const withEnv = async (vars, fn) => {
  const names = ['OAUTH_AUTHORIZATION_URL', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'OAUTH_SCOPE', 'OAUTH_TOKEN_URL'];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  names.forEach((n) => delete process.env[n]);
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    names.forEach((n) => (saved[n] === undefined ? delete process.env[n] : (process.env[n] = saved[n])));
  }
};

/**
 * Fake waits: setTimeout calls with the given delays are recorded and run at once (after 0 ms); every other timer is
 * left alone. `fire(ms)` is not needed because nothing here waits for real.
 */
export const fakeTimers = (delays = [5000]) => {
  const real = globalThis.setTimeout;
  const seen = [];

  globalThis.setTimeout = (fn, ms, ...rest) => {
    if (!delays.includes(ms)) return real(fn, ms, ...rest);
    seen.push(ms);
    return real(fn, 0, ...rest);
  };

  return {seen, restore: () => (globalThis.setTimeout = real)};
};

/** a local websocket server; every frame it receives is recorded in .received (parsed JSON), sockets in .sockets */
export const wsServer = async (onConnection) => {
  const wss = new WebSocketServer({host: '127.0.0.1', port: 0});
  await new Promise((resolve) => wss.on('listening', resolve));
  const received = [];
  const sockets = [];
  const waiters = [];

  const notify = () => waiters.splice(0).forEach((w) => w());
  wss.on('connection', (socket, req) => {
    sockets.push(socket);
    socket.upgradeReq = req;
    socket.on('message', (m) => {
      received.push(JSON.parse(String(m)));
      notify();
    });
    socket.on('close', notify);
    notify();
    onConnection?.(socket, req);
  });

  // `within`: how long a hang may last before the wait gives up (the wait itself ends when the condition holds)
  const until = async (predicate, what = 'condition', within = 30000) => {
    const deadline = performance.now() + within;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 20);
      });
    }
  };

  return {
    url: `ws://127.0.0.1:${wss.address().port}`,
    received,
    sockets,
    until,
    close: () =>
      new Promise((resolve) => {
        wss.clients.forEach((c) => c.terminate());
        wss.close(resolve);
      }),
  };
};

export const randomId = () => crypto.randomUUID();

/**
 * Held waits: setTimeout calls with the given delay are recorded and NOT run; `fire()` runs them (once) on demand.
 * Every other timer is left alone.
 */
export const heldTimers = (delay) => {
  const real = globalThis.setTimeout;
  const held = [];

  globalThis.setTimeout = (fn, ms, ...rest) => {
    if (ms !== delay) return real(fn, ms, ...rest);
    held.push(fn);
    return {unref() {}, ref() {}};
  };

  return {
    held,
    fire: () => held.splice(0).forEach((fn) => fn()),
    restore: () => (globalThis.setTimeout = real),
  };
};
