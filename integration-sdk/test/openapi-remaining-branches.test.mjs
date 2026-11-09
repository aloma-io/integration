// The OpenAPI to connector generator (build/openapi-to-connector.mjs): the branches the other openapi-*.test files do
// not reach: spec parsing (YAML, errors), method names and their disambiguation, type mapping, request body options,
// signatures, JSDoc, the generated method bodies, interfaces, the resource and main controller output, and the CLI.
// Standalone script (no mocha). Each test fixes the output as it is now, so a deliberate change to the generator
// updates the test with it. Needs `yarn build` first. Offline; the CLI cases only write into a temporary folder.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {suite} from './helpers/mini.mjs';

const {OpenAPIToConnector} = await import('../build/openapi-to-connector.mjs');
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'openapi-to-connector.mjs');

const {test, finish} = suite('openapi remaining branches');

const mk = (paths = {}, options = {}, extra = {}) =>
  new OpenAPIToConnector({openapi: '3.0.0', info: {title: 'T', version: '1'}, paths, ...extra}, 't', options);
const json = (schema) => ({content: {'application/json': {schema}}});
const op = (o) => ({method: 'GET', path: '/x', ...o});
const param = (name, inn = 'query', required = false, type = 'string') => ({name, in: inn, required, schema: {type}});
const lines = (...l) => l.join('\n');
const methodNames = (code) => [...code.matchAll(/^  async ('?[\w.]+'?)\(/gm)].map((m) => m[1]);
const parseError = (text) => {
  try {
    OpenAPIToConnector.parseSpec(text);
  } catch (e) {
    return e.message;
  }
  return null;
};
const quiet = (fn) => {
  const saved = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = saved;
  }
};

const components = {
  schemas: {
    Pet: {type: 'object', required: ['id'], properties: {id: {type: 'string', description: 'the id'}, tags: {type: 'array', items: {type: 'string'}}, owner: {$ref: '#/components/schemas/Owner'}}},
    Owner: {type: 'object', properties: {pets: {type: 'array', items: {$ref: '#/components/schemas/Pet'}}}},
    Alias: {$ref: '#/components/schemas/Pet'},
    Big: {type: 'object', properties: Object.fromEntries('abcdefghijkl'.split('').map((k) => [k, {type: 'integer'}]))},
    Combo: {allOf: [{$ref: '#/components/schemas/Pet'}, {type: 'object'}]},
    Shape: {oneOf: [{$ref: '#/components/schemas/Circle'}], anyOf: [{$ref: '#/components/schemas/Square'}]},
    Circle: {type: 'object', properties: {r: {type: 'number'}}},
    Square: {type: 'object', properties: {s: {type: 'number'}}},
    Base: {type: 'object', properties: {b: {type: 'string'}}},
    Child: {allOf: [{$ref: '#/components/schemas/Base'}]},
    Param: {type: 'string'},
    'Ev.ent': {type: 'object', properties: {e: {type: 'string'}}},
  },
};
const g = mk({}, {}, {components});

// ---- parseSpec

await test('parseSpec reads a JSON document', () => {
  const spec = OpenAPIToConnector.parseSpec('{"openapi":"3.0.1","info":{"title":"T","version":"1"},"paths":{}}');
  assert.deepEqual(spec, {openapi: '3.0.1', info: {title: 'T', version: '1'}, paths: {}});
});

await test('parseSpec reads a YAML document', () => {
  const spec = OpenAPIToConnector.parseSpec('openapi: 3.0.1\ninfo:\n  title: T\n  version: "1"\npaths: {}\n');
  assert.deepEqual(spec, {openapi: '3.0.1', info: {title: 'T', version: '1'}, paths: {}});
});

await test('parseSpec throws "Failed to parse OpenAPI spec: <reason>" for text that is neither JSON nor YAML', () => {
  assert.match(parseError('a: [1\n b: }'), /^Failed to parse OpenAPI spec: missed comma between flow collection entries/);
});

await test('parseSpec throws with an empty path when the text is empty or a plain string', () => {
  assert.equal(parseError(''), 'Invalid OpenAPI 3.x specification: : Invalid input: expected object, received undefined');
  assert.equal(parseError('just text'), 'Invalid OpenAPI 3.x specification: : Invalid input: expected object, received string');
});

await test('parseSpec throws naming the openapi field when it is missing, a number, or 3.1 without a patch number', () => {
  assert.equal(
    parseError('{"swagger":"2.0","info":{"title":"T","version":"1"},"paths":{}}'),
    'Invalid OpenAPI 3.x specification: openapi: Invalid input: expected string, received undefined'
  );
  assert.equal(
    parseError('{"openapi":3,"info":{"title":"T","version":"1"},"paths":{}}'),
    'Invalid OpenAPI 3.x specification: openapi: Invalid input: expected string, received number'
  );
  assert.match(parseError('{"openapi":"3.1","info":{"title":"T","version":"1"},"paths":{}}'), /^Invalid OpenAPI 3\.x specification: openapi: Invalid string: must match pattern/);
});

await test('parseSpec lists every failing field in one message, separated by commas', () => {
  assert.equal(
    parseError('{"openapi":"4.0.0","info":{},"paths":{}}'),
    'Invalid OpenAPI 3.x specification: openapi: Invalid string: must match pattern /^3\\.\\d+\\.\\d+$/, info.title: Invalid input: expected string, received undefined, info.version: Invalid input: expected string, received undefined'
  );
});

