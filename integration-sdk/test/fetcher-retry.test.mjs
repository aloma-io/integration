// PLAT-23: the plain Fetcher against a local vendor mock on 127.0.0.1: request building, retries, 429, timeouts and
// the error a step sees. Standalone script (no mocha). Back-off timers are faked (see helpers/mini.mjs), so nothing
// waits; the only real waits are the 150 ms request timeouts.
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

await test('a 200 with a non-JSON body is a ResponseParseError with the status and the first 200 characters, not retried', async () => {
  const body = '<html>' + 'x'.repeat(300) + 'END</html>';
  const {result, v} = await withVendor((q, res) => res.writeHead(200).end(body), {retry: 3}, (f) =>
    outcome(f.fetch('/h', {method: 'GET'}))
  );
  assert(result.error instanceof Error, 'thrown value is an Error');
  assertEqual(result.error.name, 'ResponseParseError', 'error name');
  assertEqual(result.error.status, 200, 'status');
  assert(result.error.message.includes(body.slice(0, 200)), 'the first 200 characters are in the message');
  assert(!result.error.message.includes(body.slice(0, 201)), 'nothing beyond 200 characters');
  assert(!result.error.message.includes('END'), 'the end of the body is not in the message');
  assertEqual(v.requests.length, 1, 'not retried');
});

await test('a short non-JSON body is quoted whole in the error', async () => {
  const {result} = await withVendor((q, res) => res.writeHead(200).end('maintenance'), {}, (f) =>
    outcome(f.fetch('/h', {method: 'GET'}))
  );
  assertEqual(result.error.name, 'ResponseParseError', 'error name');
  assert(result.error.message.includes('maintenance'), result.error.message);
});

await test('a non-JSON body is accepted when text is asked for', async () => {
  const {result} = await withVendor((q, res) => res.writeHead(200).end('plain'), {}, (f) =>
    f.fetch('/h', {method: 'GET', text: true})
  );
  assertEqual(result, 'plain', 'text body');
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

const BODY = {sku: 1};
const failing = (status = 500) => (q, res) => res.writeHead(status).end('x');

await test('GET, HEAD, OPTIONS, PUT and DELETE are retried after a 5xx', async () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'get', 'put']) {
    const {v} = await withVendor(failing(), {retry: 3}, (f) => outcome(f.fetch('/m', {method})));
    assertEqual(v.requests.length, 3, `attempts for ${method}`);
  }
});

await test('a request without a method is a GET and is retried', async () => {
  const {v} = await withVendor(failing(), {retry: 3}, (f) => outcome(f.fetch('/m')));
  assertEqual(v.requests.length, 3, 'attempts');
});

await test('POST and PATCH are sent once after a 5xx by default', async () => {
  for (const method of ['POST', 'PATCH', 'post']) {
    const {result, v, timers} = await withVendor(failing(503), {retry: 3}, (f) =>
      outcome(f.fetch('/orders', {method, body: BODY}))
    );
    assertEqual(v.requests.length, 1, `requests for ${method}`);
    assertEqual(timers.delays, [], 'no back-off');
    assertEqual(result.error.message, '503 x', 'the error is thrown');
  }
});

await test('POST and PATCH are retried after a 5xx, with the same body, when the caller sets retryUnsafe', async () => {
  for (const method of ['POST', 'PATCH']) {
    const {v} = await withVendor(failing(), {retry: 3}, (f) =>
      outcome(f.fetch('/orders', {method, body: BODY, retryUnsafe: true}))
    );
    assertEqual(v.requests.map((r) => `${r.method} ${r.body}`), Array(3).fill(`${method} {"sku":1}`), `requests for ${method}`);
  }
});

await test('retryUnsafe applies to the one request that sets it', async () => {
  const {v} = await withVendor(failing(), {retry: 3}, async (f) => {
    await outcome(f.fetch('/a', {method: 'POST', body: BODY, retryUnsafe: true}));
    await outcome(f.fetch('/b', {method: 'POST', body: BODY}));
  });
  assertEqual(v.requests.map((r) => r.url), ['/a', '/a', '/a', '/b'], 'requests');
});

await test('a POST that times out is not retried unless retryUnsafe is set', async () => {
  for (const [retryUnsafe, expected] of [[false, 1], [true, 2]]) {
    const v = await vendor(() => {}); // never answers
    const timers = fakeTimers();
    try {
      await captureLog(() =>
        outcome(new Fetcher({baseUrl: v.baseUrl, retry: 2}).fetch('/hang', {method: 'POST', body: BODY, timeout: 100, retryUnsafe}))
      );
      assertEqual(v.requests.length, expected, `attempts with retryUnsafe ${retryUnsafe}`);
    } finally {
      timers.restore();
      await v.close();
    }
  }
});

