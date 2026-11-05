// PLAT-23: the websocket transport of the connector (transport/index.mjs, packet.mjs, processor.mjs) and the
// on-message wrapper, against a websocket server on 127.0.0.1 or against a stub socket. Standalone script (no mocha).
// Nothing waits for real: the only delays are short polls of a loopback socket; the 5 min / 30 s / 45 s timers of the
// transport are driven by hand (clean() with a fake Date.now) or never started. Tests marked "pins current behaviour"
// fix it as it is now, so a deliberate change to it updates the test with it.
import {Transport} from '../build/internal/websocket/transport/index.mjs';
import {Packet, Callback} from '../build/internal/websocket/transport/packet.mjs';
import {Processor} from '../build/internal/websocket/transport/processor.mjs';
import {onMessage} from '../build/internal/connector/server/on-message.mjs';
import {assert, assertEqual, captureLog, newConfig, suite, wsServer} from './helpers/flow-kit.mjs';

const {test, finish} = suite('websocket transport');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(15);

/** a Transport on a stub socket that records the frames it is given; `connected` as asked */
const stubbed = async ({connected = true, onMessage: handler = () => {}} = {}) => {
  const t = new Transport({config: await newConfig(), onMessage: handler, onConnect: () => {}});
  clearInterval(t.cleaner);
  const frames = [];
  t.ws = {send: (text) => frames.push(JSON.parse(text)), terminate: () => (t.terminated = (t.terminated || 0) + 1)};
  t.connected = connected;
  return {t, frames};
};

/** a Transport connected to a local server; resolves when the socket is open */
const live = async (serverOpts) => {
  const server = await wsServer(serverOpts);
  const config = await newConfig('connector-7', server.url);
  config.setToken('test-session-token');
  const got = [];
  let opened = 0;
  let disconnected = 0;
  const t = new Transport({config, onMessage: (packet) => got.push(packet), onConnect: () => opened++});
  const quiet = await captureLog(() => t.start(() => disconnected++));
  await server.until(() => opened === 1, 'the transport to open');

  return {
    t,
    server,
    got,
    get disconnected() {
      return disconnected;
    },
    stop: async () => {
      t.leaving();
      t.close();
      await server.close();
    },
  };
};

const catchUncaught = async (fn) => {
  const errors = [];
  const handler = (e) => errors.push(e);
  process.on('uncaughtException', handler);
  try {
    await fn();
  } finally {
    process.off('uncaughtException', handler);
  }
  return errors;
};

// ---------------- packets (packet.mjs) ----------------

await test('packet: gets a 32 character id, keeps a given one, and reads and writes method, callback, event and args', async () => {
  const p = new Packet({});
  assertEqual(p.id().length, 32, 'generated id length');
  assertEqual(new Packet({id: 'test-id'}).id(), 'test-id', 'given id kept');
  assertEqual(new Packet().id().length, 32, 'no argument');
  assertEqual([p.method(), p.cb(), p.event(), p.args()], [undefined, undefined, undefined, undefined], 'getters do not set');
  p.method('connector.reply');
  p.cb('test-cb');
  p.event('test-event');
  p.args({a: 1});
  assertEqual(p.data, {id: p.id(), m: 'connector.reply', c: 'test-cb', e: 'test-event', a: {a: 1}}, 'wire names m, c, e, a');
  assertEqual([p.method(), p.cb(), p.event(), p.args()], ['connector.reply', 'test-cb', 'test-event', {a: 1}], 'getters');
});

await test('packet: newPacket copies its data and registers a callback under the packet id, or under the key it is given', async () => {
  const { t } = await stubbed();
  const data = {m: 'x'};
  const p = t.newPacket(data);
  assert(p.data !== data && !('id' in data), 'the caller object is not changed');
  assertEqual(Object.keys(t.callbacks), [], 'no callback without cb');
  const q = t.newPacket({}, () => {});
  assertEqual(q.cb(), q.id(), 'callback key defaults to the id');
  assert(t.callbacks[q.id()] instanceof Callback, 'registered');
  const r = t.newPacket({}, () => {}, 'test-key');
  assertEqual(r.cb(), 'test-key', 'given key');
  assertEqual(Object.keys(t.callbacks).sort(), [q.id(), 'test-key'].sort(), 'both registered');
});