await test('parseSpec returns a document whose component schemas are empty objects, without a warning', () => {
  let warned = 0;
  const saved = console.warn;
  console.warn = () => warned++;
  try {
    const spec = OpenAPIToConnector.parseSpec('{"openapi":"3.0.1","info":{"title":"T","version":"1"},"paths":{},"components":{"schemas":{"A":{}}}}');
    assert.deepEqual(spec.components, {schemas: {A: {}}});
  } finally {
    console.warn = saved;
  }
  assert.equal(warned, 0);
});

// ---- operations

await test('extractOperations lists get, post, put, patch, delete, head and options in that order and skips empty path items', () => {
  const gen = mk({
    '/a': {options: {}, head: {}, delete: {}, patch: {}, put: {}, post: {}, get: {}, trace: {}},
    '/none': null,
  });
  assert.deepEqual(gen.extractOperations().map((o) => `${o.method} ${o.path}`), [
    'GET /a', 'POST /a', 'PUT /a', 'PATCH /a', 'DELETE /a', 'HEAD /a', 'OPTIONS /a',
  ]);
  assert.equal(gen.getOperationsCount(), 7);
});

// ---- method names

await test('generateMethodName takes the part after the last underscore of an operationId when it is camelCase', () => {
  assert.equal(g.generateMethodName(op({operationId: 'get-/crm/v3/objects/companies_getPage'})), 'getPage');
  assert.equal(g.generateMethodName(op({operationId: 'foo_bar-baz'})), 'barBaz');
});

await test('generateMethodName keeps the whole operationId when the part after the underscore starts with a capital', () => {
  assert.equal(g.generateMethodName(op({operationId: 'foo_Bar'})), 'foo_Bar');
});

await test('generateMethodName drops an http method prefix and replaces other characters with underscores', () => {
  assert.equal(g.generateMethodName(op({operationId: 'GET-pets'})), 'pets');
  assert.equal(g.generateMethodName(op({operationId: 'my.op!'})), 'my_op');
});

await test('generateMethodName builds <method>_<path> when the operationId is missing or does not start with a letter', () => {
  assert.equal(g.generateMethodName(op({operationId: '123abc'})), 'get_x');
  assert.equal(g.generateMethodName(op({operationId: '___', path: '/a/{id}/b-c'})), 'get_a_id_b_c');
  assert.equal(g.generateMethodName({method: 'POST', path: '/9lives/{id}/x-y'}), 'post_9lives_id_x_y');
});

await test('generateMethodName returns get_root for the path /', () => {
  assert.equal(g.generateMethodName({method: 'GET', path: '/'}), 'get_root');
});

await test('toValidIdentifier replaces invalid characters, prefixes a leading digit and trims underscores', () => {
  assert.equal(g.toValidIdentifier('a-b c'), 'a_b_c');
  assert.equal(g.toValidIdentifier('9a'), '9a');
  assert.equal(g.toValidIdentifier('__a__'), 'a');
});

await test('disambiguateMethodName prefixes the last other path segment, in camelCase', () => {
  assert.equal(g.disambiguateMethodName('archive', {method: 'POST', path: '/contacts/batch/archive'}), 'batchArchive');
  assert.equal(g.disambiguateMethodName('x', {method: 'DELETE', path: '/a-b/{id}/'}), 'aBX');
});

await test('disambiguateMethodName prefixes the lower-case http method when the path has no other segment', () => {
  assert.equal(g.disambiguateMethodName('archive', {method: 'POST', path: '/archive'}), 'postArchive');
  assert.equal(g.disambiguateMethodName('archive', {method: 'POST', path: '/{id}'}), 'postArchive');
});

// ---- deriveMethodPath

await test('deriveMethodPath without nestedPaths returns the flat method name', () => {
  assert.equal(g.deriveMethodPath('GET', '/a/b', 'x_y'), 'y');
});

await test('deriveMethodPath with nestedPaths joins the path segments and the operationId suffix with dots', () => {
  const n = mk({}, {nestedPaths: true});
  assert.equal(n.deriveMethodPath('GET', '/crm/v3/objects/companies/{id}', 'get-/crm_getById'), 'crm.companies.getById');
});

await test('deriveMethodPath with nestedPaths uses the lower-case http method when the operationId has no underscore', () => {
  const n = mk({}, {nestedPaths: true});
  assert.equal(n.deriveMethodPath('POST', '/things', 'create'), 'things.post');
});

await test('deriveMethodPath with nestedPaths does not repeat a suffix equal to the last path segment', () => {
  const n = mk({}, {nestedPaths: true});
  assert.equal(n.deriveMethodPath('GET', '/things', 'x_things'), 'things');
});

await test('deriveMethodPath with nestedPaths reduces an operationId suffix that is a url path to its last meaningful segment', () => {
  const n = mk({}, {nestedPaths: true});
  assert.equal(n.deriveMethodPath('GET', '/things', 'get-/a/b/{c}/list-all_x/y/list-all'), 'things.listAll');
  assert.equal(n.deriveMethodPath('PUT', '/things', 'get-/v3/objects/{c}_/v3/objects/{c}'), 'things.put');
});

await test('deriveMethodPath with nestedPaths drops version segments and date versions', () => {
  const n = mk({}, {nestedPaths: true});
  assert.equal(n.deriveMethodPath('GET', '/crm/lists/2025-09/{listId}', 'x_get'), 'crm.lists.get');
});

