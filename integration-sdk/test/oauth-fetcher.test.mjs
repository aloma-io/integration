// PLAT-23: the OAuth fetcher (token refresh) and the refresh request of makeOAuth, against local mocks on 127.0.0.1.
// Standalone script (no mocha). Back-off timers are faked. Tokens are made-up strings; the "config-update" JWE is made
// with a key pair generated at run time. Tests marked PINS SUSPECT BEHAVIOUR pin behaviour that looks wrong.
import JWE from '../build/internal/util/jwe/index.mjs';
import Dispatcher from '../build/internal/dispatcher/index.mjs';
import {OAuth} from '../build/internal/fetcher/oauth-fetcher.mjs';
import {makeOAuth} from '../build/internal/connector/server/on-connect/make-oauth.mjs';
import {assert, assertEqual, captureLog, fakeTimers, json, outcome, suite, vendor} from './helpers/mini.mjs';

const {test, finish} = suite('OAuth fetcher');

const OLD_ACCESS = 'test-access-old';
const NEW_ACCESS = 'test-access-new';
const OLD_REFRESH = 'test-refresh-old';
const NEW_REFRESH = 'test-refresh-new';

// an OAuth whose refresh endpoint is a function; `saved` records every saveOAuthResult call
const makeOAuth0 = (data, refresh) => {
  const saved = [];
  const refreshed = [];
  const oauth = new OAuth(
    data,
    async (what) => saved.push({...what}),
    async (token) => {
      refreshed.push(token);
      return refresh(token, refreshed.length);
    }
  );
  return {oauth, saved, refreshed};
};

// a vendor that accepts only `valid` as Bearer token (401 otherwise)
const apiFor = (valid) => (req, res) =>
  req.headers.authorization === `Bearer ${valid}` ? json(res, 200, {ok: true}) : res.writeHead(401).end('expired');

const run = async (handler, fn) => {
  const v = await vendor(handler);
  const timers = fakeTimers();
  try {
    const {result, lines} = await captureLog(() => fn(v, timers));
    return {result, lines, v, timers};
  } finally {
    timers.restore();
    await v.close();
  }
};

// --- when a token is used, refreshed ---

await test('an existing access token is sent as Bearer and nothing is refreshed', async () => {
  const {oauth, refreshed} = makeOAuth0({access_token: OLD_ACCESS, refresh_token: OLD_REFRESH}, () => ({}));
  const {v} = await run(apiFor(OLD_ACCESS), (v) => oauth.getClient({baseUrl: v.baseUrl}).fetch('/a', {method: 'GET'}));
  assertEqual(v.requests[0].headers.authorization, `Bearer ${OLD_ACCESS}`, 'authorization');
  assertEqual(refreshed, [], 'no refresh');
});

await test('without an access token the refresh token is exchanged first and the new token is used', async () => {
  const {oauth, refreshed} = makeOAuth0({refresh_token: OLD_REFRESH}, () => ({access_token: NEW_ACCESS}));
  const {v} = await run(apiFor(NEW_ACCESS), (v) => oauth.getClient({baseUrl: v.baseUrl}).fetch('/a', {method: 'GET'}));
  assertEqual(refreshed, [OLD_REFRESH], 'refresh called once with the refresh token');
  assertEqual(v.requests[0].headers.authorization, `Bearer ${NEW_ACCESS}`, 'authorization');
});

await test('the refreshed token is stored (in memory and saved) and later calls reuse it without another refresh', async () => {
  const {oauth, saved, refreshed} = makeOAuth0({refresh_token: OLD_REFRESH}, () => ({
    access_token: NEW_ACCESS,
    refresh_token: NEW_REFRESH,
  }));
  const {v} = await run(apiFor(NEW_ACCESS), async (v) => {
    const client = oauth.getClient({baseUrl: v.baseUrl});
    await client.fetch('/1', {method: 'GET'});
    await client.fetch('/2', {method: 'GET'});
  });
  assertEqual(oauth.accessToken(), NEW_ACCESS, 'stored access token');
  assertEqual(oauth.refreshToken(), NEW_REFRESH, 'stored refresh token');
  assertEqual(saved.length, 1, 'saved once');
  assertEqual(saved[0].access_token, NEW_ACCESS, 'saved access token');
  assertEqual(refreshed.length, 1, 'refreshed once for two calls');
  assertEqual(v.requests.length, 2, 'two calls');
});