// ---------------- sending (index.mjs:27-52, 104-109) ----------------

await test('send: packets of one tick go out in one frame {p:[...]} in the order they were sent; nothing is sent twice', async () => {
  const { t, frames } = await stubbed();
  const a = t.newPacket({m: 'a'});
  const b = t.newPacket({m: 'b'});
  const c = t.newPacket({m: 'c'});
  t.send(a);
  t.send(b);
  t.send(c);
  await settle();
  assertEqual(frames.length, 1, 'one frame');
  assertEqual(frames[0].p.map((x) => x.m), ['a', 'b', 'c'], 'order');
  assertEqual(frames[0].p[0].id, a.id(), 'ids kept');
  t.send(t.newPacket({m: 'd'}));
  await settle();
  assertEqual(frames.map((f) => f.p.map((x) => x.m)), [['a', 'b', 'c'], ['d']], 'later frame has only the new packet');
  t.send(null);
  t.send(undefined);
  await settle();
  assertEqual(frames.length, 2, 'empty sends are ignored');
});

await test('send: while the socket is not connected the packets stay queued, in order, and none is lost', async () => {
  const { t, frames } = await stubbed({connected: false});
  t.send(t.newPacket({m: 'a'}));
  t.send(t.newPacket({m: 'b'}));
  await settle();
  assertEqual(frames.length, 0, 'nothing sent');
  assertEqual(t.packets.map((p) => p.data.m), ['a', 'b'], 'both still queued');
  t.connected = true;
  t.send(t.newPacket({m: 'c'}));
  await settle();
  assertEqual(frames.map((f) => f.p.map((x) => x.m)), [['a', 'b', 'c']], 'the next send carries the whole queue in order');
});

await test('send: pins current behaviour: packets queued before the socket opens wait for the next send(), opening does not flush them', async () => {
  // pins current behaviour: transport/index.mjs:73-80 the 'open' handler does not call schedule(). A packet sent while
  // disconnected (a health check, a task) is stuck until some other packet is sent. Internal timing, not reachable
  // from outside.
  const server = await wsServer();
  const config = await newConfig('connector-7', server.url);
  config.setToken('test-session-token');
  let opened = 0;
  const t = new Transport({config, onMessage: () => {}, onConnect: () => opened++});
  try {
    t.send(t.newPacket({m: 'early'}));
    await captureLog(() => t.start(() => {}));
    await server.until(() => opened === 1, 'open');
    await sleep(60);
    assertEqual(server.received, [], 'the early packet has not been sent');
    t.send(t.newPacket({m: 'late'}));
    await server.until(() => server.received.length === 1, 'a frame');
    assertEqual(server.received[0].p.map((x) => x.m), ['early', 'late'], 'now both go');
  } finally {
    t.leaving();
    t.close();
    await server.close();
  }
});

await test('send: pins current behaviour: when the socket throws, the packet is put back as bare data and the next frame carries null in its place', async () => {
  // pins current behaviour: transport/index.mjs:49-52 pushes packet.data objects back with unshift, but schedule0
  // reads packet.data again (:41), which is undefined for them: the packet is lost, and with several packets in the
  // queue each failed pass corrupts the queue further. Reachable by a socket that throws on send (a half-open
  // connection); the platform never gets those replies.
  const { t, frames } = await stubbed();
  let fail = true;
  t.ws.send = (text) => {
    if (fail) throw new Error('socket not open');
    frames.push(JSON.parse(text));
  };
  const { lines } = await captureLog(async () => {
    t.send(t.newPacket({m: 'a'}));
    await settle();
  });
  assert(lines.some((l) => l.includes('could not send packets')), 'logged');
  assertEqual(frames.length, 0, 'nothing sent');
  assertEqual(t.packets.length, 1, 'the packet is back in the queue');
  assert(!(t.packets[0] instanceof Packet) && t.packets[0].m === 'a', 'as bare data, not as a Packet');
  fail = false;
  t.send(t.newPacket({m: 'c'}));
  await settle();
  assertEqual(frames.length, 1, 'one frame');
  assertEqual(frames[0].p.length, 2, 'two entries');
  assertEqual(frames[0].p[0], null, 'the re-queued packet became null');
  assertEqual(frames[0].p[1].m, 'c', 'only the new packet survives');
});

