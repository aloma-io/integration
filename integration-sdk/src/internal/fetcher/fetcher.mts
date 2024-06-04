import { unwrap } from "../util/index.mjs";

export default class Fetcher {
  retry: number;
  baseUrl: any;
  onResponse: any;
  customize0: any;
  constructor({ retry = 5, baseUrl, onResponse, customize }) {
    this.retry = retry;
    this.baseUrl = baseUrl;
    this.onResponse = onResponse;
    if (customize) this.customize0 = customize;
  }

  async customize(options = {}, args = {}) {
    if (this.customize0) await this.customize0(options, args);
  }

  async onError(
    e: any,
    url: string,
    options: any,
    retries: number,
    args: any,
    rateLimit?,
  ) {
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

  async fetch(url: string, options: any = {}, retries: number, args: any = {}) {
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

      const timeout = Math.min(
        options?.timeout || 30 * 60 * 1000,
        30 * 60 * 1000,
      );
      const ret = await fetch(theURL, {
        ...options,
        signal: AbortSignal.timeout(timeout),
      });
      const status = await ret.status;

      if (status > 399) {
        const text = await ret.text();
        const e: any = new Error(status + " " + text);

        e.status = status;
        throw e;
      }

      if (local.onResponse) {
        await local.onResponse(ret);
      }

      if (status === 204) {
        return { ok: true };
      }

      return unwrap(ret, options);
    } catch (e: any) {
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
