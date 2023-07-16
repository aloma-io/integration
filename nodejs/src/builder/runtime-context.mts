import { AbstractController } from "../controller/index.mjs";
import { Connector } from "../internal/index.mjs";

export default class RuntimeContext {
  constructor(private controller: AbstractController, private data: any) {}

  async start(): Promise<void> {
    const controller = this.controller;

    if (!(controller instanceof AbstractController))
      throw new Error("the controller needs to extend AbstractController");
    const data: any = this.data;

    const connector = new Connector({
      id: data.id,
      version: data.version,
      name: `${data.id}/${data.version}`,
    });

    const configuration = connector.configure().config(data.config || {});

    const resolvers: any = {};
    const methods: string[] = [
      ...data.methods,
      "__endpoint",
      "__configQuery",
      "__default",
    ];

    methods.forEach((method) => {
      resolvers[method] = async (args) => {
        if (!methods.includes(method)) throw new Error(`${method} not found`);

        return controller[method](args);
      };
    });

    configuration.types(data.types).resolvers(resolvers);

    if (data.options?.endpoint?.enabled) {
      configuration.endpoint((arg) => controller.__endpoint(arg));
    }

    if (data.auth?.oauth) {
      configuration.oauth(data.auth?.oauth);
    }

    configuration.main(
      async ({ newTask, updateTask, config, oauth, getClient }) => {
        try {
          await controller._doStop();
          await controller._doStart(
            config,
            oauth,
            newTask,
            updateTask,
            getClient
          );
        } catch (e) {
          console.log(e);
        }
      }
    );

    connector.run();
  }
}
