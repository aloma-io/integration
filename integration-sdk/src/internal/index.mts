import { init } from "@paralleldrive/cuid2";
import express from "express";
import PromClient from "prom-client";
import { Dispatcher } from "./dispatcher/index.mjs";
import Fetcher from "./fetcher/fetcher.mjs";
import { OAuth } from "./fetcher/oauth-fetcher.mjs";
import { handlePacketError, reply } from "./util/index.mjs";
import JWE from "./util/jwe/index.mjs";
import { Config } from "./websocket/config.mjs";
import { WebsocketConnector } from "./websocket/index.mjs";
const cuid = init({ length: 32 });

class Connector {
  id: any;
  version: any;
  name: any;
  icon: any;
  dispatcher?: Dispatcher;
  constructor({ version, id, name, icon }) {
    this.id = id;
    this.version = version;
    this.name = name;
    this.icon = icon;
  }

  configure() {
    return (this.dispatcher = new Dispatcher());
  }

  async run() {
    var local = this;

    const makeMetrics = () => {
      const metrics = PromClient;

      const defaultLabels = {
        service: local.name,
        connectorId: local.id,
        connectorVersion: local.version,
        node: process.env.HOSTNAME || "test",
      };
      metrics.register.setDefaultLabels(defaultLabels);
      metrics.collectDefaultMetrics();

      return metrics;
    };

    const makeMetricsServer = (metrics) => {
      const app = express();

      app.get("/metrics", async (request, response, next) => {
        response.status(200);
        response.set("Content-type", metrics.contentType);
        response.send(await metrics.register.metrics());
        response.end();
      });

      return app;
    };

    makeMetricsServer(makeMetrics()).listen(4050, "0.0.0.0");

    const { processPacket, start, introspect, configSchema } =
      this.dispatcher!.build();

    const config = new Config({
      id: this.id,
      version: this.version,
      name: process.env.HOSTNAME || this.name,
      registrationToken: process.env.REGISTRATION_TOKEN,
      endpoint: process.env.DEVICE_ENDPOINT || "https://connect.aloma.io/",
      wsEndpoint:
        process.env.WEBSOCKET_ENDPOINT || "wss://connect.aloma.io/transport/",
      privateKey: process.env.PRIVATE_KEY,
      publicKey: process.env.PUBLIC_KEY,
      introspect,
      configSchema,
      icon: this.icon,
    });

    if (Object.keys(configSchema().fields).length) {
      try {
        await config.validateKeys();
      } catch (e) {
        const haveKey = !!process.env.PRIVATE_KEY;
        const jwe = new JWE({});
        var text = "Please double check the env variables";

        if (!haveKey) {
          await jwe.newPair();
          text =
            "fresh keys generated, set environment variables: \n\nPRIVATE_KEY: " +
            (await jwe.exportPrivateAsBase64()) +
            "\n\nPUBLIC_KEY: " +
            (await jwe.exportPublicAsBase64()) +
            "\n";
        }

        console.log(`
Error: 

public (env.PUBLIC_KEY) and private key (env.PRIVATE_KEY) could not be loaded.
      
${text}
        `);

        return;
      }
    }

    const server = new WebsocketConnector({
      config,
      onConnect: (transport) => {
        // @ts-ignore
        local.dispatcher!.onConfig = async function (secrets) {
          const decrypted: any = {};
          const fields = configSchema().fields;

          const keys = Object.keys(secrets);
          const jwe = await config.validateKeys("RSA-OAEP-256");

          for (var i = 0; i < keys.length; ++i) {
            const key = keys[i];
            const value = secrets[key];
            if (!value) continue;

            if (fields[key]?.plain || ["endpointUrl"].includes(key)) {
              decrypted[key] = value;
            } else {
              try {
                decrypted[key] = await jwe.decrypt(value, config.id());
              } catch (e) {
                console.log("failed to decrypt key", key, config.id(), e);
              }
            }
          }

          // @ts-ignore
          this.startOAuth = async function (args) {
            if (!this._oauth) throw new Error("oauth not configured");

            const authorizationURL =
              process.env.OAUTH_AUTHORIZATION_URL ||
              decrypted.authorizationURL ||
              that._oauth.authorizationURL;

            if (!authorizationURL)
              throw new Error("authorizationURL not configured");

            const clientId =
              process.env.OAUTH_CLIENT_ID ||
              decrypted.clientId ||
              this._oauth.clientId;

            if (!clientId) throw new Error("clientId not configured");

            const scopes =
              process.env.OAUTH_SCOPE ||
              decrypted.scope ||
              this._oauth.scope ||
              "";
            const useCodeChallenge = !!that._oauth.useCodeChallenge;

            return {
              url: authorizationURL
                .replace(/\{\{clientId\}\}/gi, encodeURIComponent(clientId))
                .replace(/\{\{scope\}\}/gi, encodeURIComponent(scopes)),
              useCodeChallenge,
            };
          };

          // @ts-ignore
          this.finishOAuth = async function (arg) {
            var that = this;

            const tokenURL =
              process.env.OAUTH_TOKEN_URL ||
              decrypted.tokenURL ||
              that._oauth.tokenURL;

            if (!this._oauth) throw new Error("oauth not configured");
            if (!tokenURL && !this._oauth.finishOAuth)
              throw new Error("need tokenURL or finishOAuth(arg)");

            var data = null;

            const doFinish = async () => {
              if (!arg.code || !arg.redirectURI)
                throw new Error("need code and redirectUri");

              const clientId =
                process.env.OAUTH_CLIENT_ID ||
                decrypted.clientId ||
                that._oauth.clientId;

              if (!clientId) throw new Error("clientId not configured");

              const clientSecret =
                process.env.OAUTH_CLIENT_SECRET ||
                decrypted.clientSecret ||
                that._oauth.clientSecret;
              if (!clientSecret) throw new Error("clientSecret not configured");

              const additionalTokenArgs = that._oauth.additionalTokenArgs || {};
              const useAuthHeader = !!that._oauth.useAuthHeader;
              const useCodeChallenge = !!that._oauth.useCodeChallenge;

              let body = {
                grant_type: "authorization_code",
                ...additionalTokenArgs,
                code: arg.code,
                redirect_uri: arg.redirectURI,
              };

              if (useCodeChallenge) {
                body.code_verifier = arg.codeVerifier;
              }

              let headers: any = {
                "Content-Type":
                  "application/x-www-form-urlencoded;charset=UTF-8",
                Accept: "application/json",
              };

              if (useAuthHeader) {
                headers = {
                  ...headers,
                  Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
                };
              } else {
                body = {
                  ...body,
                  client_id: clientId,
                  client_secret: clientSecret,
                };
              }

              const response = await fetch(tokenURL, {
                method: "POST",
                body: new URLSearchParams(body),
                headers,
                signal: AbortSignal.timeout(60 * 1000),
              });

              const status = await response.status;
              const text = await response.text();

              if (status === 200) {
                const ret = JSON.parse(text);
                if (ret.error) {
                  throw new Error(
                    `${status} ${ret.error} ${ret.error_description || ""}`,
                  );
                } else if (ret.access_token) {
                  return { ...ret };
                } else {
                  throw new Error(
                    status + " response has no access_token - " + text,
                  );
                }
              } else {
                throw new Error(status + " " + text);
              }
            };

            if (this._oauth.finishOAuth) {
              data = await this._oauth.finishOAuth({
                arg,
                doFinish,
                transport,
              });
            } else {
              data = await doFinish();
            }

            const jwe = await config.validateKeys("RSA-OAEP-256");

            return { value: await jwe.encrypt(data, "none", config.id()) };
          };

          const saveOAuthResult = async (what) => {
            const jwe = await config.validateKeys("RSA-OAEP-256");
            const value = await jwe.encrypt(what, "none", config.id());

            const packet = transport.newPacket({});

            packet.method("connector.config-update");
            packet.args({
              value,
            });

            transport.send(packet);
          };

          const that = this;

          const getRefreshToken = async (refreshToken) => {
            const tokenURL =
              process.env.OAUTH_TOKEN_URL ||
              decrypted.tokenURL ||
              that._oauth.tokenURL;

            const clientId =
              process.env.OAUTH_CLIENT_ID ||
              decrypted.clientId ||
              that._oauth.clientId;
            if (!clientId) throw new Error("clientId not configured");

            const clientSecret =
              process.env.OAUTH_CLIENT_SECRET ||
              decrypted.clientSecret ||
              that._oauth.clientSecret;
            if (!clientSecret) throw new Error("clientSecret not configured");

            const useAuthHeader = !!that._oauth.useAuthHeader;

            let headers = {};

            if (useAuthHeader) {
              headers = {
                ...headers,
                Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
              };
            }

            const response = await fetch(tokenURL, {
              method: "POST",
              body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret,
              }),
              headers: {
                "Content-Type":
                  "application/x-www-form-urlencoded;charset=UTF-8",
                Accept: "application/json",
                ...headers,
              },
              signal: AbortSignal.timeout(60 * 1000),
            });

            const status = await response.status;
            const text = await response.text();

            if (status === 200) {
              return JSON.parse(text);
            } else {
              throw new Error(
                "could not get refresh token " + status + " " + text,
              );
            }
          };

          const theOAuth = decrypted.oauthResult
            ? new OAuth(decrypted.oauthResult, saveOAuthResult, getRefreshToken)
            : null;

          if (theOAuth) {
            // @ts-ignore
            clearInterval(this._refreshOAuthToken);

            if (!(this._oauth.noPeriodicTokenRefresh === false)) {
              // @ts-ignore
              this._refreshOAuthToken = setInterval(
                async () => {
                  try {
                    console.log("refreshing oauth token");
                    await theOAuth.periodicRefresh();
                  } catch (e) {
                    console.log("periodic refresh", e);
                  }
                },
                this._oauth.tokenRefreshPeriod || 4 * 60 * 60 * 15000,
              );
            }
          }

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
                (ret) =>
                  ret?.error ? reject(ret.error) : resolve(ret?.content),
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

          start({
            config: decrypted,
            oauth: theOAuth,
            getBlob,
            getBlobContent,
            createBlob,
            healthCheck: async (controller) => {
              let result: any = { ok: true };

              try {
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
              theOAuth ? theOAuth.getClient(arg) : new Fetcher(arg),
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
      },
      onMessage: async (packet, transport) => {
        try {
          const ret = await processPacket(packet);
          if (ret) reply(ret, packet, transport);
        } catch (e) {
          console.log(e);
          handlePacketError(packet, e, transport);
        }
      },
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

    await server.start();
  }
}

export { Connector };
