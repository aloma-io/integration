// The connector test kit's vendor mock and network guard, tested on their own (build first: yarn build).
// Nothing here reaches a network: the mock answers in memory, the only socket is a loopback http server, and the
// guard is tested over a stub that stands in for the real connect, so no socket is ever opened.
import http from 'node:http';
import net from 'node:net';
import {suite, assert, assertEqual, outcome} from './helpers/flow-kit.mjs';
import {VendorMock} from '../build/testing/vendor-mock.mjs';
import {installNetworkGuard, uninstallNetworkGuard, blocked} from '../build/testing/network-guard.mjs';

const BASE = 'https://api.vendor.example.test';
const s = suite('vendor mock and network guard');

// run fn with a fresh mock installed; always uninstall
const withMock = async (setup, fn) => {
  const mock = new VendorMock();
  setup(mock);
  mock.install();
  try {
    return await fn(mock);
  } finally {
    mock.uninstall();
  }
};

// swap net.Socket.prototype.connect for a stub that only records what it was called with
const withConnectStub = async (fn) => {
  const saved = net.Socket.prototype.connect;
  const calls = [];
  const stub = function (...args) {
    calls.push(args);
    return this;
  };
  net.Socket.prototype.connect = stub;
  try {
    return await fn({calls, stub});
  } finally {
    net.Socket.prototype.connect = saved;
  }
};

const tryConnect = (...args) => {
  try {
    net.Socket.prototype.connect.apply({}, args);
    return undefined;
  } catch (error) {
    return error;
  }
};

await s.test('matching: a string matcher matches one or two slashes after the scheme', async () => {
  await withMock(
    (m) => m.get(`${BASE}/one`, {text: 'a'}).get('https:/api.vendor.example.test/two', {text: 'b'}),
    async () => {
      assertEqual(await (await fetch('https:/api.vendor.example.test/one')).text(), 'a', 'one slash request');
      assertEqual(await (await fetch(`${BASE}/one`)).text(), 'a', 'two slash request');
      assertEqual(await (await fetch(`${BASE}/two`)).text(), 'b', 'one slash route, two slash request');
    },
  );
});

await s.test('matching: a RegExp matches by test()', async () => {
  await withMock(
    (m) => m.get(/\/items\/\d+$/, {text: 'item'}),
    async (m) => {
      assertEqual(await (await fetch(`${BASE}/items/42`)).text(), 'item');
      const miss = await outcome(fetch(`${BASE}/items/x`));
      assert(miss.error?.alomaHarnessUnmocked, 'a url the pattern does not match is unmocked');
      assertEqual(m.requests.length, 1);
    },
  );
});

await s.test('matching: a function matcher receives the canonical url', async () => {
  const seen = [];
  await withMock(
    (m) =>
      m.get(
        (url) => {
          seen.push(url);
          return true;
        },
        {text: 'ok'},
      ),
    async () => {
      await fetch('https:/api.vendor.example.test/a b');
    },
  );
  assertEqual(seen, [`${BASE}/a%20b`]);
});

await s.test('matching: a route for another method does not match', async () => {
  await withMock(
    (m) => m.post(`${BASE}/x`, {text: 'posted'}),
    async (m) => {
      const miss = await outcome(fetch(`${BASE}/x`));
      assert(miss.error?.alomaHarnessUnmocked, 'GET does not use a POST route');
      assertEqual(await (await fetch(`${BASE}/x`, {method: 'post'})).text(), 'posted');
      assertEqual(m.unmocked.length, 1);
    },
  );
});

await s.test('matching: the first route with uses left wins and times is counted per route', async () => {
  await withMock(
    (m) =>
      m
        .get(`${BASE}/x`, {text: 'first'}, {times: 1})
        .get(`${BASE}/x`, {text: 'second'}, {times: 2})
        .get(`${BASE}/y`, {text: 'other'}, {times: 1}),
    async (m) => {
      const got = [];
      for (let i = 0; i < 3; i++) got.push(await (await fetch(`${BASE}/x`)).text());
      assertEqual(got, ['first', 'second', 'second']);
      assertEqual(await (await fetch(`${BASE}/y`)).text(), 'other', 'the other route has its own count');
      const spent = await outcome(fetch(`${BASE}/x`));
      assert(spent.error?.alomaHarnessUnmocked, 'all uses of both routes are spent');
      assertEqual(m.requests.length, 4);
    },
  );
});

