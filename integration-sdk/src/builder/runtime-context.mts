import fs from 'node:fs';
import {AbstractController} from '../controller/index.mjs';
import {Connector} from '../internal/index.mjs';

/**
 * Build a resolvers object from a list of method names and a controller.
 *
 * If a method name contains dots (e.g. 'crm.contacts.create'), it is registered
 * as a nested object tree so that resolveMethod(['crm', 'contacts', 'create'])
 * finds the handler.
 *
 * If a method name has no dots (e.g. 'contactsCreate'), it is registered flat
 * as before: resolvers.contactsCreate = handler.
 */
export function buildResolvers(methods: string[], controller: any): any {
  const resolvers: any = {};

  methods.forEach((method) => {
    const handler = async (args: any, ctx?: any) => {
      if (!methods.includes(method)) throw new Error(`${method} not found`);
      return controller[method](args, ctx);
    };

    if (method.includes('.')) {
      // Register nested tree for array-based resolution: ["crm", "contacts", "getPage"]
      const parts = method.split('.');
      let node = resolvers;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node[parts[i]] || typeof node[parts[i]] !== 'object') {
          node[parts[i]] = {};
        }
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = handler;
      // Also register flat dotted key for string-based resolution: ["crm.contacts.getPage"]
      resolvers[method] = handler;
    } else {
      resolvers[method] = handler;
    }
  });

  return resolvers;
}

/**
 * Runtime context to manage the lifecycle of the connector
 */
export default class RuntimeContext {
  constructor(
    private controller: AbstractController,
    private data: any
  ) {}

  /**
   * start the connector
   */
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

    const methods: string[] = [...data.methods, '__autocomplete', '__endpoint', '__default'];
    const resolvers = buildResolvers(methods, controller);

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
