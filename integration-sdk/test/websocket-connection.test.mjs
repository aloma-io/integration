// The websocket connector's Connection.onDisconnect (the wait before it connects again) and WebsocketConnector.send
// (what is handed to the transport). Standalone script (no mocha). The 5 s wait is held by a fake setTimeout and fired
// by hand, so nothing waits for real; the transport socket is a stub that records the frames it is given.
import {Connection} from '../build/internal/websocket/connection/index.mjs';
import {WebsocketConnector} from '../build/internal/websocket/index.mjs';
import {assert, assertEqual, heldTimers, newConfig, suite} from './helpers/flow-kit.mjs';

const {test, finish} = suite('websocket connection');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** a connector whose transport holds a stub socket that records the frames written to it */
const stubbed = async () => {
  const connector = new WebsocketConnector({config: await newConfig(), onMessage: () => {}, onConnect: () => {}});
  clearInterval(connector.transport.cleaner);
  const frames = [];
  connector.transport.ws = {send: (text) => frames.push(JSON.parse(text))};
  connector.transport.connected = true;
  return {connector, frames};
};

await test('onDisconnect does not connect again before the 5 s wait has passed', async () => {
  const timers = heldTimers(5000);
  try {
    const connection = new Connection({config: await newConfig(), onStart: () => {}});
    let starts = 0;
    connection.start = () => starts++;

    connection.onDisconnect();
    await sleep(20);

    assertEqual(timers.held.length, 1, 'one 5000 ms wait is scheduled');
    assertEqual(starts, 0, 'start calls before the wait ends');
  } finally {
    timers.restore();
  }
});

await test('onDisconnect connects again once, when the 5 s wait ends', async () => {
  const timers = heldTimers(5000);
  try {
    const connection = new Connection({config: await newConfig(), onStart: () => {}});
    let starts = 0;
    connection.start = () => starts++;

    connection.onDisconnect();
    timers.fire();

    assertEqual(starts, 1, 'start calls after the wait ends');
  } finally {
    timers.restore();
  }
});

await test('send writes one frame holding the message and a 32 character packet id', async () => {
  const {connector, frames} = await stubbed();

  connector.send({q: 'ping', a: {n: 1}});
  await sleep(20);

  assertEqual(frames.length, 1, 'frames written');
  assertEqual(frames[0].p.length, 1, 'packets in the frame');
  const packet = frames[0].p[0];
  assertEqual(packet.q, 'ping', 'message field q');
  assertEqual(packet.a, {n: 1}, 'message field a');
  assert(typeof packet.id === 'string' && packet.id.length === 32, `packet id is 32 characters, got ${packet.id}`);
});

await test('send writes nothing when the message is undefined, null, empty or zero', async () => {
  const {connector, frames} = await stubbed();

  for (const nothing of [undefined, null, '', 0, false]) connector.send(nothing);
  await sleep(20);

  assertEqual(frames.length, 0, 'frames written');
  assertEqual(connector.transport.packets.length, 0, 'packets queued');
});

await test('send keeps the message queued while the transport is not connected', async () => {
  const {connector, frames} = await stubbed();
  connector.transport.connected = false;

  connector.send({q: 'later'});
  await sleep(20);

  assertEqual(frames.length, 0, 'frames written');
  assertEqual(connector.transport.packets.length, 1, 'packets queued');
});

finish();
