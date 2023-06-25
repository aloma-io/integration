const fetch = require('node-fetch');
const {Registration} = require('./registration.cjs');
const C = require('./constants.cjs');

class Connection {
  constructor({config, onStart}) {
    this.config = config;
    this.onStart = onStart;
  }

  async start() {
    var local = this,
      config = local.config;

    try {
      const response = await fetch(
        config.url() + 'connect',
        C.augmentRequest(
          {
            method: 'POST',
            body: JSON.stringify({}),
            headers: {'Content-Type': 'application/json'},
          },
          config
        )
      );

      if (response.status === 401) {
        config.setToken(await new Registration(local.config).run());

        return await local.start();
      } else if (response.status === 200) {
        config.data(await response.json());

        await local.onStart(() => local.onDisconnect());
      } else {
        setTimeout(() => local.start(), 5000);
      }
    } catch (e) {
      console.log(e);
      setTimeout(() => local.start(), 5000);
    }
  }

  onDisconnect() {
    var local = this;

    setTimeout(() => local.start(), 5000);
  }

  async close() {
    try {
      await fetch(
        this.config.url() + 'disconnect',
        C.augmentRequest(
          {
            method: 'POST',
            body: JSON.stringify({}),
            headers: {'Content-Type': 'application/json'},
          },
          this.config
        )
      );
    } catch (e) {
      // blank
    }
  }
}

module.exports = {Connection};