await s.test('response: json is sent as JSON with a content-type; an explicit content-type is kept', async () => {
  await withMock(
    (m) =>
      m
        .get(`${BASE}/j`, {json: {a: 1}})
        .get(`${BASE}/k`, {json: {a: 2}, headers: {'content-type': 'application/vnd.test+json'}}),
    async () => {
      const j = await fetch(`${BASE}/j`);
      assertEqual(j.headers.get('content-type'), 'application/json');
      assertEqual(await j.json(), {a: 1});
      const k = await fetch(`${BASE}/k`);
      assertEqual(k.headers.get('content-type'), 'application/vnd.test+json');
      assertEqual(await k.json(), {a: 2});
    },
  );
});

await s.test('response: text is sent as is and the status defaults to 200', async () => {
  await withMock(
    (m) => m.get(`${BASE}/t`, {text: 'plain {not json'}).get(`${BASE}/s`, {status: 418, text: 'teapot'}),
    async () => {
      const t = await fetch(`${BASE}/t`);
      assertEqual(t.status, 200);
      assertEqual(await t.text(), 'plain {not json');
      const x = await fetch(`${BASE}/s`);
      assertEqual(x.status, 418);
      assertEqual(await x.text(), 'teapot');
    },
  );
});

await s.test('response: status 204, 205 and 304 carry no body even if one is given', async () => {
  await withMock(
    (m) => {
      for (const status of [204, 205, 304]) m.get(`${BASE}/${status}`, {status, text: 'ignored', json: {x: 1}});
    },
    async () => {
      for (const status of [204, 205, 304]) {
        const res = await fetch(`${BASE}/${status}`);
        assertEqual(res.status, status);
        assertEqual(await res.text(), '', `body of ${status}`);
      }
    },
  );
});

await s.test('capture: string, URL and Request-like inputs record method, url, rawUrl, lowercased headers, string body', async () => {
  await withMock(
    (m) => m.on('POST', /.*/, {status: 204}).get(/.*/, {status: 204}),
    async (m) => {
      await fetch('https:/api.vendor.example.test/s', {method: 'post', headers: {'X-One': 'a', 'Content-Type': 'text/x'}, body: 'raw'});
      await fetch(new URL(`${BASE}/u`), {method: 'POST', headers: {'X-Two': 'b'}, body: 7});
      await fetch({url: `${BASE}/r`, method: 'POST', headers: {'X-Three': 'c'}}, {body: new URLSearchParams({k: 'v'})});

      const [a, b, c] = m.requests;
      assertEqual(a, {
        method: 'POST',
        url: `${BASE}/s`,
        rawUrl: 'https:/api.vendor.example.test/s',
        headers: {'content-type': 'text/x', 'x-one': 'a'},
        body: 'raw',
      });
      assertEqual(b, {method: 'POST', url: `${BASE}/u`, rawUrl: `${BASE}/u`, headers: {'x-two': 'b'}, body: '7'});
      assertEqual(c, {method: 'POST', url: `${BASE}/r`, rawUrl: `${BASE}/r`, headers: {'x-three': 'c'}, body: 'k=v'});
    },
  );
});

await s.test('capture: the method comes from init, else from the Request-like object, else GET', async () => {
  await withMock(
    (m) => m.on('PUT', /.*/, {status: 204}).on('DELETE', /.*/, {status: 204}).get(/.*/, {status: 204}),
    async (m) => {
      await fetch({url: `${BASE}/a`, method: 'delete'}, {method: 'put'});
      await fetch({url: `${BASE}/b`, method: 'delete'});
      await fetch({url: `${BASE}/c`});
      assertEqual(
        m.requests.map((r) => r.method),
        ['PUT', 'DELETE', 'GET'],
      );
      assert(!('body' in m.requests[0]), 'no body when none is given');
    },
  );
});

