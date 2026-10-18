// Whole-spec ingestion, generated contract tests and the generated documentation.
import {assertNoNetwork} from './support/offline.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {OpenAPIToConnector} from '../build/openapi-to-connector.mjs';
import {runContract, assertParamEffect} from '../build/index.mjs';
import {loadConnector} from './support/load-generated.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const specText = fs.readFileSync(path.join(here, 'fixtures/example-crm.json'), 'utf-8');
const spec = () => OpenAPIToConnector.parseSpec(specText);

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

function specOperations(doc) {
  const ops = [];
  for (const [p, item] of Object.entries(doc.paths)) {
    for (const m of ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']) {
      if (item[m]) ops.push(`${m.toUpperCase()} ${p}`);
    }
  }
  return ops.sort();
}

// --- Whole spec ingested ---

await test('every operation in the spec becomes exactly one method (single controller)', async () => {
  const gen = new OpenAPIToConnector(spec(), 'Example CRM');
  const table = gen.getOperationTable();
  const fromTable = table.map((op) => `${op.httpMethod} ${op.path}`).sort();
  assert(JSON.stringify(fromTable) === JSON.stringify(specOperations(spec())), 'operation table differs from the spec');

  const c = await loadConnector({'controller/index.mts': gen.generateController()});
  const exposed = c.meta.methods.filter((m) => m !== 'request').sort();
  const names = table.map((op) => op.name).sort();
  assert(JSON.stringify(exposed) === JSON.stringify(names), `methods ${exposed} differ from the table ${names}`);
  assert(new Set(names).size === names.length, 'duplicate method names');
});

await test('every operation in the spec becomes exactly one method (multi-resource)', async () => {
  const gen = new OpenAPIToConnector(spec(), 'Example CRM');
  const resources = [{className: 'ContactsResource', fileName: 'contacts'}];
  const c = await loadConnector({
    'resources/contacts.mts': gen.generateResourceClass('ContactsResource'),
    'controller/index.mts': gen.generateMainController(resources, [{fileName: 'contacts', spec: spec()}]),
  });
  const exposed = c.meta.methods.filter((m) => m !== 'request');
  assert(exposed.length === specOperations(spec()).length, `${exposed.length} methods for ${specOperations(spec()).length} operations`);
});

await test('anything not fully supported is reported by operation name', async () => {
  const gen = new OpenAPIToConnector(spec(), 'Example CRM');
  const report = gen.getReport();
  assert(report.operations === specOperations(spec()).length, 'report counts the spec operations');
  assert(report.generated === report.operations, 'every operation generated');
  const text = JSON.stringify(report.warnings);
  assert(/GET \/search\/records/.test(text) && /cookie/i.test(text), 'cookie parameter not reported');
  assert(/POST \/files\/upload/.test(text) && /multipart/i.test(text), 'multipart body not reported');
});

await test('a large operation keeps its typed parameters (no catch-all signature)', async () => {
  const doc = spec();
  const params = Array.from({length: 30}, (_, i) => ({name: `p${i}`, in: 'query', schema: {type: 'string'}}));
  doc.paths['/wide'] = {get: {operationId: 'wide', parameters: params, responses: {200: {description: 'OK'}}}};
  const gen = new OpenAPIToConnector(doc, 'Example CRM');
  const c = await loadConnector({'controller/index.mts': gen.generateController()});
  assert(c.meta.text.includes('p29'), 'parameter p29 missing from introspection');
  await c.call('wide', {p0: 'x', p29: 'y'});
  assert(c.calls[0].url === '/wide?p0=x&p29=y', `url ${c.calls[0].url}`);
});

// --- Contract tests ---

await test('the generated contract covers every operation and passes on the generated connector', async () => {
  const gen = new OpenAPIToConnector(spec(), 'Example CRM');
  const contract = gen.generateContract();
  assert(contract.operations.length === specOperations(spec()).length, 'contract does not cover every operation');
  const c = await loadConnector({'controller/index.mts': gen.generateController()});
  const result = await runContract(c.controller, contract, {methods: c.meta.methods});
  assert(result.failures.length === 0, JSON.stringify(result.failures));
  assert(result.passed === contract.operations.length, `passed ${result.passed}`);
});