await test('an answer without a new refresh_token keeps the old one', async () => {
  const {oauth} = makeOAuth0({refresh_token: OLD_REFRESH}, () => ({access_token: NEW_ACCESS}));
  await run(apiFor(NEW_ACCESS), (v) => oauth.getClient({baseUrl: v.baseUrl}).fetch('/a', {method: 'GET'}));
  assertEqual(oauth.refreshToken(), OLD_REFRESH, 'refresh token');
});

await test('a 401 makes the next attempt refresh the token (after 500 ms) and retry with the new one', async () => {
  const {oauth, refreshed} = makeOAuth0({access_token: OLD_ACCESS, refresh_token: OLD_REFRESH}, () => ({
    access_token: NEW_ACCESS,
  }));
  const {result, v, timers} = await run(apiFor(NEW_ACCESS), (v) =>
    oauth.getClient({baseUrl: v.baseUrl, retry: 2}).fetch('/a', {method: 'GET'})
  );
  assertEqual(result, {ok: true}, 'result');
  assertEqual(refreshed, [OLD_REFRESH], 'refreshed after the 401');
  assertEqual(v.requests.map((r) => r.headers.authorization), [`Bearer ${OLD_ACCESS}`, `Bearer ${NEW_ACCESS}`], 'tokens');
  assertEqual(timers.delays, [500], 'back-off');
});

await test('only a 401 forces a refresh; a 500 retries with the same token', async () => {
  const {oauth, refreshed} = makeOAuth0({access_token: OLD_ACCESS, refresh_token: OLD_REFRESH}, () => ({
    access_token: NEW_ACCESS,
  }));
  const {v} = await run(
    (req, res, info) => (info.n === 1 ? res.writeHead(500).end('x') : json(res, 200, {})),
    (v) => oauth.getClient({baseUrl: v.baseUrl, retry: 2}).fetch('/a', {method: 'GET'})
  );
  assertEqual(refreshed, [], 'no refresh');
  assertEqual(v.requests.map((r) => r.headers.authorization), [`Bearer ${OLD_ACCESS}`, `Bearer ${OLD_ACCESS}`], 'tokens');
});

await test('a 401 that persists after the refresh ends after `retry` attempts with the 401 as the error', async () => {
  const { oauth, refreshed } = makeOAuth0({access_token: OLD_ACCESS, refresh_token: OLD_REFRESH}, () => ({
    access_token: NEW_ACCESS,
  }));
  const {result, v} = await run(apiFor('never'), (v) =>
    outcome(oauth.getClient({baseUrl: v.baseUrl, retry: 3}).fetch('/a', {method: 'GET'}))
  );
  assertEqual(v.requests.length, 3, 'attempts');
  assertEqual(refreshed.length, 2, 'refreshed after the first and the second 401');
  assertEqual(result.error.status, 401, 'error status');
});

await test('a custom getToken replaces the refresh logic and receives the force flag', async () => {
  const calls = [];
  const {oauth, refreshed} = makeOAuth0({}, () => ({}));
  const {v} = await run(
    (req, res, info) => (info.n === 1 ? res.writeHead(401).end('x') : json(res, 200, {})),
    (v) =>
      oauth.getClient({
        baseUrl: v.baseUrl,
        retry: 2,
        getToken: async (force) => (calls.push(force), force ? 'forced' : 'plain'),
      }).fetch('/a', {method: 'GET'})
  );
  assertEqual(calls, [undefined, true], 'force flag per attempt');
  assertEqual(v.requests.map((r) => r.headers.authorization), ['Bearer plain', 'Bearer forced'], 'tokens');
  assertEqual(refreshed, [], 'the OAuth refresh is not used');
});

await test('caller headers and customize() survive next to the Authorization header', async () => {
  const {oauth} = makeOAuth0({access_token: OLD_ACCESS}, () => ({}));
  const {v} = await run(apiFor(OLD_ACCESS), (v) =>
    oauth.getClient({baseUrl: v.baseUrl, customize: (o) => (o.headers = {...o.headers, 'X-Tenant': 't1'})}).fetch('/a', {
      method: 'GET',
      headers: {'X-Own': 'o1'},
    })
  );
  assertEqual([v.requests[0].headers['x-tenant'], v.requests[0].headers['x-own']], ['t1', 'o1'], 'headers');
});

