// PLAT-47: the Fetcher sends fetchOptions.params as the query string.
// Standalone script (no mocha). Global fetch is stubbed in this process, except one test that uses a local
// HTTP server on 127.0.0.1. No request leaves the test process.
import http from 'node:http';
import fs from 'node:fs';
import Fetcher from '../build/internal/fetcher/fetcher.mjs';
import {OAuth} from '../build/internal/fetcher/oauth-fetcher.mjs';

const colors = {green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', reset: '\x1b[0m', cyan: '\x1b[36m'};

let passed = 0;
let failed = 0;

async function test(name, fn) {
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
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message || 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const BASE = 'https://api.vendor.example.test';
// Fetcher collapses every run of slashes in baseUrl + url, so the scheme loses one slash (today's behaviour).
const RAW = 'https:/api.vendor.example.test';

// Replace global fetch with a recorder. `replies` is a list of statuses; the last one repeats.
function stubFetch(replies = [200]) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({url, init});
    const status = replies[Math.min(calls.length - 1, replies.length - 1)];
    return new Response(status === 204 ? null : JSON.stringify({ok: status < 400}), {
      status,
      headers: {'content-type': 'application/json'},
    });
  };
  return {calls, restore: () => (globalThis.fetch = realFetch)};
}

async function send(path, options, fetcherOptions = {}, replies) {
  const stub = stubFetch(replies);
  try {
    const fetcher = new Fetcher({baseUrl: BASE, retry: 1, ...fetcherOptions});
    let error;
    try {
      await fetcher.fetch(path, options);
    } catch (e) {
      error = e;
    }
    return {calls: stub.calls, error};
  } finally {
    stub.restore();
  }
}

function initWithoutSignal(init) {
  const {signal, ...rest} = init;
  return rest;
}

// --- Rule 1: params become the query string ---

await test('numbers, strings and booleans are stringified into the query string', async () => {
  const {calls} = await send('/crm/v3/objects/contacts', {
    method: 'GET',
    params: {limit: 10, after: 'abc', archived: false},
  });
  assertEqual(calls.length, 1, 'one request');
  assertEqual(calls[0].url, `${RAW}/crm/v3/objects/contacts?limit=10&after=abc&archived=false`, 'url');
});

await test('query parameters already in the url are kept', async () => {
  const {calls} = await send('/items?foo=1', {method: 'GET', params: {bar: 2}});
  assertEqual(calls[0].url, `${RAW}/items?foo=1&bar=2`, 'url');
});

await test('undefined and null values are skipped', async () => {
  const {calls} = await send('/items', {method: 'GET', params: {a: undefined, b: null, c: 'x', d: 0, e: ''}});
  assertEqual(calls[0].url, `${RAW}/items?c=x&d=0&e=`, 'url');
});

await test('arrays become repeated keys', async () => {
  const {calls} = await send('/crm/v3/objects/contacts', {
    method: 'GET',
    params: {properties: ['firstname', 'lastname'], limit: 1},
  });
  assertEqual(calls[0].url, `${RAW}/crm/v3/objects/contacts?properties=firstname&properties=lastname&limit=1`, 'url');
});

await test('undefined and null array items are skipped, other items stringified', async () => {
  const {calls} = await send('/items', {method: 'GET', params: {ids: [1, undefined, null, true, 'x']}});
  assertEqual(calls[0].url, `${RAW}/items?ids=1&ids=true&ids=x`, 'url');
});

await test('nested objects are refused with a clear error and nothing is sent', async () => {
  const started = Date.now();
  const {calls, error} = await send('/items', {method: 'GET', params: {filter: {a: 1}}}, {retry: 3});
  assert(error, 'fetch must reject');
  assert(/params\.filter/.test(error.message) && /object/.test(error.message), `error message: ${error.message}`);
  assertEqual(calls.length, 0, 'no request sent');
  assert(Date.now() - started < 400, 'refused at once, not retried');
});

await test('objects inside arrays are refused too', async () => {
  const {calls, error} = await send('/items', {method: 'GET', params: {ids: [{a: 1}]}});
  assert(error && /params\.ids/.test(error.message), `error: ${error && error.message}`);
  assertEqual(calls.length, 0, 'no request sent');
});

await test('values are encoded by URLSearchParams and a "//" inside a value is not collapsed', async () => {
  const value = 'a b&c=d/é https://x.test//y';
  const {calls} = await send('/items', {method: 'GET', params: {q: value}});
  assertEqual(calls[0].url, `${RAW}/items?${new URLSearchParams({q: value})}`, 'url');
  assertEqual(new URL(calls[0].url).searchParams.get('q'), value, 'decoded value round-trips');
});

await test('a URLSearchParams instance is sent as it is', async () => {
  const {calls} = await send('/items', {
    method: 'GET',
    params: new URLSearchParams([
      ['a', '1'],
      ['a', '2'],
    ]),
  });
  assertEqual(calls[0].url, `${RAW}/items?a=1&a=2`, 'url');
});

await test('without baseUrl the query is appended to the url as given', async () => {
  const {calls} = await send('https://other.example.test/x', {method: 'GET', params: {a: 1}}, {baseUrl: undefined});
  assertEqual(calls[0].url, 'https://other.example.test/x?a=1', 'url');
});

// --- Rule 2: nothing else changes ---

await test('params is not passed on to global fetch; headers, body and method are unchanged', async () => {
  const options = {method: 'POST', headers: {'X-Custom': '1'}, body: {name: 'n'}};
  const plain = await send('/items', {...options});
  const withParams = await send('/items', {...options, params: {a: 1}});
  assert(!('params' in withParams.calls[0].init), 'params must not reach native fetch');
  assertEqual(initWithoutSignal(withParams.calls[0].init), initWithoutSignal(plain.calls[0].init), 'init');
});

await test('the caller options and params objects are not mutated', async () => {
  const params = {a: 1, list: ['x', 'y'], skip: undefined};
  const options = {method: 'GET', params};
  await send('/items', options);
  assertEqual(Object.keys(options), ['method', 'params'], 'options keys');
  assert(options.params === params, 'same params object');
  assertEqual(Object.keys(params), ['a', 'list', 'skip'], 'params keys');
  assertEqual(params.list, ['x', 'y'], 'array untouched');
});

await test('customize runs as before and can change url and params', async () => {
  let seen;
  const {calls} = await send(
    '/items',
    {method: 'GET', params: {a: 1}},
    {
      customize: (o) => {
        seen = {url: o.url, params: {...o.params}};
        o.url = '/v2' + o.url;
        o.params = {...o.params, key: 'k'};
        o.headers = {...o.headers, Authorization: 'Bearer t'};
      },
    }
  );
  assertEqual(seen, {url: '/items', params: {a: 1}}, 'customize input');
  assertEqual(calls[0].url, `${RAW}/v2/items?a=1&key=k`, 'url');
  assertEqual(calls[0].init.headers.Authorization, 'Bearer t', 'customize header');
});

await test('a retried request sends the same url with the query string exactly once', async () => {
  const {calls, error} = await send(
    '/items',
    {method: 'GET', params: {a: 1, list: ['x', 'y']}},
    {retry: 2},
    [500, 200]
  );
  assert(!error, `no error expected, got ${error && error.message}`);
  assertEqual(calls.length, 2, 'first try + one retry');
  assertEqual(calls[0].url, `${RAW}/items?a=1&list=x&list=y`, 'first url');
  assertEqual(calls[1].url, calls[0].url, 'retry url');
  assert(!('params' in calls[1].init), 'params must not reach native fetch on retry');
});

await test('a failed attempt logs the url without its query string', async () => {
  const logged = [];
  const realLog = console.log;
  console.log = (...args) => logged.push(args.map(String).join(' '));
  let calls;
  try {
    ({calls} = await send('/items?id=user42', {method: 'GET', params: {email: 'person@example.test'}}, {retry: 1}, [
      500,
    ]));
  } finally {
    console.log = realLog;
  }
  assertEqual(calls[0].url, `${RAW}/items?id=user42&email=person%40example.test`, 'the query is sent');
  assert(logged.length > 0, 'the failure is logged');
  assert(
    !logged.some((l) => l.includes('person') || l.includes('user42')),
    `query value leaked into the log: ${logged.join(' | ')}`
  );
  assert(
    logged.some((l) => l.includes(`${RAW}/items`)),
    'the path is still logged'
  );
});

// --- Rule 3: no params gives exactly today's URL ---

await test('no params, empty params or all-undefined params give exactly the old url', async () => {
  for (const options of [
    {method: 'GET'},
    {method: 'GET', params: {}},
    {method: 'GET', params: {a: undefined, b: null}},
    {method: 'GET', params: undefined},
  ]) {
    const {calls} = await send('/items/1', options);
    assertEqual(calls[0].url, `${RAW}/items/1`, `url for ${JSON.stringify(options)}`);
  }
  const {calls} = await send('/items/1?x=1', {method: 'GET', params: {}});
  assertEqual(calls[0].url, `${RAW}/items/1?x=1`, 'existing query alone is untouched');
});

// --- OAuth fetcher inherits the behaviour ---

await test('the OAuth fetcher sends the query string and its Bearer token', async () => {
  const stub = stubFetch();
  try {
    const client = new OAuth({access_token: 'tok'}).getClient({baseUrl: BASE, retry: 1});
    await client.fetch('/crm/v3/objects/contacts', {method: 'GET', params: {properties: ['a', 'b'], archived: true}});
    assertEqual(stub.calls[0].url, `${RAW}/crm/v3/objects/contacts?properties=a&properties=b&archived=true`, 'url');
    assertEqual(stub.calls[0].init.headers.Authorization, 'Bearer tok', 'auth header');
    assert(!('params' in stub.calls[0].init), 'params must not reach native fetch');
  } finally {
    stub.restore();
  }
});

// --- End to end over a local socket ---

await test('a local HTTP server receives the query string through the real global fetch', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    res.writeHead(200, {'content-type': 'application/json'});
    res.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const {port} = server.address();
    const fetcher = new Fetcher({baseUrl: `http://127.0.0.1:${port}`, retry: 1});
    const ret = await fetcher.fetch('/crm/v3/objects/contacts', {
      method: 'GET',
      params: {limit: 2, properties: ['a', 'b']},
    });
    assertEqual(ret, {ok: true}, 'response');
    assertEqual(seen, ['/crm/v3/objects/contacts?limit=2&properties=a&properties=b'], 'request line');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// --- Typing for hand-written connectors ---

await test('params is part of the typed fetch options', async () => {
  const dts = fs.readFileSync(new URL('../build/internal/fetcher/fetcher.d.mts', import.meta.url), 'utf8');
  assert(/params\?:/.test(dts), 'fetcher.d.mts declares params?');
});

console.log(`\n${colors.yellow}--- Fetcher query params test results ---${colors.reset}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);

if (failed > 0) {
  process.exit(1);
}
