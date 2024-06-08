import C from './constants.mjs';

class Registration {
  constructor(config) {
    this.config = config;
  }

  async run() {
    var local = this;
    const config = this.config;
    const configSchema = config.configSchema();
    const intro = await config.introspect();
    const icon = config.icon();

    const response = await fetch(
      config.url() + 'register',
      C.augmentRegistration(
        {
          method: 'POST',
          body: JSON.stringify({
            deployment: process.env.DEPLOYMENT || '',
            name: config.name(),
            version: config.version(),
            id: config.id(),
            publicKey: config.publicKey(),
            schema: {configSchema, introspect: intro},
            icon,
          }),
          headers: {'Content-Type': 'application/json'},
          signal: AbortSignal.timeout(60 * 1000),
        },
        config
      )
    );

    if (response.status === 200) return (await response.json()).key;

    throw new Error('authentication failed');
  }
}

export {Registration};
