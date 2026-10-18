#!/usr/bin/env node

import {Command} from 'commander';
import fs from 'node:fs';
import yaml from 'js-yaml';
import {OpenAPIV3} from 'openapi-types';
import {z} from 'zod';

// OpenAPI 3.x validation schema
const OpenAPISchema = z.object({
  openapi: z.string().regex(/^3\.\d+\.\d+$/),
  info: z.object({
    title: z.string(),
    version: z.string(),
    description: z.string().optional(),
  }),
  paths: z.record(z.string(), z.any()),
  servers: z
    .array(
      z.object({
        url: z.string(),
        description: z.string().optional(),
      })
    )
    .optional(),
  components: z.any().optional(),
});

interface OperationInfo {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: any[];
  requestBody?: any;
  responses?: any;
  externalDocs?: {url?: string; description?: string};
  tags?: string[];
}

export interface ParamRow {
  name: string;
  /** key in the method's argument object; differs from name when the wire name is not an identifier */
  arg: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  type: string;
  description?: string;
  style?: string;
  explode?: boolean;
  schema?: any;
}

export interface BodyField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  schema?: any;
}

export interface BodyRow {
  mode: 'flat' | 'wrapper';
  contentType: string;
  required: boolean;
  type: string;
  fields: BodyField[];
  schema?: any;
}

/**
 * One operation of the spec, with everything the generated code, contract and docs need.
 * Built once, so the method name, the request and the documentation can never disagree.
 */
export interface OperationRow {
  key: string;
  name: string;
  flatName: string;
  httpMethod: string;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags: string[];
  params: ParamRow[];
  body?: BodyRow;
  responseType: string;
  reference?: string;
  referenceIsGeneral?: boolean;
  operation: OperationInfo;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const;

const RESERVED = new Set(
  (
    'break case catch class const continue debugger default delete do else enum export extends false finally for ' +
    'function if import in instanceof new null return super switch this throw true try typeof var void while with ' +
    'yield let static implements interface package private protected public await arguments eval'
  ).split(' ')
);

const isIdentifier = (s: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s) && !RESERVED.has(s);

// A property key in generated code: bare when it is a plain identifier, otherwise a JSON string literal.
const propKey = (s: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s) ? s : JSON.stringify(s));

// Member access in generated code: obj.name or obj["odd name"].
const access = (s: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s) ? `.${s}` : `[${JSON.stringify(s)}]`);

