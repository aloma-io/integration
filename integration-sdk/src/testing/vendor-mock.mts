import {installNetworkGuard, uninstallNetworkGuard} from './network-guard.mjs';

export type VendorRequest = {
  method: string;
  url: string;
  /** the url exactly as the connector passed it to fetch */
  rawUrl: string;
  headers: Record<string, string>;
  body?: string;
};

export type VendorResponse = {
  status?: number;
  headers?: Record<string, string>;
  /** sent as JSON with a json content-type */
  json?: unknown;
  /** sent as is */
  text?: string;
};

export type VendorResponder = VendorResponse | ((request: VendorRequest) => VendorResponse | Promise<VendorResponse>);
export type UrlMatcher = string | RegExp | ((url: string) => boolean);

type Route = {
  method: string;
  matcher: UrlMatcher;
  respond: VendorResponder;
  times: number;
  used: number;
};

// "https:/host/x" (one slash, which the SDK Fetcher produces) and "https://host/x" are the same URL to fetch
const canonical = (url: string): string => {
  try {
    return new URL(url).href;
  } catch (e) {
    return url;
  }
};

const matches = (matcher: UrlMatcher, url: string): boolean => {
  if (typeof matcher === 'string') return canonical(matcher) === url;
  if (matcher instanceof RegExp) return matcher.test(url);
  return matcher(url);
};

/**
 * Mock for the HTTP calls a connector makes to its vendor API.
 *
 * - intercepts global fetch (what the SDK Fetcher and OAuth code use)
 * - answers from routes you register with on()/get()/post()...
 * - any request without a route is recorded in `unmocked` and rejected,
 *   verify() then fails the test even if the connector swallowed the error
 * - also installs the network guard, so nothing can reach a non-loopback host
 */
export class VendorMock {
  readonly requests: VendorRequest[] = [];
  readonly unmocked: VendorRequest[] = [];
  private routes: Route[] = [];
  private originalFetch?: typeof fetch;
  private passthrough: (url: URL) => boolean = () => false;

  /** urls for which the real fetch is used (the fake ALOMA endpoint); everything else is mocked */
  allowPassthrough(fn: (url: URL) => boolean) {
    this.passthrough = fn;
    return this;
  }

  on(method: string, matcher: UrlMatcher, respond: VendorResponder, options: {times?: number} = {}) {
    this.routes.push({method: method.toUpperCase(), matcher, respond, times: options.times ?? Infinity, used: 0});
    return this;
  }

  get(matcher: UrlMatcher, respond: VendorResponder, options?: {times?: number}) {
    return this.on('GET', matcher, respond, options);
  }
  post(matcher: UrlMatcher, respond: VendorResponder, options?: {times?: number}) {
    return this.on('POST', matcher, respond, options);
  }
  put(matcher: UrlMatcher, respond: VendorResponder, options?: {times?: number}) {
    return this.on('PUT', matcher, respond, options);
  }
  delete(matcher: UrlMatcher, respond: VendorResponder, options?: {times?: number}) {
    return this.on('DELETE', matcher, respond, options);
  }

  install() {
    if (this.originalFetch) return this;

    installNetworkGuard();
    this.originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: any, init?: any) => this.handle(input, init)) as typeof fetch;

    return this;
  }

  uninstall() {
    if (!this.originalFetch) return;

    globalThis.fetch = this.originalFetch;
    this.originalFetch = undefined;
    uninstallNetworkGuard();
  }

  /** throws if the connector made a request that had no mock, even if it caught the error */
  verify() {
    if (this.unmocked.length) {
      const list = this.unmocked.map((r) => `${r.method} ${r.url}`).join('\n  ');
      throw new Error(`UNMOCKED vendor requests were made (no network is allowed in tests):\n  ${list}`);
    }
  }

  /** throws if a registered route was never used */
  verifyAllRoutesUsed() {
    const unused = this.routes.filter((r) => r.used === 0);
    if (unused.length) {
      throw new Error(`mocked routes never called: ${unused.map((r) => `${r.method} ${String(r.matcher)}`).join(', ')}`);
    }
  }

  private async handle(input: any, init: any = {}): Promise<Response> {
    const rawUrl: string = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = canonical(rawUrl);
    const method = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();

    const headers: Record<string, string> = {};
    new Headers(init.headers || (typeof input === 'object' && (input as any).headers) || {}).forEach((value, key) => {
      headers[key] = value;
    });

    const request: VendorRequest = {method, url, rawUrl, headers};
    if (init.body != null) request.body = typeof init.body === 'string' ? init.body : String(init.body);

    const route = this.routes.find((r) => r.method === method && r.used < r.times && matches(r.matcher, url));

    if (route) {
      route.used++;
      this.requests.push(request);
      const spec = typeof route.respond === 'function' ? await route.respond(request) : route.respond;

      const responseHeaders = {...spec.headers};
      let body: string | null = null;
      if (spec.json !== undefined) {
        body = JSON.stringify(spec.json);
        responseHeaders['content-type'] ||= 'application/json';
      } else if (spec.text !== undefined) {
        body = spec.text;
      }

      const status = spec.status ?? 200;
      return new Response([204, 205, 304].includes(status) ? null : body, {status, headers: responseHeaders});
    }

    if (this.originalFetch && this.passthrough(new URL(url))) {
      return this.originalFetch(input, init);
    }

    this.unmocked.push(request);

    // status 400 makes the SDK Fetcher give up at once instead of retrying for seconds
    const error: any = new Error(`UNMOCKED vendor request: ${method} ${url} (add a route with vendor.on(...))`);
    error.status = 400;
    error.alomaHarnessUnmocked = true;
    throw error;
  }
}
