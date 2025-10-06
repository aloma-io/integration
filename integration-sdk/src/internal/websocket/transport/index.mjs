import {init} from '@paralleldrive/cuid2';
import C from '../connection/constants.mjs';
const cuid = init({length: 32});

import WebSocket from 'ws';
import {DurableWebsocket} from './durable.mjs';
import {Callback, Packet} from './packet.mjs';

const cleanInterval = 45 * 1000;
const pingInterval = 30 * 1000;

class Transport {
  constructor({config, onMessage, onConnect}) {
    var local = this;

    this.config = config;
    this.callbacks = {};
    this.running = true;
    this.pinger = null;
    this.cleaner = setInterval(() => local.clean(), cleanInterval);

    this.acks = [];
    this.packets = [];
    this.onConnect = onConnect;
    this._onMessage = onMessage;
  }

  schedule() {
    var local = this;

    setTimeout(() => local.schedule0(), 0);
  }

  schedule0() {
    var local = this,
      packets = [],
      packet;

    if (!local.packets.length || !local.connected) return;

    while ((packet = local.packets.shift())) {
      packets.push(packet.data);
    }

    if (!packets.length) return;

    try {
      local.ws.send(JSON.stringify({p: packets}));
    } catch (e) {
      console.log('could not send packets ', e);
      packets.forEach((packet) => local.packets.unshift(packet));
    }
  }

  async start(ondisconnect) {
    var local = this,
      config = local.config;

    if (local._leaving) return;

    local.close();

    this.running = true;

    const ws = (local.ws = new WebSocket(config.wsUrl(), ['connector'], C.augmentRequest({headers: {}}, config)));

    ws.onPing = function () {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = setTimeout(() => {
        if (local.running) ws.terminate();
      }, 30000 + 15000);
    };

    ws.on('open', () => {
      console.log('transport connected');
      local.connected = true;
      ws.onPing();
      local.pinger = setInterval(() => ws.ping(() => null), pingInterval);

      local.onConnect(local);
    });

    ws.on('message', (message) => {
      setTimeout(() => local.onMessages(JSON.parse(message)), 0);
    });

    ws.on('ping', () => ws.onPing());

    ws.on('error', (message) => {
      console.log('error:', message);
    });

    ws.on('close', (message) => {
      local.connected = false;
      clearInterval(local.pinger);

      if (local.running) ondisconnect();
    });
  }

  newDurableWebsocket({endpoint, secret, onConnect, onMessage}) {
    return new DurableWebsocket({endpoint, secret, onConnect, onMessage});
  }

  send(packet) {
    if (!packet) return;

    this.packets.push(packet);
    this.schedule();
  }

  onMessages(msgs) {
    var local = this;

    msgs.p?.forEach((item) => {
      local.onMessage(item);
    });
  }

  onMessage(data) {
    if (!data) return;

    const packet = new Packet(data);

    if (packet.cb() && this.callbacks[packet.cb()]) {
      try {
        this.callbacks[packet.cb()].cb(packet.args());
      } catch (e) {
        console.log('error processing packet', e, packet);
      } finally {
        delete this.callbacks[packet.cb()];
      }

      return;
    }

    return this._onMessage(packet, this);
  }

  newPacket(data, cb, cbKey) {
    const packet = new Packet({...data});

    if (cb) {
      this.callbacks[cbKey || packet.id()] = new Callback({cb});
      packet.cb(cbKey || packet.id());
    }

    return packet;
  }

  clean() {
    var local = this;
    const cbs = {...this.callbacks},
      then = Date.now() - 5 * 60 * 1000;

    Object.keys(cbs).forEach((key) => {
      const cb = cbs[key];
      if (!cb) return;

      if (cb.created < then) {
        console.log('callback timeout', key);

        try {
          cb.cb({error: 'timeout'});
        } catch (e) {
          console.log('error while callback', key, cb, e);
        }

        delete local.callbacks[key];
      }
    });
  }

  leaving() {
    this._leaving = true;
    this.running = false;
  }

  close() {
    clearInterval(this.pinger);
    clearInterval(this.cleaner);

    this.running = false;
    this.connected = false;

    try {
      local.ws.terminate();
    } catch (e) {
      // blank
    }
  }
}

export {Transport};