// ---------------- receiving (index.mjs:82-85, 111-137) ----------------

await test('receive: a frame {p:[...]} is handed to the handler packet by packet, in order, as Packet objects', async () => {
  const l = await live();
  try {
    l.server.sockets[0].send(JSON.stringify({p: [{id: 'p1', m: 'connector.query', a: {n: 1}}, {id: 'p2', m: 'connector.query', a: {n: 2}}]}));
    await l.server.until(() => l.got.length === 2, 'two packets');
    assert(l.got.every((p) => p instanceof Packet), 'Packet objects');
    assertEqual(l.got.map((p) => [p.id(), p.method(), p.args().n]), [['p1', 'connector.query', 1], ['p2', 'connector.query', 2]], 'in order');
  } finally {
    await l.stop();
  }
});

await test('receive: frames without p, empty items and unrelated JSON are ignored', async () => {
  const { t } = await stubbed();
  const got = [];
  t._onMessage = (p) => got.push(p);
  t.onMessages({});
  t.onMessages({p: []});
  t.onMessages({p: [null, undefined, 0]});
  t.onMessages({other: [{m: 'x'}]});
  assertEqual(got, [], 'nothing handled');
});

await test('receive: an answer to a connector request goes to its callback with the packet args, once, and the callback is then forgotten', async () => {
  const { t } = await stubbed();
  const seen = [];
  const req = t.newPacket({m: 'connector.blob.get'}, (ret) => seen.push(ret), '_req-test-1');
  t.onMessage({id: 'x1', c: '_req-test-1', a: {id: 'blob-1'}});
  assertEqual(seen, [{id: 'blob-1'}], 'callback called with args');
  assertEqual(Object.keys(t.callbacks), [], 'forgotten');
  t.onMessage({id: 'x2', c: '_req-test-1', a: {id: 'blob-2'}});
  assertEqual(seen.length, 1, 'a second answer does not call it again');
  assertEqual(req.cb(), '_req-test-1', 'request carried the key');
});

await test('receive: a callback that throws is logged with the packet and does not stop the connector; it is forgotten', async () => {
  const { t } = await stubbed();
  const { lines } = await captureLog(async () => {
    t.newPacket({}, () => {
      throw new Error('boom');
    }, 'test-key');
    t.onMessage({id: 'x1', c: 'test-key', a: {}});
  });
  assert(lines.some((l) => l.includes('error processing packet') && l.includes('boom')), 'logged');
  assertEqual(Object.keys(t.callbacks), [], 'forgotten');
});

await test('receive: pins current behaviour: an answer that arrives after its callback timed out is handled like a request', async () => {
  // pins current behaviour: transport/index.mjs:124-137 anything with an unknown c goes to the handler, which for the
  // dispatcher answers "cannot handle packet" to the platform. Reachable from the platform (a late reply).
  const { t } = await stubbed();
  const handled = [];
  t._onMessage = (p) => handled.push(p);
  t.onMessage({id: 'late', c: 'test-gone', a: {id: 'blob-1'}});
  assertEqual(handled.length, 1, 'passed on to the handler');
  assertEqual(handled[0].cb(), 'test-gone', 'with its callback key');
});