// ---- types

await test('resolveSchemaRef returns the sanitised component name, or any for a missing component or a bare name', () => {
  assert.equal(g.resolveSchemaRef('#/components/schemas/Ev.ent'), 'Ev_ent');
  assert.equal(g.resolveSchemaRef('#/components/schemas/Zed'), 'any');
  assert.equal(g.resolveSchemaRef('Pet'), 'any');
});

await test('sanitizeTypeName replaces dots, plus signs and other characters, and returns UnknownType for an empty result', () => {
  assert.equal(g.sanitizeTypeName('a.b+c'), 'a_b_Plusc');
  assert.equal(g.sanitizeTypeName('x y'), 'x_y');
  assert.equal(g.sanitizeTypeName(''), 'UnknownType');
  assert.equal(g.sanitizeTypeName('--'), 'UnknownType');
});

await test('sanitizeTypeName returns a name that starts with a digit unchanged', () => {
  assert.equal(g.sanitizeTypeName('1abc'), '1abc');
});

await test('getTypeFromSchema maps arrays, inline objects of up to 5 properties, primitives, enums and unions', () => {
  const t = (s) => g.getTypeFromSchema(s);
  assert.equal(t(undefined), 'any');
  assert.equal(t({type: 'array'}), 'any[]');
  assert.equal(t({type: 'array', items: {type: 'integer'}}), 'number[]');
  assert.equal(t({type: 'object', properties: {a: {type: 'string'}}}), '{a: string}');
  assert.equal(t({type: 'object', properties: Object.fromEntries('abcdef'.split('').map((k) => [k, {type: 'string'}]))}), 'any');
  assert.equal(t({type: 'object'}), 'any');
  assert.equal(t({type: 'weird'}), 'any');
  assert.equal(t({type: 'number'}), 'number');
  assert.equal(t({type: 'boolean'}), 'boolean');
  assert.equal(t({enum: ['a']}), 'string');
  assert.equal(t({allOf: []}), 'any');
  assert.equal(t({}), 'any');
  assert.equal(t({$ref: '#/components/schemas/Pet'}), 'Pet');
});

await test('getRequestBodyType prefers application/json, then the first content type, else any', () => {
  assert.equal(g.getRequestBodyType(undefined), 'any');
  assert.equal(g.getRequestBodyType({}), 'any');
  assert.equal(g.getRequestBodyType({content: {}}), 'any');
  assert.equal(g.getRequestBodyType({content: {'text/xml': {schema: {type: 'string'}}}}), 'string');
  assert.equal(g.getRequestBodyType({content: {'text/xml': {}}}), 'any');
  assert.equal(g.getRequestBodyType({content: {'text/xml': {schema: {type: 'string'}}, 'application/json': {schema: {type: 'number'}}}}), 'number');
});

await test('getResponseType reads 200, 201, 202 or 204 in that order, json first, else any', () => {
  assert.equal(g.getResponseType({}), 'any');
  assert.equal(g.getResponseType({responses: {'201': json({type: 'string'})}}), 'string');
  assert.equal(g.getResponseType({responses: {'200': {content: {'text/plain': {schema: {type: 'number'}}}}}}), 'number');
  assert.equal(g.getResponseType({responses: {'200': {description: 'x'}}}), 'any');
  assert.equal(g.getResponseType({responses: {default: json({type: 'string'})}}), 'any');
  assert.equal(g.getResponseType({responses: {'200': {content: {'text/plain': {}}}}}), 'any');
});

await test('getParameterType returns any when the parameter has no schema', () => {
  assert.equal(g.getParameterType({name: 'a', in: 'query'}), 'any');
  assert.equal(g.getParameterType({name: 'a', in: 'query', schema: {type: 'boolean'}}), 'boolean');
});

// ---- request body options

const bodyProps = (requestBody) => {
  const out = [];
  g.addRequestBodyProperties(requestBody, out);
  return out;
};

await test('addRequestBodyProperties adds nothing for a missing body, a body without content or without a schema', () => {
  assert.deepEqual(bodyProps(undefined), []);
  assert.deepEqual(bodyProps({}), []);
  assert.deepEqual(bodyProps({content: {'text/xml': {}}}), []);
});

await test('addRequestBodyProperties lists the properties of the first content type when there is no json one', () => {
  assert.deepEqual(bodyProps({content: {'text/xml': {schema: {type: 'object', properties: {q: {type: 'string'}}}}}}), ['q?: string']);
});

await test('addRequestBodyProperties flattens a referenced schema, marking required properties and adding short descriptions', () => {
  assert.deepEqual(bodyProps(json({$ref: '#/components/schemas/Pet'})), ['id: string /** the id */', 'tags?: string[]', 'owner?: Owner']);
});

await test('addRequestBodyProperties falls back to body for a reference to a reference, a missing component or a schema without properties', () => {
  assert.deepEqual(bodyProps(json({$ref: '#/components/schemas/Alias'})), ['body?: Alias']);
  assert.deepEqual(bodyProps(json({$ref: '#/components/schemas/Zed'})), ['body?: any']);
  assert.deepEqual(bodyProps(json({type: 'string'})), ['body?: string']);
});

await test('addRequestBodyProperties falls back to body for a reference to a component whose name has characters that are renamed', () => {
  assert.deepEqual(bodyProps(json({$ref: '#/components/schemas/Ev.ent'})), ['body?: Ev_ent']);
});

