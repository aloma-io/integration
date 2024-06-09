import fs from 'node:fs';
import {AbstractController} from '../controller/index.mjs';
import {Connector} from '../internal/index.mjs';

export default class RuntimeContext {
  constructor(
    private controller: AbstractController,
    private data: any
  ) {}

  async start(): Promise<void> {
    const controller = this.controller;

    if (!(controller instanceof AbstractController)) {
      throw new Error('the controller needs to extend AbstractController');
    }

    const data: any = this.data;

    let icon;

    try {
      if (data.icon) {
        icon = fs.readFileSync(data.icon).toString('base64');
      }
    } catch (e) {
      // blank
    }

    const connector = new Connector({
      id: data.id,
      version: data.version,
      name: `${data.id}/${data.version}`,
      icon,
    });

    const configuration = connector.configure().config(data.config || {});

    const resolvers: any = {};
    const methods: string[] = [...data.methods, '__autocomplete', '__endpoint', '__default'];

    methods.forEach((method) => {
      resolvers[method] = async (args) => {
        if (!methods.includes(method)) throw new Error(`${method} not found`);

        return controller[method](args);
      };
    });

    configuration.types(data.types).resolvers(resolvers);

    if (data.options?.endpoint?.enabled) {
      configuration.endpoint((arg) => controller.__endpoint(arg), data.options?.endpoint?.required);
    }

    if (data.auth?.oauth) {
      configuration.oauth(data.auth?.oauth);
    }

    let healthInterval;

    configuration.main(
      async ({newTask, updateTask, config, oauth, getClient, getBlob, getBlobContent, createBlob, healthCheck}) => {
        try {
          clearInterval(healthInterval);

          await controller._doStop();
          await controller._doStart(config, oauth, newTask, updateTask, getClient, getBlob, getBlobContent, createBlob);

          healthInterval = setInterval(() => healthCheck(controller), 30000).unref();

          await healthCheck(controller);
        } catch (e) {
          console.log(e);
        }
      }
    );

    connector.run();

    const term = async () => {
      clearInterval(healthInterval);
      await controller._doStop(true);

      process.exit(0);
    };

    process.on('SIGTERM', term);
    process.on('SIGINT', term);
  }
}
