// PLAT-23: the durable websocket (transport/durable.mjs) against a websocket server on 127.0.0.1: the queue across a
// disconnect (no loss, no duplicate, order) and the reconnect. Standalone script (no mocha). The 5 s reconnect wait is
// held by a fake setTimeout and fired by hand, nothing waits for real. Made-up secret. Tests marked PINS SUSPECT
// BEHAVIOUR pin behaviour that looks wrong and must change on purpose when it is fixed.
//
// Note: nothing in the SDK calls Transport.newDurableWebsocket today, so this class is reachable only by a connector
// that calls it itself.
import {DurableWebsocket} from '../build/internal/websocket/transport/durable.mjs';
import {assert, assertEqual, captureLog, heldTimers, suite, wsServer} from './helpers/flow-kit.mjs';

const {test, finish} = suite('durable websocket');

const SECRET = 'test-durable-secret';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** a durable socket against a local server; `timers` holds the 5 s reconnect wait */
const durable = async () => {
  const timers = heldTimers(5000);
  const server = await wsServer();
  const state = {opens: 0, messages: []};
  const d = new DurableWebsocket({
    endpoint: server.url,
    secret: SECRET,
    onConnect: () => state.opens++,
    onMessage: (m) => state.messages.push(m),
  });

  return {
    d,
    server,
    timers,
    state,
    opened: (n) => server.until(() => state.opens === n, `open #${n}`),
    // the server drops the current connection; resolves when the client sees the close
    drop: async () => {
      const socket = server.sockets[server.sockets.length - 1];
      socket.close();
      await server.until(() => d.ws.readyState === 3, 'the client close');
    },
    stop: async () => {
      await d.close();
      timers.restore();
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

await test('connect: the server sees a Bearer authorization with the secret, and onConnect gets the durable socket', async () => {
  const x = await durable();
  try {
    let got;
    x.d.onConnect = (self) => (got = self);
    await x.server.until(() => x.server.sockets.length === 1, 'the connection');
    await sleep(20);
    assertEqual(x.server.sockets[0].upgradeReq.headers.authorization, `Bearer ${SECRET}`, 'authorization');
    assert(got === x.d, 'onConnect(durable)');
  } finally {
    await x.stop();
  }
});

await test('queue: messages sent before the socket is open are held and delivered in order, once, when it opens', async () => {
  const x = await durable();
  try {
    await x.d.send({n: 1});
    await x.d.send({n: 2});
    await x.d.send({n: 3});
    assertEqual(x.d.failed.map((m) => m.n), [1, 2, 3], 'held in order');
    await x.opened(1);
    await x.server.until(() => x.server.received.length === 3, 'three messages');
    await x.d.send({n: 4});
    await x.server.until(() => x.server.received.length === 4, 'four messages');
    assertEqual(x.server.received.map((m) => m.n), [1, 2, 3, 4], 'order, no loss, no duplicate');
    assertEqual(x.d.failed, [], 'queue empty');
  } finally {
    await x.stop();
  }
});

await test('queue: after a disconnect and a reconnect nothing already delivered is sent again', async () => {
  const x = await durable();
  try {
    await x.d.send({n: 1});
    await x.d.send({n: 2});
    await x.opened(1);
    await x.server.until(() => x.server.received.length === 2, 'two messages');
    await x.drop();
    x.timers.fire();
    await x.opened(2);
    await x.d.send({n: 3});
    await x.server.until(() => x.server.received.length === 3, 'a third message');
    await sleep(40);
    assertEqual(x.server.received.map((m) => m.n), [1, 2, 3], 'each exactly once');
  } finally {
    await x.stop();
  }
});

await test('reconnect: a close from the server schedules a new connection after 5 s; it opens, onConnect runs again and the failure count resets', async () => {
  const x = await durable();
  try {
    await x.opened(1);
    await x.drop();
    assertEqual(x.timers.held.length, 1, 'one 5 s wait scheduled');
    x.d.fails = 7;
    x.timers.fire();
    await x.opened(2);
    assertEqual(x.server.sockets.length, 2, 'a second connection');
    assertEqual(x.d.fails, 0, 'failures reset on open');
    assertEqual(x.d.connecting, false, 'not connecting');
  } finally {
    await x.stop();
  }
});

await test('reconnect: start() while a connection is being made does nothing, so a double timer cannot open two sockets', async () => {
  const x = await durable();
  try {
    await x.opened(1);
    await x.drop();
    x.d.start();
    x.d.start();
    x.timers.fire();
    await x.opened(2);
    await sleep(40);
    assertEqual(x.server.sockets.length, 2, 'two connections in all');
  } finally {
    await x.stop();
  }
});

await test('queue: PINS SUSPECT BEHAVIOUR: a message sent after the server closed the socket and before the reconnect is lost without a trace', async () => {
  // PINS SUSPECT BEHAVIOUR: durable.mjs:14-20 only queues when ws.send throws, which it does while CONNECTING. On a
  // CLOSING or CLOSED socket the ws library drops the message silently, so the "durable" queue is empty and the message
  // never arrives. Reachable by any network drop or platform restart: up to 5 s of sends are lost per disconnect.
  const x = await durable();
  try {
    await x.opened(1);
    await x.drop();
    assertEqual(x.d.ws.readyState, 3, 'closed');
    const result = await x.d.send({n: 'lost'});
    assertEqual(result, undefined, 'send does not complain');
    assertEqual(x.d.failed, [], 'and does not queue');
    x.timers.fire();
    await x.opened(2);
    await sleep(40);
    assertEqual(x.server.received, [], 'the message never arrives');
  } finally {
    await x.stop();
  }
});

await test('queue: messages sent while the reconnect is being made are held and arrive in order once it opens', async () => {
  const x = await durable();
  try {
    await x.opened(1);
    await x.drop();
    x.timers.fire();
    await x.d.send({n: 1});
    await x.d.send({n: 2});
    await x.opened(2);
    await x.d.send({n: 3});
    await x.server.until(() => x.server.received.length === 3, 'three messages');
    assertEqual(x.server.received.map((m) => m.n), [1, 2, 3], 'order, no loss, no duplicate');
  } finally {
    await x.stop();
  }
});

await test('receive: a JSON message from the server reaches onMessage, parsed, on a later turn', async () => {
  const x = await durable();
  try {
    await x.opened(1);
    x.server.sockets[0].send(JSON.stringify({p: [{id: 'm1'}], extra: true}));
    await x.server.until(() => x.state.messages.length === 1, 'the message');
    assertEqual(x.state.messages[0], {p: [{id: 'm1'}], extra: true}, 'parsed message');
  } finally {
    await x.stop();
  }
});

await test('receive: PINS SUSPECT BEHAVIOUR: a message that is not JSON throws out of the socket event handler (uncaught)', async () => {
  // PINS SUSPECT BEHAVIOUR: durable.mjs:47 JSON.parse is outside the setImmediate and has no try. Reachable from the
  // server side of the socket. With makeServer's process-wide handler it is only logged; otherwise the process exits.
  const x = await durable();
  try {
    await x.opened(1);
    const errors = await catchUncaught(async () => {
      x.server.sockets[0].send('{not json');
      await sleep(60);
    });
    assertEqual(errors.length, 1, 'one uncaught exception');
    assert(errors[0] instanceof SyntaxError, `a SyntaxError, got ${errors[0]}`);
    assertEqual(x.state.messages, [], 'nothing delivered');
  } finally {
    await x.stop();
  }
});

await test('close: after close() the socket is closed and a close from the other side does not schedule a reconnect', async () => {
  const x = await durable();
  try {
    await x.opened(1);
    await x.d.close();
    await x.server.until(() => x.d.ws.readyState === 3, 'the close');
    assertEqual(x.d.closed, true, 'closed flag');
    assertEqual(x.timers.held.length, 0, 'no reconnect scheduled');
    x.d.start();
    await sleep(30);
    assertEqual(x.server.sockets.length, 1, 'start() after close() opens nothing');
    await x.d.close();
  } finally {
    await x.stop();
  }
});

await test('error: failures are counted and stay quiet until more than 50 in a row; a refused connection schedules a retry', async () => {
  const timers = heldTimers(5000);
  const server = await wsServer();
  const deadUrl = server.url;
  await server.close();
  let d;
  try {
    const { lines } = await captureLog(async () => {
      d = new DurableWebsocket({endpoint: deadUrl, secret: SECRET, onConnect: () => {}, onMessage: () => {}});
      for (let i = 0; i < 2 && d.fails < 2; i++) {
        await new Promise((resolve) => setTimeout(resolve, 60));
        if (timers.held.length) {
          timers.fire();
        }
      }
    });
    assert(d.fails >= 1, `failures counted, got ${d.fails}`);
    assertEqual(lines.length, 0, 'quiet below 50');
    assert(timers.held.length + d.fails >= 1, 'a retry is scheduled');
    d.fails = 51;
    d.ws.emit('error', new Error('test-refused'));
    const noisy = await captureLog(async () => d.ws.emit('error', new Error('test-refused-again')));
    assert(noisy.lines.some((l) => l.includes('test-refused-again')), 'logs after 50');
  } finally {
    await d?.close();
    timers.restore();
  }
});

finish();
