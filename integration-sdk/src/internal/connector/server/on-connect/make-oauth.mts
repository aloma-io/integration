import Dispatcher from "../../../dispatcher/index.mjs";
import { OAuth } from "../../../fetcher/oauth-fetcher.mjs";
import { Config } from "../../../websocket/config.mjs";

export const makeOAuth = async ({
  config,
  transport,
  decrypted,
  dispatcher,
}: {
  config: Config;
  transport: any;
  decrypted: any;
  dispatcher: Dispatcher;
}) => {
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

  const getRefreshToken = async (refreshToken) => {
    const tokenURL =
      process.env.OAUTH_TOKEN_URL ||
      decrypted.tokenURL ||
      dispatcher._oauth.tokenURL;

    const clientId =
      decrypted.clientId ||
      process.env.OAUTH_CLIENT_ID ||
      dispatcher._oauth.clientId;
    if (!clientId) throw new Error("clientId not configured");

    const clientSecret =
      decrypted.clientSecret ||
      process.env.OAUTH_CLIENT_SECRET ||
      dispatcher._oauth.clientSecret;
    if (!clientSecret) throw new Error("clientSecret not configured");

    const useAuthHeader = !!dispatcher._oauth.useAuthHeader;

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
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
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
      throw new Error("could not get refresh token " + status + " " + text);
    }
  };

  const theOAuth = dispatcher._oauth
    ? new OAuth(decrypted.oauthResult, saveOAuthResult, getRefreshToken)
    : null;

  if (theOAuth) {
    clearInterval(dispatcher._refreshOAuthToken);

    if (!(dispatcher._oauth.noPeriodicTokenRefresh === false)) {
      dispatcher._refreshOAuthToken = setInterval(
        async () => {
          try {
            console.log("refreshing oauth token");
            await theOAuth.periodicRefresh();
          } catch (e) {
            console.log("periodic refresh", e);
          }
        },
        dispatcher._oauth.tokenRefreshPeriod || 4 * 60 * 60 * 15000,
      );
    }
  }

  return theOAuth;
};
