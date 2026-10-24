import {AbstractController} from '../controller/index.mjs';
import {buildResolvers} from '../builder/runtime-context.mjs';
import type RuntimeContext from '../builder/runtime-context.mjs';
import {Connector} from '../internal/connector/index.mjs';

/**
 * Turn what a connector repo builds (`await new Builder()...build()` gives a RuntimeContext) into a configured
 * `Connector` that the ConnectorHarness can run, without calling `connector.run()` (which starts a metrics
 * server on a fixed port and installs process signal handlers).
 *
 * This repeats the wiring of RuntimeContext.start(): methods become resolvers, config/oauth/endpoint are applied,
 * main() starts the controller and sends a health check. If RuntimeContext.start() changes, change this too.
 */
export const connectorFromRuntimeContext = (context: RuntimeContext): Connector => {
  const {controller, data} = context as any as {controller: AbstractController; data: any};

  if (!(controller instanceof AbstractController)) {
    throw new Error('the controller needs to extend AbstractController');
  }

  const connector = new Connector({
    id: data.id,
    version: data.version,
    name: `${data.id}/${data.version}`,
    icon: undefined,
  });

  const configuration = connector.configure().config(data.config || {});
  const methods: string[] = [...data.methods, '__autocomplete', '__endpoint', '__default'];

  configuration.types(data.types).resolvers(buildResolvers(methods, controller));

  if (data.options?.endpoint?.enabled) {
    configuration.endpoint((arg) => (controller as any).__endpoint(arg), data.options?.endpoint?.required);
  }

  if (data.auth?.oauth) {
    configuration.oauth(data.auth?.oauth);
  }

  configuration.main(
    async ({newTask, updateTask, config, oauth, getClient, getBlob, getBlobContent, createBlob, healthCheck}) => {
      await (controller as any)._doStop();
      await (controller as any)._doStart(config, oauth, newTask, updateTask, getClient, getBlob, getBlobContent, createBlob);
      await healthCheck(controller);
    }
  );

  return connector;
};