await test('clean: callbacks older than 5 minutes get {error:"timeout"} and are removed, younger ones stay', async () => {
  const { t } = await stubbed();
  const realNow = Date.now;
  const seen = {};
  try {
    let now = realNow();
    Date.now = () => now;
    t.newPacket({}, (r) => (seen.old = r), 'old');
    now += 4 * 60 * 1000;
    t.newPacket({}, (r) => (seen.young = r), 'young');
    now += 61 * 1000;
    await captureLog(async () => t.clean());
    assertEqual(seen, {old: {error: 'timeout'}}, 'only the old callback was told');
    assertEqual(Object.keys(t.callbacks), ['young'], 'only the young one is kept');
    t.newPacket({}, () => {
      throw new Error('boom');
    }, 'thrower');
    now += 6 * 60 * 1000;
    const { lines } = await captureLog(async () => t.clean());
    assert(lines.some((l) => l.includes('error while callback')), 'a throwing timeout callback is logged');
    assertEqual(Object.keys(t.callbacks), [], 'all removed');
  } finally {
    Date.now = realNow;
  }
});

await test('receive: pins current behaviour: a frame that is not JSON throws out of a timer callback (uncaught); the next good frame still works', async () => {
  // pins current behaviour: transport/index.mjs:84 JSON.parse is not in a try. In a connector started with makeServer a
  // process-wide 'uncaughtException' handler logs it, so the connector survives; a bare Transport would exit.
  // Reachable from the platform (the authenticated peer) or anything that can inject into the stream.
  const l = await live();
  try {
    const errors = await catchUncaught(async () => {
      l.server.sockets[0].send('{not json');
      await sleep(60);
    });
    assertEqual(errors.length, 1, 'one uncaught exception');
    assert(errors[0] instanceof SyntaxError, `a SyntaxError, got ${errors[0]}`);
    l.server.sockets[0].send(JSON.stringify({p: [{id: 'p1', m: 'm'}]}));
    await l.server.until(() => l.got.length === 1, 'the next good frame');
    assertEqual(l.got[0].id(), 'p1', 'handled');
  } finally {
    await l.stop();
  }
});

await test('receive: pins current behaviour: one item that is not an object aborts the rest of its frame (the packets after it are lost)', async () => {
  // pins current behaviour: transport/index.mjs:114-116 forEach with new Packet(item) throwing a TypeError on a string.
  // Reachable from the platform; the packets behind the bad item are dropped without a trace in the log.
  const { t } = await stubbed();
  const got = [];
  t._onMessage = (p) => got.push(p.id());
  let thrown;
  try {
    t.onMessages({p: [{id: 'first'}, 'bad', {id: 'third'}]});
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof TypeError, `a TypeError, got ${thrown}`);
  assertEqual(got, ['first'], 'the third packet was never handled');
});

await test('receive: a frame above the 100 MiB limit of the socket library closes the connection and the transport asks to reconnect', async () => {
  const l = await live();
  try {
    const errors = await captureLog(async () => {
      l.server.sockets[0].send('x'.repeat(100 * 1024 * 1024 + 1));
      await l.server.until(() => l.disconnected === 1, 'the disconnect');
    });
    assertEqual(l.disconnected, 1, 'ondisconnect called once');
    assertEqual(l.t.connected, false, 'not connected any more');
    assertEqual(l.got, [], 'nothing was handed to the handler');
    assert(errors.lines.some((x) => x.includes('error:')), 'the error is logged');
  } finally {
    await l.stop();
  }
});

// ---------------- connect, disconnect, close ----------------

await test('start: opens with the "connector" subprotocol and the session token; a close from the server calls ondisconnect once', async () => {
  const l = await live();
  try {
    const req = l.server.sockets[0].upgradeReq;
    assertEqual(req.headers['sec-websocket-protocol'], 'connector', 'subprotocol');
    assertEqual(req.headers.authorization, 'Connector test-session-token', 'authorization');
    assertEqual(l.t.connected, true, 'connected');
    l.server.sockets[0].close();
    await l.server.until(() => l.disconnected === 1, 'the disconnect');
    await sleep(20);
    assertEqual([l.disconnected, l.t.connected], [1, false], 'once, not connected');
  } finally {
    await l.stop();
  }
});

