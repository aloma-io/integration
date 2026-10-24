# nodejs - Aloma Integration SDK

A powerful toolkit for generating production-ready Aloma connectors from OpenAPI specifications with advanced features like multi-resource architecture, TypeScript type generation, and comprehensive testing.

## ✨ Key Features

- 🎯 **Deterministic Code Generation** - Same input always produces the same output
- 🔧 **Multi-Resource Architecture** - Organize large APIs into logical resource groups
- 📘 **TypeScript First** - Full TypeScript support with proper interface generation
- 🧪 **Comprehensive Testing** - Built-in scenario tests with fixtures
- 🔍 **Schema Sanitization** - Converts invalid TypeScript names to valid identifiers
- 📝 **Rich Documentation** - Detailed JSDoc generation from OpenAPI descriptions
- 🎨 **Clean Code Generation** - No unnecessary parameters or boilerplate
- 📦 **Controller-Only Mode** - Generate just the controller for existing projects

## 🚀 Quick Start

### 1. Create from scratch
```bash
npx @aloma.io/integration-sdk@latest create connectorName --connector-id 1234
```

### 2. Generate from OpenAPI specification
```bash
npx @aloma.io/integration-sdk@latest from-openapi connectorName --connector-id 1234 --spec api.yaml --no-build
```

This will automatically generate a complete connector project with:
- Methods for all OpenAPI endpoints
- Proper TypeScript interfaces from schemas
- Clean parameter handling (no unnecessary options)
- Rich JSDoc documentation

### 3. Controller-Only Generation (New!)
```bash
# Generate just the controller file for existing projects
npx @aloma.io/integration-sdk@latest from-openapi connectorName \
  --connector-id 1234 \
  --spec api.yaml \
  --controller-only \
  --out "./src/controller/index.mts"
```

```bash
npx @aloma.io/integration-sdk@latest from-openapi connectorName \
  --connector-id 1234 \
  --spec api.yaml \
  --out src/resources/myresource.mts \
  --resource MyResource \
  --no-build
```

### 5. Create Multi-Resource Connector (Recommended for complex APIs)
```bash
npx @aloma.io/integration-sdk@latest create-multi-resource "HubSpot-v2" \
  --connector-id "hubspot-123" \
  --resources "CompaniesResource:examples/hubspot-companies.json,ContactsResource:examples/hubspot-contacts.json,ListsResource:examples/hubspot-lists.json" \
  --base-url "https://api.hubapi.com" \
  --no-build
```

This creates a complete multi-resource connector with:
- Individual resource classes for each OpenAPI spec
- Main controller that composes all resources
- Proper TypeScript imports and architecture

```typescript
// Usage
await controller.companies.create({ body: { properties: { name: 'Acme' } } });
await controller.contacts.getPage({ limit: 10 });
await controller.lists.getAll({ limit: 50 });
```

### 6. Add Resource to Existing Project
```bash
npx @aloma.io/integration-sdk@latest add-resource ./existing-project \
  --className "DealsResource" \
  --spec "deals.json" \
  --no-build
```

This adds a new resource to an existing multi-resource connector.

## 🧪 Testing & Quality

### Run Scenario Tests
```bash
# Run comprehensive scenario tests with fixtures
npm run test:scenarios

# Run all tests
npm run test:all
```

The SDK includes comprehensive scenario tests that verify:
- ✅ **Complete code generation pipeline** from OpenAPI specs to connector code
- ✅ **TypeScript interface generation** with schema sanitization
- ✅ **Clean parameter handling** (no unnecessary options for simple methods)
- ✅ **Multi-resource architecture** with proper resource binding
- ✅ **Regression protection** against common code generation issues

### Test Scenarios
- **Simple Scenario**: Basic single-controller generation
- **Complex Scenario**: Multi-resource generation with Products + Orders APIs
- **Regression Tests**: Edge cases and schema sanitization

All tests use real OpenAPI specifications and compare generated output against fixtures to ensure deterministic, high-quality code generation.

