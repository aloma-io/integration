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