await test('a POST that meets a network error is not retried unless retryUnsafe is set', async () => {
  const port = await closedPort();
  for (const [retryUnsafe, expected] of [[false, []], [true, [500]]]) {
    const timers = fakeTimers();
    try {
      const {result} = await captureLog(() =>
        outcome(new Fetcher({baseUrl: `http://127.0.0.1:${port}`, retry: 2}).fetch('/n', {method: 'POST', body: BODY, retryUnsafe}))
      );
      assert(result.error, 'must reject');
      assertEqual(timers.delays, expected, `back-offs with retryUnsafe ${retryUnsafe}`);
    } finally {
      timers.restore();
    }
  }
});

await test('a PUT that times out is retried', async () => {
  const v = await vendor(() => {});
  const timers = fakeTimers();
  try {
    await captureLog(() => outcome(new Fetcher({baseUrl: v.baseUrl, retry: 2}).fetch('/hang', {method: 'PUT', body: BODY, timeout: 100})));
    assertEqual(v.requests.length, 2, 'attempts');
  } finally {
    timers.restore();
    await v.close();
  }
});

await test('401, 403, 404, 410 and 418 are thrown at once on the plain Fetcher', async () => {
  for (const status of [401, 403, 404, 410, 418]) {
    const {result, v, timers} = await withVendor(failing(status), {retry: 3}, (f) => outcome(f.fetch('/p', {method: 'GET'})));
    assertEqual(v.requests.length, 1, `requests for ${status}`);
    assertEqual(timers.delays, [], 'no back-off');
    assertEqual(result.error.status, status, 'status');
  }
});

await test('a 408 is retried', async () => {
  const {v} = await withVendor(failing(408), {retry: 3}, (f) => outcome(f.fetch('/p', {method: 'GET'})));
  assertEqual(v.requests.length, 3, 'attempts');
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

await test('a 429 counts against `retry`: with retry 1 there is one request and no wait', async () => {
  const {result, v, timers} = await withVendor(failing(429), {retry: 1}, (f) => outcome(f.fetch('/t', {method: 'GET'})));
  assertEqual(v.requests.length, 1, 'requests');
  assertEqual(timers.delays, [], 'no wait');
  assertEqual(result.error.status, 429, 'status');
});

await test('a vendor answering 429 every time gets `retry` requests, 10 s apart', async () => {
  const {result, v, timers} = await withVendor(failing(429), {retry: 3}, (f) => outcome(f.fetch('/t', {method: 'GET'})));
  assertEqual(v.requests.length, 3, 'requests');
  assertEqual(timers.delays, [10000, 10000], 'waits');
  assertEqual(result.error.status, 429, 'the 429 is thrown');
});

await test('a 429 and a 5xx share the same `retry` count', async () => {
  const {v} = await withVendor(
    (q, res, info) => res.writeHead(info.n === 1 ? 429 : 503).end('x'),
    {retry: 3},
    (f) => outcome(f.fetch('/t', {method: 'GET'}))
  );
  assertEqual(v.requests.length, 3, 'requests');
});

await test('a 429 is retried for POST as well, since the vendor did not process it', async () => {
  const {v} = await withVendor(failing(429), {retry: 2}, (f) => outcome(f.fetch('/t', {method: 'POST', body: BODY})));
  assertEqual(v.requests.length, 2, 'requests');
});

// --- Retry-After ---

const retryAfter = async (status, header, retry = 2) => {
  const {timers} = await withVendor(
    (req, res, info) => (info.n === 1 ? res.writeHead(status, header == null ? {} : {'Retry-After': header}).end('x') : ok(req, res)),
    {retry},
    (f) => f.fetch('/t', {method: 'GET'})
  );
  return timers.delays;
};

await test('Retry-After in seconds sets the wait before the retry', async () => {
  assertEqual(await retryAfter(429, '1'), [1000], '429');
  assertEqual(await retryAfter(503, '2'), [2000], '503');
});

await test('Retry-After 0 retries at once', async () => {
  assertEqual(await retryAfter(429, '0'), [0], 'wait');
});

await test('Retry-After is capped at 60 s', async () => {
  assertEqual(await retryAfter(429, '3600'), [60000], '429');
  assertEqual(await retryAfter(503, '61'), [60000], '503');
  assertEqual(await retryAfter(429, '60'), [60000], 'exactly 60 s');
});

await test('Retry-After as an HTTP date sets the wait to the time left', async () => {
  const [wait] = await retryAfter(429, new Date(Date.now() + 30000).toUTCString());
  assert(wait >= 27000 && wait <= 30000, `wait: ${wait}`);
  const [capped] = await retryAfter(503, new Date(Date.now() + 3600000).toUTCString());
  assertEqual(capped, 60000, 'capped');
  const [past] = await retryAfter(429, new Date(Date.now() - 30000).toUTCString());
  assertEqual(past, 0, 'a date in the past');
});

await test('without a usable Retry-After the usual wait applies', async () => {
  assertEqual(await retryAfter(429, null), [10000], '429 without header');
  assertEqual(await retryAfter(503, null), [500], '503 without header');
  assertEqual(await retryAfter(429, 'soon'), [10000], '429 with text');
  assertEqual(await retryAfter(503, '-5'), [500], '503 with a negative number');
  assertEqual(await retryAfter(503, ''), [500], '503 with an empty value');
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