await test('start: after leaving() a close does not ask to reconnect, and start() does nothing', async () => {
  const l = await live();
  try {
    l.t.leaving();
    l.server.sockets[0].close();
    await sleep(60);
    assertEqual(l.disconnected, 0, 'no reconnect after leaving');
    const before = l.server.sockets.length;
    await captureLog(() => l.t.start(() => {}));
    await sleep(40);
    assertEqual(l.server.sockets.length, before, 'no new connection');
  } finally {
    await l.stop();
  }
});

await test('start: pins current behaviour: start() calls close() first, which clears the callback cleaner, so callbacks never time out on their own', async () => {
  // pins current behaviour: transport/index.mjs:60 and :178-183. close() clears this.cleaner (set once in the
  // constructor) and start() is always called first, so clean() never runs from the timer. Callbacks of answers that
  // never come stay for the life of the process. Internal.
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  const cleared = [];
  let cleaner;
  try {
    globalThis.setInterval = (fn, ms, ...rest) => {
      const handle = realSet(fn, ms, ...rest);
      if (ms === 45000) cleaner = handle;
      return handle;
    };
    globalThis.clearInterval = (h) => (cleared.push(h), realClear(h));
    const server = await wsServer();
    const config = await newConfig('connector-7', server.url);
    config.setToken('test-session-token');
    const t = new Transport({config, onMessage: () => {}, onConnect: () => {}});
    try {
      assert(cleaner, 'the constructor starts the 45 s cleaner');
      await captureLog(() => t.start(() => {}));
      assert(cleared.includes(cleaner), 'start() has cleared it');
      await server.until(() => server.sockets.length === 1, 'the connection');
    } finally {
      t.leaving();
      t.close();
      await server.close();
    }
  } finally {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
    if (cleaner) realClear(cleaner);
  }
});

await test('close: pins current behaviour: close() never terminates the socket (it uses an undefined variable inside a try)', async () => {
  // pins current behaviour: transport/index.mjs:187 local.ws.terminate() with no `local` in scope: ReferenceError,
  // swallowed. start() relies on close() to drop the old socket, so a reconnect leaves the previous one to die on its own.
  const { t } = await stubbed();
  t.close();
  assertEqual([t.running, t.connected], [false, false], 'state is reset');
  assertEqual(t.terminated, undefined, 'terminate was not called');
});

// ---------------- the handler wrapper (on-message.mts) and concurrency ----------------

const wired = async (processPacket) => {
  const wrapped = onMessage(processPacket);
  const s = await stubbed();
  s.t._onMessage = wrapped;
  return s;
};

await test('handler: a result is sent back as a packet with the request callback key; no result means no reply', async () => {
  const { t, frames } = await wired(async (packet) => (packet.method() === 'echo' ? {echoed: packet.args()} : undefined));
  await captureLog(async () => {
    t.onMessage({id: 'r1', m: 'echo', c: 'test-cb-1', a: {v: 1}});
    t.onMessage({id: 'r2', m: 'silent', c: 'test-cb-2', a: {}});
    await settle();
  });
  assertEqual(frames.length, 1, 'one frame');
  assertEqual(frames[0].p.map((x) => [x.c, x.a]), [['test-cb-1', {echoed: {v: 1}}]], 'only the echo is answered');
});

await test('handler: a message type nobody handles (the dispatcher throws) is answered with an error and the connector keeps going', async () => {
  const known = new Set(['connector.query']);
  const { t, frames } = await wired(async (packet) => {
    if (!known.has(packet.method())) throw new Error('cannot handle packet');
    return {ok: true};
  });
  await captureLog(async () => {
    t.onMessage({id: 'u1', m: 'connector.unheard-of', c: 'test-cb-u', a: {}});
    t.onMessage({id: 'u2', m: 'connector.query', c: 'test-cb-q', a: {}});
    await settle();
  });
  const answers = frames.flatMap((f) => f.p).map((x) => [x.c, x.a]);
  assertEqual(answers, [['test-cb-u', {error: 'Error: cannot handle packet'}], ['test-cb-q', {ok: true}]], 'error answer, then the next packet');
});

