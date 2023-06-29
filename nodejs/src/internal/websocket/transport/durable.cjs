const WebSocket = require("ws");

class DurableWebsocket {
  constructor({ endpoint, secret, onConnect, onMessage }) {
    this.endpoint = endpoint;
    this.secret = secret;
    this.onConnect = onConnect;
    this.onMessage = onMessage;
    this.failed = [];
    this.fails = 0;
    this.start();
  }

  async send(what) {
    try {
      return await this.ws.send(JSON.stringify(what));
    } catch (e) {
      this.failed.push(what);
    }
  }

  start() {
    var local = this;

    if (local.connecting || local.closed) return;
    local.connecting = true;

    const ws = (local.ws = new WebSocket(local.endpoint, [], {
      rejectUnauthorized: false,
      headers: { Authorization: `Bearer ${local.secret}` },
    }));

    ws.on("open", () => {
      local.connecting = false;
      local.fails = 0;

      var item;

      while ((item = local.failed.shift())) {
        local.send(item);
      }

      local.onConnect(local);
    });

    ws.on("message", (message) => {
      setImmediate(() => local.onMessage(JSON.parse(message)));
    });

    ws.on("error", (message) => {
      if (local.fails > 50) console.log("error:", message.message);

      ++local.fails;
    });

    ws.on("close", (message) => {
      local.connecting = false;

      if (!local.closed) setTimeout(() => local.start(), 5000);
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;

    await this.ws?.close();
  }
}

module.exports = { DurableWebsocket };
