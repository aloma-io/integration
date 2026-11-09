// PLAT-23: the OAuth start and finish flows of a connector (on-connect/start-oauth.mts, finish-oauth.mts) against a
// token endpoint on 127.0.0.1. Standalone script (no mocha). Client ids, secrets, codes and tokens are made-up strings;
// the key pair that seals the result is generated here at run time. Tests marked "pins current behaviour" fix it as it
// is now, so a deliberate change to it updates the test with it.
//
// What the SDK does and does not do: it builds the authorize URL from a template ({{clientId}}, {{scope}}) and
// exchanges the code at the token endpoint. State, the PKCE verifier and challenge, and the redirect handling belong to
// the platform: the SDK only passes `useCodeChallenge` out and `codeVerifier` / `redirectURI` in.
import Dispatcher from '../build/internal/dispatcher/index.mjs';
import {patchStartOAuth} from '../build/internal/connector/server/on-connect/start-oauth.mjs';
import {patchFinishOAuth} from '../build/internal/connector/server/on-connect/finish-oauth.mjs';
import {assert, assertEqual, captureFailure, captureLog, json, newConfig, outcome, suite, vendor, withEnv} from './helpers/flow-kit.mjs';

const {test, finish} = suite('OAuth start and finish');

// PLAT-401: the shared RSA key pair is generated here, outside any test's clock: key generation is a random prime search
// that takes 0.1 s alone and 10 s or more when other runs share the machine, and it used to land in the first finish test.
await newConfig();

const AUTH_URL = 'https://auth.example.test/authorize?client_id={{clientId}}&scope={{scope}}&response_type=code';
const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';
const CODE = 'test-code-1';
const REDIRECT = 'https://app.example.test/callback';
const ACCESS = 'test-access-token-AAA';
const REFRESH = 'test-refresh-token-BBB';

const newDispatcher = (oauth) => {
  const dispatcher = new Dispatcher();
  dispatcher.oauth({authorizationURL: AUTH_URL, tokenURL: 'http://127.0.0.1:1/token', ...oauth});
  return dispatcher;
};

const startOf = async (oauth = {}, decrypted = {}) => {
  const dispatcher = newDispatcher({clientId: CLIENT_ID, ...oauth});
  await patchStartOAuth({dispatcher, decrypted});
  return dispatcher;
};

/** a connector with a token endpoint on 127.0.0.1; `answer` decides what the endpoint says */
const finishOf = async ({oauth = {}, decrypted = {}, answer} = {}) => {
  const token = await vendor(answer || ((req, res) => json(res, 200, {access_token: ACCESS, refresh_token: REFRESH, scope: 'a b'})));
  const config = await newConfig('connector-7');
  const dispatcher = newDispatcher({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    tokenURL: `${token.baseUrl}/token`,
    ...oauth,
  });
  const transport = {name: 'fake-transport'};
  await patchFinishOAuth({dispatcher, decrypted, config, transport});
  const open = async (value) => (await config.validateKeys('RSA-OAEP-256')).decrypt(value, config.id());

  return {dispatcher, token, config, transport, open};
};

const finishWith = async (setup, arg = {code: CODE, redirectURI: REDIRECT}) => {
  const f = await finishOf(setup);
  try {
    const failure = await captureFailure(async () => (f.value = await f.dispatcher.finishOAuth(arg)));
    return {...f, ...failure};
  } finally {
    await f.token.close();
  }
};

// ---------------- start (start-oauth.mts) ----------------

await test('start: the authorize URL carries the client id and the scopes, URL-encoded, and says whether PKCE is used', async () => {
  await withEnv({}, async () => {
    const d = await startOf({scope: 'read write&admin', useCodeChallenge: true}, {clientId: 'id with space'});
    const out = await d.startOAuth();
    assertEqual(
      out,
      {
        url: 'https://auth.example.test/authorize?client_id=id%20with%20space&scope=read%20write%26admin&response_type=code',
        useCodeChallenge: true,
      },
      'start result'
    );
    const plain = await (await startOf()).startOAuth();
    assertEqual(plain.useCodeChallenge, false, 'PKCE is off unless the connector asks for it');
    assert(plain.url.includes('scope=&'), 'no scope configured gives an empty scope');
  });
});