### Testing a connector: handshake smoke test

The SDK ships a test harness (`build/testing/`, source in `src/testing/`). It runs your real connector in-process
against a fake ALOMA endpoint on `127.0.0.1`, performs the real handshake (connect, 401, register, websocket,
configuration), sends method calls like ALOMA does, and mocks the vendor HTTP API. Any request that is not
mocked fails the test, and raw connections to non-loopback hosts are blocked, so a test never touches the network.
No real token or key is needed: the harness generates a throwaway RSA key pair and fake tokens.

A connector repo adds one dev dependency on the SDK (already a dependency) and one file, `test/handshake.smoke.test.mjs`
(run it with `mocha --exit test/handshake.smoke.test.mjs` after `yarn build`):

```js
import {describe, it, afterEach} from 'mocha';
import {expect} from 'chai';
import {Builder} from '@aloma.io/integration-sdk';
import {ConnectorHarness, connectorFromRuntimeContext} from '@aloma.io/integration-sdk/build/testing/index.mjs';

describe('handshake smoke test', function () {
  this.timeout(15000);
  let harness;

  // stop() also fails the test if the connector made a request you did not mock
  afterEach(async () => harness && (await harness.stop()));

  it('registers, connects, starts and reports healthy', async () => {
    // use the same Builder configuration as src/index.mts (config, options, auth)
    const context = await new Builder().config({fields: {apiKey: {name: 'API Key', type: 'line'}}}).build();

    harness = await ConnectorHarness.start({
      connector: connectorFromRuntimeContext(context),
      config: {apiKey: 'fake-api-key-not-real'}, // encrypted for the connector unless the field is `plain`
    });

    const health = await harness.aloma.waitForPacket('connector.health.check');
    expect(health.a).to.deep.equal({ok: true, error: null});
  });

  it('calls a method against a mocked vendor API', async () => {
    harness = await ConnectorHarness.start({/* same as above */});
    harness.vendor.get('https://api.vendor.example/things/1', {json: {id: 1}});

    expect(await harness.callOk('getThing', {id: 1})).to.deep.equal({id: 1});
  });
});
```

Useful pieces: `harness.call(method, variables, ctx)` (raw answer, `{error}` on failure), `harness.callOk(...)`,
`harness.vendor.get/post/put/delete(url | RegExp | fn, {status, json, text, headers} | fn(request))`,
`harness.vendor.requests` (what the connector sent), `harness.aloma.handle('connector.blob.create', fn)` to answer
requests the connector makes to ALOMA, `harness.aloma.registration` (what the connector registered).
`test/harness-connector-smoke.test.mjs` in this repo is a runnable version of the example.

Not covered: the Prometheus metrics server (fixed port 4050), process signal handlers, configuration through
environment variables and OAuth flows against a real provider. `connectorFromRuntimeContext` repeats the wiring of
`RuntimeContext.start()`, so keep the two in step.

SDK maintainers: `yarn test:harness` runs the harness tests (CI runs it on Node 18, 20, 22 and 24). `yarn test:mutation`
applies 30+ deliberate bugs to the harness and the SDK handshake, dispatch and result paths and checks the tests
catch each one; the result is recorded in `test/MUTATION.md`.

## 📚 Documentation

- **[OPENAPI_TO_CONNECTOR.md](./OPENAPI_TO_CONNECTOR.md)** - OpenAPI generator details
- **[MULTI_RESOURCE_GUIDE.md](./MULTI_RESOURCE_GUIDE.md)** - Complete guide for multi-resource connectors

## 🚀 Quick Examples

### HubSpot Multi-Resource Connector
```bash
# Create complete HubSpot connector with 3 resources
npx @aloma.io/integration-sdk@latest create-multi-resource "HubSpot-v2" \
  --connector-id "hubspot-123" \
  --resources "CompaniesResource:examples/hubspot-companies.json,ContactsResource:examples/hubspot-contacts.json,ListsResource:examples/hubspot-lists.json" \
  --no-build

```