await test('the contract fails when a generated method ignores a query parameter', async () => {
  const gen = new OpenAPIToConnector(spec(), 'Example CRM');
  const contract = gen.generateContract();
  const code = gen.generateController();
  // Mutation: getPage stops sending its query.
  const mutated = code.replace(
    /(async getPage\([\s\S]*?return callOperation\(this\.api, )OPERATIONS\.getPage, \{/,
    '$1{...OPERATIONS.getPage, query: []}, {'
  );
  assert(mutated !== code, 'mutation did not apply');
  const c = await loadConnector({'controller/index.mts': mutated});
  const result = await runContract(c.controller, contract, {methods: c.meta.methods});
  assert(result.failures.some((f) => f.method === 'getPage'), 'contract did not catch the dropped query');
});

await test('the contract fails a dotted method the runtime cannot reach through its namespace', async () => {
  // "crm" is both a method and the namespace of crm.contacts.get: the runtime cannot reach the latter.
  class Clashing {
    async 'crm.contacts.get'() {
      return this.api.fetch('/crm/contacts', {method: 'GET'});
    }
    async crm() {
      return this.api.fetch('/crm', {method: 'GET'});
    }
  }
  const contract = {operations: [{method: 'crm.contacts.get', args: {}, expect: {method: 'GET', url: '/crm/contacts'}}]};
  const result = await runContract(new Clashing(), contract, {methods: ['crm.contacts.get', 'crm']});
  assert(result.failures.some((f) => /namespace/.test(f.problem)), JSON.stringify(result));
});

await test('the parameter-effect check fails when a parameter changes nothing', async () => {
  let error;
  try {
    await assertParamEffect(async () => ({results: [1, 2, 3]}), {param: 'limit', values: [1, 2]});
  } catch (e) {
    error = e;
  }
  assert(error && /limit/.test(error.message), `expected a failure naming limit, got ${error?.message}`);
  await assertParamEffect(async ({limit}) => ({results: Array(limit).fill(0)}), {param: 'limit', values: [1, 2]});
});

// --- Documentation and command reference ---

await test('the doc page gives the exact call syntax and links each method to the provider reference', async () => {
  const gen = new OpenAPIToConnector(spec(), 'Example CRM');
  const md = gen.generateDocs({namespace: 'exampleCrm'});
  for (const op of gen.getOperationTable()) {
    assert(md.includes(`connectors.exampleCrm.${op.name}(`), `no call syntax for ${op.name}`);
  }
  assert(md.includes('https://docs.example.test/reference/contacts/get-page'), 'operation link missing');
  assert(md.includes('https://docs.example.test/reference'), 'spec-level link missing for unlinked operations');
  assert(/## Setup/.test(md), 'setup section missing');
});

await test('provider links: operation, then a supplied template, then the tag, then the spec', async () => {
  const doc = spec();
  doc.tags = [{name: 'Search', externalDocs: {url: 'https://docs.example.test/search'}}];
  doc.paths['/search/records'].get.tags = ['Search'];
  delete doc.paths['/crm/v3/objects/contacts'].get.externalDocs;

  const byTag = new OpenAPIToConnector(doc, 'Example CRM').getOperationTable();
  assert(byTag.find((r) => r.name === 'searchRecords').reference === 'https://docs.example.test/search', 'tag link not used');
  assert(byTag.find((r) => r.name === 'getPage').reference === 'https://docs.example.test/reference', 'spec link not used');

  const templated = new OpenAPIToConnector(doc, 'Example CRM', {
    referenceUrl: 'https://docs.example.test/ops/{operationId}?m={method}&p={path}',
  }).getOperationTable();
  const getById = templated.find((r) => r.name === 'getById');
  assert(
    getById.reference ===
      'https://docs.example.test/ops/get-%2Fcrm%2Fv3%2Fobjects%2Fcontacts%2F%7BcontactId%7D_getById?m=get&p=%2Fcrm%2Fv3%2Fobjects%2Fcontacts%2F%7BcontactId%7D',
    `template link ${getById.reference}`
  );
  assert(!getById.referenceIsGeneral, 'a templated link is specific to the operation');
});

await test('nested names: a method never shares its name with the namespace of other methods', async () => {
  const doc = spec();
  // GET /crm/v3/objects/{objectType} derives the name "crm", which is also the namespace of crm.contacts.*
  doc.paths['/crm/v3/objects/{objectType}'] = {
    get: {
      operationId: 'get-/crm/v3/objects/{objectType}_crm',
      parameters: [{name: 'objectType', in: 'path', required: true, schema: {type: 'string'}}],
      responses: {200: {description: 'OK'}},
    },
  };
  const options = {nestedPaths: true};

  const single = new OpenAPIToConnector(doc, 'Example CRM', options);
  const s = await loadConnector({'controller/index.mts': single.generateController()});
  const sResult = await runContract(s.controller, single.generateContract(), {methods: s.meta.methods});
  assert(sResult.failures.length === 0, `single: ${JSON.stringify(sResult.failures)}`);

  const resourceSpecs = [{fileName: 'crm', spec: doc}];
  const plan = OpenAPIToConnector.planExposedNames(resourceSpecs, options);
  const gen = new OpenAPIToConnector(doc, 'Example CRM', options);
  gen.useExposedNames(plan.get('crm'));
  const m = await loadConnector({
    'resources/crm.mts': gen.generateResourceClass('CrmResource'),
    'controller/index.mts': gen.generateMainController([{className: 'CrmResource', fileName: 'crm'}], resourceSpecs),
  });
  const mResult = await runContract(m.controller, gen.generateContract({resourceName: 'crm'}), {methods: m.meta.methods});
  assert(mResult.failures.length === 0, `multi: ${JSON.stringify(mResult.failures)}`);
});

await test('resources whose methods would share a name: controller, contract and docs agree on the names', async () => {
  const resourceSpecs = [
    {fileName: 'contacts', spec: spec()},
    {fileName: 'companies', spec: spec()},
  ];
  const resources = resourceSpecs.map((r) => ({className: `${r.fileName}Resource`, fileName: r.fileName}));
  const options = {nestedPaths: true};
  const plan = OpenAPIToConnector.planExposedNames(resourceSpecs, options);
  const parts = resourceSpecs.map((r) => {
    const generator = new OpenAPIToConnector(r.spec, 'Example CRM', options);
    generator.useExposedNames(plan.get(r.fileName));
    return {generator, resourceName: r.fileName};
  });

  const files = {
    'controller/index.mts': new OpenAPIToConnector(spec(), 'Example CRM', options).generateMainController(resources, resourceSpecs),
  };
  for (const {generator, resourceName} of parts) files[`resources/${resourceName}.mts`] = generator.generateResourceClass(`${resourceName}Resource`);
  const c = await loadConnector(files);

  const contract = {operations: parts.flatMap(({generator, resourceName}) => generator.generateContract({resourceName}).operations)};
  const exposed = c.meta.methods.filter((m) => m !== 'request').sort();
  const named = contract.operations.map((o) => o.method).sort();
  assert(JSON.stringify(exposed) === JSON.stringify(named), `controller ${exposed.length} vs contract ${named.length} names differ`);
  const result = await runContract(c.controller, contract, {methods: c.meta.methods});
  assert(result.failures.length === 0, JSON.stringify(result.failures.slice(0, 3)));
  const md = OpenAPIToConnector.combineDocs('Example CRM', parts);
  for (const n of named) assert(md.includes(`#### \`${n}\``), `docs miss ${n}`);
});

await test('a multi-resource doc page has one setup section and a section per resource', async () => {
  const a = new OpenAPIToConnector(spec(), 'Example CRM');
  const other = spec();
  other.info.title = 'Example Files';
  const b = new OpenAPIToConnector(other, 'Example CRM');
  const md = OpenAPIToConnector.combineDocs('Example CRM', [
    {generator: a, resourceName: 'contacts'},
    {generator: b, resourceName: 'files'},
  ]);
  assert((md.match(/^## Setup$/gm) || []).length === 1, 'setup appears more than once');
  assert((md.match(/^# /gm) || []).length === 1, 'more than one page title');
  assert(/^## Example CRM$/m.test(md) && /^## Example Files$/m.test(md), 'resource sections missing');
  assert(md.includes('connectors.exampleCrm.contactsGetById(') && md.includes('connectors.exampleCrm.filesGetById('), 'methods missing');
});

// --- Nested names for large APIs; a general reference as the last link ---

function largeSpec(n) {
  const doc = {openapi: '3.0.0', info: {title: 'Large', version: '1'}, paths: {}};
  for (let i = 0; i < n; i++) {
    doc.paths[`/crm/v3/objects/thing${i}`] = {get: {operationId: `get-/crm/v3/objects/thing${i}_getPage`, responses: {200: {description: 'OK'}}}};
  }
  return doc;
}

await test('large APIs get nested names by default; small ones stay flat; an explicit choice wins', async () => {
  const large = new OpenAPIToConnector(largeSpec(60), 'Large').getOperationTable();
  assert(large.every((r) => r.name.startsWith('crm.thing')), `large: ${large[0].name}`);
  const small = new OpenAPIToConnector(spec(), 'Example CRM').getOperationTable();
  assert(small.find((r) => r.key === 'GET /crm/v3/objects/contacts').name === 'getPage', 'small spec is not flat');
  const forced = new OpenAPIToConnector(largeSpec(60), 'Large', {nestedPaths: false}).getOperationTable();
  assert(!forced[0].name.includes('.'), `forced flat: ${forced[0].name}`);
});

await test('a multi-resource connector that is large in total gets nested names, though each resource is small', async () => {
  const resourceSpecs = Array.from({length: 6}, (_, i) => {
    const doc = largeSpec(10);
    for (const key of Object.keys(doc.paths)) {
      doc.paths[key.replace('thing', `r${i}x`)] = doc.paths[key];
      delete doc.paths[key];
    }
    return {fileName: `res${i}`, spec: doc};
  });
  const plan = OpenAPIToConnector.planExposedNames(resourceSpecs);
  const names = [...plan.get('res0').values()];
  assert(names.every((n) => n.includes('.')), `names ${names.slice(0, 3)}`);
});

await test('with no other link, methods point to the supplied general reference, labelled as general', async () => {
  const doc = spec();
  delete doc.externalDocs;
  for (const item of Object.values(doc.paths)) for (const op of Object.values(item)) if (op && op.externalDocs) delete op.externalDocs;
  const gen = new OpenAPIToConnector(doc, 'Example CRM', {referenceFallback: 'https://docs.example.test/api-overview'});
  const table = gen.getOperationTable();
  assert(table.every((r) => r.reference === 'https://docs.example.test/api-overview' && r.referenceIsGeneral), 'fallback not used');
  assert(gen.generateDocs().includes('[provider API reference](https://docs.example.test/api-overview)'), 'docs label');
  const linked = new OpenAPIToConnector(spec(), 'Example CRM', {referenceFallback: 'https://docs.example.test/api-overview'});
  const getPage = linked.getOperationTable().find((r) => r.key === 'GET /crm/v3/objects/contacts');
  assert(getPage.reference === 'https://docs.example.test/reference/contacts/get-page', 'fallback replaced a real link');
});

await test('the command reference matches the doc page method for method', async () => {
  const gen = new OpenAPIToConnector(spec(), 'Example CRM');
  const ref = gen.generateCommandReference({namespace: 'exampleCrm'});
  const names = gen.getOperationTable().map((op) => op.name);
  assert(JSON.stringify(ref.methods.map((m) => m.name)) === JSON.stringify(names), 'method list differs');
  const getById = ref.methods.find((m) => m.name === 'getById');
  assert(getById.call.startsWith('await connectors.exampleCrm.getById({'), getById.call);
  assert(getById.parameters.some((p) => p.name === 'contactId' && p.in === 'path' && p.required), 'contactId missing');
});

console.log(`\n${colors.yellow}===== Results =====${colors.reset}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);

if (failed > 0) {
  process.exit(1);
}
