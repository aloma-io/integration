// Shared helpers for the PLAT-23 standalone test scripts (fetcher, OAuth fetcher, JWE config).
// Not a test itself (the runner only picks up test/*.test.mjs). Everything here stays on 127.0.0.1.
import http from 'node:http';

const colors = {green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', reset: '\x1b[0m', cyan: '\x1b[36m'};

export const suite = (title) => {
  let passed = 0;
  let failed = 0;
  return {
    async test(name, fn) {
      try {
        console.log(`${colors.cyan}Running: ${name}${colors.reset}`);
        await fn();
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

/**
 * Fake back-off timers: the fetchers wait 500 ms (retry) or 10 s (429) with setTimeout. Those two delays are recorded
 * and fire at once; every other timer is left alone. After `limit` back-offs the fake throws RUNAWAY, which rejects
 * the fetch, so a retry loop without a cap ends the test instead of hanging it.
 */
export const fakeTimers = ({limit = 40} = {}) => {
  const real = globalThis.setTimeout;
  const delays = [];

  globalThis.setTimeout = (fn, ms, ...rest) => {
    if (ms !== 500 && ms !== 10000) return real(fn, ms, ...rest);
    delays.push(ms);
    if (delays.length > limit) throw new Error(`RUNAWAY: more than ${limit} back-offs`);
    return real(fn, 0, ...rest);
  };

  return {delays, restore: () => (globalThis.setTimeout = real)};
};

/** run a promise to its outcome: {value} or {error} */
export const outcome = (promise) =>
  promise.then(
    (value) => ({value}),
    (error) => ({error})
  );

/** capture console.log and console.dir lines while fn runs */
export const captureLog = async (fn) => {
  const lines = [];
  const {log, dir} = console;
  const text = (args) =>
    args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? `${a.stack || a.message}` : JSON.stringify(a)))
      .join(' ');
  console.log = (...args) => lines.push(text(args));
  console.dir = (...args) => lines.push(text(args));
  try {
    return {result: await fn(), lines};
  } finally {
    console.log = log;
    console.dir = dir;
  }
};

/**
 * local vendor mock on 127.0.0.1. `handler(req, res, info)` answers; info = {n, method, url, headers, body}.
 * Every request is recorded in `requests`.
 */
export const vendor = async (handler) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const info = {
        n: requests.length + 1,
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      };
      requests.push(info);
      handler(req, res, info);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();

  return {
    requests,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
};

export const json = (res, status, body, headers = {}) => {
  res.writeHead(status, {'content-type': 'application/json', ...headers});
  res.end(JSON.stringify(body));
};

/** a 127.0.0.1 port that nothing listens on */
export const closedPort = async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
};
