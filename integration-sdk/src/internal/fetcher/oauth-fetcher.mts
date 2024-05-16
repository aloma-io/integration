import Fetcher from "./fetcher.mjs";

class OAuthFetcher extends Fetcher {
  oauth: any;
  _getToken: any;
  used: boolean = false;
  constructor({ oauth, retry = 5, getToken, baseUrl, onResponse, customize }) {
    super({ retry, baseUrl, onResponse, customize });

    this.oauth = oauth;
    this._getToken = getToken;
  }
  
  async __healthCheck() {
    if (this.used && !this.oauth.accessToken()) throw new Error('no access token');
  }

  async getToken(force) {
    var local = this,
      oauth = local.oauth;
      
    this.used = true;
      
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

  async customize(options: any, args: any = {}) {
    const local = this;

    if (this.customize0) await this.customize0(options, args);

    const token = await local.getToken(args.forceTokenRefresh);

    options.headers = {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    };
  }
}

export class OAuth {
  _data: any;
  saveOAuthResult: any;
  obtainViaRefreshToken: any;
  clients: any[];
  constructor(data, saveOAuthResult, getRefreshToken) {
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
    this._data.access_token = null;
  }

  getClient(arg: any = {}) {
    const client = new OAuthFetcher({ ...arg, oauth: this });
    this.clients.push(client);
    return client;
  }
}
