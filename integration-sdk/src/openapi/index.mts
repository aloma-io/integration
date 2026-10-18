import {buildResolvers} from '../builder/runtime-context.mjs';

/**
 * One operation of a generated connector, as the generator describes it.
 */
type Named = string | {name: string; arg: string};

export interface OperationDescriptor {
  method: string;
  path: string;
  /** wire name, or {name, arg} when the argument key differs from the wire name */
  pathParams: Named[];
  query: Array<{name: string; arg?: string; style?: string; explode?: boolean}>;
  headers: Named[];
  body: null | {mode: 'flat' | 'wrapper'; contentType: string; fields?: string[]};
}

const NO_BODY = new Set(['GET', 'HEAD']);

const wireName = (n: Named) => (typeof n === 'string' ? n : n.name);
const argName = (n: Named) => (typeof n === 'string' ? n : n.arg);

function appendQuery(params: URLSearchParams, name: string, value: any, style = 'form', explode = true) {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    if (explode && style === 'form') {
      for (const item of value) params.append(name, String(item));
    } else {
      const sep = style === 'spaceDelimited' ? ' ' : style === 'pipeDelimited' ? '|' : ',';
      params.append(name, value.map(String).join(sep));
    }
    return;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== null);
    if (style === 'deepObject') {
      for (const [k, v] of entries) params.append(`${name}[${k}]`, String(v));
    } else if (explode) {
      for (const [k, v] of entries) params.append(k, String(v));
    } else {
      params.append(name, entries.map(([k, v]) => `${k},${v}`).join(','));
    }
    return;
  }

  params.append(name, String(value));
}

/**
 * Builds the request for one generated operation from the method's single argument object and sends it.
 *
 * Path values are encoded, query values are serialised per the spec's style, header parameters become
 * headers, and the remaining arguments form the body.
 */
export async function callOperation(api: any, op: OperationDescriptor, args: any = {}) {
  const a = args || {};
  const consumed = new Set<string>(['headers']);

  let path = op.path;
  for (const p of op.pathParams) {
    const name = argName(p);
    consumed.add(name);
    const value = a[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`${op.method} ${op.path}: missing required path parameter "${name}"`);
    }
    path = path.split(`{${wireName(p)}}`).join(encodeURIComponent(String(value)));
  }

  const params = new URLSearchParams();
  for (const q of op.query) {
    const name = q.arg || q.name;
    consumed.add(name);
    appendQuery(params, q.name, a[name], q.style, q.explode ?? (q.style ?? 'form') === 'form');
  }
  const qs = params.toString();
  const url = qs ? `${path}?${qs}` : path;

  const headers: {[key: string]: string} = {...(a.headers || {})};
  for (const h of op.headers) {
    const name = argName(h);
    consumed.add(name);
    if (a[name] !== undefined && a[name] !== null) headers[wireName(h)] = String(a[name]);
  }

  let body: any;
  if (op.body && !NO_BODY.has(op.method)) {
    if (op.body.mode === 'wrapper') {
      body = a.body;
    } else {
      const fields = Object.entries(a).filter(([k, v]) => !consumed.has(k) && v !== undefined);
      body = fields.length ? Object.fromEntries(fields) : undefined;
    }

    if (
      body !== undefined &&
      op.body.contentType === 'application/x-www-form-urlencoded' &&
      !(body instanceof URLSearchParams)
    ) {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) appendQuery(form, k, v);
      body = form.toString();
      headers['Content-type'] = 'application/x-www-form-urlencoded';
    } else if (
      op.body.contentType &&
      op.body.contentType !== 'application/json' &&
      !op.body.contentType.startsWith('multipart/')
    ) {
      headers['Content-type'] ||= op.body.contentType;
    }
  }

  const options: any = {method: op.method, headers};
  if (body !== undefined) options.body = body;

  return api.fetch(url, options);
}

function sameJson(a: any, b: any) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Runs a generated contract against a controller without any network: every method is called the way
 * the connector runtime calls it, and the request it makes is compared with the contract.
 */
export async function runContract(
  controller: any,
  contract: {
    operations: Array<{method: string; args: any; expect: {method: string; url: string; body?: any; headers?: any}}>;
  },
  {methods}: {methods?: string[]} = {}
) {
  const calls: Array<{url: string; options: any}> = [];
  const previous = controller.api;
  controller.api = {
    fetch: async (url: string, options: any = {}) => {
      calls.push({url, options});
      return {ok: true};
    },
  };

  const names = methods || contract.operations.map((op) => op.method);
  const resolvers = buildResolvers(names, controller);
  const failures: Array<{method: string; problem: string}> = [];
  let passed = 0;

  try {
    for (const op of contract.operations) {
      calls.length = 0;
      try {
        // As the runtime resolves it: a dotted name through its namespace objects, as well as by its key.
        const nested = op.method.split('.').reduce((node: any, part) => node?.[part], resolvers);
        if (typeof resolvers[op.method] !== 'function') throw new Error('method not exposed');
        if (typeof nested !== 'function') throw new Error('method not reachable through its namespace');
        await nested(op.args, {taskId: 'contract'});
      } catch (e: any) {
        failures.push({method: op.method, problem: `threw: ${e.message}`});
        continue;
      }

      const call = calls[0];
      const problems: string[] = [];
      if (calls.length !== 1) problems.push(`${calls.length} requests`);
      if (call) {
        if (call.options.method !== op.expect.method) problems.push(`method ${call.options.method}`);
        if (call.url !== op.expect.url) problems.push(`url ${call.url} (expected ${op.expect.url})`);
        if (!sameJson(call.options.body, op.expect.body)) problems.push(`body ${JSON.stringify(call.options.body)}`);
        for (const [k, v] of Object.entries(op.expect.headers || {})) {
          if (call.options.headers?.[k] !== v) problems.push(`header ${k}=${call.options.headers?.[k]}`);
        }
      }

      if (problems.length) failures.push({method: op.method, problem: problems.join('; ')});
      else passed++;
    }
  } finally {
    controller.api = previous;
  }

  return {passed, failures};
}

/**
 * Live smoke check: a parameter must change the result. Calls `call` once per value of `param` and
 * fails if every result is the same, which is how a dropped parameter shows up against a real API.
 */
export async function assertParamEffect(
  call: (args: any) => Promise<any>,
  {param, values, args = {}}: {param: string; values: any[]; args?: any}
) {
  if (values.length < 2) throw new Error('assertParamEffect needs at least two values');

  const results: any[] = [];
  for (const value of values) results.push(await call({...args, [param]: value}));

  if (results.every((r) => sameJson(r, results[0]))) {
    throw new Error(`parameter "${param}" had no effect: values ${JSON.stringify(values)} gave the same result`);
  }
}
