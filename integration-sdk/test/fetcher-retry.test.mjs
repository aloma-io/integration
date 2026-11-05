// PLAT-23: the plain Fetcher against a local vendor mock on 127.0.0.1: request building, retries, 429, timeouts and
// the error a step sees. Standalone script (no mocha). Back-off timers are faked (see helpers/mini.mjs), so nothing
// waits; the only real waits are the 150 ms request timeouts. These tests describe today's behaviour; the ones marked
// PINS SUSPECT BEHAVIOUR pin behaviour that looks wrong and must change on purpose when it is fixed.
import Fetcher from '../build/internal/fetcher/fetcher.mjs';
import {assert, assertEqual, captureLog, closedPort, fakeTimers, json, outcome, suite, vendor} from './helpers/mini.mjs';

const {test, finish} = suite('Fetcher retry');

// run `fn(fetcher, v)` against a vendor answering with `handler`, back-off faked, logs captured
const withVendor = async (handler, fetcherOptions, fn) => {
  const v = await vendor(handler);
  const timers = fakeTimers();
  try {
    const fetcher = new Fetcher({baseUrl: v.baseUrl, ...fetcherOptions});
    const {result, lines} = await captureLog(() => fn(fetcher, v, timers));
    return {result, lines, v, timers};
  } finally {
    timers.restore();
    await v.close();
  }
};
const ok = (req, res) => json(res, 200, {ok: true});

// --- request building (fetcher.mts:131-165) ---

await test('baseUrl and url are joined with one slash, whichever side has it', async () => {
  for (const [base, path] of [['', '/a/b'], ['/', 'a/b'], ['', 'a/b'], ['/', '/a/b']]) {
    const {v} = await withVendor(ok, {}, (f, v) => new Fetcher({baseUrl: v.baseUrl + base}).fetch(path, {method: 'GET'}));
    assertEqual(v.requests[0].url, '/a/b', `base+"${base}" with "${path}"`);
  }
});

await test('without a baseUrl the url is used as given', async () => {
  const v = await vendor(ok);
  try {
    await new Fetcher().fetch(`${v.baseUrl}/x/y`, {method: 'GET'});
    assertEqual(v.requests[0].url, '/x/y', 'path');
  } finally {
    await v.close();
  }
});

await test('Accept and Content-type default to application/json; the caller\'s values win', async () => {
  const {v} = await withVendor(ok, {}, async (f) => {
    await f.fetch('/d', {method: 'GET'});
    await f.fetch('/c', {method: 'GET', headers: {Accept: 'text/csv', 'Content-type': 'text/plain'}});
  });
  assertEqual(v.requests[0].headers.accept, 'application/json', 'default accept');
  assertEqual(v.requests[0].headers['content-type'], 'application/json', 'default content type');
  assertEqual(v.requests[1].headers.accept, 'text/csv', 'caller accept');
  assertEqual(v.requests[1].headers['content-type'], 'text/plain', 'caller content type');
});

await test('an object body is sent as JSON; a string body and a GET body are not re-encoded', async () => {
  const {v} = await withVendor(ok, {}, async (f) => {
    await f.fetch('/o', {method: 'POST', body: {a: 1}});
    await f.fetch('/s', {method: 'POST', body: 'plain text'});
  });
  assertEqual(v.requests[0].body, '{"a":1}', 'object body');
  assertEqual(v.requests[1].body, 'plain text', 'string body');
});

await test('FormData bodies get no JSON Content-type from the fetcher', async () => {
  const form = new FormData();
  form.append('k', 'v');
  const {v} = await withVendor(ok, {}, (f) => f.fetch('/f', {method: 'POST', body: form}));
  assert(/^multipart\/form-data; boundary=/.test(v.requests[0].headers['content-type']), 'multipart content type');
});

await test('the query string from params reaches the vendor', async () => {
  const {v} = await withVendor(ok, {}, (f) => f.fetch('/q', {method: 'GET', params: {limit: 2, ids: ['a', 'b']}}));
  assertEqual(v.requests[0].url, '/q?limit=2&ids=a&ids=b', 'request line');
});

await test('customize() sees the options, can change url and headers, and runs again on every retry', async () => {
  const seen = [];
  const {v} = await withVendor(
    (req, res, info) => (info.n === 1 ? json(res, 500, {}) : ok(req, res)),
    {
      retry: 2,
      customize: (options) => {
        seen.push(options.url);
        options.url = '/moved';
        options.headers = {...options.headers, 'X-Custom': 'yes'};
      },
    },
    (f) => f.fetch('/orig', {method: 'GET'})
  );
  assertEqual(seen, ['/orig', '/moved'], 'customize ran for the attempt and for the retry');
  assertEqual(v.requests.map((r) => r.url), ['/moved', '/moved'], 'urls');
  assertEqual(v.requests[0].headers['x-custom'], 'yes', 'header');
});