await test('addRequestBodyProperties marks every property required when the body is required', () => {
  assert.deepEqual(bodyProps({required: true, ...json({type: 'object', properties: {a: {type: 'string'}}})}), ['a: string']);
});

await test('addRequestBodyProperties drops descriptions of 100 characters or more and joins the lines of shorter ones', () => {
  assert.deepEqual(
    bodyProps(json({type: 'object', properties: {a: {type: 'string', description: 'x'.repeat(100)}, b: {type: 'string', description: 'line1\n  line2'}}})),
    ['a?: string', 'b?: string /** line1 line2 */']
  );
});

// ---- signatures

const sig = (o) => g.generateMethodSignature(op(o));
const H = 'headers?: Record<string, string>';

await test('generateMethodSignature gives an optional options object with headers when there are no parameters', () => {
  assert.equal(sig({}), `(options?: {${H}})`);
});

await test('generateMethodSignature makes options required when a query parameter is required', () => {
  assert.equal(sig({parameters: [param('a', 'query', true)]}), `(options: {a: string, ${H}})`);
  assert.equal(sig({parameters: [param('a')]}), `(options?: {a?: string, ${H}})`);
});

await test('generateMethodSignature passes path parameters one by one, then options', () => {
  assert.equal(sig({parameters: [param('id', 'path', true)]}), `(id: string, options?: {${H}})`);
});

await test('generateMethodSignature with path parameters makes options required for a required query parameter or a required body', () => {
  const body = {required: true, ...json({type: 'object', properties: {n: {type: 'string'}}})};
  assert.equal(
    sig({parameters: [param('id', 'path', true), param('x', 'query', true), param('y')], requestBody: body}),
    `(id: string, options: {x: string, y?: string, n: string, ${H}})`
  );
  assert.equal(
    sig({parameters: [param('id', 'path', true)], requestBody: {...body, required: false}}),
    `(id: string, options?: {n?: string, ${H}})`
  );
});

await test('generateMethodSignature groups dotted query names into one object, optional when all its members are', () => {
  assert.equal(
    sig({parameters: [param('Primary.First', 'query', true), param('Primary.Last'), param('Other.Z')]}),
    `(options: {Primary: {First: string, Last?: string}, Other?: {Z?: string}, ${H}})`
  );
});

await test('generateMethodSignature ignores header and cookie parameters and entries that are not parameters', () => {
  assert.equal(sig({parameters: [param('h', 'header'), param('c', 'cookie')]}), `(options?: {${H}})`);
  assert.equal(sig({parameters: ['x', {$ref: '#/components/parameters/P'}]}), `(options?: {${H}})`);
});

await test('generateMethodSignature falls back to a free-form options object for 16 or more options (headers included) or a long one', () => {
  const many = Array.from({length: 15}, (_, i) => param('p' + i));
  assert.equal(sig({parameters: many.slice(0, 14)}), `(options?: {${many.slice(0, 14).map((p) => `${p.name}?: string`).join(', ')}, ${H}})`);
  assert.equal(sig({parameters: many}), '(options?: {[key: string]: any})');
  assert.equal(sig({parameters: many.map((p) => ({...p, required: true}))}), '(options: {[key: string]: any})');
  assert.equal(sig({parameters: [param('p' + 'x'.repeat(100), 'query', true)]}), '(options: {[key: string]: any})');
});

await test('generateMethodSignature puts a body that has no properties under body', () => {
  assert.equal(sig({requestBody: {required: true, ...json({type: 'string'})}}), `(options: {body?: string, ${H}})`);
});

// ---- JSDoc

const doc = (o) => g.generateDetailedJSDoc(op(o));

await test('generateDetailedJSDoc names an operation with no summary or operationId "API Operation"', () => {
  assert.equal(doc({}), lines(' * API Operation', ' *', ' *', ' * @returns {Promise<any>} GET /x response'));
});

await test('generateDetailedJSDoc writes the operationId, each description line and the path parameters', () => {
  assert.equal(
    doc({operationId: 'getThing', description: 'l1\nl2', parameters: [{name: 'id', in: 'path', required: true, description: 'the id', schema: {type: 'string'}}]}),
    lines(
      ' * getThing', ' *', ' * l1', ' * l2', ' *', ' * @param {string} id the id',
      ' * @param {Object} options (optional) - Request options', ' *', ' * @returns {Promise<any>} GET /x response'
    )
  );
});

await test('generateDetailedJSDoc documents query parameters and a body that has no properties', () => {
  assert.equal(
    doc({summary: 'S', parameters: [param('a', 'query', true), {...param('b'), description: 'bee'}], requestBody: {description: 'the body', ...json({type: 'string'})}}),
    lines(
      ' * S', ' *', ' * @param {Object} options - Request options',
      ' * @param {string} options.a (required) -  [query]', ' * @param {string} options.b (optional) - bee [query]',
      ' * @param {string} options.body (optional) - the body', ' *', ' * @returns {Promise<any>} GET /x response'
    )
  );
});

