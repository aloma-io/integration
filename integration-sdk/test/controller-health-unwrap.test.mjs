// PLAT-21: the controller's health-check aggregation and the response unwrapping helpers (reply, unwrap0, unwrap).
// Standalone script (no mocha), no network beyond 127.0.0.1.
import {AbstractController} from '../build/controller/index.mjs';
import {reply, unwrap, unwrap0, ResponseParseError} from '../build/internal/util/index.mjs';
import {assert, assertEqual, captureLog, outcome, suite, vendor} from './helpers/flow-kit.mjs';

const {test, finish} = suite('controller-health-unwrap');

/** a controller with the given config and hooks; the schema is what __healthCheck is given */
const controllerWith = (config, hooks = {}) => {
  class C extends AbstractController {}
  Object.assign(C.prototype, hooks);
  const c = new C();
  c.config = config;
  return c;
};
const schemaOf = (fields) => () => ({fields});

await test('__healthCheck: nothing failing resolves', async () => {
  const c = controllerWith({a: 'x'});
  const r = await outcome(c.__healthCheck(schemaOf({a: {name: 'A'}})));
  assert(!r.error, 'no error expected: ' + r.error);
  assertEqual(r.value, undefined, 'resolves with nothing');
});

await test('__healthCheck: collects every failure, in the order healthCheck, default check, config check', async () => {
  const c = controllerWith(
    {},
    {
      async healthCheck() {
        throw new Error('health failed');
      },
      async configCheck() {
        throw new Error('config failed');
      },
    }
  );
  const r = await outcome(c.__healthCheck(schemaOf({a: {name: 'Alpha'}})));
  assert(r.error instanceof Error, 'an Error is thrown');
  assertEqual(r.error.message, 'health failed\nConfiguration: Alpha is required\nconfig failed', 'joined in order');
});

await test('__healthCheck: a failing healthCheck alone does not stop the later checks from running', async () => {
  let configSeen = null;
  const c = controllerWith(
    {a: 1},
    {
      async healthCheck() {
        throw new Error('health failed');
      },
      async configCheck(fields) {
        configSeen = fields;
      },
    }
  );
  const fields = {a: {name: 'A'}};
  const r = await outcome(c.__healthCheck(schemaOf(fields)));
  assertEqual(r.error?.message, 'health failed', 'only the health message');
  assertEqual(configSeen, fields, 'configCheck still ran with the fields');
});

await test('__healthCheck: a missing field and a failing configCheck are both reported', async () => {
  const c = controllerWith(
    {},
    {
      async configCheck() {
        throw new Error('config failed');
      },
    }
  );
  const r = await outcome(c.__healthCheck(schemaOf({a: {name: 'A'}, b: {}})));
  assertEqual(r.error?.message, 'Configuration: A is required\nConfiguration: b is required\nconfig failed', 'both reported');
});

await test('default config check: null and undefined are missing; name falls back to the key', async () => {
  const c = controllerWith({n: null});
  const r = await outcome(c.__healthCheck(schemaOf({n: {name: 'Named'}, u: {}, k: {name: ''}})));
  assertEqual(
    r.error?.message,
    'Configuration: Named is required\nConfiguration: u is required\nConfiguration: k is required',
    'one line per missing field'
  );
});

await test('default config check: optional fields are never required', async () => {
  const c = controllerWith({});
  const r = await outcome(c.__healthCheck(schemaOf({a: {optional: true}, b: {optional: true, name: 'B'}})));
  assert(!r.error, 'no error expected: ' + r.error?.message);
});

await test('default config check: a field whose definition is null is skipped', async () => {
  const c = controllerWith({});
  const r = await outcome(c.__healthCheck(schemaOf({a: null, b: undefined})));
  assert(!r.error, 'no error expected: ' + r.error?.message);
});

await test('default config check: 0, false and an empty string count as present', async () => {
  const c = controllerWith({zero: 0, no: false, empty: ''});
  const r = await outcome(c.__healthCheck(schemaOf({zero: {}, no: {}, empty: {}})));
  assert(!r.error, 'no error expected: ' + r.error?.message);
});

