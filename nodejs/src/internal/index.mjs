import { init } from "@paralleldrive/cuid2";
import express from "express";
import PromClient from "prom-client";
import { Dispatcher } from "./dispatcher/index.mjs";
import JWE from "./util/jwe/index.mjs";
import { Config } from "./websocket/config.mjs";
import { WebsocketConnector } from "./websocket/index.mjs";
const cuid = init({ length: 32 });

const handlePacketError = (packet, e, transport) => {
  if (!packet.cb()) {
    console.dir({ msg: "packet error", e, packet }, { depth: null });
    return;
  }

  transport.send(transport.newPacket({ c: packet.cb(), a: { error: "" + e } }));
};

const reply = (arg, packet, transport) => {
  if (!packet.cb()) {
    console.dir(
      { msg: "cannot reply to packet without cb", arg, packet },
      { depth: null },
    );
    return;
  }

  transport.send(transport.newPacket({ c: packet.cb(), a: { ...arg } }));
};

const unwrap0 = (ret, body, options) => {
  if (options?.bodyOnly === false) {
    return { status: ret.status, headers: ret.headers, body };
  } else {
    return body;
  }
};

const unwrap = async (ret, options) => {
  if (options?.text) return unwrap0(ret, await ret.text(), options);
  if (options?.base64) {
    const base64 = Buffer.from(await ret.arrayBuffer()).toString("base64");

    return unwrap0(ret, base64, options);
  }
  
  if (options?.skipResponseBody) {
    return { status: ret.status, headers: ret.headers};
  }

  const text = await ret.text();

  try {
    return unwrap0(ret, JSON.parse(text), options);
  } catch (e) {
    throw e + " " + text;
  }
};

class Fetcher {
  constructor({ retry = 5, baseUrl, onResponse, customize }) {
    this.retry = retry;
    this.baseUrl = baseUrl;
    this.onResponse = onResponse;
    if (customize) this.customize0 = customize;
  }

  async customize(options = {}, args = {}) {
    if (this.customize0) await this.customize0(options, args);
  }

  async onError(e, url, options, retries, args, rateLimit) {
    var local = this;

    return new Promise((resolve, reject) => {
      setTimeout(
        async () => {
          try {
            resolve(await local.fetch(url, options, retries, args));
          } catch (e) {
            reject(e);
          }
        },
        rateLimit ? 10000 : 500,
      );
    });
  }

  async fetch(url, options = {}, retries, args = {}) {
    var local = this,
      baseUrl = local.baseUrl;

    if (retries == null) retries = local.retry;

    let theURL = !baseUrl
      ? url
      : `${baseUrl?.endsWith("/") ? baseUrl : baseUrl + "/"}${url}`.replace(
          /\/\/+/gi,
          "/",
        );

    try {
      options.url = url;
      await local.customize(options, args);

      url = options.url;
      delete options.url;

      theURL = !baseUrl
        ? url
        : `${baseUrl?.endsWith("/") ? baseUrl : baseUrl + "/"}${url}`.replace(
            /\/\/+/gi,
            "/",
          );

      if (!options?.headers || !options?.headers?.Accept) {
        options.headers = {
          ...options.headers,
          Accept: "application/json",
        };
      }

      if (!options?.headers || !options?.headers?.["Content-type"]) {
        options.headers = {
          ...options.headers,
          "Content-type": "application/json",
        };
      }

      if (
        !(options?.method === "GET" || options?.method === "HEAD") &&
        options?.body &&
        !(typeof options.body === "string") &&
        options?.headers?.["Content-type"] === "application/json"
      ) {
        options.body = JSON.stringify(options.body);
      }

      const timeout = Math.min(options?.timeout || 30 * 60 * 1000, 30 * 60 * 1000);
      const ret = await fetch(theURL, {
        ...options,
        signal: AbortSignal.timeout(timeout),
      });
      const status = await ret.status;

      if (status > 399) {
        const text = await ret.text();
        const e = new Error(status + " " + text);

        e.status = status;
        throw e;
      }

      if (local.onResponse) {
        await local.onResponse(ret);
      }

      return unwrap(ret, options);
    } catch (e) {
      // too many requests
      if (e.status === 429) {
        return local.onError(e, url, options, retries, args, true);
      }

      // bad request
      if (e.status === 400 || e.status === 422) {
        throw e;
      }

      --retries;

      console.log(theURL, e);

      if (retries <= 0) throw e;

      return local.onError(e, url, options, retries, args);
    }
  }
}

