// Rate-limit (429) retries are capped. All responses come from a local stub; no network.
import {assertNoNetwork, withFetch} from './support/offline.mjs';
import Fetcher from '../build/internal/fetcher/fetcher.mjs';
import {OAuth} from '../build/internal/fetcher/oauth-fetcher.mjs';

const colors = {green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', reset: '\x1b[0m', cyan: '\x1b[36m'};
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    console.log(`${colors.cyan}Running: ${name}${colors.reset}`);
    await fn();
    assertNoNetwork();
    console.log(`${colors.green}✓ PASS: ${name}${colors.reset}\n`);
    passed++;
  } catch (error) {
    console.log(`${colors.red}✗ FAIL: ${name}${colors.reset}`);
    console.log(`${colors.red}  Error: ${error.message}${colors.reset}\n`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

const tooMany = (headers = {}) => new Response('slow down', {status: 429, headers});

// Waits are recorded, not slept, so the test is instant. Each wait still yields to the timer queue, so
// the bounded() guard below can stop a retry loop that never ends.
function instant(client, waits) {
  client.wait = (ms) => {
    waits.push(ms);
    return new Promise((resolve) => setImmediate(resolve));
  };
  return client;
}

// Stops a runaway retry loop from hanging the suite.
function bounded(promise, ms = 5000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`still retrying after ${ms} ms`)), ms)),
  ]);
}

for (const [label, make] of [
  ['Fetcher', () => new Fetcher({baseUrl: 'https://api.example.test', retry: 3})],
  [
    'OAuth client',
    () => new OAuth({access_token: 't'}, async () => {}, async () => ({})).getClient({baseUrl: 'https://api.example.test', retry: 3}),
  ],
]) {
  await test(`429 is retried a limited number of times, then fails with the 429 (${label})`, async () => {
    let attempts = 0;
    const waits = [];
    const client = instant(make(), waits);
    let error;
    await withFetch(async () => {
      attempts++;
      return tooMany();
    }, async () => {
      try {
        await bounded(client.fetch('/x', {method: 'GET'}));
      } catch (e) {
        error = e;
      }
    });
    assert(error, 'no error after repeated 429s');
    assert(error.status === 429, `expected status 429, got ${error.status} (${error.message})`);
    assert(attempts === 3, `expected 3 attempts (the retry setting, as for other errors), got ${attempts}`);
  });

  await test(`Retry-After is honoured and capped (${label})`, async () => {
    const waits = [];
    const client = instant(make(), waits);
    let n = 0;
    await withFetch(async () => {
      n++;
      if (n === 1) return tooMany({'Retry-After': '2'});
      if (n === 2) return tooMany({'Retry-After': '86400'});
      return new Response('{"ok":true}', {status: 200, headers: {'Content-Type': 'application/json'}});
    }, async () => {
      await bounded(client.fetch('/x', {method: 'GET'}));
    });
    assert(waits[0] === 2000, `first wait ${waits[0]}`);
    assert(waits[1] === 60000, `second wait ${waits[1]} (cap 60000)`);
  });
}

await test('a request that succeeds after a 429 returns its result', async () => {
  const client = instant(new Fetcher({baseUrl: 'https://api.example.test', retry: 3}), []);
  let n = 0;
  const result = await withFetch(async () => {
    n++;
    return n === 1 ? tooMany() : new Response('{"value":1}', {status: 200, headers: {'Content-Type': 'application/json'}});
  }, () => bounded(client.fetch('/x', {method: 'GET'})));
  assert(result.value === 1, JSON.stringify(result));
});

await test('the error log does not print the query string', async () => {
  const client = instant(new Fetcher({baseUrl: 'https://api.example.test', retry: 2}), []);
  const logged = [];
  const original = console.log;
  console.log = (...args) => logged.push(args.map(String).join(' '));
  try {
    await withFetch(async () => new Response('boom', {status: 500}), async () => {
      try {
        await client.fetch('/x?email=someone%40example.test&token=secret', {method: 'GET'});
      } catch {}
    });
  } finally {
    console.log = original;
  }
  const text = logged.join('\n');
  assert(!/someone|secret/.test(text), `query string logged: ${text}`);
});

console.log(`\n${colors.yellow}===== Results =====${colors.reset}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);

if (failed > 0) {
  process.exit(1);
}
