// Generated connectors, called the way the connector runtime calls them: method(args, ctx).
// No network: the controller gets a recording client, and global fetch is blocked.
import {assertNoNetwork} from './support/offline.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {OpenAPIToConnector} from '../build/openapi-to-connector.mjs';
import {loadConnector, lastCall} from './support/load-generated.mjs';
import {runContract} from '../build/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const specText = fs.readFileSync(path.join(here, 'fixtures/example-crm.json'), 'utf-8');
const fullSpec = () => OpenAPIToConnector.parseSpec(specText);
// The core cases leave out the two operations with unusual parameter names and bodies, so that each
// defect shows on its own; those two have their own tests below.
const spec = () => {
  const doc = fullSpec();
  delete doc.paths['/search/records'];
  delete doc.paths['/files/upload'];
  return doc;
};
async function singleFull() {
  const gen = new OpenAPIToConnector(fullSpec(), 'Example CRM');
  return loadConnector({'controller/index.mts': gen.generateController()});
}

const colors = {green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', reset: '\x1b[0m', cyan: '\x1b[36m'};
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    console.log(`${colors.cyan}Running: ${name}${colors.reset}`);
    await fn();
    assertNoNetwork();
    console.log(`${colors.green}✓ PASS: ${name}${colors.reset}\n`);
    passed++;
  } catch (error) {
    console.log(`${colors.red}✗ FAIL: ${name}${colors.reset}`);
    console.log(`${colors.red}  Error: ${error.message}${colors.reset}\n`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message || 'not equal'}: expected ${e}, got ${a}`);
}

async function single() {
  const gen = new OpenAPIToConnector(spec(), 'Example CRM');
  return loadConnector({'controller/index.mts': gen.generateController()});
}

async function multi() {
  const gen = new OpenAPIToConnector(spec(), 'Example CRM');
  const resources = [{className: 'ContactsResource', fileName: 'contacts'}];
  return loadConnector({
    'resources/contacts.mts': gen.generateResourceClass('ContactsResource'),
    'controller/index.mts': gen.generateMainController(resources, [{fileName: 'contacts', spec: spec()}]),
  });
}

// Names the generator gives these operations (flat mode); multi-resource prefixes the resource name.
const FLAT = {
  getPage: ['GET', '/crm/v3/objects/contacts'],
  create: ['POST', '/crm/v3/objects/contacts'],
  getById: ['GET', '/crm/v3/objects/contacts/{contactId}'],
  update: ['PATCH', '/crm/v3/objects/contacts/{contactId}'],
  archive: ['DELETE', '/crm/v3/objects/contacts/{contactId}'],
  batchCreate: ['POST', '/crm/v3/objects/contacts/batch/create'],
  batchUpdate: ['POST', '/crm/v3/objects/contacts/batch/update'],
  batchArchive: ['POST', '/crm/v3/objects/contacts/batch/archive'],
  associationsCreate: ['PUT', '/crm/v4/objects/contacts/{contactId}/associations/{toObjectType}/{toObjectId}'],
};
const multiName = (flat) => `contacts${flat.charAt(0).toUpperCase()}${flat.slice(1)}`;

// --- A. Query parameters are sent ---

for (const [label, load, name] of [
  ['single controller', single, 'getPage'],
  ['multi-resource', multi, multiName('getPage')],
]) {
  await test(`A: query parameters reach the request (${label})`, async () => {
    const c = await load();
    await c.call(name, {limit: 1, after: 'abc'});
    assertEqual(lastCall(c.calls).url, '/crm/v3/objects/contacts?limit=1&after=abc', 'request url');
  });
}

await test('A: array, deepObject, non-exploded and odd-named query parameters are serialised', async () => {
  const c = await singleFull();
  // "filter[name]" is not a plain name, so the method takes it as filter_name (see the docs test).
  await c.call('searchRecords', {filter_name: 'Ada', page: {size: 5, number: 2}, fields: ['a', 'b']});
  assertEqual(
    lastCall(c.calls).url,
    '/search/records?filter%5Bname%5D=Ada&page%5Bsize%5D=5&page%5Bnumber%5D=2&fields=a%2Cb',
    'request url'
  );
});

// --- B. Each method calls its own operation ---

for (const [label, load, nameOf] of [
  ['single controller', single, (n) => n],
  ['multi-resource', multi, multiName],
]) {
  await test(`B: every method calls its own operation (${label})`, async () => {
    const c = await load();
    const wrong = [];
    for (const [flat, [method, template]] of Object.entries(FLAT)) {
      const args = {contactId: 'c1', toObjectType: 'companies', toObjectId: 'o1', inputs: [], properties: {}, body: []};
      c.calls.length = 0;
      try {
        await c.call(nameOf(flat), args);
      } catch (e) {
        wrong.push(`${nameOf(flat)}: threw ${e.message}`);
        continue;
      }
      const {url, options} = lastCall(c.calls);
      const expectedPath = template
        .replace('{contactId}', 'c1')
        .replace('{toObjectType}', 'companies')
        .replace('{toObjectId}', 'o1');
      const gotPath = url.split('?')[0];
      if (options.method !== method || gotPath !== expectedPath) {
        wrong.push(`${nameOf(flat)}: ${options.method} ${gotPath} (expected ${method} ${expectedPath})`);
      }
    }
    assert(!wrong.length, wrong.join('; '));
  });
}

// --- C. ID methods keep their options and second IDs ---

for (const [label, load, nameOf] of [
  ['single controller', single, (n) => n],
  ['multi-resource', multi, multiName],
]) {
  await test(`C: getById keeps its id and its options (${label})`, async () => {
    const c = await load();
    await c.call(nameOf('getById'), {contactId: '7', properties: ['email', 'firstname'], archived: false});
    assertEqual(
      lastCall(c.calls).url,
      '/crm/v3/objects/contacts/7?properties=email&properties=firstname&archived=false',
      'request url'
    );
  });

  await test(`C: a method with three path ids keeps all of them and its body (${label})`, async () => {
    const c = await load();
    const body = [{associationCategory: 'USER_DEFINED', associationTypeId: 1}];
    await c.call(nameOf('associationsCreate'), {contactId: '7', toObjectType: 'companies', toObjectId: '9', body});
    const {url, options} = lastCall(c.calls);
    assertEqual(url, '/crm/v4/objects/contacts/7/associations/companies/9', 'request url');
    assertEqual(options.body, body, 'request body');
  });

  await test(`C: update sends its body without the id (${label})`, async () => {
    const c = await load();
    await c.call(nameOf('update'), {contactId: '7', properties: {email: 'a@example.test'}});
    const {url, options} = lastCall(c.calls);
    assertEqual(url, '/crm/v3/objects/contacts/7', 'request url');
    assertEqual(options.body, {properties: {email: 'a@example.test'}}, 'request body');
  });
}

// --- D. Path values are encoded; a missing path value is refused ---

await test('D: path values are URL-encoded', async () => {
  const c = await single();
  await c.call('getById', {contactId: 'a/b c?d#e'});
  assertEqual(lastCall(c.calls).url, '/crm/v3/objects/contacts/a%2Fb%20c%3Fd%23e', 'request url');
});

await test('D: a missing required path value is refused before any request', async () => {
  const c = await single();
  let error;
  try {
    await c.call('getById', {});
  } catch (e) {
    error = e;
  }
  assert(error && /contactId/.test(error.message), `expected an error naming contactId, got ${error?.message}`);
  assertEqual(c.calls.length, 0, 'requests made');
});

// --- Path-level, $ref and header parameters are not dropped ---

await test('path-level and $ref parameters are part of the method', async () => {
  const c = await single();
  await c.call('getById', {contactId: '7', archived: true});
  assertEqual(lastCall(c.calls).url, '/crm/v3/objects/contacts/7?archived=true', 'request url');
});

await test('path-level parameters keep their description and are not reported as undeclared', async () => {
  const gen = new OpenAPIToConnector(spec(), 'Example CRM');
  const getById = gen.getOperationTable().find((row) => row.name === 'getById');
  const contactId = getById.params.find((p) => p.name === 'contactId');
  assertEqual(contactId.description, 'The contact id', 'contactId description');
  const undeclared = gen.getReport().warnings.filter((w) => /not declared/.test(w.problem));
  assertEqual(undeclared, [], 'undeclared path parameters');
});

await test('header parameters are sent as headers, and caller headers are kept', async () => {
  const c = await singleFull();
  await c.call('searchRecords', {X_Request_Id: 'r-1', headers: {'X-Extra': '1'}});
  const {url, options} = lastCall(c.calls);
  assertEqual(url, '/search/records', 'request url');
  assertEqual(options.headers, {'X-Extra': '1', 'X-Request-Id': 'r-1'}, 'request headers');
});

await test('a wildcard (*/*) body is sent as JSON fields, without a wildcard content type', async () => {
  const doc = spec();
  doc.paths['/notes'] = {
    post: {
      operationId: 'createNote',
      requestBody: {content: {'*/*': {schema: {type: 'object', properties: {text: {type: 'string'}}}}}},
      responses: {200: {description: 'OK'}},
    },
  };
  const gen = new OpenAPIToConnector(doc, 'Example CRM');
  const c = await loadConnector({'controller/index.mts': gen.generateController()});
  await c.call('createNote', {text: 'hi'});
  const {options} = lastCall(c.calls);
  assertEqual(options.body, {text: 'hi'}, 'request body');
  assert(!Object.values(options.headers).includes('*/*'), `wildcard content type sent: ${JSON.stringify(options.headers)}`);
});

await test('GET requests carry no body', async () => {
  const c = await single();
  await c.call('getPage', {limit: 1});
  assert(lastCall(c.calls).options.body === undefined, 'GET sent a body');
});

// --- Names stay valid when colliding operations live under dated or numeric path segments ---

await test('colliding operations under dated paths still get valid, distinct function names', async () => {
  const op = (id) => ({operationId: id, responses: {200: {description: 'OK'}}});
  const doc = {
    openapi: '3.0.0',
    info: {title: 'Dated', version: '1'},
    paths: {
      '/crm/objects/2026-03/{objectType}': {
        parameters: [{name: 'objectType', in: 'path', required: true, schema: {type: 'string'}}],
        post: op('post-/crm/objects/2026-03/{objectType}_/crm/objects/v3/{objectType}'),
      },
      '/crm/objects/2026-03/0-410': {post: op('post-/crm/objects/2026-03/0-410')},
      '/crm/objects/2026-03/0-410/{id}': {
        parameters: [{name: 'id', in: 'path', required: true, schema: {type: 'string'}}],
        patch: op('patch-/crm/objects/2026-03/0-410/{id}'),
        delete: op('patch-/crm/objects/2026-03/0-410/{id}'),
      },
    },
  };
  const gen = new OpenAPIToConnector(doc, 'Dated');
  const names = gen.getOperationTable().map((row) => row.flatName);
  for (const n of names) assert(/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n), `invalid name ${n}`);
  // Collisions take a word from the path (objects), not the fallback of prefixing the HTTP method.
  for (const n of names) assert(!/^(get|post|put|patch|delete)_/.test(n), `fallback name ${n}`);
  assertEqual(new Set(names).size, names.length, 'distinct names');
  const resources = [{className: 'DatedResource', fileName: 'dated'}];
  const c = await loadConnector({
    'resources/dated.mts': gen.generateResourceClass('DatedResource'),
    'controller/index.mts': gen.generateMainController(resources, [{fileName: 'dated', spec: doc}]),
  });
  assert(!c.meta.error, c.meta.error);
});

await test('an operation named like a controller lifecycle method does not replace it', async () => {
  const doc = {
    openapi: '3.0.0',
    info: {title: 'Lifecycle', version: '1'},
    paths: {
      '/jobs/start': {post: {operationId: 'start', responses: {200: {description: 'OK'}}}},
      '/jobs/stop': {post: {operationId: 'stop', responses: {200: {description: 'OK'}}}},
      '/raw': {get: {operationId: 'request', responses: {200: {description: 'OK'}}}},
      '/client': {get: {operationId: 'getClient', responses: {200: {description: 'OK'}}}},
    },
  };
  const gen = new OpenAPIToConnector(doc, 'Lifecycle');
  const names = gen.getOperationTable().map((r) => r.name);
  for (const reserved of ['start', 'stop', 'request', 'getClient']) {
    assert(!names.includes(reserved), `an operation took the name ${reserved}: ${names}`);
  }
  const c = await loadConnector({'controller/index.mts': gen.generateController()});
  const contract = gen.generateContract();
  const result = await runContract(c.controller, contract, {methods: c.meta.methods});
  assert(result.failures.length === 0, JSON.stringify(result.failures));
});

// --- Spec text never becomes code ---

await test('quotes and comment markers in the spec cannot inject code into the connector', async () => {
  const evil = "'); globalThis.__injected = 1; ('";
  const doc = {
    openapi: '3.0.0',
    info: {title: 'Hostile', version: '1'},
    servers: [{url: `https://api.example.test${evil}`}],
    paths: {
      [`/things/{id}/${evil}`]: {
        get: {
          operationId: `get_${evil}`,
          summary: `*/ globalThis.__injected = 2; /*`,
          description: 'line one\n*/ globalThis.__injected = 3; /*',
          parameters: [
            {name: 'id', in: 'path', required: true, schema: {type: 'string'}},
            {name: `q${evil}`, in: 'query', description: '*/ globalThis.__injected = 4; /*', schema: {type: 'string'}},
          ],
          responses: {200: {description: 'OK'}},
        },
      },
    },
  };
  delete globalThis.__injected;
  const gen = new OpenAPIToConnector(doc, 'Hostile');
  const c = await loadConnector({'controller/index.mts': gen.generateController()});
  const [name] = c.meta.methods.filter((m) => m !== 'request');
  await c.call(name, {id: '1'});
  assert(globalThis.__injected === undefined, `spec text ran as code (${globalThis.__injected})`);
  assert(lastCall(c.calls).url.startsWith('/things/1/'), lastCall(c.calls).url);
});

// --- Introspection: what steps and the AI generator see ---

for (const [label, load] of [
  ['single controller', singleFull],
  ['multi-resource', multi],
]) {
  await test(`the generated connector type-checks with the connector template's tsconfig (${label})`, async () => {
    const c = await load();
    assert(!c.meta.error, c.meta.error);
  });
}

await test('introspection lists every parameter of every method', async () => {
  const c = await singleFull();
  const text = c.meta.text;
  for (const needle of ['contactId', 'properties', 'idProperty', 'archived', 'toObjectId', 'filter_name', 'X_Request_Id', 'inputs']) {
    assert(text.includes(needle), `introspection is missing ${needle}`);
  }
  assert(/Maximum results per page/.test(text), 'introspection is missing the limit description');
});

console.log(`\n${colors.yellow}===== Results =====${colors.reset}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);

if (failed > 0) {
  process.exit(1);
}