class OAuthFetcher extends Fetcher {
  constructor({ oauth, retry = 5, getToken, baseUrl, onResponse, customize }) {
    super({ retry, baseUrl, onResponse, customize });

    this.oauth = oauth;
    this._getToken = getToken;
  }

  async getToken(force) {
    var local = this,
      oauth = local.oauth;

    if (local._getToken) return local._getToken(force);

    if (!force && oauth.accessToken()) return oauth.accessToken();

    const refreshToken = oauth.refreshToken();

    try {
      if (!refreshToken) {
        throw new Error("have no access_token and no refresh_token");
      }

      const ret = await oauth.obtainViaRefreshToken(oauth.refreshToken());

      if (ret.access_token) {
        oauth.update(ret.access_token, ret.refresh_token);

        return ret.access_token;
      } else {
        throw new Error("could not obtain access token via refresh token");
      }
    } catch (e) {
      oauth.invalidate(e);

      throw e;
    }
  }

  async onError(e, url, options, retries, args, rateLimit) {
    var local = this;

    return new Promise((resolve, reject) => {
      setTimeout(
        async () => {
          try {
            resolve(
              await local.fetch(url, options, retries, {
                forceTokenRefresh: e.status === 401,
              }),
            );
          } catch (e) {
            reject(e);
          }
        },
        rateLimit ? 10000 : 500,
      );
    });
  }

  async periodicRefresh() {
    const local = this,
      oauth = local.oauth;

    console.log("refreshing oauth token, have token", !!oauth.refreshToken());
    if (!oauth.refreshToken()) return;

    await local.getToken(true);

    console.log("refreshed oauth token");
  }

  async customize(options, args = {}) {
    const local = this;

    if (this.customize0) await this.customize0(options, args);

    const token = await local.getToken(args.forceTokenRefresh);

    options.headers = {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    };
  }
}

class OAuth {
  constructor(data, saveOAuthResult, getRefreshToken) {
    var local = this;
    this._data = data || {};
    this.saveOAuthResult = saveOAuthResult;
    this.obtainViaRefreshToken = getRefreshToken;
    this.clients = [];
  }

  data() {
    return this._data;
  }

  accessToken() {
    return this._data.access_token;
  }

  refreshToken() {
    return this._data.refresh_token;
  }

  async update(accessToken, refreshToken) {
    this._data.access_token = accessToken;

    if (refreshToken) {
      this._data.refresh_token = refreshToken;
    }

    await this.saveOAuthResult(this._data);
  }

  async periodicRefresh() {
    const clients = this.clients;

    console.log("refreshing oauth clients", clients.length);

    for (let i = 0; i < clients.length; ++i) {
      const client = clients[0];

      await client.periodicRefresh();
    }
  }

  async invalidate(err) {
    if (true) return;
    //if (this._data.access_token === "invalid") return;
  }

  getClient(arg = {}) {
    const client = new OAuthFetcher({ ...arg, oauth: this });
    this.clients.push(client);
    return client;
  }
}

class Connector {
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
      this.dispatcher.build();

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
        local.dispatcher.onConfig = async function (secrets) {
          const decrypted = {};
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

          this.startOAuth = async function (args) {
            if (!this._oauth) throw new Error("oauth not configured");

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
              url: this._oauth.authorizationURL
                .replace(/\{\{clientId\}\}/gi, encodeURIComponent(clientId))
                .replace(/\{\{scope\}\}/gi, encodeURIComponent(scopes)),
              useCodeChallenge,
            };
          };

          this.finishOAuth = async function (arg) {
            var that = this;

            if (!this._oauth) throw new Error("oauth not configured");
            if (!this._oauth.tokenURL && !this._oauth.finishOAuth)
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

              let headers = {
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

              const response = await fetch(that._oauth.tokenURL, {
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

            const response = await fetch(that._oauth.tokenURL, {
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
            clearInterval(this._refreshOAuthToken);

            if (!(this._oauth.noPeriodicTokenRefresh === false)) {
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
          resolve();
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