await test('start: placeholders are filled case-insensitively and a value cannot break out of its parameter or inject replacement patterns', async () => {
  await withEnv({}, async () => {
    const d = await startOf(
      {authorizationURL: 'https://a.example.test/?c={{CLIENTID}}&s={{Scope}}&c2={{clientId}}', scope: 'x&evil=1$&y'},
      {clientId: 'a$&b'}
    );
    const {url} = await d.startOAuth();
    assertEqual(url, 'https://a.example.test/?c=a%24%26b&s=x%26evil%3D1%24%26y&c2=a%24%26b', 'url');
    assertEqual(new URL(url).searchParams.get('s'), 'x&evil=1$&y', 'scope round-trips as one parameter');
  });
});

await test('start: client id comes from the config, then the environment, then the connector; the authorize URL and scope prefer the environment', async () => {
  await withEnv({OAUTH_CLIENT_ID: 'env-id', OAUTH_SCOPE: 'env-scope', OAUTH_AUTHORIZATION_URL: 'https://env.example.test/?c={{clientId}}&s={{scope}}'}, async () => {
    const decrypted = {clientId: 'cfg-id', scope: 'cfg-scope', authorizationURL: 'https://cfg.example.test/?c={{clientId}}&s={{scope}}'};
    const d = await startOf({clientId: 'code-id', scope: 'code-scope'}, decrypted);
    assertEqual((await d.startOAuth()).url, 'https://env.example.test/?c=cfg-id&s=env-scope', 'env URL and scope, config client id');
  });
  await withEnv({OAUTH_CLIENT_ID: 'env-id'}, async () => {
    const d = await startOf({clientId: 'code-id', scope: 'code-scope'}, {clientId: 'cfg-id', scope: 'cfg-scope', authorizationURL: 'https://cfg.example.test/?c={{clientId}}&s={{scope}}'});
    assertEqual((await d.startOAuth()).url, 'https://cfg.example.test/?c=cfg-id&s=cfg-scope', 'config over connector');
    const e = await startOf({clientId: 'code-id'}, {});
    assertEqual((await e.startOAuth()).url.includes('client_id=env-id'), true, 'env client id over the connector');
  });
});

await test('start: refuses without oauth, client id or authorization URL', async () => {
  await withEnv({}, async () => {
    const bare = new Dispatcher();
    await patchStartOAuth({dispatcher: bare, decrypted: {}});
    assertEqual(String((await outcome(bare.startOAuth())).error), 'Error: oauth not configured', 'no oauth');

    const noClient = await startOf({clientId: undefined});
    assertEqual(String((await outcome(noClient.startOAuth())).error), 'Error: clientId not configured', 'no client id');

    const noUrl = await startOf({});
    noUrl._oauth.authorizationURL = '';
    assertEqual(String((await outcome(noUrl.startOAuth())).error), 'Error: authorizationURL not configured', 'no url');
  });
});

await test('start: stores nothing and returns only url and useCodeChallenge, the same on every call', async () => {
  await withEnv({}, async () => {
    const decrypted = {clientId: 'cfg-id'};
    const d = await startOf({useCodeChallenge: true}, decrypted);
    const before = JSON.stringify({o: d._oauth, decrypted});
    const first = await d.startOAuth();
    const second = await d.startOAuth();
    assertEqual(Object.keys(first).sort(), ['url', 'useCodeChallenge'], 'result keys');
    assertEqual(first, second, 'no per-call value such as a state or a challenge');
    assertEqual(JSON.stringify({o: d._oauth, decrypted}), before, 'nothing stored on the dispatcher or the config');
  });
});

