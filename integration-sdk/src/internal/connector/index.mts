import {Dispatcher} from '../dispatcher/index.mjs';
import {makeConfig} from './config.mjs';
import {makeMetrics} from './metrics.mjs';
import {makeServer} from './server/index.mjs';

export class Connector {
  id: any;
  version: any;
  name: any;
  icon: any;
  dispatcher!: Dispatcher;
  constructor({version, id, name, icon}) {
    this.id = id;
    this.version = version;
    this.name = name;
    this.icon = icon;
  }

  configure() {
    return (this.dispatcher = new Dispatcher());
  }

  async run() {
    console.log(`Running ${this.name}`);

    const {processPacket, start, introspect, configSchema} = this.dispatcher.build();

    const config = await makeConfig({
      id: this.id,
      version: this.version,
      name: this.name,
      introspect,
      configSchema,
      icon: this.icon,
    });

    await makeMetrics({
      id: this.id,
      name: this.name,
      version: this.version,
    });

    const server = await makeServer({
      config,
      configSchema,
      start,
      processPacket,
      dispatcher: this.dispatcher,
    });

    await server.start();
  }
}