// --- failed refresh ---

await test('no access token and no refresh token: the step sees "have no access_token and no refresh_token"', async () => {
  const {oauth, refreshed} = makeOAuth0({}, () => ({}));
  const {result, v} = await run(apiFor('x'), (v) => outcome(oauth.getClient({baseUrl: v.baseUrl, retry: 1}).fetch('/a', {method: 'GET'})));
  assertEqual(result.error.message, 'have no access_token and no refresh_token', 'message');
  assertEqual(refreshed, [], 'no refresh call');
  assertEqual(v.requests.length, 0, 'nothing sent to the vendor');
});

await test('a refresh answer without access_token fails the call, wipes the stored access token and stores nothing', async () => {
  const {oauth, saved} = makeOAuth0({access_token: OLD_ACCESS, refresh_token: OLD_REFRESH}, () => ({error: 'invalid_grant'}));
  const {result} = await run(apiFor('never'), (v) =>
    outcome(oauth.getClient({baseUrl: v.baseUrl, retry: 2}).fetch('/a', {method: 'GET'}))
  );
  assertEqual(result.error.message, 'could not obtain access token via refresh token', 'message');
  assertEqual(oauth.accessToken(), null, 'access token invalidated');
  assertEqual(oauth.refreshToken(), OLD_REFRESH, 'refresh token kept');
  assertEqual(saved, [], 'nothing saved');
});

await test('a refresh that throws invalidates the access token and the error reaches the step', async () => {
  const {oauth} = makeOAuth0({refresh_token: OLD_REFRESH}, () => {
    throw new Error('token endpoint down');
  });
  const {result} = await run(apiFor('x'), (v) => outcome(oauth.getClient({baseUrl: v.baseUrl, retry: 1}).fetch('/a', {method: 'GET'})));
  assertEqual(result.error.message, 'token endpoint down', 'message');
  assertEqual(oauth.accessToken(), null, 'access token invalidated');
});

await test('PINS SUSPECT BEHAVIOUR: a failed refresh has no status, so it is retried `retry` times against the token endpoint', async () => {
  // oauth-fetcher.mts:44-47 rethrows; fetcher.mts:205-212 retries anything without a 400/422/429 status,
  // invalid_grant included. Reachable from outside: the token endpoint is the vendor's.
  const {oauth, refreshed} = makeOAuth0({refresh_token: OLD_REFRESH}, () => ({error: 'invalid_grant'}));
  const {timers} = await run(apiFor('x'), (v) =>
    outcome(oauth.getClient({baseUrl: v.baseUrl, retry: 4}).fetch('/a', {method: 'GET'}))
  );
  assertEqual(refreshed.length, 4, 'refresh attempts');
  assertEqual(timers.delays.length, 3, 'back-offs');
});

await test('PINS SUSPECT BEHAVIOUR: concurrent calls each refresh (no single flight); the refreshed token is used by all', async () => {
  // oauth-fetcher.mts:18-48 has no shared in-flight refresh. With a single-use refresh token the second refresh
  // would fail at the vendor, and invalidate() would wipe the good token. Reachable from outside (parallel steps).
  const {oauth, refreshed} = makeOAuth0({refresh_token: OLD_REFRESH}, async (t, n) => {
    await new Promise((r) => setImmediate(r));
    return {access_token: `${NEW_ACCESS}-${n}`};
  });
  const {v} = await run(
    (req, res) => json(res, 200, {}),
    async (v) => {
      const client = oauth.getClient({baseUrl: v.baseUrl});
      await Promise.all([1, 2, 3].map((i) => client.fetch(`/c${i}`, {method: 'GET'})));
    }
  );
  assertEqual(refreshed.length, 3, 'three refreshes for three concurrent calls');
  assertEqual(new Set(v.requests.map((r) => r.headers.authorization)).size, 3, 'each call got its own token');
});

await test('__healthCheck fails once the client was used and the access token is gone', async () => {
  const {oauth} = makeOAuth0({access_token: OLD_ACCESS}, () => ({}));
  const client = oauth.getClient({});
  await client.__healthCheck(); // unused: fine
  await client.getToken(false);
  await client.__healthCheck(); // used, token present: fine
  await oauth.invalidate(new Error('x'));
  let error;
  try {
    await client.__healthCheck();
  } catch (e) {
    error = e;
  }
  assertEqual(error?.message, 'no access token', 'message');
});