await test('start: pins current behaviour: the SDK adds no state, no code challenge and no redirect to the URL, and leaves {{state}} / {{redirectURI}} placeholders unfilled', async () => {
  // pins current behaviour: start-oauth.mts:17-22 only knows {{clientId}} and {{scope}}. State, the PKCE challenge and the
  // redirect URI are the platform's job; a connector template that uses {{state}} sends the literal text to the vendor.
  await withEnv({}, async () => {
    const d = await startOf({authorizationURL: 'https://a.example.test/?c={{clientId}}&state={{state}}&redirect_uri={{redirectURI}}', useCodeChallenge: true});
    const {url} = await d.startOAuth();
    const q = new URL(url).searchParams;
    assertEqual(q.get('state'), '{{state}}', 'state placeholder left as it is');
    assertEqual(q.get('redirect_uri'), '{{redirectURI}}', 'redirect placeholder left as it is');
    const plain = new URL((await (await startOf()).startOAuth()).url).searchParams;
    assert(!plain.has('state') && !plain.has('code_challenge') && !plain.has('redirect_uri'), 'nothing added by the SDK');
  });
});

// ---------------- finish: the token request (finish-oauth.mts:28-76) ----------------

await test('finish: the code is exchanged once, with a form POST holding grant type, code, redirect URI, client id and secret', async () => {
  await withEnv({}, async () => {
    const r = await finishWith({});
    assertEqual(r.error, undefined, 'no error');
    assertEqual(r.token.requests.length, 1, 'one token request');
    const req = r.token.requests[0];
    assertEqual(req.method, 'POST', 'method');
    assertEqual(req.url, '/token', 'path');
    assertEqual(req.headers['content-type'], 'application/x-www-form-urlencoded;charset=UTF-8', 'content type');
    assertEqual(req.headers.accept, 'application/json', 'accept');
    assertEqual(req.headers.authorization, undefined, 'no Authorization header in the body form');
    assertEqual(Object.fromEntries(req.form), {grant_type: 'authorization_code', code: CODE, redirect_uri: REDIRECT, client_id: CLIENT_ID, client_secret: CLIENT_SECRET}, 'form');
  });
});

await test('finish: with useAuthHeader the credentials go in a Basic header and not in the body', async () => {
  await withEnv({}, async () => {
    const r = await finishWith({oauth: {useAuthHeader: true}});
    const req = r.token.requests[0];
    assertEqual(req.headers.authorization, `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`, 'basic header');
    assertEqual(Object.fromEntries(req.form), {grant_type: 'authorization_code', code: CODE, redirect_uri: REDIRECT}, 'form without credentials');
    assert(!req.body.includes(CLIENT_SECRET), 'the secret is not in the body');
  });
});

await test('finish: with useCodeChallenge the PKCE code verifier is sent', async () => {
  await withEnv({}, async () => {
    const verifier = 'test-verifier-0123456789-0123456789-0123456789-abc';
    const r = await finishWith({oauth: {useCodeChallenge: true}}, {code: CODE, redirectURI: REDIRECT, codeVerifier: verifier});
    assertEqual(r.token.requests[0].form.get('code_verifier'), verifier, 'code_verifier');
  });
});

await test('finish: without useCodeChallenge no code verifier is sent, even if the platform passes one', async () => {
  await withEnv({}, async () => {
    const r = await finishWith({}, {code: CODE, redirectURI: REDIRECT, codeVerifier: 'test-verifier-unused'});
    assert(!r.token.requests[0].form.has('code_verifier'), 'no code_verifier');
    assert(!r.token.requests[0].body.includes('test-verifier-unused'), 'verifier not in the body');
  });
});

await test('finish: pins current behaviour: useCodeChallenge without a codeVerifier sends the text "undefined" as the verifier', async () => {
  // pins current behaviour: finish-oauth.mts:49-51 does not check that a verifier was passed. The vendor rejects it,
  // but the request goes out and the error is the vendor's, not "codeVerifier missing".
  await withEnv({}, async () => {
    const r = await finishWith({oauth: {useCodeChallenge: true}}, {code: CODE, redirectURI: REDIRECT});
    assertEqual(r.token.requests.length, 1, 'request sent');
    assertEqual(r.token.requests[0].form.get('code_verifier'), 'undefined', 'verifier text');
  });
});

