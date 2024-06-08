import {Registration} from './registration.mjs';
import C from './constants.mjs';

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
            signal: AbortSignal.timeout(60 * 1000),
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
            signal: AbortSignal.timeout(60 * 1000),
          },
          this.config
        )
      );
    } catch (e) {
      // blank
    }
  }
}

export {Connection};