// --- periodic refresh ---

await test('periodicRefresh refreshes a client that has a refresh token and skips one that has none', async () => {
  const withToken = makeOAuth0({access_token: OLD_ACCESS, refresh_token: OLD_REFRESH}, () => ({access_token: NEW_ACCESS}));
  const without = makeOAuth0({access_token: OLD_ACCESS}, () => ({access_token: NEW_ACCESS}));
  await captureLog(async () => {
    await withToken.oauth.getClient({}).periodicRefresh();
    await without.oauth.getClient({}).periodicRefresh();
  });
  assertEqual(withToken.refreshed, [OLD_REFRESH], 'refreshed');
  assertEqual(withToken.oauth.accessToken(), NEW_ACCESS, 'stored');
  assertEqual(without.refreshed, [], 'skipped');
});

await test('PINS SUSPECT BEHAVIOUR: OAuth.periodicRefresh refreshes only the first client, once per client slot', async () => {
  // oauth-fetcher.mts:138 reads clients[0] instead of clients[i]. Internal only (own client list).
  const {oauth} = makeOAuth0({refresh_token: OLD_REFRESH}, () => ({access_token: NEW_ACCESS}));
  const a = oauth.getClient({});
  const b = oauth.getClient({});
  const calls = [];
  a.periodicRefresh = async () => calls.push('a');
  b.periodicRefresh = async () => calls.push('b');
  await captureLog(() => oauth.periodicRefresh());
  assertEqual(calls, ['a', 'a'], 'the first client twice, the second never');
});

// --- no token or key in a log line or an error ---

await test('no token appears in the log lines of a failed call and refresh', async () => {
  const {oauth} = makeOAuth0({access_token: OLD_ACCESS, refresh_token: OLD_REFRESH}, () => ({
    access_token: NEW_ACCESS,
    refresh_token: NEW_REFRESH,
  }));
  const {lines} = await run(
    (req, res, info) => (info.n < 3 ? res.writeHead(info.n === 1 ? 401 : 500).end('nope') : json(res, 200, {})),
    async (v) => {
      const client = oauth.getClient({baseUrl: v.baseUrl, retry: 4});
      await client.fetch('/a', {method: 'GET'});
      await client.periodicRefresh();
    }
  );
  assert(lines.length > 0, 'something was logged');
  for (const token of [OLD_ACCESS, NEW_ACCESS, OLD_REFRESH, NEW_REFRESH]) {
    assert(!lines.some((l) => l.includes(token)), `${token} found in the log: ${lines.join(' | ')}`);
  }
});

// --- makeOAuth: the refresh request and the saved result (make-oauth.mts) ---

const dispatcherWith = (oauthOptions) => {
  const d = new Dispatcher();
  d.oauth({authorizationURL: 'http://127.0.0.1:1/authorize', ...oauthOptions});
  return d;
};

// makeOAuth with a fake transport, a config whose JWE key pair is generated here
const setup = async ({decrypted = {}, oauthOptions = {tokenURL: 'unset'}} = {}) => {
  const jwe = new JWE({algorithm: 'RSA-OAEP-256'});
  await jwe.newPair();
  const sent = [];
  const config = {id: () => 'connector-1', validateKeys: async () => jwe};
  const transport = {
    newPacket: () => {
      const p = {};
      p.method = (m) => ((p.m = m), p);
      p.args = (a) => ((p.a = a), p);
      return p;
    },
    send: (p) => sent.push(p),
  };
  const dispatcher = dispatcherWith(oauthOptions);
  const timers = [];
  const real = {setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval};
  globalThis.setInterval = (fn, ms) => (timers.push(ms), 'interval-handle');
  globalThis.clearInterval = () => {};
  const restore = () => Object.assign(globalThis, real);
  const theOAuth = await makeOAuth({config, transport, decrypted, dispatcher});
  return {theOAuth, jwe, sent, timers, dispatcher, restore};
};

const withTokenServer = async (handler, options, fn) => {
  const v = await vendor(handler);
  const saveEnv = {...process.env};
  try {
    const s = await setup({...options(v)});
    try {
      return {s, v, ...(await captureLog(() => fn(s, v)))};
    } finally {
      s.restore();
    }
  } finally {
    process.env = saveEnv;
    await v.close();
  }
};
const grant = (req, res) => json(res, 200, {access_token: NEW_ACCESS, refresh_token: NEW_REFRESH});