// Text from the spec placed inside a /** */ comment: it must not be able to close the comment.
const commentText = (s: any) =>
  String(s ?? '')
    .replace(/\r/g, '')
    .replace(/\*\//g, '*\\/');

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * from this many operations on, an API gets dotted method names unless told otherwise
 */
export const LARGE_API_OPERATIONS = 50;

// Names a generated method must not take: the controller's own members (AbstractController and what the
// generated controller adds), which a method of the same name would replace.
const CONTROLLER_MEMBERS = [
  'constructor', 'start', 'stop', 'request', 'api', 'config', 'client', 'oauth', 'bindResourceFunctions',
  'autocomplete', 'fallback', 'endpoint', 'newTask', 'updateTask', 'getClient', 'createBlob', 'getBlob',
  'getBlobContent', 'healthCheck', 'configCheck', 'defaultConfigCheck', '_doStart', '_doStop',
  '__autocomplete', '__default', '__endpoint', '__healthCheck',
];

// An exported function name: reserved words get a trailing underscore.
const fnName = (s: string) => (isIdentifier(s) ? s : `${s}_`);


export interface OpenAPIToConnectorOptions {
  /**
   * dotted method names from the URL (crm.contacts.getById); when not set, large APIs
   * (LARGE_API_OPERATIONS or more operations) get them and smaller ones keep flat names
   */
  nestedPaths?: boolean;
  /**
   * link used for methods that have no more specific provider reference, e.g. the provider's API overview
   */
  referenceFallback?: string;
  /**
   * import path of the connector's hand-written auth module (an AuthPlan as its default export), as seen
   * from the controller file; when set, the controller takes its credentials from it
   */
  authModule?: string;
  /**
   * link to the provider's reference for each operation, when the spec has none of its own;
   * {operationId}, {method} and {path} are replaced (URL-encoded)
   */
  referenceUrl?: string;
}

export class OpenAPIToConnector {
  private spec: OpenAPIV3.Document;
  private connectorName: string;
  private options: OpenAPIToConnectorOptions;

  constructor(spec: OpenAPIV3.Document, connectorName: string, options?: OpenAPIToConnectorOptions) {
    this.spec = spec;
    this.connectorName = connectorName;
    this.options = options || {};
  }

  private table?: OperationRow[];
  private operationCount?: number;

  /**
   * whether method names are dotted: as set, or by the size of the API
   */
  useNestedPaths(): boolean {
    if (this.options.nestedPaths !== undefined) return this.options.nestedPaths;
    this.operationCount ??= this.extractOperations().length;
    return this.operationCount >= LARGE_API_OPERATIONS;
  }
  private warnings: Array<{operation: string; problem: string}> = [];
  private exposedNames?: Map<string, string>;

  /**
   * The method name each operation gets in a multi-resource connector, per resource file name and
   * operation key. Names that two resources would share get a number. The main controller, contract,
   * docs and command reference all take their names from this plan, so they always agree.
   */
  static planExposedNames(
    resourceSpecs: Array<{fileName: string; spec: OpenAPIV3.Document}>,
    options: OpenAPIToConnectorOptions = {}
  ): Map<string, Map<string, string>> {
    const resolved = OpenAPIToConnector.resolveOptions(resourceSpecs, options);
    const tables = resourceSpecs.map(({fileName, spec}) => ({
      fileName,
      rows: new OpenAPIToConnector(spec, fileName, resolved).getOperationTable(),
    }));
    const baseOf = (fileName: string, row: OperationRow) =>
      resolved.nestedPaths ? row.name : `${fileName}${capitalize(row.flatName)}`;

    // Blocked: the namespaces of dotted names, and the resource properties on the main controller.
    const blocked = OpenAPIToConnector.namespacesOf(tables.flatMap(({fileName, rows}) => rows.map((r) => baseOf(fileName, r))));
    for (const {fileName} of tables) blocked.add(fileName);
    for (const member of CONTROLLER_MEMBERS) blocked.add(member);

    const used = new Set<string>();
    const plan = new Map<string, Map<string, string>>();
    for (const {fileName, rows} of tables) {
      const names = new Map<string, string>();
      for (const row of rows) {
        const base = baseOf(fileName, row);
        let name = base;
        for (let n = 2; used.has(name) || blocked.has(name); n++) name = `${base}${n}`;
        used.add(name);
        names.set(row.key, name);
      }
      plan.set(fileName, names);
    }
    return plan;
  }

  /**
   * Options for every resource of a multi-resource connector: dotted names are decided by the size of the
   * whole connector, not of each resource.
   */
  static resolveOptions(
    resourceSpecs: Array<{spec: OpenAPIV3.Document}>,
    options: OpenAPIToConnectorOptions = {}
  ): OpenAPIToConnectorOptions {
    if (options.nestedPaths !== undefined) return options;
    const total = resourceSpecs.reduce((n, {spec}) => n + new OpenAPIToConnector(spec, '', options).extractOperations().length, 0);
    return {...options, nestedPaths: total >= LARGE_API_OPERATIONS};
  }

  /**
   * Every namespace prefix of the dotted names: crm.contacts.getPage gives crm and crm.contacts.
   */
  static namespacesOf(names: string[]): Set<string> {
    const namespaces = new Set<string>();
    for (const name of names) {
      const parts = name.split('.');
      for (let i = 1; i < parts.length; i++) namespaces.add(parts.slice(0, i).join('.'));
    }
    return namespaces;
  }

  /**
   * the spec and options this generator was made with
   */
  getSpec(): OpenAPIV3.Document {
    return this.spec;
  }

  getOptions(): OpenAPIToConnectorOptions {
    return this.options;
  }

  /**
   * use names from planExposedNames() for this resource in the contract, docs and command reference
   */
  useExposedNames(names?: Map<string, string>) {
    this.exposedNames = names;
  }

  /**
   * prefix for schema type names, used when a main controller refers to a resource file's types
   */
  typePrefix = '';

  private warn(operation: string, problem: string) {
    if (!this.warnings.some((w) => w.operation === operation && w.problem === problem)) {
      this.warnings.push({operation, problem});
    }
  }

  /**
   * Follow a local $ref (#/components/...) to its target. Returns null when it cannot be resolved.
   */
  private deref(obj: any, where = ''): any {
    let current = obj;
    for (let depth = 0; current && typeof current === 'object' && '$ref' in current; depth++) {
      const ref = String(current.$ref);
      if (depth > 10 || !ref.startsWith('#/')) {
        if (where) this.warn(where, `unresolved reference ${ref}`);
        return null;
      }
      current = ref
        .slice(2)
        .split('/')
        .reduce((node: any, part) => node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], this.spec as any);
      if (!current && where) this.warn(where, `unresolved reference ${ref}`);
    }
    return current ?? null;
  }

  /**
   * Extract all operations from the OpenAPI spec, with path-level parameters merged in and
   * parameter and request body references resolved
   */
  private extractOperations(): OperationInfo[] {
    const operations: OperationInfo[] = [];

    for (const [path, pathItem] of Object.entries(this.spec.paths || {})) {
      if (!pathItem) continue;
      const item: any = this.deref(pathItem, path) || {};

      for (const method of HTTP_METHODS) {
        const operation = item[method];
        if (!operation) continue;

        const where = `${method.toUpperCase()} ${path}`;
        const resolve = (list: any[] | undefined) =>
          (list || []).map((p) => this.deref(p, where)).filter((p: any) => p && p.name && p.in);
        const own = resolve(operation.parameters);
        const shared = resolve(item.parameters).filter(
          (p: any) => !own.some((o: any) => o.name === p.name && o.in === p.in)
        );

        operations.push({
          method: method.toUpperCase(),
          path,
          operationId: operation.operationId,
          summary: operation.summary,
          description: operation.description,
          parameters: [...shared, ...own],
          requestBody: operation.requestBody ? this.deref(operation.requestBody, where) : undefined,
          responses: operation.responses,
          externalDocs: operation.externalDocs,
          tags: operation.tags,
        });
      }
    }

    return operations;
  }



  /**
   * Derive a dotted method path from URL path and operationId.
   * When nestedPaths is enabled, builds a namespace from the URL segments.
   * When disabled (default), falls back to the existing flat method name.
   */
  deriveMethodPath(httpMethod: string, urlPath: string, operationId: string): string {
    if (!this.useNestedPaths()) {
      return this.generateMethodName({method: httpMethod, path: urlPath, operationId});
    }

    const VERSION_RE = /^v\d+$|^\d{4}-\d{2}$/;
    const STRIP = new Set(['objects', 'items']);

    // Convert hyphenated segment to camelCase identifier
    const toCamel = (s: string): string =>
      s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

    // Build namespace parts from the URL path
    const parts = urlPath
      .replace(/\{[^}]+\}/g, '')
      .split('/')
      .filter(Boolean)
      .filter((p) => !VERSION_RE.test(p))
      .filter((p) => !STRIP.has(p))
      .map(toCamel);

    // Extract the leaf action from operationId suffix
    let suffix = operationId.includes('_')
      ? operationId.split('_').pop()!
      : httpMethod.toLowerCase();

    // Bug 3 fix: If the suffix looks like a raw URL path (contains slashes),
    // clean it by extracting meaningful segments rather than using it literally
    if (suffix.includes('/')) {
      const suffixParts = suffix
        .replace(/\{[^}]+\}/g, '')
        .split('/')
        .filter(Boolean)
        .filter((p) => !VERSION_RE.test(p))
        .filter((p) => !STRIP.has(p))
        .map(toCamel);
      suffix = suffixParts.length > 0 ? suffixParts[suffixParts.length - 1] : httpMethod.toLowerCase();
    } else {
      suffix = toCamel(suffix);
    }

    // Dedup: if suffix equals last path segment, don't repeat it
    const last = parts[parts.length - 1];
    if (suffix === last) return parts.join('.');
    return [...parts, suffix].join('.');
  }

  /**
   * Parse OpenAPI spec from JSON or YAML string
   */
  static parseSpec(specString: string): OpenAPIV3.Document {
    let parsed: any;

    try {
      // Try parsing as JSON first
      parsed = JSON.parse(specString);
    } catch {
      try {
        // If JSON fails, try YAML
        parsed = yaml.load(specString);
      } catch (error) {
        throw new Error(`Failed to parse OpenAPI spec: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Validate against OpenAPI 3.x schema with lenient validation
    const validationResult = OpenAPISchema.safeParse(parsed);
    if (!validationResult.success) {
      // Check if the errors are just about missing 'type' fields in schemas
      const criticalErrors = validationResult.error.errors.filter((err) => {
        const path = err.path.join('.');
        // Allow missing 'type' in schema definitions as many OpenAPI specs don't include it
        return !path.includes('components.schemas') || !err.message.includes('Required');
      });

      if (criticalErrors.length > 0) {
        const errors = criticalErrors.map((err) => `${err.path.join('.')}: ${err.message}`).join(', ');
        throw new Error(`Invalid OpenAPI 3.x specification: ${errors}`);
      }

      // Log a warning about lenient validation
      console.warn('⚠️  OpenAPI spec has some validation warnings but proceeding with lenient validation...');
    }

    return parsed as OpenAPIV3.Document;
  }


  /**
   * Generate a valid JavaScript identifier from a string
   */
  private toValidIdentifier(str: string): string {
    return str
      .replace(/[^a-zA-Z0-9_$]/g, '_')
      .replace(/^[0-9]/, '_$&')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * Generate method name from operation info
   */
  private generateMethodName(operation: OperationInfo): string {
    if (operation.operationId) {
      // Clean up HubSpot-style operationIds like "get-/crm/v3/objects/companies_getPage"
      let cleaned = operation.operationId;

      // Extract the last part after underscore if it exists
      const parts = cleaned.split('_');
      if (parts.length > 1) {
        let lastPart = parts[parts.length - 1];
        // Convert hyphens to camelCase before testing
        lastPart = lastPart.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
        // If the last part looks like a method name (camelCase), use it
        if (lastPart && /^[a-z][a-zA-Z0-9]*$/.test(lastPart)) {
          cleaned = lastPart;
        }
      }

      // Remove any remaining special characters and clean up
      cleaned = cleaned
        .replace(/^(get|post|put|patch|delete|head|options)-/i, '') // Remove HTTP method prefix
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');

      // If we still have a valid identifier, use it
      if (cleaned && /^[a-zA-Z]/.test(cleaned)) {
        return cleaned;
      }
    }

    // Generate from method + path
    const pathParts = operation.path
      .replace(/[{}]/g, '') // Remove path parameters
      .split('/')
      .filter((part) => part.length > 0)
      .map((part) => this.toValidIdentifier(part));

    const methodPrefix = operation.method.toLowerCase();
    const pathSuffix = pathParts.join('_') || 'root';

    return `${methodPrefix}_${pathSuffix}`;
  }

  /**
   * Disambiguate a colliding method name by prepending path context.
   * E.g., "archive" from path "/contacts/batch/archive" becomes "batchArchive".
   */
  private disambiguateMethodName(baseName: string, operation: OperationInfo): string {
    // Extract meaningful path segments excluding parameters and the base name itself
    const pathParts = operation.path
      .replace(/\{[^}]+\}/g, '')
      .split('/')
      .filter(Boolean)
      .filter((p) => p.toLowerCase() !== baseName.toLowerCase());

    // Use the last path segment before the method name as a distinguishing prefix, skipping version and
    // numeric segments (v3, 2026-03, 0-410), which cannot start a name
    const named = pathParts.filter((p) => /^[A-Za-z]/.test(p) && !/^v\d+$/.test(p));
    if (named.length > 0) {
      const prefix = named[named.length - 1]
        .replace(/-([a-z0-9])/gi, (_, c) => c.toUpperCase())
        .replace(/[^A-Za-z0-9_$]/g, '_');
      const capitalizedBase = baseName.charAt(0).toUpperCase() + baseName.slice(1);
      return `${prefix}${capitalizedBase}`;
    }

    // Fallback: prepend the HTTP method
    return `${operation.method.toLowerCase()}${baseName.charAt(0).toUpperCase() + baseName.slice(1)}`;
  }

  /**
   * Get the number of operations in the OpenAPI spec
   */
  getOperationsCount(): number {
    return this.extractOperations().length;
  }

  private authImport(): string {
    return this.options.authModule ? `import auth from ${JSON.stringify(this.options.authModule)};\n` : '';
  }

  // How the controller's start() makes its client: credentials from the hand-written auth module, or a
  // placeholder to fill in when there is none.
  private clientSetup(baseUrl: string): string {
    if (this.options.authModule) {
      return `    this.api = this.getClient({
      baseUrl: ${JSON.stringify(baseUrl)},
      ...clientAuth(auth, config),
    });`;
    }
    return `    this.api = this.getClient({
      baseUrl: ${JSON.stringify(baseUrl)},
      customize(request) {
        request.headers ||= {};
        // Add authentication headers based on your API requirements
        // Example: request.headers["Authorization"] = \`Bearer \${config.apiToken}\`;
      },
    });`;
  }

  /**
   * The hand-written auth module written once into a new connector project (src/auth.mts). Regenerating
   * the connector does not overwrite it.
   */
  static authModuleStub(): string {
    return `// Hand-written: how this connector authenticates. The generator writes this file once and never
// overwrites it. Use OAuth (run by the SDK runtime), an access token from the connector's configuration,
// or both; see AuthPlan in @aloma.io/integration-sdk, and hubspotAuth for an example.
import type {AuthPlan} from '@aloma.io/integration-sdk';

const auth: AuthPlan = {
  token: {field: 'apiToken', name: 'API token'},
};

export default auth;
`;
  }

  /**
   * The connector's entry point (src/index.mts) when it has a hand-written auth module.
   */
  static entryPoint(summary: string): string {
    return `import {Builder, configureAuth} from '@aloma.io/integration-sdk';
import auth from './auth.mjs';

const builder = new Builder();

configureAuth(builder, auth, {summary: ${JSON.stringify(summary)}});

const runtime = await builder.build();

await runtime.start();
`;
  }

  /**
   * The operation table: every operation in the spec, named once, with its parameters and body.
   * Everything the generator writes (controller, resource files, contract, docs) is built from it.
   */
  getOperationTable(): OperationRow[] {
    if (this.table) return this.table;

    const usedNames = new Map<string, number>();
    const usedFlat = new Map<string, number>();
    // A taken name: used by another method, or blocked (the namespace of dotted names, where the runtime
    // resolves crm.contacts.getPage through an object named crm).
    const dedup = (used: Map<string, number>, base: string, operation: OperationInfo, blocked = new Set<string>()) => {
      const taken = (n: string) => used.has(n) || blocked.has(n);
      let name = base;
      if (taken(name)) {
        name = this.disambiguateMethodName(name, operation);
        if (taken(name)) {
          let n = 2;
          while (taken(`${base}${n}`)) n++;
          name = `${base}${n}`;
        }
      }
      if (!/^[A-Za-z_$]/.test(name)) name = `${operation.method.toLowerCase()}_${name}`;
      while (taken(name)) name = `${name}_`;
      used.set(name, (used.get(name) || 0) + 1);
      return name;
    };

    const operations = this.extractOperations();
    const nestedBase = (op: OperationInfo) =>
      this.useNestedPaths() && op.operationId ? this.deriveMethodPath(op.method, op.path, op.operationId) : undefined;
    const namespaces = OpenAPIToConnector.namespacesOf(operations.map(nestedBase).filter((n): n is string => !!n));
    const reserved = new Set(CONTROLLER_MEMBERS);
    for (const n of reserved) namespaces.add(n);

    const general = this.spec.externalDocs?.url;
    const tagLinks = new Map<string, string>(
      ((this.spec.tags || []) as any[]).filter((t) => t?.externalDocs?.url).map((t) => [t.name, t.externalDocs.url])
    );
    const template = this.options.referenceUrl;
    const fromTemplate = (op: OperationInfo) =>
      template &&
      template
        .replace(/\{operationId\}/g, encodeURIComponent(op.operationId || ''))
        .replace(/\{method\}/g, encodeURIComponent(op.method.toLowerCase()))
        .replace(/\{path\}/g, encodeURIComponent(op.path));

    this.table = operations.map((operation) => {
      const key = `${operation.method} ${operation.path}`;
      const flatName = dedup(usedFlat, this.generateMethodName(operation), operation, reserved);
      const nested = nestedBase(operation);
      const name = this.useNestedPaths() ? dedup(usedNames, nested || flatName, operation, namespaces) : flatName;

      const params = this.buildParams(operation, key);
      const body = this.buildBody(operation, key, params);
      // Most specific first: the operation's own link, a supplied per-operation template, its tag, the spec.
      const specific = operation.externalDocs?.url || fromTemplate(operation);
      const tagLink = (operation.tags || []).map((t) => tagLinks.get(t)).find(Boolean);
      const reference = specific || tagLink || general || this.options.referenceFallback;

      return {
        key,
        name,
        flatName,
        httpMethod: operation.method,
        path: operation.path,
        operationId: operation.operationId,
        summary: operation.summary,
        description: operation.description,
        tags: operation.tags || [],
        params,
        body,
        responseType: this.getResponseType(operation),
        reference,
        referenceIsGeneral: !specific && !!reference,
        operation,
      };
    });

    return this.table;
  }

  private buildParams(operation: OperationInfo, key: string): ParamRow[] {
    const params: ParamRow[] = [];

    for (const param of operation.parameters || []) {
      if (param.in === 'cookie') {
        this.warn(key, `cookie parameter "${param.name}" is not supported and is not sent`);
        continue;
      }
      if (!['path', 'query', 'header'].includes(param.in)) {
        this.warn(key, `parameter "${param.name}" in "${param.in}" is not supported and is not sent`);
        continue;
      }
      if (param.name === 'headers' || param.name === 'body') {
        this.warn(key, `parameter "${param.name}" shares its name with the method's own "${param.name}" argument`);
      }
      if (params.some((p) => p.name === param.name)) {
        this.warn(key, `parameter "${param.name}" appears in more than one place; only the first is used`);
        continue;
      }

      params.push({
        name: param.name,
        arg: param.name,
        in: param.in,
        required: param.in === 'path' ? true : !!param.required,
        type: this.getParameterType(param),
        description: param.description,
        style: param.style,
        explode: param.explode,
        schema: param.schema,
      });
    }

    // Path placeholders the spec forgot to declare are still required path parameters.
    for (const [, name] of operation.path.matchAll(/\{([^}]+)\}/g)) {
      if (!params.some((p) => p.in === 'path' && p.name === name)) {
        this.warn(key, `path parameter "${name}" is not declared in the spec; added as a required string`);
        params.push({name, arg: name, in: 'path', required: true, type: 'string'});
      }
    }

    // Argument keys must be plain identifiers: the connector build cannot read quoted keys in a method's
    // parameter type. A wire name like "filter[name]" becomes the argument filter_name.
    const taken = new Set(['headers', 'body']);
    for (const p of params) {
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p.name) && !taken.has(p.name)) {
        taken.add(p.name);
        continue;
      }
      let arg = p.name.replace(/[^A-Za-z0-9_$]+/g, '_').replace(/^_+|_+$/g, '') || 'param';
      if (/^[0-9]/.test(arg)) arg = `_${arg}`;
      while (taken.has(arg) || params.some((o) => o !== p && o.name === arg)) arg = `${arg}_`;
      taken.add(arg);
      p.arg = arg;
      if (p.name !== 'headers' && p.name !== 'body') this.warn(key, `parameter "${p.name}" is passed as "${arg}"`);
    }

    return params;
  }

  private buildBody(operation: OperationInfo, key: string, params: ParamRow[]): BodyRow | undefined {
    const requestBody = operation.requestBody;
    if (!requestBody) return undefined;

    const content = requestBody.content || {};
    // A wildcard body (*/*) is sent the usual way, as JSON.
    const types = Object.keys(content).map((t) => (t === '*/*' ? 'application/json' : t));
    const wildcard = '*/*' in content && !('application/json' in content);
    const contentType =
      types.find((t) => t === 'application/json') ||
      types.find((t) => /json/i.test(t)) ||
      types.find((t) => t === 'application/x-www-form-urlencoded') ||
      types[0] ||
      'application/json';

    const required = !!requestBody.required;
    const raw = (content[contentType] || (wildcard && contentType === 'application/json' ? content['*/*'] : undefined))?.schema;
    const type = raw ? this.getTypeFromSchema(raw) : 'any';
    const wrapper = (problem?: string): BodyRow => {
      if (problem) this.warn(key, problem);
      return {mode: 'wrapper', contentType, required, type, fields: [], schema: raw};
    };

    if (contentType.startsWith('multipart/')) {
      return wrapper(`${contentType} body: pass a FormData as "body"`);
    }
    if (!/json/i.test(contentType) && contentType !== 'application/x-www-form-urlencoded') {
      return wrapper(`${contentType} body is sent as given in "body"`);
    }

    const schema = this.flattenSchema(raw, key);
    if (!schema?.properties || !Object.keys(schema.properties).length) return wrapper();

    const taken = new Set(['headers', 'body', ...params.map((p) => p.arg)]);
    const clash = Object.keys(schema.properties).find((n) => taken.has(n));
    if (clash) {
      return wrapper(`body field "${clash}" shares its name with a parameter; the body is passed as "body"`);
    }
    const odd = Object.keys(schema.properties).find((n) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n));
    if (odd) {
      return wrapper(`body field "${odd}" is not a plain name; the body is passed as "body"`);
    }

    const requiredFields = new Set<string>(schema.required || []);
    const fields = Object.entries(schema.properties).map(([name, prop]: [string, any]) => ({
      name,
      type: this.getTypeFromSchema(prop),
      required: required && requiredFields.has(name),
      description: prop?.description,
      schema: prop,
    }));

    return {mode: 'flat', contentType, required, type, fields, schema};
  }

  /**
   * An object schema with its properties, following $ref and merging allOf; null if it is not an object.
   */
  private flattenSchema(schema: any, key: string, depth = 0): any {
    const s = this.deref(schema, key);
    if (!s || depth > 10) return null;

    if (s.allOf) {
      const merged: any = {type: 'object', properties: {...(s.properties || {})}, required: [...(s.required || [])]};
      for (const part of s.allOf) {
        const p = this.flattenSchema(part, key, depth + 1);
        if (!p) return null;
        Object.assign(merged.properties, p.properties || {});
        merged.required.push(...(p.required || []));
      }
      return merged;
    }

    if (s.oneOf || s.anyOf) return null;
    if (s.type && s.type !== 'object') return null;
    return s.properties ? s : null;
  }

  /**
   * Every key of the method's single argument, in order: path, query, header, body, then headers.
   */
  private argEntries(row: OperationRow): Array<{key: string; type: string; required: boolean}> {
    const entries = row.params.map((p) => ({key: p.arg, type: p.type, required: p.required}));

    if (row.body?.mode === 'flat') {
      entries.push(...row.body.fields.map((f) => ({key: f.name, type: f.type, required: f.required})));
    } else if (row.body) {
      entries.push({key: 'body', type: row.body.type, required: row.body.required});
    }

    if (!entries.some((e) => e.key === 'headers')) {
      entries.push({key: 'headers', type: 'Record<string, string>', required: false});
    }

    return entries;
  }

  /**
   * The parameter list of a generated method: one destructured object, so the runtime's method(args, ctx)
   * call works and introspection lists every parameter. Returns the signature and the object to pass on.
   */
  private emitArgs(row: OperationRow): {signature: string; pass: string} {
    const locals = new Set<string>();
    const parts = this.argEntries(row).map((entry) => {
      let local = isIdentifier(entry.key) ? entry.key : `p_${entry.key.replace(/[^A-Za-z0-9_$]/g, '_')}`;
      if (!isIdentifier(local)) local = `p_${local}`;
      while (locals.has(local)) local = `${local}_`;
      locals.add(local);

      const k = propKey(entry.key);
      const bind = k === local ? local : `${k}: ${local}`;
      return {bind, type: `${k}${entry.required ? '' : '?'}: ${entry.type}`, required: entry.required};
    });

    const anyRequired = parts.some((p) => p.required);
    const binds = parts.map((p) => p.bind).join(', ');
    const types = parts.map((p) => p.type).join('; ');

    return {
      signature: `({${binds}}: {${types}}${anyRequired ? '' : ' = {}'})`,
      pass: `{${binds}}`,
    };
  }

  /**
   * The request descriptor for one operation, written into the generated file as JSON.
   */
  private descriptor(row: OperationRow) {
    return {
      method: row.httpMethod,
      path: row.path,
      pathParams: row.params.filter((p) => p.in === 'path').map((p) => (p.arg === p.name ? p.name : {name: p.name, arg: p.arg})),
      query: row.params
        .filter((p) => p.in === 'query')
        .map((p) => ({
          name: p.name,
          ...(p.arg !== p.name ? {arg: p.arg} : {}),
          ...(p.style ? {style: p.style} : {}),
          ...(p.explode !== undefined ? {explode: p.explode} : {}),
        })),
      headers: row.params.filter((p) => p.in === 'header').map((p) => (p.arg === p.name ? p.name : {name: p.name, arg: p.arg})),
      body: row.body
        ? {
            mode: row.body.mode,
            contentType: row.body.contentType,
            ...(row.body.mode === 'flat' ? {fields: row.body.fields.map((f) => f.name)} : {}),
          }
        : null,
    };
  }

  private emitDescriptors(rows: OperationRow[], nameOf: (row: OperationRow) => string): string {
    const entries = rows.map((row) => `  ${JSON.stringify(nameOf(row))}: ${JSON.stringify(this.descriptor(row))},`);
    return `const OPERATIONS: {[name: string]: OperationDescriptor} = {\n${entries.join('\n')}\n};`;
  }

  /**
   * The namespace steps use for this connector in examples, e.g. "Example CRM" -> exampleCrm.
   */
  defaultNamespace(): string {
    const words = this.connectorName.split(/[^A-Za-z0-9]+/).filter(Boolean);
    const ns = words.map((w, i) => (i ? capitalize(w.toLowerCase()) : w.toLowerCase())).join('');
    return isIdentifier(ns) ? ns : `connector${capitalize(ns)}`;
  }

  /**
   * Example argument values for an operation, used in docs, JSDoc and the contract.
   */
  private exampleValue(schema: any, name: string, depth = 0): any {
    const s = this.deref(schema) || {};
    if (s.example !== undefined && depth === 0 && typeof s.example !== 'object') return s.example;
    if (s.enum?.length) return s.enum[0];
    switch (s.type) {
      case 'integer':
      case 'number':
        return 1;
      case 'boolean':
        return true;
      case 'array':
        return depth > 2 ? [] : [this.exampleValue(s.items, name, depth + 1)];
      case 'object': {
        if (depth > 2 || !s.properties) return {};
        const [first] = Object.keys(s.properties);
        return first ? {[first]: this.exampleValue(s.properties[first], first, depth + 1)} : {};
      }
      default:
        return `${name}-value`;
    }
  }

  private exampleArgs(row: OperationRow, {all = false}: {all?: boolean} = {}): {[key: string]: any} {
    const args: {[key: string]: any} = {};
    for (const p of row.params) {
      if (all || p.required) args[p.arg] = p.in === 'path' ? `${p.arg}-1` : this.exampleValue(p.schema, p.arg);
    }
    if (row.body?.mode === 'flat') {
      for (const f of row.body.fields) {
        if (all || f.required) args[f.name] = this.exampleValue(f.schema, f.name);
      }
    } else if (row.body && (all || row.body.required)) {
      args.body = this.exampleValue(row.body.schema, 'body');
    }
    return args;
  }

  private callSyntax(row: OperationRow, namespace: string, methodName = row.name): string {
    const args = this.exampleArgs(row);
    const body = Object.entries(args)
      .map(([k, v]) => `${propKey(k)}: ${JSON.stringify(v)}`)
      .join(', ');
    const target = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(methodName) ? `.${methodName}` : `[${JSON.stringify(methodName)}]`;
    return `await connectors.${namespace}${target}({${body ? ` ${body} ` : ''}})`;
  }

  /**
   * What the generator could not fully support, by operation. Every operation is still generated.
   */
  getReport() {
    const table = this.getOperationTable();
    return {
      operations: table.length,
      generated: table.length,
      skipped: [] as Array<{operation: string; reason: string}>,
      warnings: [...this.warnings],
    };
  }



  /**
   * Resolve a schema reference to a TypeScript type name
   */
  private resolveSchemaRef(ref: string): string {
    const parts = ref.split('/');
    if (parts.length >= 2) {
      const componentName = parts[parts.length - 1];
      if (!this.spec.components?.schemas?.[componentName]) {
        return 'any';
      }
      return `${this.typePrefix}${this.sanitizeTypeName(componentName)}`;
    }
    return 'any';
  }

  /**
   * Sanitize a name to be a valid TypeScript identifier
   */
  private sanitizeTypeName(name: string): string {
    return (
      name
        // Replace dots with underscores
        .replace(/\./g, '_')
        // Replace + with _Plus (common in OpenAPI for enums)
        .replace(/\+/g, '_Plus')
        // Replace other invalid characters with underscores
        .replace(/[^a-zA-Z0-9_$]/g, '_')
        // Ensure it starts with a letter or underscore
        .replace(/^[0-9]/, '_$&')
        // Remove multiple consecutive underscores
        .replace(/_+/g, '_')
        // Remove trailing/leading underscores
        .replace(/^_+|_+$/g, '') ||
      // Ensure it's not empty
      'UnknownType'
    );
  }

  /**
   * Get TypeScript type from schema object
   */
  private getTypeFromSchema(schema: any): string {
    if (!schema) return 'any';

    // Handle $ref
    if (schema.$ref) {
      return this.resolveSchemaRef(schema.$ref);
    }

    // Handle arrays
    if (schema.type === 'array') {
      if (schema.items) {
        const itemType = this.getTypeFromSchema(schema.items);
        return `${itemType}[]`;
      }
      return 'any[]';
    }

    // Handle objects with properties
    if (schema.type === 'object' && schema.properties) {
      const propNames = Object.keys(schema.properties);

      // For response objects, generate inline type definitions
      if (propNames.length <= 5) {
        // Reasonable limit for inline types
        const propTypes = Object.entries(schema.properties).map(([key, prop]: [string, any]) => {
          const propType = this.getTypeFromSchema(prop);
          return `${propKey(key)}: ${propType}`;
        });
        return `{${propTypes.join('; ')}}`;
      }

      // For complex objects, return a generic object type
      return 'any';
    }

    // Handle other primitive types
    if (schema.type) {
      switch (schema.type) {
        case 'string':
          return 'string';
        case 'integer':
        case 'number':
          return 'number';
        case 'boolean':
          return 'boolean';
        case 'object':
          return 'any';
        default:
          return 'any';
      }
    }

    // Handle enum
    if (schema.enum) {
      return 'string'; // Could be expanded to union types
    }

    // Handle allOf, oneOf, anyOf
    if (schema.allOf || schema.oneOf || schema.anyOf) {
      return 'any'; // Could be expanded to intersection/union types
    }

    return 'any';
  }

  /**
   * Get TypeScript type for request body
   */
  private getRequestBodyType(requestBody: any): string {
    if (!requestBody) return 'any';

    // Handle content types
    if (requestBody.content) {
      // Prefer application/json
      if (requestBody.content['application/json']?.schema) {
        return this.getTypeFromSchema(requestBody.content['application/json'].schema);
      }

      // Fall back to first available content type
      const firstContentType = Object.keys(requestBody.content)[0];
      if (requestBody.content[firstContentType]?.schema) {
        return this.getTypeFromSchema(requestBody.content[firstContentType].schema);
      }
    }

    return 'any';
  }


  /**
   * Get TypeScript type for response
   */
  private getResponseType(operation: OperationInfo): string {
    if (!operation.responses) return 'any';

    // Try success responses first (200, 201, etc.)
    const successCodes = ['200', '201', '202', '204'];
    for (const code of successCodes) {
      if (operation.responses[code]) {
        const response = operation.responses[code];
        if (response.content) {
          // Prefer application/json
          if (response.content['application/json']?.schema) {
            return this.getTypeFromSchema(response.content['application/json'].schema);
          }

          // Fall back to first available content type
          const firstContentType = Object.keys(response.content)[0];
          if (response.content[firstContentType]?.schema) {
            return this.getTypeFromSchema(response.content[firstContentType].schema);
          }
        }
      }
    }

    return 'any';
  }

  /**
   * Get TypeScript type for a parameter based on its schema
   */
  private getParameterType(param: any): string {
    if (param.schema) {
      return this.getTypeFromSchema(param.schema);
    }
    return 'any';
  }


  /**
   * Generate TypeScript interface from OpenAPI schema
   */
  private generateInterfaceFromSchema(name: string, schema: any, exported = true): string {
    if (!schema) return '';

    const sanitizedName = this.sanitizeTypeName(name);
    const lines: string[] = [];
    lines.push(`${exported ? 'export ' : ''}interface ${sanitizedName} {`);

    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const propType = this.getTypeFromSchema(propSchema as any);
        const required = schema.required && schema.required.includes(propName);
        const optional = required ? '' : '?';

        // Add description as comment if available
        const description = (propSchema as any)?.description;
        if (description) {
          lines.push(`  /** ${commentText(description)} */`);
        }

        lines.push(`  ${propKey(propName)}${optional}: ${propType};`);
      }
    }

    // Handle allOf, oneOf, anyOf
    if (schema.allOf) {
      lines.push(
        `  // Inherits from: ${schema.allOf.map((s: any) => (s.$ref ? this.resolveSchemaRef(s.$ref) : 'unknown')).join(', ')}`.replace(/[\r\n]/g, ' ')
      );
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Generate all TypeScript interfaces from OpenAPI components
   */
  private generateAllInterfaces(exported = true): string {
    if (!this.spec.components?.schemas) {
      return '';
    }

    const interfaces: string[] = [];
    const usedTypes = this.collectUsedSchemaTypes();

    for (const [schemaName, schema] of Object.entries(this.spec.components.schemas)) {
      const sanitizedSchemaName = this.sanitizeTypeName(schemaName);
      if (usedTypes.has(sanitizedSchemaName)) {
        const interfaceCode = this.generateInterfaceFromSchema(schemaName, schema, exported);
        if (interfaceCode) {
          interfaces.push(interfaceCode);
        }
      }
    }

    if (interfaces.length === 0) {
      return '';
    }

    return `// Generated TypeScript interfaces from OpenAPI schemas\n\n${interfaces.join('\n\n')}\n`;
  }

  /**
   * JSDoc for a generated method. Parameter names match the argument object's keys, so introspection
   * shows each description next to its parameter.
   */
  private generateDetailedJSDoc(row: OperationRow, methodName = row.name, indent = '   '): string {
    const lines: string[] = [];
    const add = (text = '') => lines.push(`${indent}*${text ? ' ' + text : ''}`);

    add(commentText(row.summary || row.operationId || `${row.httpMethod} ${row.path}`));
    if (row.description) {
      add();
      for (const line of commentText(row.description).split('\n')) add(line);
    }
    add();
    add(commentText(`${row.httpMethod} ${row.path}`));
    if (row.reference) add(commentText(`Provider reference: ${row.reference}`));
    add();

    for (const p of row.params) {
      const req = p.required ? '(required)' : '(optional)';
      const wire = p.arg !== p.name ? ` (sent as ${p.name})` : '';
      add(commentText(`@param {${p.type}} ${p.arg} ${req} - ${(p.description || '').replace(/\n/g, ' ')}${wire} [${p.in}]`));
    }
    if (row.body?.mode === 'flat') {
      for (const f of row.body.fields) {
        const req = f.required ? '(required)' : '(optional)';
        add(commentText(`@param {${f.type}} ${f.name} ${req} - ${(f.description || '').replace(/\n/g, ' ')} [body]`));
      }
    } else if (row.body) {
      const req = row.body.required ? '(required)' : '(optional)';
      add(commentText(`@param {${row.body.type}} body ${req} - request body (${row.body.contentType})`));
    }
    add('@param {Record<string, string>} headers (optional) - extra request headers');

    add();
    add('@example usage');
    add('```');
    add(commentText(this.callSyntax(row, this.defaultNamespace(), methodName)));
    add('```');
    add();
    add(commentText(`@returns {Promise<${row.responseType}>} ${row.httpMethod} ${row.path} response`));
    this.addSchemaDetails(lines, row.responseType, 'response', indent);

    return lines.join('\n');
  }

  /**
   * Methods exposed by a main controller for each resource, delegating to that resource's functions.
   * Names come from each resource's operation table, so a method always reaches its own operation.
   */
  generateExposedResourceMethods(
    resources: Array<{className: string; fileName: string}>,
    resourceSpecs?: Array<{fileName: string; spec: OpenAPIV3.Document}>
  ): string {
    return this.exposedMethods(resources, resourceSpecs)
      .map(({code}) => code)
      .join('\n\n');
  }

  private exposedMethods(
    resources: Array<{className: string; fileName: string}>,
    resourceSpecs?: Array<{fileName: string; spec: OpenAPIV3.Document}>
  ) {
    const specs = resources
      .map((resource) => resourceSpecs?.find((rs) => rs.fileName === resource.fileName))
      .filter((rs): rs is {fileName: string; spec: OpenAPIV3.Document} => !!rs);
    for (const resource of resources) {
      if (!specs.some((rs) => rs.fileName === resource.fileName)) {
        this.warn(resource.fileName, 'no spec given for this resource; its methods are not exposed');
      }
    }

    const resolved = OpenAPIToConnector.resolveOptions(specs, this.options);
    const plan = OpenAPIToConnector.planExposedNames(specs, resolved);
    const methods: Array<{name: string; row: OperationRow; resource: string; code: string}> = [];

    for (const {fileName: resourceName, spec} of specs) {
      const gen = new OpenAPIToConnector(spec, resourceName, resolved);
      gen.typePrefix = `${resourceName}Types.`;
      const names = plan.get(resourceName)!;

      for (const row of gen.getOperationTable()) {
        const name = names.get(row.key)!;
        const base = gen.useNestedPaths() ? row.name : `${resourceName}${capitalize(row.flatName)}`;
        if (name !== base) this.warn(row.key, `method name "${base}" is used by another resource; exposed as "${name}"`);

        const {signature, pass} = gen.emitArgs(row);
        const code = `  /**
${gen.generateDetailedJSDoc(row, name)}
   */
  async ${propKey(name)}${signature} {
    return this.${resourceName}${access(fnName(row.flatName))}(${pass});
  }`;
        methods.push({name, row, resource: resourceName, code});
      }

      for (const w of gen.warnings) this.warn(w.operation, w.problem);
    }

    return methods;
  }

  /**
   * Generate a resource file with exported functions (new pattern for proper introspection)
   */
  generateResourceClass(className: string): string {
    const table = this.getOperationTable();

    if (table.length === 0) {
      throw new Error('No operations found in OpenAPI specification');
    }

    const resourceName = className.replace('Resource', '').toLowerCase();

    const functions = table
      .map((row) => {
        const {signature, pass} = this.emitArgs(row);
        const params = signature.slice(1, -1);
        return `/**
${this.generateDetailedJSDoc(row, this.exposedNames?.get(row.key) || (this.useNestedPaths() ? row.name : `${resourceName}${capitalize(row.flatName)}`), ' ')}
 */
export function ${fnName(row.flatName)}(this: any, ${params}) {
  return callOperation(this.api, OPERATIONS${access(fnName(row.flatName))}, ${pass});
}`;
      })
      .join('\n\n');

    const interfaces = this.generateAllInterfaces();

    return `// ${className} resource functions
// These functions will be bound to the controller instance and accessible as ${resourceName}.method()
import {callOperation} from '@aloma.io/integration-sdk';
import type {OperationDescriptor} from '@aloma.io/integration-sdk';

${interfaces.trim() ? `${interfaces.trim()}\n\n` : ''}${this.emitDescriptors(table, (row) => fnName(row.flatName))}

${functions}
`;
  }

  /**
   * Generate a main controller that composes multiple resources using function binding
   */
  generateMainController(
    resources: Array<{className: string; fileName: string}>,
    resourceSpecs?: Array<{fileName: string; spec: OpenAPIV3.Document}>
  ): string {
    const baseUrl = this.spec.servers && this.spec.servers.length > 0 ? this.spec.servers[0].url : 'https://api.example.com';

    const imports = resources
      .map(
        (resource) =>
          `import * as ${resource.fileName}Functions from '../resources/${resource.fileName}.mjs';\n` +
          `import type * as ${resource.fileName}Types from '../resources/${resource.fileName}.mjs';`
      )
      .join('\n');

    const properties = resources.map((resource) => `  ${resource.fileName}: any = {};`).join('\n');

    const bindings = resources
      .map((resource) => `    this.bindResourceFunctions('${resource.fileName}', ${resource.fileName}Functions);`)
      .join('\n');

    const exposedMethods = this.generateExposedResourceMethods(resources, resourceSpecs);

    return `import {AbstractController${this.options.authModule ? ', clientAuth' : ''}} from '@aloma.io/integration-sdk';
${this.authImport()}${imports}

export default class Controller extends AbstractController {
${properties}

  private api: any;

  protected async start(): Promise<void> {
    const config = this.config;

${this.clientSetup(baseUrl)}

    // Bind resource functions to this controller context
    // This allows using this.resourceName.method() syntax
${bindings}
  }

  private bindResourceFunctions(resourceName: string, functions: any) {
    for (const [functionName, func] of Object.entries(functions)) {
      if (typeof func === 'function') {
        this[resourceName][functionName] = func.bind(this);
      }
    }
  }

  /**
   * Generic API request method
   * @param url - API endpoint
   * @param options - Request options
   */
  async request({url, options}: {url: string; options?: any}) {
    return this.api.fetch(url, options);
  }

${exposedMethods}
}
`;
  }

  /**
   * Generate the connector controller code with improved pattern
   */
  generateController(): string {
    const table = this.getOperationTable();

    if (table.length === 0) {
      throw new Error('No operations found in OpenAPI specification');
    }

    const methods = table
      .map((row) => {
        const {signature, pass} = this.emitArgs(row);
        return `  /**
${this.generateDetailedJSDoc(row)}
   */
  async ${propKey(row.name)}${signature} {
    return callOperation(this.api, OPERATIONS${access(row.name)}, ${pass});
  }`;
      })
      .join('\n\n');

    const baseUrl = this.spec.servers && this.spec.servers.length > 0 ? this.spec.servers[0].url : 'https://api.example.com';

    // Not exported: the connector build allows a single exported declaration, the controller class.
    const interfaces = this.generateAllInterfaces(false);
    const typeImports = this.generateTypeImports();

    const preamble = [typeImports.trim(), interfaces.trim()].filter(Boolean).join('\n\n');

    return `import {AbstractController, callOperation${this.options.authModule ? ', clientAuth' : ''}} from '@aloma.io/integration-sdk';
import type {OperationDescriptor} from '@aloma.io/integration-sdk';
${this.authImport()}
${preamble ? `${preamble}\n\n` : ''}${this.emitDescriptors(table, (row) => row.name)}

export default class Controller extends AbstractController {
  private api: any;

  protected async start(): Promise<void> {
    const config = this.config;

${this.clientSetup(baseUrl)}
  }

${methods}
}
`;
  }


  private methodNames(resourceName?: string): Map<OperationRow, string> {
    const names = new Map<OperationRow, string>();
    for (const row of this.getOperationTable()) {
      const planned = this.exposedNames?.get(row.key);
      names.set(
        row,
        planned || (resourceName && !this.useNestedPaths() ? `${resourceName}${capitalize(row.flatName)}` : row.name)
      );
    }
    return names;
  }

  // The request a method must make for the given arguments, worked out from the spec alone
  // (not with the runtime helper), so the contract checks the generated code rather than itself.
  private expectedRequest(row: OperationRow, args: {[key: string]: any}) {
    let path = row.path;
    const query: string[] = [];
    const headers: {[key: string]: string} = {};
    const enc = encodeURIComponent;
    // application/x-www-form-urlencoded, as URLSearchParams writes it
    const form = (x: string) =>
      encodeURIComponent(x)
        .replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
        .replace(/%20/g, '+');
    const consumed = new Set<string>(['headers']);

    for (const p of row.params) {
      consumed.add(p.arg);
      const v = args[p.arg];
      if (v === undefined) continue;
      if (p.in === 'path') path = path.split(`{${p.name}}`).join(enc(String(v)));
      if (p.in === 'header') headers[p.name] = String(v);
      if (p.in !== 'query') continue;

      const style = p.style || 'form';
      const explode = p.explode ?? style === 'form';
      const pair = (k: string, val: any) => query.push(`${form(k)}=${form(String(val))}`);
      if (Array.isArray(v)) {
        if (explode && style === 'form') v.forEach((item) => pair(p.name, item));
        else pair(p.name, v.join(style === 'spaceDelimited' ? ' ' : style === 'pipeDelimited' ? '|' : ','));
      } else if (v && typeof v === 'object') {
        const entries = Object.entries(v);
        if (style === 'deepObject') entries.forEach(([k, val]) => pair(`${p.name}[${k}]`, val));
        else if (explode) entries.forEach(([k, val]) => pair(k, val));
        else pair(p.name, entries.map(([k, val]) => `${k},${val}`).join(','));
      } else {
        pair(p.name, v);
      }
    }

    let body: any;
    if (row.body && !['GET', 'HEAD'].includes(row.httpMethod)) {
      if (row.body.mode === 'wrapper') {
        body = args.body;
      } else {
        const fields = Object.entries(args).filter(([k, v]) => !consumed.has(k) && v !== undefined);
        body = fields.length ? Object.fromEntries(fields) : undefined;
      }
      if (body !== undefined && row.body.contentType === 'application/x-www-form-urlencoded') {
        body = Object.entries(body)
          .map(([k, v]) => `${form(k)}=${form(String(v))}`)
          .join('&');
      }
    }

    return {method: row.httpMethod, url: query.length ? `${path}?${query.join('&')}` : path, body, headers};
  }

  /**
   * A contract per operation: the arguments a test passes and the exact request the method must make
   * (method, path, query, body, header parameters). Run it with runContract() from the SDK.
   */
  generateContract({resourceName}: {resourceName?: string} = {}) {
    const names = this.methodNames(resourceName);
    return {
      connector: this.connectorName,
      source: {title: this.spec.info?.title, version: this.spec.info?.version},
      operations: this.getOperationTable().map((row) => {
        const args = this.exampleArgs(row, {all: true});
        // A value that needs encoding, so a path that is not encoded fails the contract.
        for (const p of row.params) if (p.in === 'path') args[p.arg] = `${p.arg} 1/2`;
        return {method: names.get(row)!, operation: row.key, args, expect: this.expectedRequest(row, args)};
      }),
    };
  }

  private docsCell(s: any) {
    return String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
  }

  // Title, setup and usage of a doc page. count and parts are given when the page covers several specs.
  private docsHeader(namespace: string, resourceName: string | undefined, title: string, count?: number, parts = 1): string[] {
    const names = this.methodNames(resourceName);
    const table = this.getOperationTable();
    const out: string[] = [];

    out.push(`# ${title}`, '');
    out.push(
      `Generated from the ${this.spec.info?.title || 'provider'} OpenAPI specification (version ${this.spec.info?.version || 'unknown'})${
        count === undefined ? `: ${table.length} methods, one per operation in the spec.` : ` and ${parts - 1} more: ${count} methods, one per operation in the specs.`
      }`
    );
    if (this.spec.externalDocs?.url) out.push('', `Provider API reference: ${this.spec.externalDocs.url}`);

    out.push('', '## Setup', '');
    out.push('1. Add the connector to the workspace from the connector catalogue.');
    const schemes = Object.entries((this.spec.components as any)?.securitySchemes || {});
    if (schemes.length) {
      out.push('2. Connect it with one of the authentication methods the provider supports:');
      for (const [name, scheme] of schemes as Array<[string, any]>) {
        const how =
          scheme.type === 'oauth2'
            ? 'OAuth 2.0: use the connector\'s "Connect" button'
            : scheme.type === 'apiKey'
              ? `API key in the ${scheme.in} "${scheme.name}"`
              : scheme.type === 'http'
                ? `HTTP ${scheme.scheme} authentication`
                : scheme.type;
        out.push(`   - \`${name}\`: ${how}`);
      }
    } else {
      out.push('2. Configure the credentials the provider requires in the connector settings.');
    }
    out.push(`3. Steps then call it as \`connectors.${namespace}\`.`);

    out.push('', '## Usage', '');
    out.push('Every method takes one object. Path, query and header parameters and body fields are all keys of that object;');
    out.push('`headers` adds request headers. Values in the path are encoded for you. Example:');
    out.push('', '```javascript');
    if (table[0]) out.push(`const result = ${this.callSyntax(table[0], namespace, names.get(table[0]))};`);
    out.push('```');

    return out;
  }

  // The methods of this spec: as the whole page's Methods section, or as one resource's section.
  private docsMethods(namespace: string, resourceName: string | undefined, section: boolean): string[] {
    const names = this.methodNames(resourceName);
    const table = this.getOperationTable();
    const cell = (s: any) => this.docsCell(s);
    const out: string[] = [];

    const groups = new Map<string, OperationRow[]>();
    for (const row of table) {
      const group = row.tags[0] || row.path.split('/').filter((p) => p && !p.startsWith('{'))[0] || 'General';
      groups.set(group, [...(groups.get(group) || []), row]);
    }

    if (section) {
      out.push('', `## ${this.spec.info?.title || resourceName || 'Methods'}`);
      if (this.spec.externalDocs?.url) out.push('', `Provider API reference: ${this.spec.externalDocs.url}`);
    } else {
      out.push('', '## Methods');
    }
    for (const [group, rows] of groups) {
      out.push('', `### ${group}`);
      for (const row of rows) {
        const name = names.get(row)!;
        out.push('', `#### \`${name}\``, '');
        out.push(`\`${row.httpMethod} ${row.path}\`${row.summary ? ` — ${cell(row.summary)}` : ''}`);
        if (row.reference) {
          out.push('', `What it does: [${row.referenceIsGeneral ? 'provider API reference' : 'provider reference for this call'}](${row.reference})`);
        }
        out.push('', '```javascript', this.callSyntax(row, namespace, name), '```');

        const rowsOut = row.params.map(
          (p) =>
            `| \`${p.arg}\` | ${p.in}${p.arg !== p.name ? ` (\`${cell(p.name)}\`)` : ''} | \`${cell(p.type)}\` | ${p.required ? 'yes' : 'no'} | ${cell(p.description)} |`
        );
        if (row.body?.mode === 'flat') {
          rowsOut.push(...row.body.fields.map((f) => `| \`${f.name}\` | body | \`${cell(f.type)}\` | ${f.required ? 'yes' : 'no'} | ${cell(f.description)} |`));
        } else if (row.body) {
          rowsOut.push(`| \`body\` | body | \`${cell(row.body.type)}\` | ${row.body.required ? 'yes' : 'no'} | ${cell(row.body.contentType)} |`);
        }
        if (rowsOut.length) {
          out.push('', '| Argument | In | Type | Required | Description |', '|---|---|---|---|---|', ...rowsOut);
        }
      }
    }

    const unlinked = table.filter((row) => !row.reference);
    if (unlinked.length) {
      out.push('', `${section ? '###' : '##'} Methods without a provider link`, '');
      out.push('The spec gives no reference link for these operations:', '');
      for (const row of unlinked) out.push(`- \`${names.get(row)}\` (${row.key})`);
    }

    const report = this.getReport();
    if (report.warnings.length) {
      out.push('', `${section ? '###' : '##'} Limitations`, '');
      for (const w of report.warnings) out.push(`- ${w.operation}: ${cell(w.problem)}`);
    }

    return out;
  }

  /**
   * The documentation page for the connector: setup, how steps call it, and every method with its exact
   * call syntax and a link to the provider's own reference for what the call does.
   */
  generateDocs({namespace = this.defaultNamespace(), resourceName}: {namespace?: string; resourceName?: string} = {}): string {
    return [...this.docsHeader(namespace, resourceName, this.connectorName), ...this.docsMethods(namespace, resourceName, false)].join('\n') + '\n';
  }

  /**
   * One documentation page for a multi-resource connector: a single setup and usage section, then a
   * section per resource.
   */
  static combineDocs(
    name: string,
    parts: Array<{generator: OpenAPIToConnector; resourceName?: string}>,
    namespace = parts[0]?.generator.defaultNamespace()
  ): string {
    if (!parts.length) throw new Error('no resources to document');
    const count = parts.reduce((n, p) => n + p.generator.getOperationTable().length, 0);
    const out = parts[0].generator.docsHeader(namespace, parts[0].resourceName, name, count, parts.length);
    for (const {generator, resourceName} of parts) out.push(...generator.docsMethods(namespace, resourceName, true));
    return out.join('\n') + '\n';
  }

  /**
   * The machine-readable command reference for AI step generation, built from the same table as the docs.
   */
  generateCommandReference({namespace = this.defaultNamespace(), resourceName}: {namespace?: string; resourceName?: string} = {}) {
    const names = this.methodNames(resourceName);
    return {
      connector: this.connectorName,
      namespace,
      source: {title: this.spec.info?.title, version: this.spec.info?.version},
      methods: this.getOperationTable().map((row) => ({
        name: names.get(row)!,
        operation: row.key,
        summary: row.summary,
        reference: row.reference,
        call: this.callSyntax(row, namespace, names.get(row)),
        parameters: [
          ...row.params.map((p) => ({
            name: p.arg,
            ...(p.arg !== p.name ? {wireName: p.name} : {}),
            in: p.in,
            type: p.type,
            required: p.required,
            description: p.description,
          })),
          ...(row.body?.mode === 'flat'
            ? row.body.fields.map((f) => ({name: f.name, in: 'body', type: f.type, required: f.required, description: f.description}))
            : row.body
              ? [{name: 'body', in: 'body', type: row.body.type, required: row.body.required, description: row.body.contentType}]
              : []),
        ],
        returns: row.responseType,
      })),
    };
  }



  /**
   * Add detailed schema field information to JSDoc
   */
  private addSchemaDetails(lines: string[], typeName: string, context: string, indent = '   '): void {
    // Remove array notation to get base type
    const baseType = typeName.replace(/\[\]$/, '');
    const isArray = typeName.endsWith('[]');

    if (['string', 'number', 'boolean', 'any'].includes(baseType)) {
      return; // Skip primitive types
    }

    const schema = this.spec.components?.schemas?.[baseType];
    if (!schema) {
      return;
    }

    // Type guard to check if schema has properties (is not a ReferenceObject)
    if ('$ref' in schema) {
      return; // Skip reference objects
    }

    if (!schema.properties) {
      return;
    }

    lines.push(`${indent}*`);
    lines.push(`${indent}* ${context}${isArray ? '[]' : ''} fields:`);

    const maxFields = 10; // Limit to avoid too much clutter
    const properties = Object.entries(schema.properties).slice(0, maxFields);

    for (const [propName, propSchema] of properties) {
      const propType = this.getTypeFromSchema(propSchema as any);
      const required = schema.required && schema.required.includes(propName);
      const requiredText = required ? '' : '?';
      const description = (propSchema as any)?.description;

      if (description) {
        lines.push(`${indent}* - ${commentText(propName)}${requiredText}: ${propType} - ${commentText(description).replace(/\n/g, ' ')}`);
      } else {
        lines.push(`${indent}* - ${commentText(propName)}${requiredText}: ${propType}`);
      }
    }

    const totalFields = Object.keys(schema.properties).length;
    if (totalFields > maxFields) {
      lines.push(`${indent}* - ... and ${totalFields - maxFields} more fields`);
    }
  }

  /**
   * Collect all schema types used in operations (including nested references)
   */
  private collectUsedSchemaTypes(): Set<string> {
    const usedTypes = new Set<string>();
    const visitedSchemas = new Set<string>(); // Track visited schemas to prevent infinite recursion
    const operations = this.extractOperations();

    for (const operation of operations) {
      // Collect from request body schemas
      if (operation.requestBody) {
        this.collectTypesFromRequestBody(operation.requestBody, usedTypes, visitedSchemas);
      }

      // Collect from response schemas
      if (operation.responses) {
        this.collectTypesFromResponses(operation.responses, usedTypes, visitedSchemas);
      }

      // Collect from parameter schemas
      if (operation.parameters) {
        for (const param of operation.parameters) {
          if (typeof param === 'object' && 'schema' in param && param.schema) {
            this.collectTypesFromSchema(param.schema, usedTypes, visitedSchemas);
          }
        }
      }
    }

    return usedTypes;
  }

  /**
   * Collect types from request body schema
   */
  private collectTypesFromRequestBody(requestBody: any, usedTypes: Set<string>, visitedSchemas: Set<string>): void {
    if (!requestBody || !requestBody.content) return;

    // Check all content types
    for (const contentType of Object.keys(requestBody.content)) {
      const content = requestBody.content[contentType];
      if (content.schema) {
        this.collectTypesFromSchema(content.schema, usedTypes, visitedSchemas);
      }
    }
  }

  /**
   * Collect types from response schemas
   */
  private collectTypesFromResponses(responses: any, usedTypes: Set<string>, visitedSchemas: Set<string>): void {
    if (!responses) return;

    // Check success responses
    const successCodes = ['200', '201', '202', '204'];
    for (const code of successCodes) {
      const response = responses[code];
      if (response && response.content) {
        for (const contentType of Object.keys(response.content)) {
          const content = response.content[contentType];
          if (content.schema) {
            this.collectTypesFromSchema(content.schema, usedTypes, visitedSchemas);
          }
        }
      }
    }
  }

  /**
   * Collect types from a schema object
   */
  private collectTypesFromSchema(schema: any, usedTypes: Set<string>, visitedSchemas: Set<string>): void {
    if (!schema) return;

    // Handle $ref
    if (schema.$ref) {
      const parts = schema.$ref.split('/');
      const originalSchemaName = parts[parts.length - 1];
      const sanitizedRefType = this.resolveSchemaRef(schema.$ref);

      if (sanitizedRefType !== 'any' && !['string', 'number', 'boolean'].includes(sanitizedRefType)) {
        // Add the sanitized type name to used types
        usedTypes.add(sanitizedRefType);

        // Only recurse if we haven't visited this schema before (use original name for lookup)
        if (!visitedSchemas.has(originalSchemaName)) {
          visitedSchemas.add(originalSchemaName);
          const referencedSchema = this.spec.components?.schemas?.[originalSchemaName];
          if (referencedSchema) {
            this.collectTypesFromSchema(referencedSchema, usedTypes, visitedSchemas);
          }
        }
      }
      return;
    }

    // Handle arrays
    if (schema.type === 'array' && schema.items) {
      this.collectTypesFromSchema(schema.items, usedTypes, visitedSchemas);
      return;
    }

    // Handle objects with properties
    if (schema.type === 'object' && schema.properties) {
      for (const propSchema of Object.values(schema.properties)) {
        this.collectTypesFromSchema(propSchema, usedTypes, visitedSchemas);
      }
      return;
    }

    // Handle allOf, oneOf, anyOf
    if (schema.allOf) {
      for (const subSchema of schema.allOf) {
        this.collectTypesFromSchema(subSchema, usedTypes, visitedSchemas);
      }
    }

    if (schema.oneOf) {
      for (const subSchema of schema.oneOf) {
        this.collectTypesFromSchema(subSchema, usedTypes, visitedSchemas);
      }
    }

    if (schema.anyOf) {
      for (const subSchema of schema.anyOf) {
        this.collectTypesFromSchema(subSchema, usedTypes, visitedSchemas);
      }
    }
  }

  /**
   * Generate type imports for used schema types
   */
  private generateTypeImports(): string {
    const usedTypes = this.collectUsedSchemaTypes();
    if (usedTypes.size === 0) {
      return '';
    }

    const typeList = Array.from(usedTypes).sort().join(', ');
    return `// Type imports (you may need to adjust the import path)\n// import type { ${typeList} } from './types';\n\n`;
  }
}

// CLI setup
const program = new Command();

program
  .name('openapi-to-connector')
  .description('Generate a connector controller from an OpenAPI specification')
  .version('1.0.0')
  .showHelpAfterError();

program
  .command('generate')
  .description('Generate connector controller from OpenAPI spec')
  .requiredOption('--name <name>', 'Human-readable connector name')
  .requiredOption('--spec <file>', 'OpenAPI specification file (JSON or YAML)')
  .option('--out <file>', 'Output file path', 'index.mts')
  .action(async (options) => {
    try {
      // Read and parse the OpenAPI spec
      const specContent = fs.readFileSync(options.spec, 'utf-8');
      const spec = OpenAPIToConnector.parseSpec(specContent);

      // Generate the connector controller
      const generator = new OpenAPIToConnector(spec, options.name);
      const controllerCode = generator.generateController();

      // Write the output file
      fs.writeFileSync(options.out, controllerCode);

      console.log(`✅ Successfully generated connector controller: ${options.out}`);
      console.log(`📝 Connector name: ${options.name}`);
      console.log(`📊 Found ${generator['extractOperations']().length} operations`);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

// Only run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // If no command is provided, show help
  if (process.argv.length <= 2) {
    program.help();
  } else {
    program.parse();
  }
}
