import { init } from "@paralleldrive/cuid2";
import Dispatcher from "../../../dispatcher/index.mjs";
import Fetcher from "../../../fetcher/fetcher.mjs";
import { Config } from "../../../websocket/config.mjs";
import { decryptConfig } from "./decrypt-config.mjs";
import { patchFinishOAuth } from "./finish-oauth.mjs";
import { makeOAuth } from "./make-oauth.mjs";
import { patchStartOAuth } from "./start-oauth.mjs";

const cuid = init({ length: 32 });

export const onConnect = ({
  dispatcher,
  configSchema,
  config,
  start,
}: {
  config: Config;
  configSchema: any;
  start: any;
  dispatcher: Dispatcher;
}) => {
  return async (transport) => {
    dispatcher.onConfig = async function (secrets) {
      const decrypted: any = await decryptConfig({
        configSchema,
        secrets,
        config,
      });

      await patchStartOAuth({ dispatcher, decrypted });
      await patchFinishOAuth({ dispatcher, decrypted, config, transport });

      const theOAuth = await makeOAuth({
        config,
        transport,
        decrypted,
        dispatcher,
      });

      const getBlob = (id) => {
        return new Promise((resolve, reject) => {
          const packet = transport.newPacket(
            {},
            (ret) => (ret?.error ? reject(ret.error) : resolve(ret)),
            `_req-${cuid()}`,
          );

          packet.method("connector.blob.get");
          packet.args({
            id,
          });

          transport.send(packet);
        });
      };

      const getBlobContent = (id) => {
        return new Promise((resolve, reject) => {
          const packet = transport.newPacket(
            {},
            (ret) => (ret?.error ? reject(ret.error) : resolve(ret?.content)),
            `_req-${cuid()}`,
          );

          packet.method("connector.blob.get-content");
          packet.args({
            id,
          });

          transport.send(packet);
        });
      };

      const createBlob = (args = {}) => {
        return new Promise((resolve, reject) => {
          const packet = transport.newPacket(
            {},
            (ret) => (ret?.error ? reject(ret.error) : resolve(ret?.id)),
            `_req-${cuid()}`,
          );

          packet.method("connector.blob.create");
          packet.args(args);

          transport.send(packet);
        });
      };

      let oauthClient;

      start({
        config: decrypted,
        oauth: theOAuth,
        getBlob,
        getBlobContent,
        createBlob,
        healthCheck: async (controller) => {
          let result: any = { ok: true, error: null };

          try {
            if (oauthClient) {
              await oauthClient.__healthCheck();
            }

            await controller.__healthCheck();
          } catch (e: any) {
            result.ok = false;
            result.error = e.message;
          }

          const packet = transport.newPacket({});

          packet.method("connector.health.check");
          packet.args(result);

          transport.send(packet);
        },
        getClient: (arg) =>
          theOAuth ? (oauthClient = theOAuth.getClient(arg)) : new Fetcher(arg),
        newTask: (name, data) => {
          return new Promise((resolve, reject) => {
            const packet = transport.newPacket(
              {},
              (ret) => (ret?.error ? reject(ret.error) : resolve(ret)),
              `_req-${cuid()}`,
            );

            packet.method("connector.task.new");
            packet.args({
              name,
              a: data,
            });

            transport.send(packet);
          });
        },
        updateTask: (id, data) => {
          return new Promise((resolve, reject) => {
            const packet = transport.newPacket(
              {},
              (ret) => (ret?.error ? reject(ret.error) : resolve(ret)),
              `_req-${cuid()}`,
            );

            packet.method("connector.task.update");
            packet.args({
              id,
              a: data,
            });

            transport.send(packet);
          });
        },
      });
    };
  };
};
