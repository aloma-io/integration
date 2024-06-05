import Dispatcher from "../../dispatcher/index.mjs";
import { Config } from "../../websocket/config.mjs";
import { WebsocketConnector } from "../../websocket/index.mjs";
import { onConnect } from "./on-connect/index.mjs";
import { onMessage } from "./on-message.mjs";

export const makeServer = async ({config, configSchema, start, processPacket, dispatcher}: {config: Config, configSchema: any, start: any, processPacket: any, dispatcher: Dispatcher}): Promise<WebsocketConnector> => {
  const server = new WebsocketConnector({
    config,
    onConnect: onConnect({config, configSchema, dispatcher, start}),
    onMessage: onMessage(processPacket)
  });

  const term = async () => {
    await server.leaving();

    await new Promise((resolve) => {
      setTimeout(async () => {
        await server.close();
        resolve(null);
      }, 10000);
    });

    process.exit(0);
  };

  process.on("uncaughtException", (e) => {
    console.log(e);
  });

  process.on("unhandledRejection", (e) => {
    console.log(e);
  });

  process.on("SIGTERM", term);
  process.on("SIGINT", term);

  return server;
}