await test('finish: additionalTokenArgs are added to the request but cannot replace the code or the redirect URI', async () => {
  await withEnv({}, async () => {
    const r = await finishWith({oauth: {additionalTokenArgs: {resource: 'https://api.example.test', code: 'other', redirect_uri: 'https://evil.example.test/'}}});
    const form = r.token.requests[0].form;
    assertEqual(form.get('resource'), 'https://api.example.test', 'extra arg');
    assertEqual(form.get('code'), CODE, 'code not replaceable');
    assertEqual(form.get('redirect_uri'), REDIRECT, 'redirect not replaceable');
  });
});

await test('finish: needs a code and a redirect URI, a client id and a secret, and sends nothing without them', async () => {
  await withEnv({}, async () => {
    const noCode = await finishWith({}, {redirectURI: REDIRECT});
    assertEqual(String(noCode.error), 'Error: need code and redirectUri', 'no code');
    const noRedirect = await finishWith({}, {code: CODE});
    assertEqual(String(noRedirect.error), 'Error: need code and redirectUri', 'no redirect');
    const noId = await finishWith({oauth: {clientId: undefined}});
    assertEqual(String(noId.error), 'Error: clientId not configured', 'no client id');
    const noSecret = await finishWith({oauth: {clientSecret: undefined}});
    assertEqual(String(noSecret.error), 'Error: clientSecret not configured', 'no secret');
    for (const r of [noCode, noRedirect, noId, noSecret]) assertEqual(r.token.requests.length, 0, 'no token request');
  });
});

await test('finish: client id and secret come from the config, then the environment, then the connector; the token URL prefers the environment', async () => {
  const env = {OAUTH_CLIENT_ID: 'env-id', OAUTH_CLIENT_SECRET: 'env-secret'};
  await withEnv(env, async () => {
    const r = await finishWith({decrypted: {clientId: 'cfg-id', clientSecret: 'cfg-secret'}});
    assertEqual([r.token.requests[0].form.get('client_id'), r.token.requests[0].form.get('client_secret')], ['cfg-id', 'cfg-secret'], 'config wins');
  });
  await withEnv(env, async () => {
    const r = await finishWith({});
    assertEqual([r.token.requests[0].form.get('client_id'), r.token.requests[0].form.get('client_secret')], ['env-id', 'env-secret'], 'env over connector');
  });
  await withEnv({}, async () => {
    const other = await vendor((req, res) => json(res, 200, {access_token: 'test-access-other'}));
    try {
      await withEnv({OAUTH_TOKEN_URL: `${other.baseUrl}/env-token`}, async () => {
        const r = await finishWith({decrypted: {tokenURL: 'http://127.0.0.1:1/cfg'}});
        assertEqual(r.token.requests.length, 0, 'connector token endpoint not used');
        assertEqual(other.requests.length, 1, 'environment token endpoint used');
        assertEqual(other.requests[0].url, '/env-token', 'path');
      });
    } finally {
      await other.close();
    }
  });
});

// ---------------- finish: answers of the token endpoint ----------------

await test('finish: an error status from the token endpoint throws "<status> <body>", after one request and no retry', async () => {
  await withEnv({}, async () => {
    const r = await finishWith({answer: (req, res) => (res.writeHead(400), res.end('{"error":"invalid_grant"}'))});
    assertEqual(String(r.error), 'Error: 400 {"error":"invalid_grant"}', 'message');
    assertEqual(r.token.requests.length, 1, 'code not offered twice');
    assert(r.value === undefined, 'nothing returned');
  });
});

await test('finish: a 200 carrying an error field throws status, error and description', async () => {
  await withEnv({}, async () => {
    const r = await finishWith({answer: (req, res) => json(res, 200, {error: 'bad_verification_code', error_description: 'the code passed is incorrect'})});
    assertEqual(String(r.error), 'Error: 200 bad_verification_code the code passed is incorrect', 'message');
    const bare = await finishWith({answer: (req, res) => json(res, 200, {error: 'access_denied'})});
    assertEqual(String(bare.error), 'Error: 200 access_denied ', 'no description');
  });
});