await test('generateDetailedJSDoc documents the properties of a referenced body, and falls back to options.body for a missing component', () => {
  assert.equal(
    doc({requestBody: {required: true, ...json({$ref: '#/components/schemas/Pet'})}}),
    lines(
      ' * API Operation', ' *', ' * @param {Object} options - Request options',
      ' * @param {string} options.id (required) - the id [body property]',
      ' * @param {string[]} options.tags (required) -  [body property]',
      ' * @param {Owner} options.owner (required) -  [body property]', ' *', ' * @returns {Promise<any>} GET /x response'
    )
  );
  assert.equal(
    doc({requestBody: {required: true, ...json({$ref: '#/components/schemas/Zed'})}}),
    lines(' * API Operation', ' *', ' * @param {Object} options - Request options', ' * @param {any} options.body (required) - Request body', ' *', ' * @returns {Promise<any>} GET /x response')
  );
});

await test('generateDetailedJSDoc documents a body in a content type that has no schema as an options line only', () => {
  assert.equal(
    doc({requestBody: {content: {'text/x': {}}}}),
    lines(' * API Operation', ' *', ' * @param {Object} options - Request options', ' *', ' * @returns {Promise<any>} GET /x response')
  );
});

await test('generateDetailedJSDoc documents the properties of a body given only in a non-json content type', () => {
  assert.equal(
    doc({requestBody: {content: {'text/x': {schema: {type: 'object', properties: {k: {type: 'number'}}}}}}}),
    lines(
      ' * API Operation', ' *', ' * @param {Object} options - Request options', ' * @param {number} options.k (optional) -  [body property]', ' *',
      ' * @returns {Promise<any>} GET /x response'
    )
  );
});

await test('generateDetailedJSDoc marks the fallback options.body line optional for an unresolved reference in an optional body', () => {
  assert.equal(
    doc({requestBody: json({$ref: '#/components/schemas/Alias'})}),
    lines(' * API Operation', ' *', ' * @param {Object} options - Request options', ' * @param {Alias} options.body (optional) - Request body', ' *', ' * @returns {Promise<any>} GET /x response')
  );
});

await test('generateDetailedJSDoc lists the fields of an array response, at most 10, then counts the rest', () => {
  assert.equal(
    doc({responses: {'200': json({type: 'array', items: {$ref: '#/components/schemas/Pet'}})}}),
    lines(
      ' * API Operation', ' *', ' *', ' * @returns {Promise<Pet[]>} GET /x response', ' *', ' * response[] fields:',
      ' * - id: string - the id', ' * - tags?: string[]', ' * - owner?: Owner'
    )
  );
  const big = doc({responses: {'200': json({$ref: '#/components/schemas/Big'})}}).split('\n');
  assert.equal(big.filter((l) => /^ \* - [a-j]\?: number$/.test(l)).length, 10);
  assert.equal(big[big.length - 1], ' * - ... and 2 more fields');
});

await test('generateDetailedJSDoc adds no field list for a primitive, a missing component or a component without properties', () => {
  const tail = (schema) => doc({responses: {'200': json(schema)}}).split('\n').slice(-1)[0];
  assert.equal(tail({type: 'string'}), ' * @returns {Promise<string>} GET /x response');
  assert.equal(tail({$ref: '#/components/schemas/Zed'}), ' * @returns {Promise<any>} GET /x response');
  assert.equal(tail({$ref: '#/components/schemas/Param'}), ' * @returns {Promise<Param>} GET /x response');
  assert.equal(tail({$ref: '#/components/schemas/Alias'}), ' * @returns {Promise<Alias>} GET /x response');
});

// ---- method bodies

const BODY = {content: {'application/json': {schema: {type: 'object'}}}};
const impl = (o) => g.generateControllerMethodImplementation(op(o));
const resImpl = (o) => g.generateResourceFunctionImplementation(op(o));

await test('controller method body with no parameters sends only the method and does not read options', () => {
  assert.equal(impl({}), lines("    const url = '/x';", '', '    const fetchOptions: any = {', "      method: 'GET',", '    };', '', '    return this.api.fetch(url, fetchOptions);'));
});

await test('controller method body with a query parameter copies it into params when it is not undefined', () => {
  assert.equal(
    impl({parameters: [{name: 'a', in: 'query'}]}),
    lines(
      '    options = options || {};', '', "    const url = '/x';", '', '    const fetchOptions: any = {', "      method: 'GET',", '      params: {},',
      '      headers: options.headers,', '    };', '', '    // Add query parameters', '    if (options.a !== undefined) {',
      '      fetchOptions.params.a = options.a;', '    }', '', '    return this.api.fetch(url, fetchOptions);'
    )
  );
});

await test('controller method body with a body sends every option except headers and query parameters as the body', () => {
  assert.equal(
    impl({method: 'POST', parameters: [{name: 'a', in: 'query'}], requestBody: BODY}),
    lines(
      '    options = options || {};', '', "    const url = '/x';", '', '    const { headers, a, ...bodyData } = options;',
      '    const requestBody = Object.keys(bodyData).length > 0 ? bodyData : undefined;', '', '    const fetchOptions: any = {', "      method: 'POST',",
      '      params: {},', '      body: requestBody,', '      headers: options.headers,', '    };', '', '    // Add query parameters',
      '    if (options.a !== undefined) {', '      fetchOptions.params.a = options.a;', '    }', '', '    return this.api.fetch(url, fetchOptions);'
    )
  );
});

await test('controller method body with a path parameter replaces it in the url and sends no headers when there is no query or body', () => {
  assert.equal(
    impl({path: '/x/{id}', parameters: [{name: 'id', in: 'path'}]}),
    lines(
      "    let url = '/x/{id}';", '    if (id) {', "      url = url.replace('{id}', id);", '    }', '', '    const fetchOptions: any = {', "      method: 'GET',",
      '    };', '', '    return this.api.fetch(url, fetchOptions);'
    )
  );
});