await s.test('responder: a function gets the captured request and may be async', async () => {
  await withMock(
    (m) =>
      m
        .post(`${BASE}/sync`, (req) => ({json: {echo: req.body, method: req.method}}))
        .post(`${BASE}/async`, async (req) => {
          await new Promise((r) => setTimeout(r, 5));
          return {status: 201, text: req.headers['x-in']};
        }),
    async () => {
      const a = await fetch(`${BASE}/sync`, {method: 'POST', body: 'hi'});
      assertEqual(await a.json(), {echo: 'hi', method: 'POST'});
      const b = await fetch(`${BASE}/async`, {method: 'POST', headers: {'X-In': 'seen'}});
      assertEqual(b.status, 201);
      assertEqual(await b.text(), 'seen');
    },
  );
});

await s.test('unmocked: the call is recorded, rejects with status 400 and the harness flag, and verify() lists it', async () => {
  await withMock(
    () => {},
    async (m) => {
      const {error} = await outcome(fetch('https:/api.vendor.example.test/nope', {method: 'delete'}));
      assert(error, 'the call rejects');
      assertEqual(error.status, 400);
      assertEqual(error.alomaHarnessUnmocked, true);
      assertEqual(m.unmocked.length, 1);
      assertEqual(m.unmocked[0].method, 'DELETE');
      assertEqual(m.requests.length, 0, 'not counted as a mocked request');
      const verdict = await outcome(Promise.resolve().then(() => m.verify()));
      assert(verdict.error, 'verify throws');
      assert(verdict.error.message.includes(`DELETE ${BASE}/nope`), `message lists the call: ${verdict.error.message}`);
    },
  );
  await withMock(() => {}, async (m) => m.verify());
});