await test('finish: a 200 that is not JSON fails with a parse error and returns nothing', async () => {
  await withEnv({}, async () => {
    const r = await finishWith({answer: (req, res) => res.end('<html>maintenance</html>')});
    assert(r.error instanceof SyntaxError, `expected a SyntaxError, got ${r.error}`);
    assert(r.value === undefined, 'nothing returned');
  });
});

await test('finish: pins current behaviour: a 200 without access_token puts the whole answer, tokens included, in the error and the log of the caller', async () => {
  // pins current behaviour: finish-oauth.mts:88 appends the raw answer text. An answer that has a refresh or id token
  // but no access_token (some vendors do this for OpenID-only grants) leaks it into the error that goes back to the platform.
  await withEnv({}, async () => {
    const r = await finishWith({answer: (req, res) => json(res, 200, {refresh_token: REFRESH, id_token: 'test-id-token-CCC'})});
    assert(String(r.error).startsWith('Error: 200 response has no access_token - '), `message: ${r.error}`);
    assert(String(r.error).includes(REFRESH) && String(r.error).includes('test-id-token-CCC'), 'the tokens are in the error');
  });
});

// ---------------- finish: what is returned, stored and logged ----------------

await test('finish: returns the token answer sealed for this connector in {value}; the plain token is not in the return value', async () => {
  await withEnv({}, async () => {
    const r = await finishWith({});
    assertEqual(Object.keys(r.value), ['value'], 'result keys');
    assert(typeof r.value.value === 'string' && r.value.value.split('.').length === 5, 'a compact JWE');
    assert(!r.value.value.includes(ACCESS) && !JSON.stringify(r.value).includes(REFRESH), 'no plain token');
    assertEqual(await r.open(r.value.value), {access_token: ACCESS, refresh_token: REFRESH, scope: 'a b'}, 'the whole answer, unchanged');
  });
});

await test('finish: the sealed result is for this connector only', async () => {
  await withEnv({}, async () => {
    const r = await finishWith({});
    const config = r.config;
    const jwe = await config.validateKeys('RSA-OAEP-256');
    const wrongAudience = await outcome(jwe.decrypt(r.value.value, 'connector-other'));
    assert(wrongAudience.error, 'another audience is refused');
  });
});

await test('finish: neither the code, the secret nor the tokens are logged, on success or on failure', async () => {
  await withEnv({}, async () => {
    const ok = await captureLog(async () => {
      const f = await finishOf({});
      try {
        await f.dispatcher.finishOAuth({code: CODE, redirectURI: REDIRECT});
      } finally {
        await f.token.close();
      }
    });
    const failed = await captureLog(async () => {
      const f = await finishOf({answer: (req, res) => (res.writeHead(401), res.end('{"error":"invalid_client"}'))});
      try {
        await outcome(f.dispatcher.finishOAuth({code: CODE, redirectURI: REDIRECT}));
      } finally {
        await f.token.close();
      }
    });
    const all = [...ok.lines, ...failed.lines].join('\n');
    for (const secret of [ACCESS, REFRESH, CLIENT_SECRET, CODE]) assert(!all.includes(secret), `"${secret}" appears in the log`);
  });
});

await test('finish: a connector finishOAuth hook gets {arg, doFinish, transport}; its result is sealed, and doFinish runs the standard exchange', async () => {
  await withEnv({}, async () => {
    let seen;
    const r = await finishWith({
      oauth: {
        finishOAuth: async (ctx) => {
          seen = ctx;
          const standard = await ctx.doFinish();
          return {...standard, extra: 'test-extra'};
        },
      },
    });
    assertEqual(r.error, undefined, 'no error');
    assertEqual(seen.arg, {code: CODE, redirectURI: REDIRECT}, 'arg');
    assertEqual(seen.transport, r.transport, 'transport');
    assertEqual(r.token.requests.length, 1, 'one exchange');
    assertEqual((await r.open(r.value.value)).extra, 'test-extra', 'hook result sealed');
  });
});

// ---------------- finish: state, code reuse, redirects, setup errors ----------------