await test('controller method body with a path parameter, a query parameter and a body reads options with a safe access', () => {
  assert.equal(
    impl({method: 'POST', path: '/x/{id}', parameters: [{name: 'id', in: 'path'}, {name: 'a', in: 'query'}], requestBody: BODY}),
    lines(
      "    let url = '/x/{id}';", '    if (id) {', "      url = url.replace('{id}', id);", '    }', '',
      '    const { headers, a, ...bodyData } = options;', '    const requestBody = Object.keys(bodyData).length > 0 ? bodyData : undefined;', '',
      '    const fetchOptions: any = {', "      method: 'POST',", '      params: {},', '      body: requestBody,', '      headers: options?.headers,', '    };', '',
      '    // Add query parameters', '    if (options?.a !== undefined) {', '      fetchOptions.params.a = options.a;', '    }', '',
      '    return this.api.fetch(url, fetchOptions);'
    )
  );
});

await test('resource function body with no parameters sends the headers option', () => {
  assert.equal(
    resImpl({}),
    lines(
      '  options = options || {};', '', "  const url = '/x';", '', '  const fetchOptions: any = {', "    method: 'GET',", '    headers: options.headers,', '  };', '',
      '  return this.api.fetch(url, fetchOptions);'
    )
  );
});

await test('resource function body with only a path parameter fetches with the method alone', () => {
  assert.equal(
    resImpl({path: '/x/{id}', parameters: [{name: 'id', in: 'path'}]}),
    lines("  let url = '/x/{id}';", '  if (id) {', "    url = url.replace('{id}', id);", '  }', '', '  return this.api.fetch(url, {', "    method: 'GET',", '  });')
  );
});

await test('resource function body with a path parameter, a query parameter and a body builds the url, the body and the params', () => {
  assert.equal(
    resImpl({method: 'POST', path: '/x/{id}', parameters: [{name: 'id', in: 'path'}, {name: 'a', in: 'query'}], requestBody: BODY}),
    lines(
      '  options = options || {};', '', '  // Build URL with path parameters', "  let url = '/x/{id}';", '  if (id) {', "    url = url.replace('{id}', id);", '  }', '',
      '  const { headers, a, ...bodyData } = options;', '  const requestBody = Object.keys(bodyData).length > 0 ? bodyData : undefined;', '',
      '  const fetchOptions: any = {', "    method: 'POST',", '    params: {},', '    body: requestBody,', '    headers: options.headers,', '  };', '',
      '  // Add query parameters', '  if (options.a !== undefined) {', '    fetchOptions.params.a = options.a;', '  }', '', '  return this.api.fetch(url, fetchOptions);'
    )
  );
});

await test('resource function body with a query parameter and a body, without a path parameter, destructures options', () => {
  const out = resImpl({method: 'POST', parameters: [{name: 'a', in: 'query'}], requestBody: BODY});
  assert.ok(out.includes('  const { headers, a, ...bodyData } = options;'));
  assert.ok(out.includes("  const url = '/x';"));
  assert.ok(out.includes('    params: {},\n    body: requestBody,\n    headers: options.headers,'));
});

// ---- interfaces and type collection

await test('generateInterfaceFromSchema writes required and optional properties with descriptions as comments', () => {
  assert.equal(
    g.generateInterfaceFromSchema('Pet', components.schemas.Pet),
    lines('export interface Pet {', '  /** the id */', '  id: string;', '  tags?: string[];', '  owner?: Owner;', '}')
  );
});

await test('generateInterfaceFromSchema returns an empty string without a schema and lists allOf parents as a comment', () => {
  assert.equal(g.generateInterfaceFromSchema('Pet', undefined), '');
  assert.equal(g.generateInterfaceFromSchema('Combo', components.schemas.Combo), lines('export interface Combo {', '  // Inherits from: Pet, unknown', '}'));
  assert.equal(g.generateInterfaceFromSchema('a.b+c', {type: 'object', properties: {x: {type: 'boolean'}}}), lines('export interface a_b_Plusc {', '  x?: boolean;', '}'));
});

await test('generateInterfaceFromSchema writes an empty interface for a oneOf or a string schema', () => {
  assert.equal(g.generateInterfaceFromSchema('Shape', components.schemas.Shape), 'export interface Shape {\n}');
  assert.equal(g.generateInterfaceFromSchema('Param', components.schemas.Param), 'export interface Param {\n}');
});

const used = mk(
  {
    '/pets': {
      get: {operationId: 'listPets', parameters: [{name: 'kind', in: 'query', schema: {$ref: '#/components/schemas/Param'}}, 'x', {name: 'n', in: 'query'}], responses: {'200': json({type: 'array', items: {$ref: '#/components/schemas/Pet'}}), '400': json({$ref: '#/components/schemas/Circle'})}},
      post: {operationId: 'addPet', requestBody: json({$ref: '#/components/schemas/Shape'}), responses: {'201': json({$ref: '#/components/schemas/Child'})}},
    },
    '/pets/{id}': {get: {operationId: 'getPet', parameters: [param('id', 'path', true)], responses: {'200': json({$ref: '#/components/schemas/Ev.ent'})}}, delete: {responses: {'204': {description: 'x'}}}},
  },
  {},
  {components, servers: [{url: 'https://api.test/v1'}]}
);