await test('the refresh request is a form POST with grant_type, refresh_token, client_id and client_secret', async () => {
  const {v} = await withTokenServer(
    grant,
    (v) => ({decrypted: {clientId: 'test-client', clientSecret: 'test-secret', oauthResult: {refresh_token: OLD_REFRESH}}, oauthOptions: {tokenURL: `${v.baseUrl}/token`}}),
    (s) => s.theOAuth.obtainViaRefreshToken(OLD_REFRESH)
  );
  const r = v.requests[0];
  assertEqual([r.method, r.url], ['POST', '/token'], 'request line');
  assertEqual(Object.fromEntries(new URLSearchParams(r.body)), {
    grant_type: 'refresh_token',
    refresh_token: OLD_REFRESH,
    client_id: 'test-client',
    client_secret: 'test-secret',
  }, 'form');
  assert(r.headers['content-type'].startsWith('application/x-www-form-urlencoded'), 'content type');
  assertEqual(r.headers.accept, 'application/json', 'accept');
  assertEqual(r.headers.authorization, undefined, 'no Basic header by default');
});

await test('useAuthHeader adds a Basic Authorization header built from the client id and secret', async () => {
  const { v } = await withTokenServer(
    grant,
    (v) => ({decrypted: {clientId: 'test-client', clientSecret: 'test-secret'}, oauthOptions: {tokenURL: `${v.baseUrl}/token`, useAuthHeader: true}}),
    (s) => s.theOAuth.obtainViaRefreshToken(OLD_REFRESH)
  );
  assertEqual(v.requests[0].headers.authorization, `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`, 'header');
});

await test('token URL: OAUTH_TOKEN_URL beats the config value, which beats the connector default', async () => {
  const hit = [];
  const mk = (name) => async (req, res) => (hit.push(name), grant(req, res));
  const a = await vendor(mk('env'));
  const b = await vendor(mk('config'));
  const c = await vendor(mk('default'));
  const saveEnv = {...process.env};
  try {
    const decrypted = {clientId: 'c', clientSecret: 's', tokenURL: b.baseUrl};
    let s = await setup({decrypted, oauthOptions: {tokenURL: c.baseUrl}});
    try {
      await captureLog(() => s.theOAuth.obtainViaRefreshToken(OLD_REFRESH));
      process.env.OAUTH_TOKEN_URL = a.baseUrl;
      await captureLog(() => s.theOAuth.obtainViaRefreshToken(OLD_REFRESH));
      delete process.env.OAUTH_TOKEN_URL;
      s.restore();
      s = await setup({decrypted: {clientId: 'c', clientSecret: 's'}, oauthOptions: {tokenURL: c.baseUrl}});
      await captureLog(() => s.theOAuth.obtainViaRefreshToken(OLD_REFRESH));
    } finally {
      s.restore();
    }
  } finally {
    process.env = saveEnv;
    await Promise.all([a.close(), b.close(), c.close()]);
  }
  assertEqual(hit, ['config', 'env', 'default'], 'which endpoint answered');
});

await test('client id and secret: the config value beats OAUTH_CLIENT_ID/SECRET, which beat the connector default', async () => {
  const v = await vendor(grant);
  const saveEnv = {...process.env};
  try {
    process.env.OAUTH_CLIENT_ID = 'env-client';
    process.env.OAUTH_CLIENT_SECRET = 'env-secret';
    let s = await setup({decrypted: {clientId: 'cfg-client', clientSecret: 'cfg-secret'}, oauthOptions: {tokenURL: `${v.baseUrl}/t`}});
    await captureLog(() => s.theOAuth.obtainViaRefreshToken(OLD_REFRESH));
    s.restore();
    s = await setup({decrypted: {}, oauthOptions: {tokenURL: `${v.baseUrl}/t`, clientId: 'dflt-client', clientSecret: 'dflt-secret'}});
    await captureLog(() => s.theOAuth.obtainViaRefreshToken(OLD_REFRESH));
    s.restore();
    delete process.env.OAUTH_CLIENT_ID;
    delete process.env.OAUTH_CLIENT_SECRET;
    s = await setup({decrypted: {}, oauthOptions: {tokenURL: `${v.baseUrl}/t`, clientId: 'dflt-client', clientSecret: 'dflt-secret'}});
    await captureLog(() => s.theOAuth.obtainViaRefreshToken(OLD_REFRESH));
    s.restore();
  } finally {
    process.env = saveEnv;
    await v.close();
  }
  const form = (i) => Object.fromEntries(new URLSearchParams(v.requests[i].body));
  assertEqual([form(0).client_id, form(0).client_secret], ['cfg-client', 'cfg-secret'], 'config wins');
  assertEqual([form(1).client_id, form(1).client_secret], ['env-client', 'env-secret'], 'env beats the default');
  assertEqual([form(2).client_id, form(2).client_secret], ['dflt-client', 'dflt-secret'], 'default last');
});

