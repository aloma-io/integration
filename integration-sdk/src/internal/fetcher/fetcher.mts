import {unwrap} from '../util/index.mjs';

/**
 * http request fetcher
 */
export default class Fetcher {
  protected retry: number;
  protected baseUrl: any;
  protected onResponse: any;
  protected customize0: any;
  constructor({
    retry = 5,
    baseUrl,
    onResponse,
    customize,
  }: {
    retry?: number;
    baseUrl?: string;
    onResponse?: (response: Response) => void;
    customize?: (request: {[key: string]: any}) => void;
  } = {}) {
    this.retry = retry;
    this.baseUrl = baseUrl;
    this.onResponse = onResponse;
    if (customize) this.customize0 = customize;
  }

  async getToken(force: boolean): Promise<string> {
    throw new Error('not implemented');
  }

  protected async customize(options = {}, args = {}) {
    if (this.customize0) await this.customize0(options, args);
  }

  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * delay before retrying: Retry-After when the server sends one (capped at 60 s), otherwise 10 s for
   * rate limits and 500 ms for other errors
   */
  protected retryDelay(e: any, rateLimit?: boolean): number {
    const header = e?.retryAfter;
    if (header) {
      const seconds = Number(header);
      const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
      if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, 60 * 1000);
    }

    return rateLimit ? 10000 : 500;
  }

  protected async onError(e: any, url: string, options: any, retries: number, args: any, rateLimit?) {
    await this.wait(this.retryDelay(e, rateLimit));

    return this.fetch(url, options, retries, args);
  }

  /**
   * fetch data from a url
   * @param url url to fetch
   * @param options request options
   * @param retries retries left for the request
   * @param args optional args for customize()
   * @returns
   */
  async fetch(
    url: string,
    options?: {
      /**
       * request method like GET, POST, PUT, DELETE
       */
      method?: string;
      /**
       * request headers like Accept, Content-type
       */
      headers?: {[key: string]: any};
      /**
       * request body like "hello world" or {hello: "world"}
       */
      body?: any;
    },
    retries?: number,
    args: any = {}
  ) {
    var local = this,
      baseUrl = local.baseUrl;
    options ||= {};

    const options0: any = {...options};

    if (retries == null) retries = local.retry;

    let theURL = !baseUrl ? url : `${baseUrl?.endsWith('/') ? baseUrl : baseUrl + '/'}${url}`.replace(/\/\/+/gi, '/');

    try {
      options0.url = url;
      await local.customize(options0, args);

      url = options0.url;
      delete options0.url;

      theURL = !baseUrl ? url : `${baseUrl?.endsWith('/') ? baseUrl : baseUrl + '/'}${url}`.replace(/\/\/+/gi, '/');

      if (!options0?.headers || !options0?.headers?.Accept) {
        options0.headers = {
          ...options0.headers,
          Accept: 'application/json',
        };
      }

      if ((!options0?.headers || !options0?.headers?.['Content-type']) && !(options0?.body instanceof FormData)) {
        options0.headers = {
          ...options0.headers,
          'Content-type': 'application/json',
        };
      }

      if (
        !(options0?.method === 'GET' || options0?.method === 'HEAD') &&
        options0?.body &&
        !(typeof options0.body === 'string') &&
        options0?.headers?.['Content-type'] === 'application/json'
      ) {
        options0.body = JSON.stringify(options0.body);
      }

      const timeout = Math.min(options0?.timeout || 30 * 60 * 1000, 30 * 60 * 1000);
      const ret = await fetch(theURL, {
        ...options0,
        signal: AbortSignal.timeout(timeout),
      });
      const status = await ret.status;

      if (status > 399) {
        const text = await ret.text();
        const e: any = new Error(status + ' ' + text);

        e.status = status;
        e.retryAfter = ret.headers?.get?.('retry-after');
        throw e;
      }

      if (local.onResponse) {
        await local.onResponse(ret);
      }

      if (status === 204) {
        return {ok: true};
      }

      return unwrap(ret, options0);
    } catch (e: any) {
      // bad request
      if (e.status === 400 || e.status === 422) {
        throw e;
      }

      // too many requests count against the same retry limit, so a rate limit cannot retry forever
      const rateLimit = e.status === 429;

      // the query string can carry personal data or keys, so it is not logged
      console.log(theURL.split('?')[0], rateLimit ? '429 too many requests' : e);

      const remaining = retries - 1;
      if (remaining <= 0) throw e;

      return local.onError(e, url, options0, remaining, args, rateLimit);
    }
  }
}