// --- responses and the error a step sees (fetcher.mts:173-191) ---

await test('a 200 answer is the parsed JSON body and onResponse sees the response', async () => {
  let status;
  const {result} = await withVendor(ok, {onResponse: (r) => (status = r.status)}, (f) => f.fetch('/r', {method: 'GET'}));
  assertEqual(result, {ok: true}, 'body');
  assertEqual(status, 200, 'onResponse status');
});

await test('a 204 answer is {ok: true}', async () => {
  const {result} = await withVendor((q, res) => res.writeHead(204).end(), {}, (f) => f.fetch('/r', {method: 'DELETE'}));
  assertEqual(result, {ok: true}, 'result');
});

await test('an error status throws "<status> <body>" with .status, and onResponse is not called', async () => {
  let called = false;
  const {result} = await withVendor(
    (q, res) => res.writeHead(422).end('bad field x'),
    {onResponse: () => (called = true)},
    (f) => outcome(f.fetch('/e', {method: 'POST', body: {}}))
  );
  assertEqual(result.error.message, '422 bad field x', 'message');
  assertEqual(result.error.status, 422, 'status');
  assert(!called, 'onResponse is for successful answers only');
});

await test('PINS SUSPECT BEHAVIOUR: a 200 with a non-JSON body escapes as a bare string holding the whole body, unretried', async () => {
  // fetcher.mts:191 `return unwrap(...)` is not awaited inside the try, so the catch (and the retry) never see it
  const {result, v} = await withVendor(
    (q, res) => res.writeHead(200).end('<html>maintenance</html>'),
    {retry: 3},
    (f) => outcome(f.fetch('/h', {method: 'GET'}))
  );
  assertEqual(typeof result.error, 'string', 'thrown value is a string, not an Error');
  assert(result.error.includes('<html>maintenance</html>'), 'the whole body is in the error');
  assertEqual(v.requests.length, 1, 'not retried');
});

// --- retries (fetcher.mts:196-212) ---

await test('400 and 422 are thrown at once, without a retry', async () => {
  for (const status of [400, 422]) {
    const {result, v, timers} = await withVendor((q, res) => res.writeHead(status).end('no'), {retry: 5}, (f, v, t) =>
      outcome(f.fetch('/b', {method: 'GET'}))
    );
    assertEqual(v.requests.length, 1, `one request for ${status}`);
    assertEqual(timers.delays, [], 'no back-off');
    assertEqual(result.error.status, status, 'status');
  }
});

await test('a 5xx is retried; `retry` is the total number of attempts, 500 ms apart', async () => {
  const {result, v, timers} = await withVendor((q, res) => res.writeHead(503).end('down'), {retry: 3}, (f) =>
    outcome(f.fetch('/s', {method: 'GET'}))
  );
  assertEqual(v.requests.length, 3, 'attempts');
  assertEqual(timers.delays, [500, 500], 'back-off between attempts');
  assertEqual(result.error.message, '503 down', 'the last error is thrown');
});

await test('the default is 5 attempts', async () => {
  const {v} = await withVendor((q, res) => res.writeHead(500).end('x'), {}, (f) => outcome(f.fetch('/s', {method: 'GET'})));
  assertEqual(v.requests.length, 5, 'attempts');
});

await test('a retry that succeeds returns the answer', async () => {
  const {result, v} = await withVendor(
    (req, res, info) => (info.n < 3 ? res.writeHead(502).end('bad gateway') : ok(req, res)),
    {retry: 5},
    (f) => f.fetch('/s', {method: 'GET'})
  );
  assertEqual(result, {ok: true}, 'result');
  assertEqual(v.requests.length, 3, 'attempts');
});

await test('a network error is retried and then thrown', async () => {
  const port = await closedPort();
  const timers = fakeTimers();
  try {
    const {result} = await captureLog(() =>
      outcome(new Fetcher({baseUrl: `http://127.0.0.1:${port}`, retry: 2}).fetch('/n', {method: 'GET'}))
    );
    assert(result.error, 'must reject');
    assertEqual(result.error.status, undefined, 'a network error has no status');
    assertEqual(timers.delays, [500], 'one back-off for two attempts');
  } finally {
    timers.restore();
  }
});

await test('a failed attempt is logged with the url without its query string', async () => {
  const {lines} = await withVendor((q, res) => res.writeHead(500).end('x'), {retry: 1}, (f) =>
    outcome(f.fetch('/log?secret=abc', {method: 'GET'}))
  );
  assert(lines.length > 0, 'logged');
  assert(!lines.some((l) => l.includes('abc')), `query leaked: ${lines.join(' | ')}`);
});