await test('a missing client id or client secret is refused before any request', async () => {
  const v = await vendor(grant);
  const saveEnv = {...process.env};
  try {
    delete process.env.OAUTH_CLIENT_ID;
    delete process.env.OAUTH_CLIENT_SECRET;
    const errors = [];
    for (const decrypted of [{clientSecret: 's'}, {clientId: 'c'}]) {
      const s = await setup({decrypted, oauthOptions: {tokenURL: `${v.baseUrl}/t`}});
      try {
        errors.push((await outcome(s.theOAuth.obtainViaRefreshToken(OLD_REFRESH))).error.message);
      } finally {
        s.restore();
      }
    }
    assertEqual(errors, ['clientId not configured', 'clientSecret not configured'], 'errors');
    assertEqual(v.requests.length, 0, 'no request sent');
  } finally {
    process.env = saveEnv;
    await v.close();
  }
});

await test('a token endpoint answering 200 gives the parsed JSON; any other status throws "could not get refresh token <status> <body>"', async () => {
  const { s, v, result } = await withTokenServer(
    (req, res, info) => (info.n === 1 ? grant(req, res) : res.writeHead(400).end('{"error":"invalid_grant"}')),
    (v) => ({decrypted: {clientId: 'c', clientSecret: 's'}, oauthOptions: {tokenURL: `${v.baseUrl}/t`}}),
    async (s) => ({
      ok: await s.theOAuth.obtainViaRefreshToken(OLD_REFRESH),
      bad: (await outcome(s.theOAuth.obtainViaRefreshToken(OLD_REFRESH))).error.message,
    })
  );
  assertEqual(result.ok, {access_token: NEW_ACCESS, refresh_token: NEW_REFRESH}, 'ok');
  assertEqual(result.bad, 'could not get refresh token 400 {"error":"invalid_grant"}', 'error');
});

await test('PINS SUSPECT BEHAVIOUR: a token endpoint that echoes the refresh token puts it in the thrown error and the log', async () => {
  // make-oauth.mts:72 throws the endpoint's body unfiltered; fetcher.mts:208 logs the error. Reachable from outside:
  // only if the vendor's error body contains the token (some vendors echo the request).
  const { lines, result } = await withTokenServer(
    (req, res) => res.writeHead(500).end(`upstream failed for ${OLD_REFRESH}`),
    (v) => ({decrypted: {clientId: 'c', clientSecret: 's', oauthResult: {refresh_token: OLD_REFRESH}}, oauthOptions: {tokenURL: `${v.baseUrl}/t`}}),
    async (s) => {
      const api = await vendor(apiFor('never'));
      const timers = fakeTimers();
      try {
        return (await outcome(s.theOAuth.getClient({baseUrl: api.baseUrl, retry: 1}).fetch('/x', {method: 'GET'}))).error.message;
      } finally {
        timers.restore();
        await api.close();
      }
    }
  );
  assert(result.includes(OLD_REFRESH), `error: ${result}`);
  assert(lines.some((l) => l.includes(OLD_REFRESH)), 'the log line holds the token');
});

await test('the refresh request does not log the refresh token or the client secret', async () => {
  const { lines } = await withTokenServer(
    grant,
    (v) => ({decrypted: {clientId: 'test-client', clientSecret: 'test-secret'}, oauthOptions: {tokenURL: `${v.baseUrl}/t`}}),
    (s) => s.theOAuth.obtainViaRefreshToken(OLD_REFRESH)
  );
  for (const secret of [OLD_REFRESH, 'test-secret', NEW_ACCESS, NEW_REFRESH]) {
    assert(!lines.some((l) => l.includes(secret)), `${secret} in log: ${lines.join(' | ')}`);
  }
});