await test('handler: a handler that throws is logged and answered with its error text; without a callback key nothing can be answered', async () => {
  const { t, frames } = await wired(async () => {
    throw new Error('test-handler-failure');
  });
  const { lines } = await captureLog(async () => {
    t.onMessage({id: 'h1', m: 'connector.query', c: 'test-cb-h', a: {}});
    t.onMessage({id: 'h2', m: 'connector.query', a: {}});
    await settle();
  });
  assertEqual(frames.flatMap((f) => f.p).map((x) => [x.c, x.a]), [['test-cb-h', {error: 'Error: test-handler-failure'}]], 'one error answer');
  assert(lines.some((l) => l.includes('test-handler-failure')), 'logged');
  assert(lines.some((l) => l.includes('packet error')), 'the unanswerable one is logged as a packet error');
});

await test('handler: packets of one frame run at the same time; a slow one does not hold back a fast one, answers go out in completion order', async () => {
  const gates = {};
  const { t, frames } = await wired(
    (packet) =>
      new Promise((resolve) => {
        gates[packet.args().name] = () => resolve({name: packet.args().name});
      })
  );
  t.onMessages({p: [{id: 's', m: 'q', c: 'test-cb-slow', a: {name: 'slow'}}, {id: 'f', m: 'q', c: 'test-cb-fast', a: {name: 'fast'}}]});
  await settle();
  assertEqual(Object.keys(gates).sort(), ['fast', 'slow'], 'both handlers started before either finished');
  gates.fast();
  await settle();
  gates.slow();
  await settle();
  assertEqual(frames.flatMap((f) => f.p).map((x) => x.c), ['test-cb-fast', 'test-cb-slow'], 'fast answered first');
});

// ---------------- the processor (processor.mjs) ----------------

const processing = async (processPacket) => {
  const s = await stubbed();
  const processor = new Processor({transport: s.t, processPacket});
  return {...s, processor};
};

await test('processor: every packet of a frame is processed, its id is noted in acks, and the result goes out as connector.reply with the request callback key', async () => {
  const { t, frames, processor } = await processing(async (packet) => ({got: packet.args().n}));
  await processor.onMessages({p: [{id: 'a1', m: 'q', c: 'test-cb-1', a: {n: 1}}, {id: 'a2', m: 'q', c: 'test-cb-2', a: {n: 2}}]});
  await settle();
  assertEqual(t.acks, ['a1', 'a2'], 'acks');
  const sent = frames.flatMap((f) => f.p);
  assertEqual(sent.map((x) => [x.m, x.c, x.a]), [['connector.reply', 'test-cb-1', {got: 1}], ['connector.reply', 'test-cb-2', {got: 2}]], 'replies');
});

await test('processor: a packet that wraps another in args.packet is processed as the inner packet and answered under the outer callback key', async () => {
  const seen = [];
  const { frames, processor } = await processing(async (packet) => (seen.push(packet.method()), {ok: true}));
  await processor.onMessages({p: [{id: 'w1', c: 'test-cb-outer', a: {packet: {m: 'inner.method', a: {x: 1}}}}]});
  await settle();
  assertEqual(seen, ['inner.method'], 'inner packet handled');
  assertEqual(frames.flatMap((f) => f.p).map((x) => [x.m, x.c]), [['connector.reply', 'test-cb-outer']], 'outer key');
});

await test('processor: a handler that throws is logged with the packet, the other packets of the frame are still processed', async () => {
  const { frames, processor } = await processing(async (packet) => {
    if (packet.args().n === 1) throw new Error('test-processor-failure');
    return {n: packet.args().n};
  });
  const { lines } = await captureLog(async () => {
    await processor.onMessages({p: [{id: 'e1', m: 'q', c: 'test-cb-1', a: {n: 1}}, {id: 'e2', m: 'q', c: 'test-cb-2', a: {n: 2}}]});
    await settle();
  });
  assert(lines.some((l) => l.includes('error processing packet') && l.includes('test-processor-failure')), 'logged with the error');
  assertEqual(frames.flatMap((f) => f.p).map((x) => x.c), ['test-cb-2'], 'the second packet was answered');
});