await s.test('passthrough: allowPassthrough(true) uses the original fetch, against a loopback server', async () => {
  const server = http.createServer((req, res) => res.end(`loop ${req.url}`));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  try {
    await withMock(
      (m) => m.allowPassthrough((url) => url.hostname === '127.0.0.1'),
      async (m) => {
        const res = await fetch(`http://127.0.0.1:${port}/ping`);
        assertEqual(await res.text(), 'loop /ping');
        assertEqual(m.unmocked.length, 0);
        const other = await outcome(fetch(`${BASE}/x`));
        assert(other.error?.alomaHarnessUnmocked, 'a url the callback declines is still unmocked');
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await s.test('verifyAllRoutesUsed: names every route never called and passes when all were used', async () => {
  await withMock(
    (m) => m.get(`${BASE}/a`, {text: 'a'}).post(`${BASE}/b`, {text: 'b'}).delete(/gone/, {text: 'c'}),
    async (m) => {
      await fetch(`${BASE}/a`);
      const r = await outcome(Promise.resolve().then(() => m.verifyAllRoutesUsed()));
      assert(r.error, 'throws with unused routes');
      assert(r.error.message.includes('POST https://api.vendor.example.test/b'), r.error.message);
      assert(r.error.message.includes('DELETE /gone/'), r.error.message);
      assert(!r.error.message.includes('GET'), 'the used route is not named');
      await fetch(`${BASE}/b`, {method: 'POST'});
      await fetch(`${BASE}/gone`, {method: 'DELETE'});
      m.verifyAllRoutesUsed();
    },
  );
});

await s.test('install/uninstall: install twice replaces fetch once; uninstall restores the original exactly', async () => {
  const original = globalThis.fetch;
  await withConnectStub(async ({stub}) => {
    const m = new VendorMock();
    assertEqual(m.install(), m, 'install returns the mock');
    const replaced = globalThis.fetch;
    assert(replaced !== original, 'fetch is replaced');
    m.install();
    assert(globalThis.fetch === replaced, 'a second install does not wrap again');
    assert(net.Socket.prototype.connect !== stub, 'the guard is on');
    m.uninstall();
    assert(globalThis.fetch === original, 'the original fetch is back');
    assert(net.Socket.prototype.connect === stub, 'one uninstall removes the guard that one install added');
  });
});

await s.test('install/uninstall: uninstall without install does nothing', async () => {
  const marker = async () => new Response('marker');
  const before = globalThis.fetch;
  globalThis.fetch = marker;
  try {
    await withConnectStub(async ({stub}) => {
      new VendorMock().uninstall();
      assert(globalThis.fetch === marker, 'fetch untouched');
      assert(net.Socket.prototype.connect === stub, 'guard count untouched');
    });
  } finally {
    globalThis.fetch = before;
  }
});

await s.test('guard: installs are counted, two installs need two uninstalls', async () => {
  await withConnectStub(async ({stub}) => {
    installNetworkGuard();
    const guarded = net.Socket.prototype.connect;
    assert(guarded !== stub, 'guard is on');
    installNetworkGuard();
    assert(net.Socket.prototype.connect === guarded, 'second install does not wrap again');
    uninstallNetworkGuard();
    assert(net.Socket.prototype.connect === guarded, 'still guarded after one uninstall');
    uninstallNetworkGuard();
    assert(net.Socket.prototype.connect === stub, 'the original connect is back after two');
    uninstallNetworkGuard();
    assert(net.Socket.prototype.connect === stub, 'an extra uninstall does nothing');
  });
});

await s.test('guard: a non-loopback host throws NETWORK BLOCKED before any socket opens and is recorded', async () => {
  await withConnectStub(async ({calls}) => {
    installNetworkGuard();
    try {
      const before = blocked.length;
      const e1 = tryConnect({host: 'blocked.invalid', port: 80});
      const e2 = tryConnect([{host: 'blocked.invalid', port: 81}, () => {}]);
      assert(e1 && e1.message.includes('NETWORK BLOCKED'), 'options form blocked');
      assert(e2 && e2.message.includes('NETWORK BLOCKED'), 'normalized array form blocked');
      assertEqual(calls.length, 0, 'the underlying connect was never reached');
      assertEqual(blocked.slice(before), ['blocked.invalid', 'blocked.invalid']);
    } finally {
      uninstallNetworkGuard();
    }
  });
});

await s.test('guard: localhost, 127.0.0.1 and ::1 are allowed', async () => {
  await withConnectStub(async ({calls}) => {
    installNetworkGuard();
    try {
      const before = blocked.length;
      for (const host of ['localhost', '127.0.0.1', '::1']) {
        assertEqual(tryConnect({host, port: 80}), undefined, `${host} allowed`);
      }
      assertEqual(tryConnect({port: 80}), undefined, 'no host means localhost');
      assertEqual(calls.length, 4);
      assertEqual(blocked.length, before);
    } finally {
      uninstallNetworkGuard();
    }
  });
});

await s.test('guard: a unix socket path is allowed', async () => {
  await withConnectStub(async ({calls}) => {
    installNetworkGuard();
    try {
      assertEqual(tryConnect({path: '/tmp/not-a-real.sock'}), undefined, 'path option');
      assertEqual(tryConnect('/tmp/not-a-real.sock'), undefined, 'bare path string');
      assertEqual(calls.length, 2);
    } finally {
      uninstallNetworkGuard();
    }
  });
});

await s.test('guard: a bare number with a host string argument is judged by that host', async () => {
  await withConnectStub(async ({calls}) => {
    installNetworkGuard();
    try {
      const before = blocked.length;
      const e1 = tryConnect(80, 'blocked.invalid');
      const e2 = tryConnect('8080', 'blocked.invalid');
      assert(e1 && e1.message.includes('NETWORK BLOCKED'), 'number with a foreign host blocked');
      assert(e2 && e2.message.includes('NETWORK BLOCKED'), 'numeric string with a foreign host blocked');
      assertEqual(blocked.slice(before), ['blocked.invalid', 'blocked.invalid']);
      assertEqual(tryConnect(80, '127.0.0.1'), undefined, 'number with loopback host allowed');
      assertEqual(tryConnect(80), undefined, 'number alone means localhost');
      assertEqual(calls.length, 2);
    } finally {
      uninstallNetworkGuard();
    }
  });
});

s.finish();