await test('PINS SUSPECT BEHAVIOUR: a POST is retried after a 5xx with the same body (duplicate writes)', async () => {
  // fetcher.mts:205-212 retries every method; a vendor that processed the POST and then failed sees it twice
  const {v} = await withVendor((q, res) => res.writeHead(500).end('x'), {retry: 3}, (f) =>
    outcome(f.fetch('/orders', {method: 'POST', body: {sku: 1}}))
  );
  assertEqual(v.requests.map((r) => `${r.method} ${r.body}`), ['POST {"sku":1}', 'POST {"sku":1}', 'POST {"sku":1}'], 'requests');
});

await test('PINS SUSPECT BEHAVIOUR: 401, 403 and 404 are retried like a 5xx on the plain Fetcher', async () => {
  // fetcher.mts:201 only exempts 400 and 422
  for (const status of [401, 403, 404]) {
    const {v} = await withVendor((q, res) => res.writeHead(status).end('no'), {retry: 3}, (f) =>
      outcome(f.fetch('/p', {method: 'GET'}))
    );
    assertEqual(v.requests.length, 3, `attempts for ${status}`);
  }
});

// --- 429 (fetcher.mts:196-198, 86) ---

await test('a 429 is retried after 10 s, and the retry succeeds', async () => {
  const {result, timers} = await withVendor(
    (req, res, info) => (info.n === 1 ? res.writeHead(429).end('slow down') : ok(req, res)),
    {retry: 2},
    (f) => f.fetch('/t', {method: 'GET'})
  );
  assertEqual(result, {ok: true}, 'result');
  assertEqual(timers.delays, [10000], 'rate-limit back-off is 10 s');
});

await test('PINS SUSPECT BEHAVIOUR: a 429 does not use up `retry`; a vendor answering 429 forever is retried without end', async () => {
  // fetcher.mts:196-198 returns before `--retries`; retry: 1 would otherwise allow a single attempt
  const v = await vendor((q, res) => res.writeHead(429).end('slow down'));
  const timers = fakeTimers({limit: 12});
  try {
    const {result} = await captureLog(() =>
      outcome(new Fetcher({baseUrl: v.baseUrl, retry: 1}).fetch('/t', {method: 'GET'}))
    );
    assert(result.error?.message.startsWith('RUNAWAY'), `still retrying after 12 back-offs: ${result.error?.message}`);
    assert(v.requests.length >= 12, `requests: ${v.requests.length}`);
  } finally {
    timers.restore();
    await v.close();
  }
});

await test('PINS SUSPECT BEHAVIOUR: a Retry-After header on a 429 is ignored; the wait is always 10 s', async () => {
  // fetcher.mts:86 and oauth-fetcher.mts:67 have a fixed 10000; nothing reads Retry-After
  const {timers} = await withVendor(
    (req, res, info) => (info.n === 1 ? res.writeHead(429, {'Retry-After': '1'}).end('x') : ok(req, res)),
    {retry: 2},
    (f) => f.fetch('/t', {method: 'GET'})
  );
  assertEqual(timers.delays, [10000], 'waited 10 s although the vendor said 1 s');
});

await test('PINS SUSPECT BEHAVIOUR: a long Retry-After (an hour) is not honoured either', async () => {
  const {timers} = await withVendor(
    (req, res, info) => (info.n === 1 ? res.writeHead(429, {'Retry-After': '3600'}).end('x') : ok(req, res)),
    {retry: 2},
    (f) => f.fetch('/t', {method: 'GET'})
  );
  assertEqual(timers.delays, [10000], 'retried after 10 s, inside the vendor\'s ban');
});

// --- timeouts (fetcher.mts:167-171) ---

await test('a request that gets no answer is aborted at options.timeout and retried', async () => {
  const v = await vendor(() => {}); // never answers
  const timers = fakeTimers();
  try {
    const started = Date.now();
    const {result} = await captureLog(() =>
      outcome(new Fetcher({baseUrl: v.baseUrl, retry: 2}).fetch('/hang', {method: 'GET', timeout: 150}))
    );
    assert(result.error, 'must reject');
    assertEqual(result.error.name, 'TimeoutError', 'error name');
    assertEqual(v.requests.length, 2, 'attempts');
    assertEqual(timers.delays, [500], 'back-off');
    assert(Date.now() - started < 1500, 'two 150 ms timeouts');
  } finally {
    timers.restore();
    await v.close();
  }
});

await test('the timeout defaults to 30 minutes and is capped at 30 minutes', async () => {
  const realTimeout = AbortSignal.timeout;
  const asked = [];
  AbortSignal.timeout = (ms) => (asked.push(ms), realTimeout.call(AbortSignal, ms));
  try {
    await withVendor(ok, {}, async (f) => {
      await f.fetch('/a', {method: 'GET'});
      await f.fetch('/b', {method: 'GET', timeout: 1e9});
      await f.fetch('/c', {method: 'GET', timeout: 5000});
    });
  } finally {
    AbortSignal.timeout = realTimeout;
  }
  assertEqual(asked, [1800000, 1800000, 5000], 'timeouts passed to AbortSignal.timeout');
});

finish();
