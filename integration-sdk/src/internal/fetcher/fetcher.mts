import {unwrap} from '../util/index.mjs';

class ParamsError extends Error {}

/**
 * build a query string from request params: undefined and null are skipped, arrays become repeated keys,
 * objects are refused; values are encoded by URLSearchParams
 */
const toQuery = (params: any): string => {
  if (params == null) return '';
  if (params instanceof URLSearchParams) return params.toString();
  if (typeof params !== 'object' || Array.isArray(params)) throw new ParamsError('params must be an object');

  const query = new URLSearchParams();
  const add = (key: string, value: any) => {
    if (value == null) return;
    if (typeof value === 'object') {
      throw new ParamsError(`params.${key} is an object; only strings, numbers, booleans and arrays of them are sent`);
    }
    query.append(key, String(value));
  };

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => add(key, item));
    else add(key, value);
  }

  return query.toString();
};

const withQuery = (url: string, query: string): string => {
  if (!query) return url;

  const hash = url.indexOf('#');
  const base = hash < 0 ? url : url.slice(0, hash);
  const sep = !base.includes('?') ? '?' : /[?&]$/.test(base) ? '' : '&';

  return base + sep + query + (hash < 0 ? '' : url.slice(hash));
};

const REQUEST_TIMEOUT_MAX = 30 * 60 * 1000;
const RETRY_AFTER_MAX = 60 * 1000;
const RATE_LIMIT_WAIT = 10000;
const RETRY_WAIT = 500;

// methods that may be sent again after a 5xx, a timeout or a network error without the caller opting in
const REPEATABLE_METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'];

/**
 * the wait in ms asked for by a Retry-After header (seconds or an HTTP date), capped at 60 s;
 * undefined when the header is absent or not usable
 */
const retryAfterMs = (value?: string | null): number | undefined => {
  const text = value?.trim();
  if (!text) return undefined;

  let ms: number;
  if (/^\d+$/.test(text)) {
    ms = Number(text) * 1000;
  } else if (/[a-z]/i.test(text) && !Number.isNaN(Date.parse(text))) {
    ms = Math.max(0, Date.parse(text) - Date.now());
  } else {
    return undefined;
  }

  return Math.min(ms, RETRY_AFTER_MAX);
};

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

  /**
   * whether a failed attempt is tried again: 429 and 408 always (the vendor did not process the request);
   * other 4xx never; a 5xx, a timeout or a network error for GET, HEAD, OPTIONS, PUT and DELETE, and for other
   * methods only when the request sets retryUnsafe
   */
  protected retryable(e: any, options: any): boolean {
    if (e.status === 429 || e.status === 408) return true;
    if (e.status != null && e.status < 500) return false;

    const method = String(options?.method || 'GET').toUpperCase();

    return REPEATABLE_METHODS.includes(method) || options?.retryUnsafe === true;
  }

  /** ms to wait before the next attempt: the vendor's Retry-After, else 10 s for a 429, else 500 ms */
  protected waitBefore(e: any): number {
    if (e.retryAfter != null) return e.retryAfter;

    return e.status === 429 ? RATE_LIMIT_WAIT : RETRY_WAIT;
  }

  protected async onError(e: any, url: string, options: any, retries: number, args: any, wait: number = RETRY_WAIT) {
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
        wait
      );
    });
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
      /**
       * query parameters like {limit: 10, properties: ["a", "b"]}, appended to the url;
       * undefined and null are skipped, arrays become repeated keys, objects are refused
       */
      params?: {[key: string]: any} | URLSearchParams;
      /**
       * retry a POST or PATCH (or any other method that is not GET, HEAD, OPTIONS, PUT or DELETE) after a 5xx,
       * a timeout or a network error; off by default, because the vendor may already have processed the request
       */
      retryUnsafe?: boolean;
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
      // after the slash collapse, so encoded values are not altered; options0 keeps params for retries
      const fullURL = withQuery(theURL, toQuery(options0.params));

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
      const {params, ...init} = options0;
      const ret = await fetch(fullURL, {
        ...init,
        signal: AbortSignal.timeout(timeout),
      });
      const status = await ret.status;

      if (status > 399) {
        const text = await ret.text();
        const e: any = new Error(status + ' ' + text);

        e.status = status;
        e.retryAfter = retryAfterMs(ret.headers.get('retry-after'));
        throw e;
      }

      if (local.onResponse) {
        await local.onResponse(ret);
      }

      if (status === 204) {
        return {ok: true};
      }

      return await unwrap(ret, options0);
    } catch (e: any) {
      if (e instanceof ParamsError) throw e;

      // client errors other than 408 and 429, and unsafe methods without retryUnsafe
      if (!local.retryable(e, options0)) throw e;

      --retries;

      // without the query string: its values may hold ids or emails
      console.log(theURL.split('?')[0], e);

      if (retries <= 0) throw e;

      return local.onError(e, url, options0, retries, args, local.waitBefore(e));
    }
  }
}