await test('the saved OAuth result goes out as a connector.config-update packet holding a JWE for this connector, without expiry', async () => {
  const { s } = await withTokenServer(
    grant,
    (v) => ({decrypted: {clientId: 'c', clientSecret: 's'}, oauthOptions: {tokenURL: `${v.baseUrl}/t`}}),
    (s) => s.theOAuth.update(NEW_ACCESS, NEW_REFRESH)
  );
  assertEqual(s.sent.length, 1, 'one packet');
  assertEqual(s.sent[0].m, 'connector.config-update', 'method');
  const jose = await import('jose');
  const {payload, protectedHeader} = await jose.jwtDecrypt(s.sent[0].a.value, s.jwe.pair.privateKey, {
    issuer: 'home.aloma.io',
    audience: 'connector-1',
  });
  assertEqual(payload._data, {access_token: NEW_ACCESS, refresh_token: NEW_REFRESH}, 'data');
  assertEqual(payload.exp, undefined, 'no expiry on the stored config');
  assertEqual(protectedHeader.alg, 'RSA-OAEP-256', 'algorithm');
  assert(!s.sent[0].a.value.includes(NEW_REFRESH), 'the packet value is not plaintext');
});

await test('makeOAuth gives null when the connector declares no OAuth', async () => {
  const ret = await makeOAuth({config: {}, transport: {}, decrypted: {}, dispatcher: new Dispatcher()});
  assertEqual(ret, null, 'no oauth');
});

await test('the OAuth object starts from decrypted.oauthResult', async () => {
  const s = await setup({decrypted: {oauthResult: {access_token: OLD_ACCESS, refresh_token: OLD_REFRESH}}});
  s.restore();
  assertEqual([s.theOAuth.accessToken(), s.theOAuth.refreshToken()], [OLD_ACCESS, OLD_REFRESH], 'tokens');
});

await test('PINS SUSPECT BEHAVIOUR: the periodic refresh runs unless noPeriodicTokenRefresh is exactly false, every 60 h by default', async () => {
  // make-oauth.mts:81 `!(x === false)` is inverted for a flag named "no..."; :91 15000 ms per "second"
  // makes 4*60*60*15000 ms = 60 h. Internal only (connector author's own setting).
  const rows = {};
  for (const [name, flag] of [['unset', undefined], ['true', true], ['false', false]]) {
    const s = await setup({oauthOptions: {tokenURL: 'unset', noPeriodicTokenRefresh: flag}});
    s.restore();
    rows[name] = s.timers;
  }
  assertEqual(rows.unset, [4 * 60 * 60 * 15000], 'installed when unset, period');
  assertEqual(rows.true, [4 * 60 * 60 * 15000], 'still installed when set to true');
  assertEqual(rows.false, [], 'not installed only when false');
  assertEqual(4 * 60 * 60 * 15000 / 3600000, 60, 'hours');
});

await test('tokenRefreshPeriod overrides the interval', async () => {
  const s = await setup({oauthOptions: {tokenURL: 'unset', tokenRefreshPeriod: 1234}});
  s.restore();
  assertEqual(s.timers, [1234], 'period');
});

// --- Dispatcher.oauth (the connector's OAuth declaration) ---

await test('Dispatcher.oauth needs an authorizationURL and a tokenURL or finishOAuth, and stores a copy of the options', async () => {
  const errors = [];
  for (const arg of [{tokenURL: 'x'}, {authorizationURL: 'x'}]) {
    try {
      new Dispatcher().oauth(arg);
    } catch (e) {
      errors.push(e.message);
    }
  }
  assertEqual(errors, ['need a authorizationURL', 'need a tokenURL or finishOAuth()'], 'errors');
  const arg = {authorizationURL: 'a', tokenURL: 't'};
  const d = new Dispatcher().oauth(arg);
  assertEqual(d._oauth, arg, 'stored');
  assert(d._oauth !== arg, 'a copy');
  assertEqual(d._config.oauth, true, 'config marked oauth');
  assertEqual(d._config.fields.oauthResult.type, 'managed', 'managed field');
});

finish();