await test('finish: pins current behaviour: there is no state check, the exchange runs for whatever is passed and "state" is neither required nor sent', async () => {
  // pins current behaviour: finish-oauth.mts:16-108 takes {code, redirectURI, codeVerifier} only. A state value, right or
  // wrong, is ignored. The only protection is whatever the platform does before it calls connector.finish-oauth
  // (the platform starts the flow and receives the browser redirect): reachable from the platform side only.
  await withEnv({}, async () => {
    const wrong = await finishWith({}, {code: CODE, redirectURI: REDIRECT, state: 'test-state-from-another-session'});
    assertEqual(wrong.error, undefined, 'a call with a foreign state is accepted');
    assert(wrong.value?.value, 'and a token result is returned');
    assert(!wrong.token.requests[0].form.has('state'), 'state is not sent to the vendor');
    const none = await finishWith({}, {code: CODE, redirectURI: REDIRECT});
    assertEqual(none.error, undefined, 'a call with no state is accepted');
  });
});

await test('finish: pins current behaviour: the same code can be exchanged again, the SDK keeps no record of used codes', async () => {
  // pins current behaviour: finish-oauth.mts has no replay guard; a second call with the code just goes to the vendor
  // again (a vendor should refuse it; the SDK does not). Reachable from the platform side only.
  await withEnv({}, async () => {
    const f = await finishOf({});
    try {
      const first = await f.dispatcher.finishOAuth({code: CODE, redirectURI: REDIRECT});
      const second = await f.dispatcher.finishOAuth({code: CODE, redirectURI: REDIRECT});
      assert(first.value && second.value, 'both exchanges ran');
      assertEqual(f.token.requests.map((r) => r.form.get('code')), [CODE, CODE], 'the code went to the vendor twice');
    } finally {
      await f.token.close();
    }
  });
});

await test('finish: pins current behaviour: a vendor answering 307 gets the client secret re-sent to the other address', async () => {
  // pins current behaviour: finish-oauth.mts:71 uses fetch with the default redirect handling; a 307/308 repeats the POST
  // body, client_secret and code included, at the Location. Reachable from the vendor side (or anyone who can change
  // the token URL configuration). Both servers are on 127.0.0.1 here.
  await withEnv({}, async () => {
    const elsewhere = await vendor((req, res) => json(res, 200, {access_token: ACCESS}));
    try {
      const r = await finishWith({answer: (req, res) => (res.writeHead(307, {Location: `${elsewhere.baseUrl}/collect`}), res.end())});
      assertEqual(r.error, undefined, 'the exchange follows the redirect');
      assertEqual(elsewhere.requests.length, 1, 'the second address got the request');
      assertEqual(elsewhere.requests[0].form.get('client_secret'), CLIENT_SECRET, 'with the secret');
    } finally {
      await elsewhere.close();
    }
  });
});

await test('finish: pins current behaviour: without oauth configured and without a token URL in the environment the error is a TypeError, not "oauth not configured"', async () => {
  // pins current behaviour: finish-oauth.mts:21 reads dispatcher._oauth.tokenURL before the check on line 23. A
  // connector with platformOAuth (no _oauth) gets a confusing message when the platform calls finish-oauth.
  await withEnv({}, async () => {
    const dispatcher = new Dispatcher();
    await patchFinishOAuth({dispatcher, decrypted: {}, config: await newConfig(), transport: {}});
    const e = (await outcome(dispatcher.finishOAuth({code: CODE, redirectURI: REDIRECT}))).error;
    assert(e instanceof TypeError, `expected a TypeError, got ${e}`);
  });
  await withEnv({OAUTH_TOKEN_URL: 'http://127.0.0.1:1/token'}, async () => {
    const dispatcher = new Dispatcher();
    await patchFinishOAuth({dispatcher, decrypted: {}, config: await newConfig(), transport: {}});
    const e = (await outcome(dispatcher.finishOAuth({code: CODE, redirectURI: REDIRECT}))).error;
    assertEqual(String(e), 'Error: oauth not configured', 'with a token URL in the environment the check is reached');
  });
});

finish();
