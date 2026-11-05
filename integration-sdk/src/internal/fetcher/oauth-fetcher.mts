import Fetcher from './fetcher.mjs';

class OAuthFetcher extends Fetcher {
  oauth: any;
  _getToken: any;
  used: boolean = false;
  constructor({oauth, retry = 5, getToken, baseUrl, onResponse, customize}) {
    super({retry, baseUrl, onResponse, customize});

    this.oauth = oauth;
    this._getToken = getToken;
  }

  async __healthCheck() {
    if (this.used && !this.oauth.accessToken()) throw new Error('no access token');
  }

  /**
   * the access token for a call
   * @param force refresh the token even if one is stored
   * @param staleToken the token the failed attempt was sent with; when another call has refreshed since, that token is used
   */
  async getToken(force, staleToken?: string) {
    var local = this,
      oauth = local.oauth;

    this.used = true;

    if (local._getToken) return local._getToken(force);

    const current = oauth.accessToken();

    if (current && (!force || (staleToken && current !== staleToken))) return current;

    return oauth.refreshAccessToken();
  }

  // a 401 is retried with a refreshed token; an error that ends the refresh is not retried
  protected retryable(e: any, options: any): boolean {
    if (e?.noRetry) return false;

    return e.status === 401 || super.retryable(e, options);
  }

  async onError(e, url, options, retries, args, wait: number = 500) {
    var local = this;

    return new Promise((resolve, reject) => {
      setTimeout(
        async () => {
          try {
            resolve(
              await local.fetch(url, options, retries, {
                forceTokenRefresh: e.status === 401,
                staleToken: `${options?.headers?.Authorization || ''}`.replace(/^Bearer /, '') || undefined,
              })
            );
          } catch (e) {
            reject(e);
          }
        },
        wait
      );
    });
  }

  async periodicRefresh() {
    const local = this,
      oauth = local.oauth;

    console.log('refreshing oauth token, have token', !!oauth.refreshToken());
    if (!oauth.refreshToken()) return;

    await local.getToken(true);

    console.log('refreshed oauth token');
  }

  async customize(options: any, args: any = {}) {
    const local = this;

    if (this.customize0) await this.customize0(options, args);

    const token = await local.getToken(args.forceTokenRefresh, args.staleToken);

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
  private refreshing: Promise<string> | null = null;
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

  /**
   * exchange the refresh token for a new access token and store it; calls that arrive while an exchange is
   * running share it
   */
  refreshAccessToken(): Promise<string> {
    return (this.refreshing ||= this.exchange().finally(() => {
      this.refreshing = null;
    }));
  }

  private async exchange(): Promise<string> {
    const before = this.accessToken();

    try {
      const refreshToken = this.refreshToken();

      if (!refreshToken) {
        throw new Error('have no access_token and no refresh_token');
      }

      const ret = await this.obtainViaRefreshToken(refreshToken);

      if (!ret.access_token) {
        throw new Error('could not obtain access token via refresh token');
      }

      try {
        await this.update(ret.access_token, ret.refresh_token);
      } catch (e: any) {
        // the stored token is not repeated by a retry
        if (e && typeof e === 'object') e.noRetry = true;

        throw e;
      }

      return ret.access_token;
    } catch (e: any) {
      // a client error from the token endpoint ends the call; the same refresh token would be refused again
      if (e?.status >= 400 && e.status < 500) e.noRetry = true;

      // a token that was stored while this exchange ran stays valid
      if (this.accessToken() === before) await this.invalidate(e);

      throw e;
    }
  }

  async periodicRefresh() {
    const clients = this.clients;

    console.log('refreshing oauth clients', clients.length);

    let failure: any;

    for (const client of clients) {
      try {
        await client.periodicRefresh();
      } catch (e) {
        failure ||= e;
      }
    }

    if (failure) throw failure;
  }

  async invalidate(err) {
    this._data.access_token = null;
  }

  getClient(arg: any = {}) {
    const client = new OAuthFetcher({...arg, oauth: this});
    this.clients.push(client);
    return client;
  }
}
