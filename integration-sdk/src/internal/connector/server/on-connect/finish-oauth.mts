import Dispatcher from '../../../dispatcher/index.mjs';
import {Config} from '../../../websocket/config.mjs';
import {WebsocketConnector} from '../../../websocket/index.mjs';

export const patchFinishOAuth = async ({
  dispatcher,
  decrypted,
  config,
  transport,
}: {
  dispatcher: Dispatcher;
  decrypted: any;
  config: Config;
  transport: WebsocketConnector;
}) => {
  dispatcher.finishOAuth = async function (arg: {
    code: string;
    redirectURI: string;
    codeVerifier?: string;
  }): Promise<{value: string}> {
    const tokenURL = process.env.OAUTH_TOKEN_URL || decrypted.tokenURL || dispatcher._oauth.tokenURL;

    if (!dispatcher._oauth) throw new Error('oauth not configured');
    if (!tokenURL && !dispatcher._oauth.finishOAuth) throw new Error('need tokenURL or finishOAuth(arg)');

    var data = null;

    const doFinish = async () => {
      if (!arg.code || !arg.redirectURI) throw new Error('need code and redirectUri');

      const clientId = decrypted.clientId || process.env.OAUTH_CLIENT_ID || dispatcher._oauth.clientId;

      if (!clientId) throw new Error('clientId not configured');

      const clientSecret = decrypted.clientSecret || process.env.OAUTH_CLIENT_SECRET || dispatcher._oauth.clientSecret;
      if (!clientSecret) throw new Error('clientSecret not configured');

      const additionalTokenArgs = dispatcher._oauth.additionalTokenArgs || {};
      const useAuthHeader = !!dispatcher._oauth.useAuthHeader;
      const useCodeChallenge = !!dispatcher._oauth.useCodeChallenge;

      let body = {
        grant_type: 'authorization_code',
        ...additionalTokenArgs,
        code: arg.code,
        redirect_uri: arg.redirectURI,
      };

      if (useCodeChallenge) {
        body.code_verifier = arg.codeVerifier;
      }

      let headers: any = {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json',
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
        method: 'POST',
        body: new URLSearchParams(body),
        headers,
        signal: AbortSignal.timeout(60 * 1000),
      });

      const status = await response.status;
      const text = await response.text();

      if (status === 200) {
        const ret = JSON.parse(text);
        if (ret.error) {
          throw new Error(`${status} ${ret.error} ${ret.error_description || ''}`);
        } else if (ret.access_token) {
          return {...ret};
        } else {
          throw new Error(status + ' response has no access_token - ' + text);
        }
      } else {
        throw new Error(status + ' ' + text);
      }
    };

    if (dispatcher._oauth.finishOAuth) {
      data = await dispatcher._oauth.finishOAuth({
        arg,
        doFinish,
        transport,
      });
    } else {
      data = await doFinish();
    }

    const jwe = await config.validateKeys('RSA-OAEP-256');

    return {value: await jwe.encrypt(data, 'none', config.id())};
  };
};