await test('collectUsedSchemaTypes follows references through parameters, bodies, success responses, arrays, properties, allOf, oneOf and anyOf', () => {
  assert.deepEqual([...used.collectUsedSchemaTypes()].sort(), ['Base', 'Child', 'Circle', 'Ev_ent', 'Owner', 'Param', 'Pet', 'Shape', 'Square']);
});

await test('collectUsedSchemaTypes ignores a schema that only an error response uses', () => {
  const only = mk({'/a': {get: {responses: {'400': json({$ref: '#/components/schemas/Circle'})}}}}, {}, {components});
  assert.deepEqual([...only.collectUsedSchemaTypes()], []);
});

await test('collectUsedSchemaTypes ends on a reference cycle', () => {
  const cyc = mk({'/a': {get: {responses: {'200': json({$ref: '#/components/schemas/Pet'})}}}}, {}, {components});
  assert.deepEqual([...cyc.collectUsedSchemaTypes()].sort(), ['Owner', 'Pet']);
});

await test('generateTypeImports lists the used types in sorted order as a comment, and nothing when none is used', () => {
  assert.equal(
    used.generateTypeImports(),
    '// Type imports (you may need to adjust the import path)\n// import type { Base, Child, Circle, Ev_ent, Owner, Param, Pet, Shape, Square } from \'./types\';\n\n'
  );
  assert.equal(mk({'/a': {get: {}}}).generateTypeImports(), '');
});

await test('generateAllInterfaces returns an empty string without component schemas or when none is used', () => {
  assert.equal(mk({'/a': {get: {}}}).generateAllInterfaces(), '');
  assert.equal(mk({'/a': {get: {}}}, {}, {components}).generateAllInterfaces(), '');
});

await test('generateAllInterfaces writes one interface for each used schema, in component order, under a header', () => {
  const out = used.generateAllInterfaces();
  assert.ok(out.startsWith('// Generated TypeScript interfaces from OpenAPI schemas\n\nexport interface Pet {'));
  assert.deepEqual([...out.matchAll(/^export interface (\w+)/gm)].map((m) => m[1]), ['Pet', 'Owner', 'Shape', 'Circle', 'Square', 'Base', 'Child', 'Param', 'Ev_ent']);
  assert.ok(out.endsWith('}\n'));
});

// ---- controller output

await test('generateController throws when there is no operation', () => {
  assert.throws(() => mk({}).generateController(), /^Error: No operations found in OpenAPI specification$/);
  assert.throws(() => mk({'/x': {}}).generateController(), /No operations found in OpenAPI specification/);
});

await test('generateController names colliding operations with a path prefix, then a number', () => {
  const dup = mk({'/a': {get: {operationId: 'list'}}, '/b': {get: {operationId: 'list'}}, '/b/': {get: {operationId: 'list'}}, '/': {get: {operationId: 'list'}}});
  assert.deepEqual(methodNames(dup.generateController()), ['list', 'bList', 'bList2', 'getList']);
});

await test('generateController names methods and quotes dotted names when nestedPaths is on', () => {
  const nested = mk({'/crm/{id}/deals': {get: {operationId: 'x_list'}}, '/crm/{id}/notes': {post: {operationId: 'x_add'}}}, {nestedPaths: true});
  assert.deepEqual(methodNames(nested.generateController()), ["'crm.deals.list'", "'crm.notes.add'"]);
});

await test('generateController uses the first server url, else https://api.example.com', () => {
  assert.ok(used.generateController().includes("baseUrl: 'https://api.test/v1',"));
  assert.ok(mk({'/a': {get: {}}}).generateController().includes("baseUrl: 'https://api.example.com',"));
});

await test('generateController writes the methods of every operation with their signatures', () => {
  const code = used.generateController();
  assert.deepEqual(methodNames(code), ['listPets', 'addPet', 'getPet', 'delete_pets_id']);
  assert.ok(code.includes(`  async listPets(options?: {kind?: Param, n?: any, ${H}}) {`));
  assert.ok(code.includes(`  async getPet(id: string, options?: {${H}}) {`));
  assert.ok(code.includes('import {AbstractController} from \'@aloma.io/integration-sdk\';\n\n// Type imports'));
});

await test('generateResourceClass throws when there is no operation', () => {
  assert.throws(() => mk({}).generateResourceClass('PetsResource'), /No operations found in OpenAPI specification/);
});

await test('generateResourceClass writes exported functions after a header naming the resource', () => {
  const code = mk({'/pets': {get: {operationId: 'list'}}}).generateResourceClass('PetsResource');
  assert.ok(code.startsWith('// PetsResource resource functions\n// These functions will be bound to the controller instance and accessible as pets.method()\n'));
  assert.ok(code.includes(`export function list(this: any, options?: {${H}}) {`));
});

await test('generateResourceClass names colliding operations with a path prefix, then a number', () => {
  const dup = mk({'/a/list': {get: {operationId: 'list'}}, '/b/list': {get: {operationId: 'list'}}, '/a/{id}/list': {get: {operationId: 'list'}}, '/b/list/': {get: {operationId: 'list'}}});
  assert.deepEqual([...dup.generateResourceClass('XResource').matchAll(/export function (\w+)/g)].map((m) => m[1]), ['list', 'bList', 'aList', 'bList2']);
});