await test('processor: pins current behaviour: the caller of a failed packet gets no answer at all (no error reply), and an unknown type fails the same way', async () => {
  // pins current behaviour: processor.mjs:59-61 only logs. The platform waits for a reply that never comes (until its
  // own timeout). The Processor is not used by the connector today (the Transport + on-message path answers errors);
  // this pins the class for whoever wires it in.
  const { frames, processor } = await processing(async (packet) => {
    if (packet.method() === 'unknown.type') throw new Error('cannot handle packet');
    return {};
  });
  await captureLog(async () => {
    await processor.onMessages({p: [{id: 'k1', m: 'unknown.type', c: 'test-cb-k', a: {}}]});
    await settle();
  });
  assertEqual(frames, [], 'nothing sent back');
});

await test('processor: pins current behaviour: a packet without args rejects the whole onMessages call (the others still run)', async () => {
  // pins current behaviour: processor.mjs:28 packet.args().packet on undefined args: TypeError out of processPacket,
  // not caught by processPacket0. Reachable from the platform, if the Processor were wired in.
  const { processor, frames } = await processing(async () => ({ok: true}));
  let error;
  await captureLog(async () => {
    try {
      await processor.onMessages({p: [{id: 'n1', m: 'q', c: 'test-cb-1'}, {id: 'n2', m: 'q', c: 'test-cb-2', a: {}}]});
    } catch (e) {
      error = e;
    }
    await settle();
  });
  assert(error instanceof TypeError, `a TypeError, got ${error}`);
  assertEqual(frames.flatMap((f) => f.p).map((x) => x.c), ['test-cb-2'], 'the packet with args was answered');
});

await test('processor: event packets are only logged and not answered', async () => {
  const handled = [];
  const { frames, processor } = await processing(async (p) => (handled.push(p), {}));
  const { lines } = await captureLog(async () => {
    await processor.onMessages({p: [{id: 'v1', e: 'something-happened', a: {}}]});
    await settle();
  });
  assert(lines.some((l) => l.includes('handle event packet')), 'logged');
  assertEqual([handled.length, frames.length], [0, 0], 'not handled, not answered');
});

await test('processor: pins current behaviour: the callbacks the Transport registers are Callback objects, so an answer routed through the Processor never reaches them', async () => {
  // pins current behaviour: processor.mjs:41 calls callbacks[key](args) but Transport stores new Callback({cb}); the
  // TypeError is caught and logged, the callback is deleted unanswered. Internal (the Processor is not wired in).
  const { t, processor } = await processing(async () => ({}));
  const seen = [];
  t.newPacket({}, (ret) => seen.push(ret), 'test-key');
  const { lines } = await captureLog(async () => {
    await processor.onMessages({p: [{id: 'c1', c: 'test-key', a: {done: true}}]});
  });
  assertEqual(seen, [], 'callback not called');
  assertEqual(Object.keys(t.callbacks), [], 'but deleted');
  assert(lines.some((l) => l.includes('error in callback')), 'logged');
});

await test('processor: packets of a frame run at the same time and onMessages resolves when all are done', async () => {
  const gates = {};
  const { processor, frames } = await processing(
    (packet) =>
      new Promise((resolve) => {
        gates[packet.args().name] = () => resolve({name: packet.args().name});
      })
  );
  let done = false;
  const all = processor.onMessages({p: [{id: 'g1', m: 'q', c: 'test-cb-slow', a: {name: 'slow'}}, {id: 'g2', m: 'q', c: 'test-cb-fast', a: {name: 'fast'}}]}).then(() => (done = true));
  await settle();
  assertEqual(Object.keys(gates).sort(), ['fast', 'slow'], 'both started');
  gates.fast();
  await settle();
  assertEqual(done, false, 'not done while one is open');
  gates.slow();
  await all;
  await settle();
  assertEqual(frames.flatMap((f) => f.p).map((x) => x.c), ['test-cb-fast', 'test-cb-slow'], 'completion order');
});

finish();