/** a transport that records what is sent; newPacket returns the plain object */
const recordingTransport = () => {
  const sent = [];
  return {sent, newPacket: (p) => p, send: (p) => sent.push(p)};
};

await test('reply: a packet without a callback prints the diagnostic and sends nothing', async () => {
  const t = recordingTransport();
  const {lines} = await captureLog(async () => reply({x: 1}, {cb: () => undefined}, t));
  assertEqual(t.sent, [], 'nothing sent');
  assert(lines.some((l) => l.includes('cannot reply to packet without cb')), 'diagnostic printed: ' + lines.join('|'));
});

await test('reply: with a callback sends one packet to it, carrying a copy of the arguments', async () => {
  const t = recordingTransport();
  const arg = {x: 1};
  reply(arg, {cb: () => 'cb-1'}, t);
  assertEqual(t.sent, [{c: 'cb-1', a: {x: 1}}], 'one packet');
  assert(t.sent[0].a !== arg, 'a copy, not the same object');
});

await test('unwrap0: bodyOnly false wraps status, headers and body; otherwise the body alone', async () => {
  const ret = {status: 201, headers: {h: 'v'}};
  assertEqual(unwrap0(ret, 'b', {bodyOnly: false}), {status: 201, headers: {h: 'v'}, body: 'b'}, 'wrapped');
  assertEqual(unwrap0(ret, 'b', {}), 'b', 'empty options');
  assertEqual(unwrap0(ret, 'b', undefined), 'b', 'no options');
  assertEqual(unwrap0(ret, 'b', {bodyOnly: true}), 'b', 'bodyOnly true');
});

/** fetch a body from a loopback server and unwrap it with the options */
const unwrapped = async (body, options, contentType = 'text/plain') => {
  const v = await vendor((req, res) => {
    res.writeHead(200, {'Content-Type': contentType, 'X-Mark': 'yes'});
    res.end(body);
  });
  try {
    const ret = await fetch(v.baseUrl + '/');
    return await outcome(unwrap(ret, options));
  } finally {
    await v.close();
  }
};

await test('unwrap: a JSON body is parsed and returned', async () => {
  const r = await unwrapped('{"a":[1,2]}', undefined, 'application/json');
  assertEqual(r.value, {a: [1, 2]}, 'parsed');
});

await test('unwrap: a non-JSON body is a ResponseParseError with the status and the text (no text fallback today)', async () => {
  const r = await unwrapped('plain words', {});
  assert(r.error instanceof ResponseParseError, 'ResponseParseError: ' + r.error);
  assertEqual(r.error.status, 200, 'status');
  assert(r.error.message.includes('plain words'), 'message carries the text');
});

await test('unwrap: the text option returns the text, even for JSON', async () => {
  const r = await unwrapped('{"a":1}', {text: true}, 'application/json');
  assertEqual(r.value, '{"a":1}', 'text');
});

await test('unwrap: the base64 option returns the base64 of the bytes', async () => {
  const r = await unwrapped(Buffer.from([0, 255, 16, 65]), {base64: true}, 'application/octet-stream');
  assertEqual(r.value, Buffer.from([0, 255, 16, 65]).toString('base64'), 'base64');
});

await test('unwrap: skipResponseBody returns only status and headers', async () => {
  const r = await unwrapped('not json at all', {skipResponseBody: true});
  assertEqual(Object.keys(r.value).sort(), ['headers', 'status'], 'keys');
  assertEqual(r.value.status, 200, 'status');
  assertEqual(r.value.headers.get('x-mark'), 'yes', 'headers');
});

await test('unwrap: bodyOnly false wraps status, headers and the parsed body; with text it wraps the text', async () => {
  const j = await unwrapped('{"a":1}', {bodyOnly: false}, 'application/json');
  assertEqual(Object.keys(j.value).sort(), ['body', 'headers', 'status'], 'keys');
  assertEqual(j.value.body, {a: 1}, 'parsed body');
  assertEqual(j.value.status, 200, 'status');
  const t = await unwrapped('words', {bodyOnly: false, text: true});
  assertEqual(t.value.body, 'words', 'text body');
});

finish();