const resources = [
  {
    fileName: 'pets',
    spec: mk({'/pets': {get: {operationId: 'list'}}, '/pets/{id}': {get: {operationId: 'get', parameters: [{name: 'id', in: 'path', required: true}]}}}).spec,
  },
  {
    fileName: 'orders',
    spec: mk({'/o': {post: {operationId: 'x_create', requestBody: json({type: 'object', properties: {n: {type: 'string'}}})}}}).spec,
  },
];

await test('generateMainController imports, declares and binds every resource, with the default base url without servers', () => {
  const code = mk({}).generateMainController([{fileName: 'pets'}, {fileName: 'orders'}], resources);
  assert.ok(code.includes("import * as petsFunctions from '../resources/pets.mjs';\nimport * as ordersFunctions from '../resources/orders.mjs';"));
  assert.ok(code.includes('  pets: any = {};\n  orders: any = {};'));
  assert.ok(code.includes("    this.bindResourceFunctions('pets', petsFunctions);\n    this.bindResourceFunctions('orders', ordersFunctions);"));
  assert.ok(code.includes("baseUrl: 'https://api.example.com',"));
});

await test('generateMainController takes the base url from the first server', () => {
  const code = mk({}, {}, {servers: [{url: 'https://s.test'}]}).generateMainController([], []);
  assert.ok(code.includes("baseUrl: 'https://s.test',"));
});

await test('generateMainController writes one method for each operation of each resource, delegating to the resource', () => {
  const code = mk({}).generateMainController([{fileName: 'pets'}, {fileName: 'orders'}], resources);
  assert.deepEqual(methodNames(code).filter((n) => n !== 'start' && n !== 'request'), ['petsList', 'petsGet', 'ordersCreate']);
  assert.ok(code.includes(`  async petsGet(id: any, options?: {${H}}) {\n    return this.pets.get(id, options);\n  }`));
  assert.ok(code.includes(`  async ordersCreate(options?: {n?: string, ${H}}) {\n    return this.orders.create(options);\n  }`));
});

await test('generateExposedResourceMethods skips a resource that has no spec', () => {
  assert.equal(mk({}).generateExposedResourceMethods([{fileName: 'ghost'}], undefined), '');
  assert.equal(mk({}).generateExposedResourceMethods([{fileName: 'ghost'}], resources), '');
});

await test('generateExposedResourceMethods with nestedPaths names a method after the dotted path and quotes it', () => {
  const nested = mk({}, {nestedPaths: true});
  const out = nested.generateExposedResourceMethods(
    [{fileName: 'orders'}],
    [{fileName: 'orders', spec: mk({'/o/items': {post: {operationId: 'x_create'}, get: {}}}).spec}]
  );
  assert.ok(out.includes(`  async ordersGet_o_items(options?: {${H}}) {\n    return this.orders.get_o_items(options);\n  }`));
  assert.ok(out.includes(`  async 'o.create'(options?: {${H}}) {\n    return this.orders.create(options);\n  }`));
});

await test('generateParameterCallForOperation passes path parameters then options, or options alone, or nothing', () => {
  const call = (o, s) => g.generateParameterCallForOperation(o, s);
  assert.equal(call({parameters: [{name: 'id', in: 'path'}]}, '(id: string)'), 'id');
  assert.equal(call({parameters: [{name: 'id', in: 'path'}]}, '(id: string, options?: {})'), 'id, options');
  assert.equal(call({parameters: [{name: 'id', in: 'path'}, {name: 'q', in: 'query'}, 'zz']}, '(id: string)'), 'id');
  assert.equal(call({}, '()'), '');
  assert.equal(call({}, '(options?: {a: string})'), 'options');
  assert.equal(call({}, '(a: string)'), '');
});

// ---- command line

const runCli = (args) => spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8'});

await test('the generate command writes the controller and reports the name and the operation count', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-cli-'));
  try {
    const specFile = path.join(dir, 'spec.yaml');
    const out = path.join(dir, 'out.mts');
    fs.writeFileSync(specFile, 'openapi: 3.0.1\ninfo:\n  title: T\n  version: "1"\npaths:\n  /pets:\n    get:\n      operationId: listPets\n');
    const res = runCli(['generate', '--name', 'Pets', '--spec', specFile, '--out', out]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, `✅ Successfully generated connector controller: ${out}\n📝 Connector name: Pets\n📊 Found 1 operations\n`);
    assert.ok(fs.readFileSync(out, 'utf8').includes('  async listPets(options?: {'));
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

await test('the generate command prints the error and exits with 1 for a spec without operations', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-cli-'));
  try {
    const specFile = path.join(dir, 'spec.json');
    fs.writeFileSync(specFile, '{"openapi":"3.0.1","info":{"title":"T","version":"1"},"paths":{}}');
    const res = runCli(['generate', '--name', 'Pets', '--spec', specFile, '--out', path.join(dir, 'out.mts')]);
    assert.equal(res.status, 1);
    assert.equal(res.stderr, '❌ Error: No operations found in OpenAPI specification\n');
    assert.equal(fs.existsSync(path.join(dir, 'out.mts')), false);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

await test('the generate command exits with 1 when the spec file does not exist', () => {
  const res = runCli(['generate', '--name', 'Pets', '--spec', path.join(os.tmpdir(), 'no-such-spec-file.json')]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /^❌ Error: ENOENT: no such file or directory/);
});

await test('running with no command prints the help and exits with 0', () => {
  const res = runCli([]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Usage: openapi-to-connector/);
});

finish();
